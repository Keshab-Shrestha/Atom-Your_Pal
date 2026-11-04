import AppKit
import SwiftUI
import ArkIslandCore

/// What ARK may use on this Mac (ADR-075), what it remembers, and where to read it.
struct PrivacySection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        PermissionsCard(model: model)
            .onAppear { model.permissions.startPolling() }
            .onDisappear { model.permissions.stopPolling() }
            // The window is closed and opened again without the page disappearing and appearing: start again when it comes back.
            .onReceive(NotificationCenter.default.publisher(for: NSWindow.didBecomeKeyNotification)) { _ in model.permissions.startPolling() }
        // Remembering by itself (upgrades.md C2). 2026-11-04 (Keshab): it keeps what it notices at once, with no question.
        Card("Memory", footer: "After a chat, ARK keeps a lasting fact you stated, such as \"prefers window seats\", with no question. It never keeps passwords or other secrets, or facts from web pages and files. See, edit or forget every fact in Second brain.") {
            Row(title: "Remember by itself", detail: "Saved quietly after a chat. Never spoken") {
                ThemedSwitch(isOn: model.suggestions.enabled, set: { model.setSuggestionsEnabled($0) }, label: "Remember by itself")
            }
        }
            .onAppear { model.loadSuggestions() }
        Card(footer: "Facts, conversation notes and kept chats stay on this Mac.") {
            Row(title: "What ARK remembers", detail: "Facts, conversation notes and kept chats") {
                PillButton(title: "Open Second brain") { model.navigate { model.windowPage = .brain } }
            }
        }
        ChatHistoryCard(model: model)
    }
}

/// Every saved chat: copied out as Markdown files, or deleted for good after a question (2026-10-31).
private struct ChatHistoryCard: View {
    let model: IslandModel
    @State private var confirming = false
    @Environment(\.theme) private var theme

    var body: some View {
        let count = model.chats?.chats.count ?? 0
        Card("Chat history", footer: "Export writes one Markdown file per chat into a new folder. Delete removes every chat, including project chats, and their chat notes in Second brain. Facts and your own notes stay.") {
            Row(title: "Export all chats", detail: count == 1 ? "1 saved chat" : "\(count) saved chats") {
                PillButton(title: "Export…", symbol: "square.and.arrow.up") { chooseFolder() }
                    .disabled(model.chatHistoryPending || count == 0)
            }
            RowDivider()
            Row(title: "Delete all chats", detail: "This cannot be undone") {
                Button { confirming = true } label: {
                    Label("Delete all…", systemImage: "trash").appFont(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.problem.color)
                        .padding(.horizontal, 12).frame(height: ControlMetrics.buttonHeight)
                        .background(Capsule().fill(theme.problem.color.opacity(0.12)))
                }
                .buttonStyle(.pressable)
                .disabled(model.chatHistoryPending || count == 0)
            }
            if model.chatHistoryPending || model.chatHistoryResult != nil {
                RowDivider()
                HStack(spacing: 8) {
                    if model.chatHistoryPending { ProgressView().controlSize(.small) }
                    Text(model.chatHistoryPending ? "Working…" : model.chatHistoryResult?.sentence ?? "")
                        .appFont(.system(size: 12)).foregroundStyle(model.chatHistoryResult?.ok == false ? theme.problem.color : theme.text2.color)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    if let folder = model.chatHistoryResult?.folder, model.chatHistoryResult?.ok == true {
                        PillButton(title: "Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: folder)]) }
                    }
                }
                .padding(.horizontal, Spacing.well).padding(.vertical, 12)
            }
        }
        .confirmationDialog("Delete all \(count) chats?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Delete all chats", role: .destructive) { model.clearChats() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Every chat and its messages are removed for good. Export them first if you may want them later.")
        }
    }

    /// The folder the export goes into; a new "ARK chats <date>" folder is made inside it.
    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Export here"
        panel.message = "Choose where to put the exported chats. ARK makes a new folder inside it."
        panel.directoryURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        guard panel.runModal() == .OK, let url = panel.url else { return }
        model.exportChats(to: url)
    }
}
