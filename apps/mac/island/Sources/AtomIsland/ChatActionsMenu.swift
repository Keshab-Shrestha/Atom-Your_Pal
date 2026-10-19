import AppKit
import SwiftUI
import AtomIslandCore

/// Secondary actions stay focusable without adding a row beneath every message.
struct ChatActionsMenu<Actions: View>: View {
    let title: String
    var attention = false
    var revealed = true
    @FocusState private var focused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ViewBuilder let actions: () -> Actions
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        Group {
            if snapshot { label } else {
                Menu(content: actions, label: { label })
                    .menuStyle(.borderlessButton).menuIndicator(.hidden)
            }
        }
        .fixedSize()
        .tint(theme.text3.color)
        .focused($focused)
        .opacity(revealed || focused || NSWorkspace.shared.isVoiceOverEnabled ? 1 : 0)
        .accessibilityHidden(false)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: revealed)
        .accessibilityLabel(title)
        .help(title)
    }

    private var label: some View {
        Image(systemName: "ellipsis")
            .font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text3.color)
            .frame(width: 24, height: 24).contentShape(Rectangle())
            .overlay(alignment: .topTrailing) {
                if attention { Circle().fill(theme.attention.color).frame(width: 5, height: 5).accessibilityHidden(true) }
            }
    }
}
