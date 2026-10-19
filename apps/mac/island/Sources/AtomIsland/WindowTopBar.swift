import AppKit
import SwiftUI
import AtomIslandCore

/// ADR-091: the bar along the top of the window's main pane: the page's name, a hairline under it, and room for the
/// page's own controls. It moves the window like a title bar, and a double click zooms it.
struct WindowTopBar<Trailing: View>: View {
    let title: String
    let symbol: String
    var compact = false
    var context: String? = nil
    /// ADR-128: set while the sidebar is hidden: the button that shows it again sits at the bar's left end.
    var showSidebar: (() -> Void)? = nil
    /// ADR-096: Back, when there is a step to go back to (else no arrow).
    var back: (() -> Void)? = nil
    @ViewBuilder let trailing: () -> Trailing
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        HStack(spacing: 8) {
            if let showSidebar { SidebarToggleButton(hidden: true, action: showSidebar) }
            if let back {
                Button(action: back) {
                    Image(systemName: "chevron.left").font(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text2.color)
                        .frame(width: 24, height: 24).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Back (⌘[)")
                .accessibilityLabel("Back")
            }
            if !compact { Image(systemName: symbol).font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color) }
            if compact, let context {
                Text(context).font(.system(size: 13)).foregroundStyle(theme.text3.color).lineLimit(1)
                Text("/").foregroundStyle(theme.text3.color)
            }
            Text(title).font(.system(size: compact ? 13 : 12.5, weight: compact ? .medium : .semibold)).foregroundStyle(theme.text.color).lineLimit(1)
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.leading, compact && showSidebar != nil ? 82 : 18)
        .padding(.trailing, 18)
        .frame(height: compact ? 44 : HelpersView.titleBarRoom)
        // 2026-10-15: room above the bar, so the back arrow and the page's name sit level with the app name in the
        // sidebar and not up beside the window's buttons. It is part of the bar: it still moves the window.
        .padding(.top, compact ? 8 : HelpersView.topBarGap)
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

/// ADR-097: the chat's own model. Picking one applies to this chat only; "Default" follows Settings → Model.
/// Voice and new chats use the default.
struct ChatModelMenu: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @State private var customOpen = false
    @State private var customId = ""

    var body: some View {
        if let info = model.modelInfo {
            let chats = model.chats
            let ownProvider = chats?.currentProvider
            let ownModel = chats?.currentModel
            let value = ownProvider.flatMap { p in ownModel.map { info.modelName(provider: p, model: $0) } } ?? info.currentModelName
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
                Text(value + "  ⌄").font(.system(size: 12)).foregroundStyle(theme.text2.color)
            }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).buttonStyle(.plain).fixedSize()
            .help("The model for this chat only")
            .accessibilityLabel("Model for this chat")
            .accessibilityIdentifier("chat.model")
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

/// ADR-128: the sidebar button: in the sidebar's header while it is shown, in the top bar's left end while it is hidden.
struct SidebarToggleButton: View {
    let hidden: Bool
    let action: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            Image(systemName: "sidebar.left").font(.system(size: 13, weight: .regular)).foregroundStyle(theme.text2.color)
                .frame(width: 24, height: 24).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(WindowChrome.sidebarToggleHelp(hidden: hidden))
        .accessibilityLabel(WindowChrome.sidebarToggleTitle(hidden: hidden))
    }
}
