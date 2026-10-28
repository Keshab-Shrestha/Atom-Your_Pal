import AppKit
import SwiftUI
import AtomIslandCore

/// ADR-054: computer control, with the questions ATOM asks before a risky step. Its permissions are under Privacy.
struct ComputerSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let settings = model.settings
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
        Card {
            Row(title: "Needs Screen Recording and Accessibility", detail: "Check them in Privacy.") {
                PillButton(title: "Open Privacy") { model.settingsPage = .privacy }
            }
        }
    }
}
