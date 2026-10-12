import SwiftUI
import ZenoIslandCore

/// Open at login, sounds, permissions (ADR-075) and the tour. Each page with choices has its own reset (ADR-079).
struct GeneralSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let settings = model.settings
        let login = model.loginItem
        Card(footer: loginFooter(login)) {
            Row(title: "Open at login", detail: "Start ZENO when you log in to this Mac") {
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
            Row(title: "Sounds", detail: "A soft tone when listening starts and stops") {
                ThemedSwitch(isOn: settings.soundsEnabled, set: { settings.soundsEnabled = $0 }, label: "Sounds")
            }
            RowDivider()
            Row(title: "Answer without keys", detail: "When ZENO asks you something, it listens for a few seconds") {
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
            }
        }
        // ADR-091: which macOS notifications ZENO posts.
        Card("Notifications", footer: "Shown by macOS. Titles and short reasons only, never a report's text. Allow ZENO in System Settings → Notifications if none appear.") {
            ForEach(Array(AppNotice.Kind.allCases.enumerated()), id: \.element) { index, kind in
                if index > 0 { RowDivider() }
                Row(title: kind.title, detail: Self.detail(kind)) {
                    ThemedSwitch(isOn: settings.notifies(kind), set: { settings.setNotifies(kind, $0) }, label: kind.title)
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
    static func detail(_ kind: AppNotice.Kind) -> String {
        switch kind {
        case .needsYou: "A plan, a held task, a proposal, or ZENO asking for your OK"
        case .done: "A worker finished, with its report's title"
        case .failed: "A task failed, and why"
        case .budget: "A budget or the Claude plan passing 80%, or used up"
        }
    }
}

@MainActor private func loginFooter(_ login: LoginItem) -> String? {
    if !login.available { return "Available when ZENO runs as an app (pnpm island:open)." }
    return login.error
}
