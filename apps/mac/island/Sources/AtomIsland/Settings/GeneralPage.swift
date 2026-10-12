import AppKit
import SwiftUI
import AtomIslandCore

/// Open at login, permissions (ADR-075) and the tour (ADR-097: the sounds moved to Settings → Sounds). Each page with choices has its own reset (ADR-079).
struct GeneralSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    /// ADR-098 item 5: what "Copy token" did ("Copied", or why not). Never the token.
    @State private var tokenNote: String?

    var body: some View {
        let settings = model.settings
        let login = model.loginItem
        Card(footer: loginFooter(login)) {
            Row(title: "Open at login", detail: "Start ATOM when you log in to this Mac") {
                ThemedSwitch(isOn: login.enabled || login.needsApproval, set: { login.set($0) }, label: "Open at login")
                    .disabled(!login.available)
            }
            if login.needsApproval || login.error != nil {
                RowDivider()
                Row(title: "Needs your OK in System Settings") {
                    PillButton(title: "Open…") { login.openSystemSettings() }
                }
            }
            RowDivider()
            Row(title: "Answer without keys", detail: "Off: one turn, then ATOM waits. On: after a spoken question it listens for a few seconds") {
                ThemedSwitch(isOn: settings.followUpEnabled, set: { settings.followUpEnabled = $0 }, label: "Answer without keys")
            }
        }
        .onAppear { login.refresh() }
        // ADR-095: the team-wide limit on parallel runs. Nil from an older runtime: no row.
        if let maxRunning = model.helpers.list?.maxRunning {
            Card("Team", footer: "Budgets and the plan limit still hold new runs. Lowering it stops nothing already running.") {
                Row(title: "Runs at once", detail: "How many tasks the team runs at the same time. Each one uses your Claude plan.") {
                    Stepper(value: Binding(get: { maxRunning }, set: { model.sendHelpers(model.helpers.setMaxRunning($0)) }),
                            in: HelpersState.maxRunningRange) {
                        Text("\(maxRunning)").font(.system(size: 12, weight: .medium)).monospacedDigit().foregroundStyle(theme.text.color)
                    }
                    .fixedSize()
                    .accessibilityLabel("Runs at once")
                    .accessibilityValue("\(maxRunning)")
                }
                // ADR-098 item 7: shown only when Codex is found and signed in.
                if let list = model.helpers.list, list.codexReady {
                    RowDivider()
                    Row(title: "Use Codex when the Claude plan limit is reached",
                        detail: "A task held only by the plan's limit runs on Codex (your ChatGPT plan). Same folders, no network.") {
                        ThemedSwitch(isOn: list.codexFallback, set: { model.sendHelpers(model.helpers.setCodexFallback($0)) },
                                     label: "Use Codex when the Claude plan limit is reached")
                    }
                }
            }
        }
        // ADR-091: which macOS notifications ATOM posts.
        Card("Notifications", footer: "Shown by macOS. Titles and short reasons only, never a report's text. Allow ATOM in System Settings → Notifications if none appear.") {
            ForEach(Array(AppNotice.Kind.allCases.enumerated()), id: \.element) { index, kind in
                if index > 0 { RowDivider() }
                Row(title: kind.title, detail: Self.detail(kind)) {
                    ThemedSwitch(isOn: settings.notifies(kind), set: { settings.setNotifies(kind, $0) }, label: kind.title)
                }
            }
        }
        // ADR-098: ATOM's own Telegram bot. The names only, never the values.
        Card("Telegram", footer: model.telegramConnected
             ? "Only the chat in ATOM_TELEGRAM_CHAT_ID is served. Send /help to the bot for its commands."
             : "Make a bot for ATOM with @BotFather. Add ATOM_TELEGRAM_BOT_TOKEN and ATOM_TELEGRAM_CHAT_ID to .env, then restart ATOM.") {
            Row(title: "Telegram", detail: model.telegramConnected ? "Connected" : "Not set up") {
                StatusDot(color: model.telegramConnected ? theme.success.color : theme.text3.color, size: 8)
            }
            RowDivider()
            Row(title: "Send to Telegram", detail: "What needs you, finished goals and schedule results") {
                ThemedSwitch(isOn: settings.telegramPush, set: { settings.telegramPush = $0; model.send(.telegramSet(push: $0)) }, label: "Send to Telegram")
                    .disabled(!model.telegramConnected)
            }
        }
        // ADR-098 item 5: the local API for Hermes, Claude Code and other tools on this Mac. The token is never shown:
        // "Copy token" reads data/api-token when clicked and puts it on the clipboard.
        Card("Local API", footer: "Listens on 127.0.0.1 only. Each request needs the token. Add the MCP server to Claude Code with: claude mcp add atom -- node <ATOM folder>/apps/mac/src/mcp-serve.ts") {
            Row(title: "Local API", detail: apiDetail(on: settings.localApi)) {
                ThemedSwitch(isOn: settings.localApi, set: { settings.localApi = $0; tokenNote = nil; model.send(.apiSet(on: $0)) }, label: "Local API")
            }
            if settings.localApi, let api = model.apiStatus, api.on {
                RowDivider()
                Row(title: "Token", detail: tokenNote ?? "For the header Authorization: Bearer <token>") {
                    PillButton(title: "Copy token") { copyToken(api.tokenFile) }
                }
            }
        }
        PermissionsCard(model: model)
            .onAppear { model.permissions.startPolling() }
            .onDisappear { model.permissions.stopPolling() }
        Card(footer: settings.petEnabled ? nil : "Turn on ATOM to see the tour.") {
            Row(title: "Replay the tour", detail: "ATOM shows where to talk and where your settings live") {
                PillButton(title: "Replay") { model.replayTour() }
                    .disabled(!settings.petEnabled)
            }
        }
    }
}

extension GeneralSection {
    func apiDetail(on: Bool) -> String {
        guard on else { return "Other tools on this Mac can give ATOM goals and read results" }
        guard let api = model.apiStatus else { return "Starting…" }
        if let error = api.error { return error }
        return api.on ? "Listening on 127.0.0.1:\(api.port)" : "Starting…"
    }

    /// Reads the token file on click only; the token goes to the clipboard and nowhere else.
    func copyToken(_ path: String) {
        guard let token = try? String(contentsOfFile: path, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {
            tokenNote = "Could not read \(path)"
            return
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(token, forType: .string)
        tokenNote = "Copied"
    }

    static func detail(_ kind: AppNotice.Kind) -> String {
        switch kind {
        case .needsYou: "A plan, a held task, a proposal, or ATOM asking for your OK"
        case .done: "A worker finished, with its report's title"
        case .failed: "A task failed, and why"
        case .budget: "A budget or the Claude plan passing 80%, or used up"
        }
    }
}

@MainActor private func loginFooter(_ login: LoginItem) -> String? {
    if !login.available { return "Available when ATOM runs as an app (pnpm island:open)." }
    return login.error
}
