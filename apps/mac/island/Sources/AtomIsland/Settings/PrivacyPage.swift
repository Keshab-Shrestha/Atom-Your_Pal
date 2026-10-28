import AppKit
import SwiftUI
import AtomIslandCore

/// What ATOM may use on this Mac (ADR-075), what it remembers, and where to read it.
struct PrivacySection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        PermissionsCard(model: model)
            .onAppear { model.permissions.startPolling() }
            .onDisappear { model.permissions.stopPolling() }
            // The window is closed and opened again without the page disappearing and appearing: start again when it comes back.
            .onReceive(NotificationCenter.default.publisher(for: NSWindow.didBecomeKeyNotification)) { _ in model.permissions.startPolling() }
        // Remembering by itself (upgrades.md C2): nothing is kept without a press of Remember.
        Card("Memory", footer: "After a chat, ATOM may notice a lasting fact about you, such as \"prefers window seats\". It shows it above the chat box. It keeps the fact only when you press Remember, and never asks again for one you refuse.") {
            Row(title: "Suggest things to remember", detail: "Quiet rows above the chat box. Never spoken") {
                ThemedSwitch(isOn: model.suggestions.enabled, set: { model.setSuggestionsEnabled($0) }, label: "Suggest things to remember")
            }
        }
            .onAppear { model.loadSuggestions() }
        Card(footer: "Facts, conversation notes and kept chats stay on this Mac.") {
            Row(title: "What ATOM remembers", detail: "Facts, conversation notes and kept chats") {
                PillButton(title: "Open Second brain") { model.navigate { model.windowPage = .brain } }
            }
        }
    }
}
