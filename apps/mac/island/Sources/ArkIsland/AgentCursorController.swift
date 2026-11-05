import AppKit

/// A visual second pointer owned by ARK, shown only during computer work. Never changes the real pointer.
@MainActor
final class AgentCursorController {
    private let panel: AgentCursorPanel
    private let art: CursorArt
    /// The cursors of the lanes other than the main one (ADR-249): each a tinted copy that wears the lane's name. At most `maxLanes`.
    private var lanes: [String: AgentCursorController] = [:]
    static let maxLanes = 3
    /// Coral, violet and amber: a lane's cursor is not ARK's teal.
    static let laneTints = [NSColor(calibratedRed: 0.86, green: 0.36, blue: 0.36, alpha: 1), NSColor(calibratedRed: 0.55, green: 0.42, blue: 0.86, alpha: 1), NSColor(calibratedRed: 0.90, green: 0.62, blue: 0.16, alpha: 1)]
    private var enabled = false
    private var active = false
    private var returning = false
    private var home = CGPoint.zero
    private var start = CGPoint.zero
    private var revision = 0
    private var motion: Timer?
    var log: (String, [String: String]) -> Void = { _, _ in }

    /// `tint` and `label` make a lane's cursor: the same arrow in another colour, with the lane's name beside it.
    init(tint: NSColor? = nil, label: String = "") {
        let size = CursorArt.size(label: label)
        panel = AgentCursorPanel(contentRect: CGRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        art = CursorArt(frame: CGRect(origin: .zero, size: size))
        art.tint = tint
        art.label = label
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 3) // above ARK's bubble/work strip
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        panel.contentView = art
        panel.setAccessibilityLabel("ARK agent cursor")
    }

    /// A lane's cursor, made the first time it moves. A fourth name takes the place of a lane that is not moving; none is free: nil.
    func lane(_ name: String) -> AgentCursorController? {
        if let known = lanes[name] { return known }
        if lanes.count >= Self.maxLanes {
            guard let idle = lanes.first(where: { !$0.value.active })?.key else { return nil }
            lanes[idle]?.retire()
            lanes[idle] = nil
        }
        let tints = Self.laneTints
        let used = Set(lanes.values.map(\.art.tint))
        let tint = tints.first(where: { !used.contains($0) }) ?? tints[0]
        let made = AgentCursorController(tint: tint, label: name)
        made.log = log
        made.setEnabled(enabled)
        made.setHome(home)
        lanes[name] = made
        return made
    }

    /// Gone at once: no glide home.
    func retire() {
        revision += 1; motion?.invalidate(); motion = nil; active = false; returning = false; panel.orderOut(nil)
    }

    func setHome(_ point: CGPoint) {
        lanes.values.forEach { $0.setHome(point) }
        home = point
        if enabled && !active { place(point) }
    }

    func setEnabled(_ value: Bool) {
        lanes.values.forEach { $0.setEnabled(value) }
        guard value != enabled else { return }
        enabled = value
        if value { place(home); panel.orderOut(nil) }
        else { revision += 1; motion?.invalidate(); motion = nil; active = false; returning = false; art.active = false; art.needsDisplay = true; panel.orderOut(nil) }
        log("island.cursor.enabled", ["enabled": String(value), "visible": String(panel.isVisible)])
    }

    func begin() {
        guard enabled, !active || returning else { return }
        revision += 1
        start = home
        active = true
        returning = false
        art.active = true
        art.needsDisplay = true
        place(start)
        panel.orderFrontRegardless()
        log("island.cursor.begin", ["visible": String(panel.isVisible)])
    }

    func move(x: Double, y: Double) {
        let screens = NSScreen.screens
        let mainID = CGMainDisplayID()
        guard enabled, let primary = screens.first(where: {
            ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == mainID
        }) else {
            log("island.cursor.move_refused", ["enabled": String(enabled)])
            return
        }
        let point = CGPoint(x: x, y: primary.frame.maxY - y)
        guard let screen = screens.first(where: { $0.frame.contains(point) }) else {
            log("island.cursor.move_refused", ["connectedScreen": "false"])
            return
        }
        begin()
        panel.orderFrontRegardless()
        let targetDisplay = screen.localizedName
        glide(to: point, duration: 0.3) { [weak self] in
            guard let self else { return }
            self.art.ripple()
            self.log("island.cursor.move", ["visible": String(self.panel.isVisible),
                "targetDisplay": targetDisplay, "actualDisplay": self.panel.screen?.localizedName ?? "unknown",
                "unoccluded": String(self.panel.occlusionState.contains(.visible)),
                "atTarget": String(hypot(self.panel.frame.minX + CursorArt.tip.x - point.x, self.panel.frame.minY + CursorArt.tip.y - point.y) < 1)])
        }
    }

    func end() {
        lanes.values.forEach { $0.end() }
        guard enabled, active, !returning else { return }
        returning = true
        revision += 1
        let ending = revision
        // Return to the pet's current home even if it walked while the task was running.
        let destination = NSScreen.screens.contains(where: { $0.frame.contains(home) }) ? home : start
        glide(to: destination, duration: 0.55) { [weak self] in
            guard let self, self.revision == ending else { return }
            self.active = false
            self.returning = false
            self.art.active = false
            self.art.needsDisplay = true
            let atHome = hypot(self.panel.frame.minX + CursorArt.tip.x - destination.x, self.panel.frame.minY + CursorArt.tip.y - destination.y) < 1
            self.panel.orderOut(nil)
            self.log("island.cursor.home", ["visible": String(self.panel.isVisible), "atHome": String(atHome)])
        }
    }

    private func place(_ point: CGPoint) {
        motion?.invalidate()
        motion = nil
        panel.setFrameOrigin(CGPoint(x: point.x - CursorArt.tip.x, y: point.y - CursorArt.tip.y))
    }

    /// Move the real panel frame on the main run loop, including between displays. No NSWindow animator proxy.
    private func glide(to point: CGPoint, duration: Double, completion: (@MainActor @Sendable () -> Void)? = nil) {
        motion?.invalidate()
        motion = nil
        let origin = CGPoint(x: point.x - CursorArt.tip.x, y: point.y - CursorArt.tip.y)
        if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            panel.setFrameOrigin(origin)
            completion?()
            return
        }
        let from = panel.frame.origin
        let began = ProcessInfo.processInfo.systemUptime
        let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] timer in
            // Registered only on RunLoop.main below, including during menu tracking.
            nonisolated(unsafe) let tick = timer
            MainActor.assumeIsolated {
                guard let self, self.motion === tick else { tick.invalidate(); return }
                let progress = min(1, (ProcessInfo.processInfo.systemUptime - began) / duration)
                let eased = progress * progress * (3 - 2 * progress)
                self.panel.setFrameOrigin(CGPoint(x: from.x + (origin.x - from.x) * eased,
                                                 y: from.y + (origin.y - from.y) * eased))
                if progress >= 1 {
                    tick.invalidate()
                    self.motion = nil
                    completion?()
                }
            }
        }
        motion = timer
        RunLoop.main.add(timer, forMode: .common)
    }
}

/// AppKit's ordinary panel constraints must not move the overlay to a different screen or its title-bar margin.
private final class AgentCursorPanel: NSPanel {
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// The agent pointer: an arrow in ARK's teal with a white outline (2026-11-05: it was a pointing hand; now like the swarm-cursors project).
/// The tip is the point ARK acts on; a ring ripples from it when the pointer arrives. Vector, drawn at any scale.
final class CursorArt: NSView {
    static let size = CGSize(width: 44, height: 48)
    /// Room for a lane's name beside the arrow.
    static let labelFont = NSFont.systemFont(ofSize: 10, weight: .semibold)
    static func size(label: String) -> CGSize {
        guard !label.isEmpty else { return size }
        return CGSize(width: size.width + ceil((label as NSString).size(withAttributes: [.font: labelFont]).width) + 12, height: size.height)
    }
    /// A lane's colour; nil: ARK's teal.
    var tint: NSColor?
    /// A lane's name, drawn in a small chip beside the arrow.
    var label = ""
    /// Where the label chip starts, to the right of the arrow.
    private static let labelOrigin = CGPoint(x: 37, y: 27)
    /// The tip in the panel's own (bottom-left) coordinates: where the pointer is.
    static let tip = CGPoint(x: 19.75, y: 37)
    var active = false
    private var rippleProgress: CGFloat?
    private var rippleTimer: Timer?
    override var isFlipped: Bool { true }

    /// The pointer (2026-11-05, after the swarm-cursors project: an arrow, one colour for each cursor, its name beside it). The tip is the point
    /// ARK acts on. Top-left origin; the tip sits at `tip` (in bottom-left coordinates, so 11 points below the panel's top).
    static func arrow() -> NSBezierPath {
        let origin = CGPoint(x: tip.x, y: size.height - tip.y)
        let unit: [CGPoint] = [(0, 0), (0, 17), (4.3, 13.3), (7.1, 19.6), (9.8, 18.5), (7.0, 12.3), (12.6, 12.3)].map { CGPoint(x: $0.0, y: $0.1) }
        let path = NSBezierPath()
        let scale: CGFloat = 1.2
        for (index, point) in unit.enumerated() {
            let at = CGPoint(x: origin.x + point.x * scale, y: origin.y + point.y * scale)
            if index == 0 { path.move(to: at) } else { path.line(to: at) }
        }
        path.close()
        path.lineJoinStyle = .round
        return path
    }

    /// The ring at a fixed point of its way out, for the gallery.
    func showRipple(at progress: CGFloat) { rippleProgress = progress }

    /// One ring, out from the tip and fading, over 0.45 seconds. None with Reduce Motion.
    func ripple() {
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        rippleTimer?.invalidate()
        let began = ProcessInfo.processInfo.systemUptime
        rippleProgress = 0
        let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] timer in
            nonisolated(unsafe) let tick = timer
            MainActor.assumeIsolated {
                guard let self else { tick.invalidate(); return }
                let progress = (ProcessInfo.processInfo.systemUptime - began) / 0.45
                self.rippleProgress = progress >= 1 ? nil : CGFloat(progress)
                if progress >= 1 { tick.invalidate(); self.rippleTimer = nil }
                self.needsDisplay = true
            }
        }
        rippleTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    override func draw(_ dirtyRect: NSRect) {
        let teal = tint ?? NSColor(calibratedRed: 0.13, green: 0.63, blue: 0.58, alpha: 1)
        let alpha: CGFloat = active ? 1 : 0.55
        let tipPoint = CGPoint(x: Self.tip.x, y: Self.size.height - Self.tip.y)
        if let progress = rippleProgress {
            let radius = 3 + 8 * progress
            let ring = NSBezierPath(ovalIn: NSRect(x: tipPoint.x - radius, y: tipPoint.y - radius, width: radius * 2, height: radius * 2))
            teal.withAlphaComponent(0.8 * (1 - progress)).setStroke()
            ring.lineWidth = 2
            ring.stroke()
        }
        // One layer at the pointer's opacity, so the outline never shows through the fill when it is idle.
        let context = NSGraphicsContext.current?.cgContext
        context?.setAlpha(alpha)
        context?.beginTransparencyLayer(auxiliaryInfo: nil)
        let arrow = Self.arrow()
        // The outline first, wide and white, then the colour over it: only the outer edge stays white.
        NSColor.white.setStroke()
        arrow.lineWidth = 3
        arrow.stroke()
        NSGradient(starting: teal.blended(withFraction: 0.25, of: .white) ?? teal, ending: teal.blended(withFraction: 0.15, of: .black) ?? teal)?
            .draw(in: arrow, angle: 90)
        context?.endTransparencyLayer()
        if !label.isEmpty {
            let attributes: [NSAttributedString.Key: Any] = [.font: Self.labelFont, .foregroundColor: NSColor.white]
            let text = (label as NSString).size(withAttributes: attributes)
            let chip = NSRect(x: Self.labelOrigin.x, y: Self.labelOrigin.y, width: ceil(text.width) + 10, height: 16)
            context?.setAlpha(alpha)
            teal.setFill()
            NSBezierPath(roundedRect: chip, xRadius: 8, yRadius: 8).fill()
            (label as NSString).draw(at: CGPoint(x: chip.minX + 5, y: chip.minY + (chip.height - text.height) / 2), withAttributes: attributes)
        }
    }
}
