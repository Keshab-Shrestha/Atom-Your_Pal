import AppKit
import SwiftUI
import ZenoIslandCore

/// ADR-091: the bar along the top of the window's main pane: the page's name, a hairline under it, and room for the
/// page's own controls (the chat's sounds). It moves the window like a title bar, and a double click zooms it.
struct WindowTopBar<Trailing: View>: View {
    let title: String
    let symbol: String
    @ViewBuilder let trailing: () -> Trailing
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        HStack(spacing: 8) {
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
            Toggle("Start and stop sounds", isOn: Binding(get: { settings.soundsEnabled }, set: { settings.soundsEnabled = $0 }))
        } label: {
            PillMenuLabel(label: "Sounds", value: quiet ? "Quiet" : settings.speakReports && settings.speakUpdates ? "On" : "Some", dimmed: quiet, identifier: false)
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .help("What ZENO says aloud while you chat")
        .accessibilityLabel("Sounds")
    }

    private func push() {
        model.send(.speechSet(reports: model.settings.speakReports, updates: model.settings.speakUpdates))
    }
}
