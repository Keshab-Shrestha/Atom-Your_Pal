import AppKit
import SwiftUI
import ArkIslandCore

// Draw on screen (2026-11-05). When the model points with a shape, a click-through window over that display draws a ring, box, underline or
// arrow over the place for a few seconds, then fades. It changes nothing in any app, so it never asks. The runtime sends only a place and a shape.

/// One shape, drawn over `rect` (the display's own top-left coordinates). `progress` 0 to 1 draws the stroke in.
struct DrawShapeView: View {
    let shape: DrawShape
    let rect: CGRect
    let color: Color
    var progress: CGFloat = 1

    var body: some View {
        path
            .trim(from: 0, to: progress)
            .stroke(color, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
            .shadow(color: color.opacity(0.55), radius: 6)
            .allowsHitTesting(false)
    }

    private var path: Path {
        switch shape {
        case .ring:
            return Path(ellipseIn: rect.insetBy(dx: -rect.width * 0.12, dy: -rect.height * 0.25))
        case .box:
            return Path(roundedRect: rect, cornerRadius: 8)
        case .underline:
            var p = Path()
            p.move(to: CGPoint(x: rect.minX, y: rect.maxY + 4))
            p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY + 4))
            return p
        case .arrow:
            // From above and to the left of the place, ending a little short of its top-left corner.
            let tip = CGPoint(x: rect.minX - 4, y: rect.minY - 4)
            let tail = CGPoint(x: tip.x - 70, y: tip.y - 70)
            var p = Path()
            p.move(to: tail)
            p.addLine(to: tip)
            p.move(to: CGPoint(x: tip.x - 20, y: tip.y - 2))
            p.addLine(to: tip)
            p.addLine(to: CGPoint(x: tip.x - 2, y: tip.y - 20))
            return p
        }
    }
}

/// The shape on a full-display layer, drawn in as it appears.
private struct DrawLayer: View {
    let shape: DrawShape
    let rect: CGRect
    let color: Color
    @State private var progress: CGFloat = 0

    var body: some View {
        DrawShapeView(shape: shape, rect: rect, color: color, progress: progress)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .onAppear {
                if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion { progress = 1 }
                else { withAnimation(.easeOut(duration: 0.5)) { progress = 1 } }
            }
    }
}

@MainActor
final class DrawOverlayController {
    /// How long the shape stays: as long as Pal dwells at the place.
    static let dwell: TimeInterval = IslandController.pointDwell

    private var panel: NSPanel?
    private var timer: Timer?
    private(set) var isVisible = false

    func show(_ target: PointTarget, shape: DrawShape, palette: ThemePalette) {
        hide(animated: false)
        let areas = NSScreen.screens.map { ScreenArea(frame: $0.frame, visible: $0.visibleFrame) }
        guard let layout = DrawPlacement.layout(for: target, screens: areas) else { return }
        let window = NSPanel(contentRect: layout.screenFrame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true // it only shows; clicks reach what is under it
        window.level = .screenSaver
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        window.isReleasedWhenClosed = false
        window.animationBehavior = .none
        let hosting = NSHostingView(rootView: DrawLayer(shape: shape, rect: layout.local, color: palette.attention.color))
        hosting.sizingOptions = []
        window.contentView = hosting
        window.setFrame(layout.screenFrame, display: false)
        window.alphaValue = 0
        window.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { $0.duration = 0.15; window.animator().alphaValue = 1 }
        panel = window
        isVisible = true
        let t = Timer(timeInterval: Self.dwell, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.hide(animated: true) } }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func hide(animated: Bool = true) {
        timer?.invalidate(); timer = nil
        guard let window = panel else { isVisible = false; return }
        panel = nil
        isVisible = false
        guard animated else { window.orderOut(nil); return }
        NSAnimationContext.runAnimationGroup({ $0.duration = 0.25; window.animator().alphaValue = 0 }, completionHandler: {
            MainActor.assumeIsolated { window.orderOut(nil) }
        })
    }
}
