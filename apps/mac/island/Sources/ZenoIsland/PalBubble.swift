import AppKit
import SwiftUI
import ZenoIslandCore

/// What the bubble draws, written by `BubbleController`.
@MainActor @Observable
final class BubbleState {
    var visible = false
    /// Where the tail's tip is, from the bubble's left edge.
    var tailX: CGFloat = BubbleLayout.size.width / 2
    /// The bubble is below Pal, so the tail is on top.
    var tailOnTop = false
    /// Settings → Bubble → Size: the bubble is drawn at its normal size and scaled.
    var scale: CGFloat = 1

    init(visible: Bool = false, tailX: CGFloat = BubbleLayout.size.width / 2, tailOnTop: Bool = false) {
        self.visible = visible
        self.tailX = tailX
        self.tailOnTop = tailOnTop
    }
}

/// A rounded bubble with a soft tail on its top or bottom edge, as one outline.
struct BubbleShape: Shape {
    var tailX: CGFloat
    var tailOnTop: Bool
    /// The body's corner radius: Lantern's 18, or the theme's card radius in Void (16).
    var cornerRadius = BubbleLayout.cornerRadius

    var animatableData: CGFloat {
        get { tailX }
        set { tailX = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let tail = BubbleLayout.tailHeight
        let body = CGRect(x: rect.minX, y: tailOnTop ? rect.minY + tail : rect.minY, width: rect.width, height: rect.height - tail)
        let half: CGFloat = 9
        // The tail's base sits a point inside the body so the union has no seam; its sides curve in to a soft tip.
        let base = tailOnTop ? body.minY + 1 : body.maxY - 1
        let tip = tailOnTop ? rect.minY : rect.maxY
        let bend = base + (tip - base) * 0.55
        var point = Path()
        point.move(to: CGPoint(x: tailX - half, y: base))
        point.addLine(to: CGPoint(x: tailX + half, y: base))
        point.addQuadCurve(to: CGPoint(x: tailX, y: tip), control: CGPoint(x: tailX + half * 0.24, y: bend))
        point.addQuadCurve(to: CGPoint(x: tailX - half, y: base), control: CGPoint(x: tailX - half * 0.24, y: bend))
        point.closeSubpath()
        return Path(roundedRect: body, cornerRadius: cornerRadius, style: .continuous).union(point)
    }
}

/// How the bubble is lit (ADR-084): Pal's light while listening, amber when Pal needs you, coral for a problem,
/// otherwise plain night glass with a white hairline.
enum BubbleTone: Equatable {
    case plain, lit, attention, problem

    init(_ kind: IslandStatus.Kind) {
        switch kind {
        case .listening: self = .lit
        case .notice, .asking: self = .attention
        case .problem: self = .problem
        default: self = .plain
        }
    }

    /// The rim's colour; nil for the plain hairline.
    func rim(_ palette: ThemePalette) -> Color? {
        switch self {
        case .plain: nil
        case .lit: palette.live.color
        case .attention: palette.attention.color
        case .problem: palette.problem.color
        }
    }

    /// The light pooled inside the glass at the tail, where Pal is, and the glow around it. Lantern's glow is Pal's
    /// own light even where controls use a deeper blue (Lantern Day).
    func light(_ palette: ThemePalette) -> Color? {
        switch self {
        case .plain: nil
        case .lit: (palette.glow.a > 0 ? palette.glow.with(alpha: 1) : palette.live).color
        case .attention: palette.attention.color
        case .problem: palette.problem.color
        }
    }
}

/// ZENO's status as a speech bubble over Pal (ADR-050), in Lantern's night glass (ADR-084): no icon circle, since
/// Pal is right below it. It grows out of the tail, where Pal is, and shrinks back into it.
struct BubbleView: View {
    let model: IslandModel
    let state: BubbleState
    /// For development snapshots: a flat fill instead of the blur, which only the window server can draw.
    var snapshot = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let size = BubbleLayout.size
        let tail = BubbleLayout.tailHeight
        let palette = model.settings.theme.palette
        let tone = BubbleTone(model.status.kind)
        let tailAnchor = UnitPoint(x: state.tailX / size.width, y: state.tailOnTop ? 0 : 1)
        BubbleContent(model: model)
            .padding(.horizontal, 18)
            .padding(.top, state.tailOnTop ? tail : 0)
            .padding(.bottom, state.tailOnTop ? 0 : tail)
            .frame(width: size.width, height: size.height)
            .background {
                BubbleGlass(state: state, tone: tone, snapshot: snapshot, fill: model.settings.bubbleOpacity.fill, tailAnchor: tailAnchor)
            }
            .themed(palette)
            .environment(\.islandSnapshot, snapshot)
            .animation(Motion.glow(reduceMotion), value: tone)
            .scaleEffect(state.visible || reduceMotion ? 1 : 0.6, anchor: tailAnchor)
            .opacity(state.visible ? 1 : 0)
            .animation(state.visible ? Motion.open(reduceMotion) : Motion.close(reduceMotion), value: state.visible)
            .scaleEffect(state.scale, anchor: .topLeading)
            .frame(width: size.width * state.scale, height: size.height * state.scale, alignment: .topLeading)
            .padding(BubbleController.shadowInset)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(model.status.detail.isEmpty ? "ZENO: \(model.status.title)" : "ZENO: \(model.status.title). \(model.status.detail)")
    }
}

/// The bubble's glass: the blur, the theme's night fill, light pooled at the tail, a top-lit rim and the state's rim,
/// with a soft shadow (a glow of the state's light when lit).
private struct BubbleGlass: View {
    let state: BubbleState
    let tone: BubbleTone
    let snapshot: Bool
    /// The Background setting: how much of the theme's fill covers the blur.
    let fill: Double
    let tailAnchor: UnitPoint
    @Environment(\.theme) private var theme

    var body: some View {
        if theme.isFlat { flatBody } else { glassBody }
    }

    /// Void (ADR-086): opaque black and a 1 px graphite hairline, no blur, rim light, pool of light or shadow. The
    /// state is the dot in the content.
    private var flatBody: some View {
        let shape = BubbleShape(tailX: state.tailX, tailOnTop: state.tailOnTop, cornerRadius: theme.radiusCard)
        return ZStack {
            shape.fill(theme.surfaceSolid.color)
            shape.stroke(theme.border.color, lineWidth: 1)
        }
    }

    private var glassBody: some View {
        let shape = BubbleShape(tailX: state.tailX, tailOnTop: state.tailOnTop)
        let light = tone.light(theme)
        return ZStack {
            if !snapshot { shape.fill(theme.isDark ? .ultraThinMaterial : .regularMaterial) }
            shape.fill(theme.surfaceFill(solid: snapshot, opacity: min(1, fill / 0.86)))
            if let light {
                shape.fill(RadialGradient(colors: [light.opacity(tone == .lit ? (theme.isDark ? 0.24 : 0.30) : 0.06), light.opacity(0)],
                                          center: tailAnchor, startRadius: 0, endRadius: 190))
            }
            // Light catching the top edge of the glass.
            shape.stroke(LinearGradient(colors: [theme.rim.color, theme.border.color, theme.border.color], startPoint: .top, endPoint: .bottom),
                         lineWidth: 0.7)
            if let rim = tone.rim(theme) {
                shape.stroke(rim.opacity(tone == .lit ? 0.5 : 0.55), lineWidth: 0.9)
            }
        }
        .shadow(color: .black.opacity(theme.isDark ? 0.3 : 0.12), radius: 2, y: 1)
        .shadow(color: shadowColor(light), radius: tone == .lit ? 16 : 12, y: 6)
    }

    private func shadowColor(_ light: Color?) -> Color {
        if tone == .lit, let light { return light.opacity(theme.isDark ? 0.3 : 0.35) }
        return .black.opacity(theme.isDark ? 0.36 : 0.14)
    }
}

/// What the bubble says. Dictating: the words heard so far, with the meter in Pal's light. Otherwise the title and
/// a line under it, led by an amber dot (Pal needs you), a coral dot (a problem) or a check (done).
private struct BubbleContent: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let status = model.status
        HStack(spacing: 10) {
            mark(status.kind)
            VStack(alignment: .leading, spacing: 2) {
                if let target = model.pointing.target {
                    title(PointingState.line(for: target))
                    detail("ZENO is pointing")
                } else if !status.preview.isEmpty {
                    Text(status.preview)
                        .font(.system(size: 13.5))
                        .foregroundStyle(theme.text.color)
                        .truncationMode(.head)
                } else {
                    title(status.title)
                    if !status.detail.isEmpty { detail(status.detail) }
                }
            }
            .lineLimit(1)
            .contentTransition(.opacity)
            .animation(.easeOut(duration: 0.18), value: status.title)

            Spacer(minLength: 8)

            if status.showsLevel {
                BubbleMeter(levels: model.meter.history, color: theme.live.color)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.18), value: status.showsLevel)
    }

    private func title(_ text: String) -> some View {
        Text(text).font(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color)
    }

    private func detail(_ text: String) -> some View {
        Text(text).font(.system(size: 11.5)).foregroundStyle(theme.text2.color)
    }

    @ViewBuilder private func mark(_ kind: IslandStatus.Kind) -> some View {
        if theme.statusDots {
            // Void: every state is a small dot in its status colour (green for done or ready).
            StatusDot(color: theme.tint(kind))
        } else {
            lanternMark(kind)
        }
    }

    @ViewBuilder private func lanternMark(_ kind: IslandStatus.Kind) -> some View {
        switch kind {
        case .notice, .asking: GlowDot(color: theme.attention.color)
        case .problem: GlowDot(color: theme.problem.color)
        case .ready:
            Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(theme.accent.color)
        default: EmptyView()
        }
    }
}

/// A small glowing dot: amber or coral.
private struct GlowDot: View {
    let color: Color
    var body: some View {
        Circle().fill(color).frame(width: 7, height: 7).shadow(color: color.opacity(0.8), radius: 3.5)
    }
}

/// The microphone as Pal's light (ADR-084): bars that rise with the voice, brighter towards the newest on the right.
struct BubbleMeter: View {
    let levels: [Double]
    let color: Color
    @Environment(\.theme) private var theme

    var body: some View {
        let count = max(1, levels.count)
        HStack(alignment: .center, spacing: 2.5) {
            ForEach(levels.indices, id: \.self) { i in
                Capsule()
                    .fill(color.opacity(0.35 + 0.65 * Double(i + 1) / Double(count)))
                    .frame(width: 2.5, height: 4 + 16 * min(1, max(0, levels[i])))
            }
        }
        .frame(height: 22)
        .shadow(color: color.opacity(theme.usesGlow ? 0.6 : 0), radius: 4)
        .animation(.linear(duration: 0.05), value: levels)
        .accessibilityHidden(true)
    }
}

/// The window that carries the bubble: transparent, click-through, never takes focus, and follows Pal.
@MainActor
final class BubbleController {
    /// Room around the bubble for its shadow and the glow of its light.
    static let shadowInset: CGFloat = 22

    let state = BubbleState()
    private let model: IslandModel
    private let panel: NSPanel
    private var feet = CGPoint.zero
    private var hiding: Task<Void, Never>?

    var isVisible: Bool { state.visible }

    init(model: IslandModel) {
        self.model = model
        let size = CGSize(width: BubbleLayout.size.width + 2 * Self.shadowInset, height: BubbleLayout.size.height + 2 * Self.shadowInset)
        panel = NSPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true // the bubble only shows; clicks reach whatever is under it
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1) // over Pal
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        let hosting = NSHostingView(rootView: BubbleView(model: model, state: state))
        hosting.sizingOptions = []
        panel.contentView = hosting
    }

    /// Shows the bubble over Pal, who stands at `feet`.
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

    /// Pal moved.
    func follow(_ feet: CGPoint) {
        self.feet = feet
        if panel.isVisible { reposition() }
    }

    func stop() {
        hiding?.cancel()
        state.visible = false
        panel.orderOut(nil)
    }

    /// The area a window next to Pal must stay inside: the display `point` is on, below its menu bar.
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
        let pal = settings.palSize.scale // a bigger Pal stands taller: the bubble clears its head
        let size = CGSize(width: BubbleLayout.size.width * scale, height: BubbleLayout.size.height * scale)
        let placement = BubbleLayout.place(feet: feet, bodyHeight: 54 * pal, size: size, in: bounds)
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
