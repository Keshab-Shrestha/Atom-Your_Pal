import AppKit
import SwiftUI
import ZenoIslandCore

/// What the bubble draws, written by `BubbleController`.
@MainActor @Observable
final class BubbleState {
    var visible = false
    /// Where the tail's tip is, from the bubble's left edge.
    var tailX: CGFloat = BubbleLayout.size.width / 2
    /// The bubble is below Wisp, so the tail is on top.
    var tailOnTop = false
    /// Settings → Bubble → Size: the bubble is drawn at its normal size and scaled.
    var scale: CGFloat = 1

    init(visible: Bool = false, tailX: CGFloat = BubbleLayout.size.width / 2, tailOnTop: Bool = false) {
        self.visible = visible
        self.tailX = tailX
        self.tailOnTop = tailOnTop
    }
}

/// A rounded bubble with a tail on its top or bottom edge, as one outline.
struct BubbleShape: Shape {
    var tailX: CGFloat
    var tailOnTop: Bool

    var animatableData: CGFloat {
        get { tailX }
        set { tailX = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let tail = BubbleLayout.tailHeight
        let body = CGRect(x: rect.minX, y: tailOnTop ? rect.minY + tail : rect.minY, width: rect.width, height: rect.height - tail)
        let half: CGFloat = 8
        var point = Path()
        if tailOnTop {
            point.move(to: CGPoint(x: tailX - half, y: body.minY + 1))
            point.addLine(to: CGPoint(x: tailX, y: rect.minY))
            point.addLine(to: CGPoint(x: tailX + half, y: body.minY + 1))
        } else {
            point.move(to: CGPoint(x: tailX - half, y: body.maxY - 1))
            point.addLine(to: CGPoint(x: tailX, y: rect.maxY))
            point.addLine(to: CGPoint(x: tailX + half, y: body.maxY - 1))
        }
        point.closeSubpath()
        return Path(roundedRect: body, cornerRadius: BubbleLayout.cornerRadius, style: .continuous).union(point)
    }
}

/// ZENO's status as a speech bubble over Wisp (ADR-050): what the island's card shows, held by the character.
struct BubbleView: View {
    let model: IslandModel
    let state: BubbleState
    /// For development snapshots: a flat fill instead of the blur, which only the window server can draw.
    var snapshot = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let size = BubbleLayout.size
        let tail = BubbleLayout.tailHeight
        let shape = BubbleShape(tailX: state.tailX, tailOnTop: state.tailOnTop)
        StatusRow(model: model)
            .padding(.leading, 11)
            .padding(.trailing, 14)
            .padding(.top, state.tailOnTop ? tail : 0)
            .padding(.bottom, state.tailOnTop ? 0 : tail)
            .frame(width: size.width, height: size.height)
            .background {
                ZStack {
                    if !snapshot { shape.fill(.ultraThinMaterial) }
                    shape.fill(Color(white: 0.06).opacity(snapshot ? 0.94 : model.settings.bubbleOpacity.fill))
                }
            }
            .overlay { shape.stroke(.white.opacity(0.16), lineWidth: 0.5) }
            .shadow(color: .black.opacity(snapshot ? 0 : 0.32), radius: 9, y: 3)
            .environment(\.colorScheme, .dark)
            .environment(\.islandSnapshot, snapshot)
            // It grows out of the tail, where Wisp is, and shrinks back into it.
            .scaleEffect(state.visible || reduceMotion ? 1 : 0.72, anchor: UnitPoint(x: state.tailX / size.width, y: state.tailOnTop ? 0 : 1))
            .opacity(state.visible ? 1 : 0)
            .animation(reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.34, dampingFraction: 0.78), value: state.visible)
            .scaleEffect(state.scale, anchor: .topLeading)
            .frame(width: size.width * state.scale, height: size.height * state.scale, alignment: .topLeading)
            .padding(BubbleController.shadowInset)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(model.status.detail.isEmpty ? "ZENO: \(model.status.title)" : "ZENO: \(model.status.title). \(model.status.detail)")
    }
}

/// The window that carries the bubble: transparent, click-through, never takes focus, and follows Wisp.
@MainActor
final class BubbleController {
    /// Room around the bubble for its shadow.
    static let shadowInset: CGFloat = 12

    let state = BubbleState()
    private let model: IslandModel
    private let panel: NSPanel
    private var feet = CGPoint.zero
    private var hiding: Task<Void, Never>?
    /// Set while Wisp points: the side that keeps the bubble off the thing pointed at.
    var preferredSide: BubblePlacement.Side? { didSet { if panel.isVisible { reposition() } } }

    var isVisible: Bool { state.visible }

    init(model: IslandModel) {
        self.model = model
        let size = CGSize(width: BubbleLayout.size.width + 2 * Self.shadowInset, height: BubbleLayout.size.height + 2 * Self.shadowInset)
        panel = NSPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true // the bubble only shows; clicks reach whatever is under it
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1) // over Wisp
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        let hosting = NSHostingView(rootView: BubbleView(model: model, state: state))
        hosting.sizingOptions = []
        panel.contentView = hosting
    }

    /// Shows the bubble over Wisp, who stands at `feet`.
    func show(at feet: CGPoint) {
        hiding?.cancel()
        hiding = nil
        self.feet = feet
        reposition()
        if !panel.isVisible {
            state.visible = false
            panel.orderFrontRegardless()
        }
        if !state.visible {
            // One turn later, so the window is on screen before it grows.
            Task { @MainActor [state] in state.visible = true }
        }
    }

    func hide() {
        guard state.visible else { return }
        state.visible = false
        hiding?.cancel()
        hiding = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(380))
            guard let self, !Task.isCancelled, !self.state.visible else { return }
            self.panel.orderOut(nil)
        }
    }

    /// A bubble setting changed: place the bubble again.
    func lookChanged() {
        if panel.isVisible { reposition() }
    }

    /// Wisp moved.
    func follow(_ feet: CGPoint) {
        self.feet = feet
        if panel.isVisible { reposition() }
    }

    func stop() {
        hiding?.cancel()
        state.visible = false
        panel.orderOut(nil)
    }

    /// The area a window next to Wisp must stay inside: the display `point` is on, below its menu bar.
    static func displayBounds(containing point: CGPoint) -> CGRect? {
        let screens = NSScreen.screens
        guard let screen = screens.first(where: { $0.frame.insetBy(dx: -1, dy: -1).contains(point) }) ?? screens.first else { return nil }
        return CGRect(x: screen.frame.minX, y: screen.frame.minY, width: screen.frame.width,
                      height: screen.visibleFrame.maxY - screen.frame.minY)
    }

    private func reposition() {
        guard let bounds = Self.displayBounds(containing: feet) else { return }
        let settings = model.settings
        let scale = settings.bubbleSize.scale
        let wisp = settings.wispSize.scale // a bigger Wisp stands taller: the bubble clears its head
        let size = CGSize(width: BubbleLayout.size.width * scale, height: BubbleLayout.size.height * scale)
        let placement = BubbleLayout.place(feet: feet, bodyHeight: 54 * wisp, size: size, in: bounds, prefer: preferredSide)
        let tailOnTop = placement.side == .below
        // The tail is drawn in the bubble's own (unscaled) coordinates.
        let tailX = placement.tailX / scale
        if state.scale != scale { state.scale = scale }
        if state.tailX != tailX { state.tailX = tailX }
        if state.tailOnTop != tailOnTop { state.tailOnTop = tailOnTop }
        let frame = placement.frame.insetBy(dx: -Self.shadowInset, dy: -Self.shadowInset)
        if panel.frame != frame { panel.setFrame(frame, display: false) }
    }
}
