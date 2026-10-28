import SwiftUI
import AtomIslandCore

struct ComputerDecisionSettings: View {
    let model: IslandModel
    @State private var key = ""
    @State private var remove = false
    @State private var enableJev = false
    var body: some View {
        let decisions = model.computerDecisions
        Card("Computer decisions", footer: "The chat model prepares and reviews tasks. Jev or Laya can choose between prepared button plans; checked observations, approvals and Stop still apply. This cannot shorten the driver's click waits. Low confidence returns to the chat model.") {
            Row(title: "Decision provider", detail: "Applies to the next fast decision. Existing chats and permissions stay as they are.") {
                Picker("Computer decision provider", selection: Binding(get: { decisions.provider }, set: { value in
                    if value == "jev" { enableJev = true } else { decisions.setProvider(value) }
                })) {
                    Text("Chat model (default)").tag("off")
                    Text("Jev · cloud").tag("jev")
                    Text("Laya · local").tag("laya")
                }.labelsHidden().frame(maxWidth: 210)
            }
            if decisions.provider == "jev" {
                RowDivider()
                Row(title: "Laya backup", detail: "Use local Laya only if Jev is unavailable. Uncertain Jev answers return to the chat model.") {
                    ThemedSwitch(isOn: decisions.backup, set: { decisions.setBackup($0) }, label: "Use Laya if Jev is unavailable")
                }
            }
            if decisions.provider == "laya" {
                RowDivider()
                Row(title: "Local Laya", detail: "Uses the existing installation. No installation or download is performed. A cold or unavailable model returns to the chat model.") { EmptyView() }
            }
            RowDivider()
            Row(title: "Jev API key", detail: decisions.hasKey ? "Saved in macOS Keychain. Never shown here." : "Not configured. Get a key from console.typesafe.ai.") {
                SecureField(decisions.hasKey ? "Replace API key" : "Jev API key", text: $key)
                    .textFieldStyle(.roundedBorder).frame(maxWidth: 230).accessibilityLabel("Jev API key")
                PillButton(title: "Save key") { if decisions.saveKey(key) { key = "" } }.disabled(key.isEmpty)
            }
            if decisions.hasKey {
                Row(title: "Remove saved key", detail: "Removes only ATOM's Jev credential; it does not revoke it at TypeSafe.") {
                    PillButton(title: "Remove key") { remove = true }
                }
            }
            if let note = decisions.note { Row(title: note) { EmptyView() } }
        }
        .onAppear { decisions.refreshKeyStatus() }
        .onDisappear { key = "" }
        .confirmationDialog("Use Jev for computer decisions?", isPresented: $enableJev) {
            Button("Use Jev") { decisions.setProvider("jev") }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("During an authorized computer task, ATOM sends the goal, prepared button plans, button labels and bounded read-only window text to TypeSafe at api.typesafe.ai. No screenshots, editable-field values or chat history are included. API charges may apply. Your key stays in Keychain. This never approves actions.")
        }
        .confirmationDialog("Remove ATOM's saved Jev API key?", isPresented: $remove) {
            Button("Remove key", role: .destructive) { decisions.removeKey() }
            Button("Cancel", role: .cancel) {}
        }
    }
}
