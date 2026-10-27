import AppKit
import SwiftUI
import AtomIslandCore

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
            AtomScrollView {
                // Match the snapshot layout: SwiftUI's implicit stack adds gaps and centers short labels.
                VStack(alignment: .leading, spacing: 0) { content }
                    .frame(maxWidth: .infinity, alignment: .leading)
            }.scrollIndicators(.automatic)
        }
    }
}

/// Shared chrome for ATOM-owned lists, sheets, tables and code. Keep native scrolling and accessibility.
struct AtomScrollView<Content: View>: View {
    var axes: Axis.Set
    var showsIndicators: Bool
    let content: Content

    init(_ axes: Axis.Set = .vertical, showsIndicators: Bool = true, @ViewBuilder content: () -> Content) {
        self.axes = axes
        self.showsIndicators = showsIndicators
        self.content = content()
    }

    var body: some View {
        ScrollView(axes, showsIndicators: showsIndicators) {
            content.background { CompactScrollChrome() }
        }
        .contentMargins(.all, 0, for: .scrollContent)
    }
}

/// Attach from inside the owned scroll content; never traverse or restyle web/terminal controls.
private struct CompactScrollChrome: NSViewRepresentable {
    @Environment(\.theme) private var theme
    func makeNSView(context: Context) -> Probe { Probe(frame: .zero) }
    func updateNSView(_ view: Probe, context: Context) {
        view.dark = theme.isDark
        view.configure()
        DispatchQueue.main.async { [weak view] in view?.configure() }
    }

    final class Probe: NSView {
        var dark = true
        private var configuring = false
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            DispatchQueue.main.async { [weak self] in self?.configure() }
        }
        override func layout() {
            super.layout()
            configure()
        }
        func configure() {
            guard !configuring, let scroll = enclosingScrollView else { return }
            configuring = true
            defer { configuring = false }
            var resized = false
            if scroll.scrollerStyle != .overlay { scroll.scrollerStyle = .overlay; resized = true }
            if !scroll.autohidesScrollers { scroll.autohidesScrollers = true }
            let knob: NSScroller.KnobStyle = dark ? .light : .dark
            if scroll.scrollerKnobStyle != knob { scroll.scrollerKnobStyle = knob }
            for scroller in [scroll.verticalScroller, scroll.horizontalScroller].compactMap({ $0 }) where scroller.controlSize != .small {
                scroller.controlSize = .small
                resized = true
            }
            if resized { scroll.tile() }
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
