import AppKit
import SwiftUI
import AtomIslandCore

/// Open at login and the tour (ADR-097: the sounds moved to Settings → Sounds). The rest of what this page held now sits
/// under the page that names its purpose: Computer, Notifications, Connections and Privacy. Each page with choices has its own reset (ADR-079).
struct GeneralSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

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
        Card(footer: settings.petEnabled ? nil : "Turn on ATOM to see the tour.") {
            Row(title: "Replay the tour", detail: "ATOM shows where to talk and where your settings live") {
                PillButton(title: "Replay") { model.replayTour() }
                    .disabled(!settings.petEnabled)
            }
        }
    }
}

@MainActor private func loginFooter(_ login: LoginItem) -> String? {
    if !login.available { return "Available when ATOM runs as an app (pnpm island:open)." }
    return login.error
}
