import SwiftUI
import ArkIslandCore

/// Settings → Defaults (Keshab, 2026-11-02): what new chats and the window start with, saved on this Mac. Each chat can still change
/// its own model, thinking and access.
struct DefaultsSection: View {
    let model: IslandModel
    @State private var pickingModel = false
    @State private var confirmingFull = false
    @Environment(\.theme) private var theme

    var body: some View {
        let settings = model.settings
        Card("New chats", footer: "For a chat you start in the ARK window. Thinking is used only when the model has that level. Each chat can change these for itself.") {
            if let info = model.modelInfo {
                Row(title: "Model", detail: "New chats and voice answer with it") {
                    Button { pickingModel = true } label: {
                        HStack(spacing: 8) {
                            ProviderIcon(provider: info.provider, size: 12)
                            MenuLabel(text: info.currentModelName, identifier: true)
                        }
                    }
                    .buttonStyle(.plain).fixedSize().disabled(model.pendingModel != nil)
                    .accessibilityLabel("Default model: " + info.currentModelName)
                    .popover(isPresented: $pickingModel, arrowEdge: .bottom) {
                        ChatModelPicker(model: model, info: info, setsDefault: true, close: { pickingModel = false }).themed(theme)
                    }
                }
                RowDivider()
            }
            ChoiceRow(title: "Thinking", selection: settings.newChatEffort) { settings.newChatEffort = $0 }
            RowDivider()
            Row(title: "Access", detail: settings.newChatAccess.detail) {
                ThemedMenu(selection: settings.newChatAccess) { mode in
                    if mode == .full, settings.newChatAccess != .full { confirmingFull = true } else { settings.newChatAccess = mode }
                }
            }
            RowDivider()
            ChoiceRow(title: "New chat goes to", detail: "For ⌘N and the sidebar's new chat button", selection: settings.newChatPlace) { settings.newChatPlace = $0 }
        }
        Card("Window", footer: "The Dashboard's switch changes the range too.") {
            ChoiceRow(title: "Opens on", selection: settings.startPage) { settings.startPage = $0 }
            RowDivider()
            ChoiceRow(title: "Dashboard trends", selection: settings.dashboardRange) { settings.dashboardRange = $0 }
        }
        ResetPageCard(footer: "New chats go back to Saved permissions, the model's thinking and the sidebar's project; the window opens on Chat.") {
            settings.resetDefaults()
        }
        .onChange(of: [settings.newChatAccess.rawValue, settings.newChatEffort.rawValue]) { model.sendChatDefaults() }
        .alert("Start every new chat in Full access?", isPresented: $confirmingFull) {
            Button("Use Full access") { settings.newChatAccess = .full }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("New chats skip routine file, command and plugin prompts, and allowed commands can run outside the sandbox. Protected files and macOS permissions still ask, and a chat that reads the web asks again. Full access needs Claude or Codex; with another model a new chat uses Saved permissions.")
        }
    }
}

extension IslandModel {
    /// Tells the runtime what a new chat starts with (on ready and on each change).
    func sendChatDefaults() {
        send(.chatDefaults(access: settings.newChatAccess, effort: settings.newChatEffort.rawValue))
    }

    /// Settings → Defaults: the page the window opens on.
    func goToStartPage() {
        let page = settings.startPage == .last ? settings.lastWindowPage : settings.startPage
        switch page {
        case .board: windowPage = .agents; helpers.selectBoard()
        case .dashboard: windowPage = .dashboard
        case .chat, .last: windowPage = .chat
        }
    }

    /// Kept when the window closes, for "Last page used". Other pages count as Chat.
    func rememberWindowPage() {
        settings.lastWindowPage = windowPage == .dashboard ? .dashboard : windowPage == .agents && helpers.showsBoard ? .board : .chat
    }
}
