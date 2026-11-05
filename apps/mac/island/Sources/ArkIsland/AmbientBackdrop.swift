import AppKit
import QuartzCore
import SwiftUI
import ArkIslandCore

extension IslandModel {
    /// ARK's mood for the ambient light: its own state, and whether agents work or wait for the user (the Board's counts).
    var ambientMood: AmbientMood {
        let board = BoardAttention(list: helpers.list, approvalPending: approval.pending != nil)
        return AmbientMood(status: status.kind, agentsWorking: board.running > 0, agentsWaiting: board.asks > 0)
    }
}

/// ADR-255: the ambient light behind the glass panes. A few large, soft pools of the theme's colour drift slowly; the third takes
/// ARK's mood (active blue, attention amber, problem red) and fades to it. Reduce Motion holds the lights still.
///
/// On screen the lights are Core Animation layers: the window server runs the drift, so it costs ARK almost no CPU. A SwiftUI
/// animation of the same drift cost about 12% CPU (measured 2026-11-05). A snapshot cannot draw AppKit layers, so it draws the
/// same lights, still, in SwiftUI.
struct AmbientBackdrop: View {
    let theme: AppTheme
    let mood: AmbientMood
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let lights = AmbientScene.lights(theme, mood: mood)
        let base = AmbientScene.base(theme)
        Group {
            if snapshot {
                StillAmbient(base: base, lights: lights)
            } else {
                AmbientLayers(base: base, lights: lights, moving: !reduceMotion)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// Where a light's centre is, in a box of `size`, at `phase` (-1 to 1) of its drift. Unit y runs down from the top.
private func ambientCentre(_ light: AmbientLight, index: Int, phase: Double, size: CGSize) -> CGPoint {
    let step = phase * light.drift * (index.isMultiple(of: 2) ? 1 : -1)
    return CGPoint(x: (light.x + step) * size.width, y: (light.y + step * 0.6) * size.height)
}

/// The lights' colour stops: full at the centre, 42% halfway, clear at the edge.
private func ambientStops(_ color: RGBA) -> [RGBA] { [color, color.with(alpha: color.a * 0.42), color.with(alpha: 0)] }

/// The snapshot drawing: each light at the start of its drift.
private struct StillAmbient: View {
    let base: RGBA
    let lights: [AmbientLight]

    var body: some View {
        GeometryReader { proxy in
            let span = max(proxy.size.width, proxy.size.height)
            ZStack {
                base.color
                ForEach(lights.indices, id: \.self) { index in
                    let light = lights[index]
                    let diameter = light.radius * span * 2
                    Circle()
                        .fill(RadialGradient(colors: ambientStops(light.color).map(\.color), center: .center, startRadius: 0, endRadius: diameter / 2))
                        .frame(width: diameter, height: diameter)
                        .position(ambientCentre(light, index: index, phase: -1, size: proxy.size))
                }
            }
        }
    }
}

private struct AmbientLayers: NSViewRepresentable {
    let base: RGBA
    let lights: [AmbientLight]
    let moving: Bool

    func makeNSView(context: Context) -> AmbientLayerView { AmbientLayerView() }
    func updateNSView(_ view: AmbientLayerView, context: Context) { view.update(base: base, lights: lights, moving: moving) }
}

/// A layer-hosting view: one radial-gradient layer per light, drifting by a Core Animation animation that never ends.
final class AmbientLayerView: NSView {
    /// How long a change of mood takes to fade in.
    private static let fade: CFTimeInterval = 1.2
    private let root = CALayer()
    private var lightLayers: [CAGradientLayer] = []
    private var lights: [AmbientLight] = []
    private var moving = false
    private var laidOut = CGSize.zero

    override init(frame: NSRect) {
        super.init(frame: frame)
        root.isGeometryFlipped = true // unit y runs down, as in SwiftUI
        layer = root
        wantsLayer = true
    }

    required init?(coder: NSCoder) { nil }

    func update(base: RGBA, lights: [AmbientLight], moving: Bool) {
        let first = lightLayers.isEmpty
        CATransaction.begin()
        CATransaction.setDisableActions(first)
        CATransaction.setAnimationDuration(Self.fade)
        root.backgroundColor = base.nsColor.cgColor
        while lightLayers.count < lights.count {
            let layer = CAGradientLayer()
            layer.type = .radial
            layer.startPoint = CGPoint(x: 0.5, y: 0.5)
            layer.endPoint = CGPoint(x: 1, y: 1)
            layer.locations = [0, 0.5, 1]
            root.addSublayer(layer)
            lightLayers.append(layer)
        }
        for (layer, light) in zip(lightLayers, lights) { layer.colors = ambientStops(light.color).map { $0.nsColor.cgColor } }
        CATransaction.commit()
        let moved = lights.map(\.drift) != self.lights.map(\.drift) || moving != self.moving
        self.lights = lights
        self.moving = moving
        if moved || first { laidOut = .zero; needsLayout = true }
    }

    override func layout() {
        super.layout()
        let size = bounds.size
        guard size != laidOut, size.width > 0, size.height > 0 else { return }
        laidOut = size
        let span = max(size.width, size.height)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for (index, (layer, light)) in zip(lightLayers, lights).enumerated() {
            let diameter = light.radius * span * 2
            layer.bounds = CGRect(x: 0, y: 0, width: diameter, height: diameter)
            layer.position = ambientCentre(light, index: index, phase: -1, size: size)
            layer.removeAnimation(forKey: "drift")
            guard moving else { continue }
            let drift = CABasicAnimation(keyPath: "position")
            drift.fromValue = NSValue(point: ambientCentre(light, index: index, phase: -1, size: size))
            drift.toValue = NSValue(point: ambientCentre(light, index: index, phase: 1, size: size))
            drift.duration = light.period
            drift.autoreverses = true
            drift.repeatCount = .infinity
            drift.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            layer.add(drift, forKey: "drift")
        }
        CATransaction.commit()
    }
}
