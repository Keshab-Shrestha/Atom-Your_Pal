import AppKit
import SwiftUI

/// An endless board (2026-11-05, Keshab: "an infinite board", n8n's editor as the reference — its look, not its code): a dotted grid
/// that pans and zooms, content placed in canvas points, and the controls at the bottom left (fit, zoom in, zoom out, 100%).
/// Drag the empty board or scroll with two fingers to pan; pinch, or Command-scroll, to zoom around the pointer. The Team's org chart
/// and a workflow's editor use it. Content lays itself out in the named coordinate space `InfiniteCanvasSpace.name`, so a drag inside
/// it reads canvas points whatever the zoom.
enum InfiniteCanvasSpace {
    static let name = "infinite-canvas"
}

struct InfiniteCanvas<Content: View>: View {
    /// The content's extent in canvas points, for Fit.
    let bounds: CGRect
    @ViewBuilder let content: () -> Content

    static var zoomRange: ClosedRange<CGFloat> { 0.25...2 }

    @State private var offset: CGSize = .zero
    @State private var zoom: CGFloat = 1
    @State private var panStart: CGSize?
    @State private var pinchStart: CGFloat?
    @State private var pointer: CGPoint?
    @State private var viewport: CGSize = .zero
    @State private var monitor: Any?
    @State private var fitted = false
    @Environment(\.theme) private var theme

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                grid
                    .contentShape(Rectangle())
                    .gesture(DragGesture(minimumDistance: 2)
                        .onChanged { value in
                            let start = panStart ?? offset
                            panStart = start
                            offset = CGSize(width: start.width + value.translation.width, height: start.height + value.translation.height)
                        }
                        .onEnded { _ in panStart = nil })
                content()
                    .frame(width: max(1, bounds.maxX), height: max(1, bounds.maxY), alignment: .topLeading)
                    .coordinateSpace(name: InfiniteCanvasSpace.name)
                    .scaleEffect(zoom, anchor: .topLeading)
                    .offset(offset)
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
            .clipped()
            .simultaneousGesture(MagnifyGesture()
                .onChanged { value in
                    let start = pinchStart ?? zoom
                    pinchStart = start
                    zoom(to: start * value.magnification, around: pointer ?? CGPoint(x: proxy.size.width / 2, y: proxy.size.height / 2))
                }
                .onEnded { _ in pinchStart = nil })
            .onContinuousHover { phase in
                if case .active(let at) = phase { pointer = at } else { pointer = nil }
            }
            .overlay(alignment: .bottomLeading) { controls.padding(16) }
            .onAppear {
                viewport = proxy.size
                if !fitted { fit(); fitted = true }
                install()
            }
            .onChange(of: proxy.size) { _, size in viewport = size }
            .onDisappear(perform: uninstall)
        }
    }

    /// n8n's dots: a fixed spacing scaled by the zoom, moving with the pan.
    private var grid: some View {
        Canvas { context, size in
            let step = max(8, 20 * zoom)
            let dot = Path(ellipseIn: CGRect(x: 0, y: 0, width: 1.6, height: 1.6))
            let shading = GraphicsContext.Shading.color(theme.text3.color.opacity(0.35))
            var x = offset.width.truncatingRemainder(dividingBy: step)
            if x < 0 { x += step }
            while x < size.width {
                var y = offset.height.truncatingRemainder(dividingBy: step)
                if y < 0 { y += step }
                while y < size.height {
                    context.fill(dot.offsetBy(dx: x, dy: y), with: shading)
                    y += step
                }
                x += step
            }
        }
    }

    private var controls: some View {
        HStack(spacing: 2) {
            IconButton(symbol: "arrow.up.left.and.arrow.down.right", label: "Fit to view") { withAnimation(.easeOut(duration: 0.2)) { fit() } }
            IconButton(symbol: "plus.magnifyingglass", label: "Zoom in") { withAnimation(.easeOut(duration: 0.15)) { zoom(to: zoom * 1.25, around: center) } }
            IconButton(symbol: "minus.magnifyingglass", label: "Zoom out") { withAnimation(.easeOut(duration: 0.15)) { zoom(to: zoom / 1.25, around: center) } }
            Button { withAnimation(.easeOut(duration: 0.15)) { zoom(to: 1, around: center) } } label: {
                Text("\(Int((zoom * 100).rounded()))%").appFont(.system(size: 11, weight: .medium)).monospacedDigit()
                    .foregroundStyle(theme.text2.color).frame(minWidth: 40, minHeight: 28)
            }
            .buttonStyle(.plain).help("Zoom to 100%").accessibilityLabel("Zoom to 100 percent")
        }
        .padding(4)
        .floatingSurface(RoundedRectangle(cornerRadius: theme.radiusControl + 4, style: .continuous))
    }

    private var center: CGPoint { CGPoint(x: viewport.width / 2, y: viewport.height / 2) }

    /// Zoom to `target`, keeping the canvas point under `anchor` (a screen point) where it is.
    private func zoom(to target: CGFloat, around anchor: CGPoint) {
        let next = min(max(target, Self.zoomRange.lowerBound), Self.zoomRange.upperBound)
        let ratio = next / zoom
        offset = CGSize(width: anchor.x - (anchor.x - offset.width) * ratio, height: anchor.y - (anchor.y - offset.height) * ratio)
        zoom = next
    }

    /// The whole content in view, with a margin, never above 100%.
    private func fit() {
        guard viewport.width > 0, viewport.height > 0, bounds.width > 0, bounds.height > 0 else { return }
        let margin: CGFloat = 64
        let scale = min(1, (viewport.width - margin * 2) / bounds.width, (viewport.height - margin * 2) / bounds.height)
        zoom = min(max(scale, Self.zoomRange.lowerBound), Self.zoomRange.upperBound)
        offset = CGSize(width: (viewport.width - bounds.width * zoom) / 2 - bounds.minX * zoom,
                        height: (viewport.height - bounds.height * zoom) / 2 - bounds.minY * zoom)
    }

    /// Two-finger scroll pans; Command-scroll zooms. Only while the pointer is over the board, so other scroll views keep theirs.
    private func install() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { event in
            guard let at = pointer else { return event }
            if event.modifierFlags.contains(.command) {
                zoom(to: zoom * (1 + event.scrollingDeltaY * (event.hasPreciseScrollingDeltas ? 0.01 : 0.1)), around: at)
            } else {
                let unit: CGFloat = event.hasPreciseScrollingDeltas ? 1 : 12
                offset = CGSize(width: offset.width + event.scrollingDeltaX * unit, height: offset.height + event.scrollingDeltaY * unit)
            }
            return nil
        }
    }

    private func uninstall() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }
}
