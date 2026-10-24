import AppKit
import SwiftUI
import AtomIslandCore

/// Open at login, permissions (ADR-075) and the tour (ADR-097: the sounds moved to Settings → Sounds). Each page with choices has its own reset (ADR-079).
struct GeneralSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    /// ADR-098 item 5: what "Copy token" did ("Copied", or why not). Never the token.
    @State private var tokenNote: String?
    /// "Regenerate" asks first: tools that hold the old token stop working.
    @State private var askingRegenerate = false

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
        .onAppear { login.refresh(); model.loadSuggestions() }
        BriefSettingsCard(model: model) // upgrades.md C3
        // Remembering by itself (upgrades.md C2): nothing is kept without a press of Remember.
        Card("Memory", footer: "After a chat, ATOM may notice a lasting fact about you, such as \"prefers window seats\". It shows it above the chat box. It keeps the fact only when you press Remember, and never asks again for one you refuse.") {
            Row(title: "Suggest things to remember", detail: "Quiet rows above the chat box. Never spoken") {
                ThemedSwitch(isOn: model.suggestions.enabled, set: { model.setSuggestionsEnabled($0) }, label: "Suggest things to remember")
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
             ? "Only the chat in ATOM_TELEGRAM_CHAT_ID is served. Send /help to the bot for its commands. More: docs/telegram.md."
             : "Make a bot for ATOM with @BotFather. Add ATOM_TELEGRAM_BOT_TOKEN and ATOM_TELEGRAM_CHAT_ID to .env, then restart ATOM. Steps: docs/telegram.md in the ATOM folder.") {
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
                    PillButton(title: "Regenerate") { askingRegenerate = true }
                        .confirmationDialog("Make a new token?", isPresented: $askingRegenerate) {
                            Button("Make a new token", role: .destructive) {
                                model.send(.apiRegenerate)
                                tokenNote = "New token made. The old one no longer works. Copy the new one."
                            }
                            Button("Cancel", role: .cancel) {}
                        } message: {
                            Text("Every tool that uses the old token (the MCP server, Hermes, scripts) stops working until you give it the new one.")
                        }
                }
                RowDivider()
                // ADR-121: the phone page. ATOM stays on 127.0.0.1; Tailscale Serve forwards one private name to it.
                Row(title: "Phone", detail: "Install Tailscale on the Mac and the phone. Run the command once, put your .ts.net name in .env as ATOM_API_HOST, restart ATOM, then open https://<name>/app on the phone. Steps: docs/mobile.md") {
                    PillButton(title: "Copy command") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString("tailscale serve --bg \(api.port)", forType: .string)
                    }
                }
            }
        }
        // ADR-054: computer control. The runtime restarts to apply the switch; the switch shows the runtime's real state.
        Card("Computer control", footer: "ATOM can click, type and read the screen in other apps. Risky steps ask you first. It needs Screen Recording and Accessibility for Cua Driver.") {
            Row(title: "Computer control", detail: model.computerRestarting ? "Restarting ATOM…" : "Lets ATOM use other apps for you. ATOM restarts when you change this.") {
                ThemedSwitch(isOn: model.computerRestarting ? (model.settings.computerOverride ?? model.computerOn) : model.computerOn,
                             set: { model.setComputer($0) }, label: "Computer control")
                    .disabled(model.computerRestarting)
            }
            Row(title: "Work in the foreground", detail: "Brings each app to the front while ATOM acts, then gives focus back. Off: ATOM works behind your windows. You can also ask for either in a request.") {
                ThemedSwitch(isOn: settings.computerForeground, set: { settings.computerForeground = $0; model.send(.computerMode(foreground: $0)) }, label: "Work in the foreground")
                    .disabled(!model.computerOn)
            }
        }
        ComputerDecisionSettings(model: model)
        PermissionsCard(model: model)
            .onAppear { model.permissions.startPolling() }
            .onDisappear { model.permissions.stopPolling() }
            // The window is closed and opened again without the page disappearing and appearing: start again when it comes back.
            .onReceive(NotificationCenter.default.publisher(for: NSWindow.didBecomeKeyNotification)) { _ in model.permissions.startPolling() }
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
        SecretClipboard.copy(token) // concealed, and cleared after 60 seconds
        tokenNote = "Copied. It leaves the clipboard in \(Int(SecretClipboard.clearAfter)) seconds."
    }

    static func detail(_ kind: AppNotice.Kind) -> String {
        switch kind {
        case .needsYou: "A plan, a held task, a proposal, or ATOM asking for your OK"
        case .done: "A worker finished, with its report's title"
        case .failed: "A task failed, and why"
        case .planUse: "The Claude plan passing 80% of its five hours, or used up"
        case .brief: "Your daily brief is ready"
        }
    }
}

@MainActor private func loginFooter(_ login: LoginItem) -> String? {
    if !login.available { return "Available when ATOM runs as an app (pnpm island:open)." }
    return login.error
}
