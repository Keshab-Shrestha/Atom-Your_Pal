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

    /// `tint` and `label` make a lane's cursor: the same hand in another colour, with the lane's name beside it.
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

/// The agent pointer (2026-11-02, Keshab: "more stylish like fingertips"): a pointing hand in ARK's teal with a white outline.
/// The fingertip is the point ARK acts on; a ring ripples from it when the pointer arrives. Vector, drawn at any scale.
final class CursorArt: NSView {
    static let size = CGSize(width: 44, height: 48)
    /// Room for a lane's name beside the hand.
    static let labelFont = NSFont.systemFont(ofSize: 10, weight: .semibold)
    static func size(label: String) -> CGSize {
        guard !label.isEmpty else { return size }
        return CGSize(width: size.width + ceil((label as NSString).size(withAttributes: [.font: labelFont]).width) + 12, height: size.height)
    }
    /// A lane's colour; nil: ARK's teal.
    var tint: NSColor?
    /// A lane's name, drawn in a small chip beside the hand.
    var label = ""
    /// Where the label chip starts, to the right of the hand.
    private static let labelOrigin = CGPoint(x: 36, y: 20)
    /// The fingertip in the panel's own (bottom-left) coordinates: where the pointer is.
    static let tip = CGPoint(x: 19.75, y: 37)
    /// The hand's offset inside the panel: room around the fingertip for the ripple.
    private static let inset = CGPoint(x: 9, y: 9)
    var active = false
    private var rippleProgress: CGFloat?
    private var rippleTimer: Timer?
    override var isFlipped: Bool { true }

    /// The hand's parts, top-left origin, fingertip at (10.75, 2) before the inset.
    static func parts() -> [NSBezierPath] {
        func capsule(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat) -> NSBezierPath {
            NSBezierPath(roundedRect: NSRect(x: x + inset.x, y: y + inset.y, width: w, height: h), xRadius: r, yRadius: r)
        }
        let thumb = capsule(4, 15, 5.5, 11, 2.75)
        let turn = AffineTransform(translationByX: 8.5 + inset.x, byY: 24 + inset.y)
        var transform = AffineTransform(translationByX: -(8.5 + inset.x), byY: -(24 + inset.y))
        transform.append(AffineTransform(rotationByDegrees: -32))
        transform.append(turn)
        thumb.transform(using: transform)
        return [capsule(8, 2, 5.5, 17, 2.75),    // index finger
                capsule(13, 10, 4.5, 10, 2.25),  // middle
                capsule(17, 11.5, 4.5, 9, 2.25), // ring
                capsule(21, 13.5, 3.5, 7.5, 1.75), // little finger
                capsule(7, 14, 17.5, 14.5, 5),   // palm
                thumb]
    }

    /// The ring at a fixed point of its way out, for the gallery.
    func showRipple(at progress: CGFloat) { rippleProgress = progress }

    /// One ring, out from the fingertip and fading, over 0.45 seconds. None with Reduce Motion.
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
        // One layer at the hand's opacity, so overlapping parts never show through each other when it is idle.
        let context = NSGraphicsContext.current?.cgContext
        context?.setAlpha(alpha)
        context?.beginTransparencyLayer(auxiliaryInfo: nil)
        let parts = Self.parts()
        // The outline first, wide, then one fill over the whole hand: only its outer edge stays white.
        NSColor.white.setStroke()
        for part in parts { part.lineWidth = 3; part.lineJoinStyle = .round; part.stroke() }
        let hand = NSBezierPath()
        hand.windingRule = .nonZero
        for part in parts { hand.append(part) }
        NSGradient(starting: teal.blended(withFraction: 0.25, of: .white) ?? teal, ending: teal.blended(withFraction: 0.2, of: .black) ?? teal)?
            .draw(in: hand, angle: 90)
        // Knuckle lines between the fingers, faint.
        let knuckles = NSBezierPath()
        for x in [CGFloat(13), 17, 21] { knuckles.move(to: CGPoint(x: x + Self.inset.x, y: 15 + Self.inset.y)); knuckles.line(to: CGPoint(x: x + Self.inset.x, y: 19 + Self.inset.y)) }
        NSColor.black.withAlphaComponent(0.18).setStroke()
        knuckles.lineWidth = 0.8
        knuckles.stroke()
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
