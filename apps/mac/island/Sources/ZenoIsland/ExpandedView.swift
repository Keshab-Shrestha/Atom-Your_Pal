import SwiftUI
import ZenoIslandCore

/// The panel under the menu-bar icon (ADR-038, ADR-040, ADR-056, ADR-057, ADR-084): a header with Wisp and ZENO's
/// state, then word tabs for the conversation and Settings (whose "now" card is what the Status tab was). Every colour comes from the user's theme.
struct ExpandedView: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            PanelHeader(model: model)

            // Inset, so the header's hairline never draws a square box edge to edge.
            Capsule().fill(theme.separator.color).frame(height: theme.isFlat ? 1 : 0.5).padding(.horizontal, Spacing.panel)

            ZStack(alignment: .top) {
                switch model.tab {
                case .conversation: ConversationTab(model: model).transition(Motion.handOff(reduceMotion))
                case .settings: SettingsTab(model: model).transition(Motion.handOff(reduceMotion))
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

extension View {
    /// Fades a scrolling list out at its top and bottom edges, so it never ends on a hard, square cut.
    func softEdges(_ depth: CGFloat = 16) -> some View {
        mask {
            VStack(spacing: 0) {
                LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: depth)
                Color.black
                LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom).frame(height: depth)
            }
        }
    }
}
