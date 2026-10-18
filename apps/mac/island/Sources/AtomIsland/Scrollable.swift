import SwiftUI

/// ImageRenderer cannot draw AppKit's borderless buttons. Keep their labels and layout in fixtures.
struct SnapshotBorderlessButtonStyle: PrimitiveButtonStyle {
    @Environment(\.islandSnapshot) private var snapshot
    @ViewBuilder func makeBody(configuration: Configuration) -> some View {
        if snapshot { configuration.label }
        else { BorderlessButtonStyle().makeBody(configuration: configuration) }
    }
}

// Scrolling and snapshot helpers shared by the window's pages, the compact card and the gallery. They lived beside the
// drop-down panel's view until ADR-093 removed it.

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
                VStack(alignment: .leading, spacing: 0) { content }
                    .fixedSize(horizontal: false, vertical: true)
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
