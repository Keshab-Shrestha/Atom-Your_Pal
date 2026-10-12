import AppKit
import SwiftUI
import ZenoIslandCore

/// ADR-091: the bar along the top of the window's main pane: the page's name, a hairline under it, and room for the
/// page's own controls (the chat's sounds). It moves the window like a title bar, and a double click zooms it.
struct WindowTopBar<Trailing: View>: View {
    let title: String
    let symbol: String
    /// ADR-096: Back, when there is a step to go back to (else no arrow).
    var back: (() -> Void)? = nil
    @ViewBuilder let trailing: () -> Trailing
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        HStack(spacing: 8) {
            if let back {
                Button(action: back) {
                    Image(systemName: "chevron.left").font(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text2.color)
                        .frame(width: 24, height: 24).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Back (⌘[)")
                .accessibilityLabel("Back")
            }
            Image(systemName: symbol).font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
            Text(title).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(1)
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, 18)
        .frame(height: HelpersView.titleBarRoom)
        // Snapshots cannot draw an AppKit view; the window can.
        .background { if !snapshot { WindowDragArea() } }
        .overlay(alignment: .bottom) {
            Rectangle().fill(theme.isFlat ? theme.border.color : theme.separator.color).frame(height: theme.isFlat ? 1 : 0.5)
        }
    }
}

extension WindowTopBar where Trailing == EmptyView {
    init(title: String, symbol: String) {
        self.init(title: title, symbol: symbol) { EmptyView() }
    }
}

/// An empty area that moves the window when dragged, and zooms it on a double click, as a title bar does.
struct WindowDragArea: NSViewRepresentable {
    final class DragView: NSView {
        override var mouseDownCanMoveWindow: Bool { true }

        override func mouseDown(with event: NSEvent) {
            if event.clickCount == 2 { window?.zoom(nil); return }
            window?.performDrag(with: event)
        }
    }

    func makeNSView(context: Context) -> NSView { DragView() }
    func updateNSView(_ nsView: NSView, context: Context) {}
}

/// ADR-091: the chat's sounds: reports and updates said aloud, and the start and stop sounds. Off, they only show.
struct ChatSoundsMenu: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let settings = model.settings
        let quiet = !settings.speakReports && !settings.speakUpdates
        Menu {
            Toggle("Speak the team's reports", isOn: Binding(get: { settings.speakReports }, set: { settings.speakReports = $0; push() }))
            Toggle("Speak timers and updates", isOn: Binding(get: { settings.speakUpdates }, set: { settings.speakUpdates = $0; push() }))
            Divider()
            Toggle("Chime before speaking", isOn: Binding(get: { settings.speechChime }, set: { settings.speechChime = $0; push() }))
            Divider()
            Toggle("Start and stop sounds", isOn: Binding(get: { settings.soundsEnabled }, set: { settings.soundsEnabled = $0 }))
            Toggle("Notification sounds", isOn: Binding(get: { settings.notificationSounds }, set: { settings.notificationSounds = $0 }))
            Divider()
            Button("Sound settings…") { model.navigate { model.openSoundSettings() } }
        } label: {
            PillMenuLabel(label: "Sounds", value: quiet ? "Quiet" : settings.speakReports && settings.speakUpdates ? "On" : "Some", dimmed: quiet, identifier: false)
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .help("What ZENO says aloud while you chat")
        .accessibilityLabel("Sounds")
    }

    private func push() { model.sendSpeech() }
}

/// ADR-097: the chat's own model. Picking one applies to this chat only; "Default" follows Settings → Model.
/// Voice and new chats use the default.
struct ChatModelMenu: View {
    let model: IslandModel
    @State private var customOpen = false
    @State private var customId = ""

    var body: some View {
        if let info = model.modelInfo {
            let chats = model.chats
            let ownProvider = chats?.currentProvider
            let ownModel = chats?.currentModel
            let value = ownProvider.flatMap { p in ownModel.map { info.modelName(provider: p, model: $0) } } ?? "Default"
            Menu {
                Button {
                    model.chooseChatModel(provider: nil, model: nil)
                } label: {
                    let name = "Default (\(info.currentModelName))"
                    if ownModel == nil { Label(name, systemImage: "checkmark") } else { Text(name) }
                }
                ForEach(info.providers.filter(\.available)) { provider in
                    Section(provider.name) {
                        ForEach(provider.models) { option in
                            Button {
                                model.chooseChatModel(provider: provider.id, model: option.id)
                            } label: {
                                if provider.id == ownProvider && option.id == ownModel { Label(option.name, systemImage: "checkmark") } else { Text(option.name) }
                            }
                        }
                    }
                }
                Divider()
                Button("Custom model…") { customOpen = true }
            } label: {
                PillMenuLabel(label: "Model", value: value, dimmed: ownModel == nil)
            }
            .menuStyle(.button).buttonStyle(.plain).fixedSize()
            .help("The model for this chat only")
            .accessibilityLabel("Model for this chat")
            .alert("Custom model for this chat", isPresented: $customOpen) {
                TextField("model-id", text: $customId)
                Button("Save") {
                    let id = customId.trimmingCharacters(in: .whitespaces)
                    if ModelInfo.isValidModelId(id) { model.chooseChatModel(provider: ownProvider ?? info.provider, model: id) }
                    customId = ""
                }
                Button("Cancel", role: .cancel) { customId = "" }
            } message: {
                Text("Type the model id for \(info.providers.first { $0.id == (ownProvider ?? info.provider) }?.name ?? "the provider"). Use up to 100 letters, digits, \".\", \"_\", \":\" or \"-\".")
            }
        }
    }
}
