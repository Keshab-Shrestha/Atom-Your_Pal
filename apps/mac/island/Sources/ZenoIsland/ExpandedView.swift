import SwiftUI
import ZenoIslandCore

/// The panel under the menu-bar icon (ADR-038, ADR-040, ADR-056, ADR-057, ADR-084): a header with Wisp and ZENO's
/// state, then word tabs for the conversation, ZENO's status and Settings. Every colour comes from the user's theme.
struct ExpandedView: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            PanelHeader(model: model)

            Rectangle().fill(theme.separator.color).frame(height: 0.5)

            Group {
                switch model.tab {
                case .conversation: ConversationTab(model: model)
                case .status: StatusTab(model: model)
                case .settings: SettingsTab(model: model)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .background { PanelGlow(kind: model.status.kind) }
    }
}

// MARK: - Building blocks

private struct SnapshotKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// Rendering for a development snapshot: `ImageRenderer` cannot draw scroll views.
    var islandSnapshot: Bool {
        get { self[SnapshotKey.self] }
        set { self[SnapshotKey.self] = newValue }
    }
}

/// A vertical scroll view, laid out flat in development snapshots.
struct Scrollable<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        if snapshot {
            // Natural height, pinned to the top; anything taller is cut off at the bottom like an unscrolled
            // list. GeometryReader takes only the space offered, so tall content cannot push the header out.
            GeometryReader { proxy in
                content.fixedSize(horizontal: false, vertical: true)
                    .frame(width: proxy.size.width, alignment: .top)
            }
            .clipped()
        } else {
            ScrollView { content }.scrollIndicators(.automatic)
        }
    }
}
