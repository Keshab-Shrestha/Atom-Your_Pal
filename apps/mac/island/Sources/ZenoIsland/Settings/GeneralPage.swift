import SwiftUI
import ZenoIslandCore

/// Open at login, sounds, permissions (ADR-075) and the tour. Each page with choices has its own reset (ADR-079).
struct GeneralSection: View {
    let model: IslandModel

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
        PermissionsCard(model: model)
            .onAppear { model.permissions.startPolling() }
            .onDisappear { model.permissions.stopPolling() }
        Card(footer: settings.petEnabled ? nil : "Turn on Wisp to see the tour.") {
            Row(title: "Replay the tour", detail: "Wisp shows where to talk and where your settings live") {
                PillButton(title: "Replay") { model.replayTour() }
                    .disabled(!settings.petEnabled)
            }
        }
    }
}

@MainActor private func loginFooter(_ login: LoginItem) -> String? {
    if !login.available { return "Available when ZENO runs as an app (pnpm island:open)." }
    return login.error
}
