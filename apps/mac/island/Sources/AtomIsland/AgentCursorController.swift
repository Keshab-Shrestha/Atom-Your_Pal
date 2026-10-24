import AppKit

/// A visual second pointer owned by ATOM, shown only during computer work. Never changes the real pointer.
@MainActor
final class AgentCursorController {
    private let panel = AgentCursorPanel(contentRect: CGRect(x: 0, y: 0, width: 24, height: 30), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    private let art = CursorArt(frame: CGRect(x: 0, y: 0, width: 24, height: 30))
    private var enabled = false
    private var active = false
    private var returning = false
    private var home = CGPoint.zero
    private var start = CGPoint.zero
    private var revision = 0
    private var motion: Timer?
    var log: (String, [String: String]) -> Void = { _, _ in }

    init() {
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 3) // above ATOM's bubble/work strip
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        panel.contentView = art
        panel.setAccessibilityLabel("ATOM agent cursor")
    }

    func setHome(_ point: CGPoint) {
        home = point
        if enabled && !active { place(point) }
    }

    func setEnabled(_ value: Bool) {
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
            self.log("island.cursor.move", ["visible": String(self.panel.isVisible),
                "targetDisplay": targetDisplay, "actualDisplay": self.panel.screen?.localizedName ?? "unknown",
                "unoccluded": String(self.panel.occlusionState.contains(.visible)),
                "atTarget": String(hypot(self.panel.frame.minX + 2 - point.x, self.panel.frame.minY + 28 - point.y) < 1)])
        }
    }

    func end() {
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
            let atHome = hypot(self.panel.frame.minX + 2 - destination.x, self.panel.frame.minY + 28 - destination.y) < 1
            self.panel.orderOut(nil)
            self.log("island.cursor.home", ["visible": String(self.panel.isVisible), "atHome": String(atHome)])
        }
    }

    private func place(_ point: CGPoint) {
        motion?.invalidate()
        motion = nil
        panel.setFrameOrigin(CGPoint(x: point.x - 2, y: point.y - 28))
    }

    /// Move the real panel frame on the main run loop, including between displays. No NSWindow animator proxy.
    private func glide(to point: CGPoint, duration: Double, completion: (@MainActor @Sendable () -> Void)? = nil) {
        motion?.invalidate()
        motion = nil
        let origin = CGPoint(x: point.x - 2, y: point.y - 28)
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

private final class CursorArt: NSView {
    var active = false
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath()
        path.move(to: CGPoint(x: 2, y: 2))
        for point in [CGPoint(x: 3, y: 21), CGPoint(x: 8, y: 16), CGPoint(x: 12, y: 26), CGPoint(x: 17, y: 24), CGPoint(x: 13, y: 15), CGPoint(x: 21, y: 15)] { path.line(to: point) }
        path.close()
        NSColor(calibratedRed: 0.13, green: 0.63, blue: 0.58, alpha: active ? 1 : 0.55).setFill()
        path.fill()
        NSColor.white.withAlphaComponent(active ? 1 : 0.75).setStroke()
        path.lineWidth = 1.5
        path.stroke()
    }
}
