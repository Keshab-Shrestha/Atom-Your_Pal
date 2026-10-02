import AppKit
import SwiftUI
import ZenoIslandCore

/// Wisp's home (ADR-042, ADR-043): a small transparent window that follows Wisp.
///
/// - By default Wisp wanders the "walkway" along the top of the Dock on the primary display.
/// - Drag it anywhere, on any display: it stays there ("parked", remembered across launches). Drop it back on
///   the Dock walkway and it wanders again. Double-click, or right-click → "Back to the Dock", sends it home.
/// - Clicks pass straight through everything except Wisp's body: the window only listens while the pointer is
///   over Wisp, so the transparent margin never blocks the app underneath.
/// - It never takes focus. It joins every Space and shows over full-screen apps. Shown only while the Pet
///   setting is on.
@MainActor
final class PetController {
    /// Wisp's drawn size in points (the window is 1.5× this: see `WispView`).
    static let size: CGFloat = 56
    private static let side = size * 1.5
    /// From the bottom of the window up to Wisp's feet.
    private static let groundInset = WispView.groundInset(for: size)
    /// Keeps the walkway off the very edges of the screen.
    private static let margin: CGFloat = 24
    /// How far above the Dock's top edge Wisp's feet rest.
    private static let dockLift: CGFloat = 3
    /// Dropped within this distance of the walkway's height, Wisp joins the walkway.
    private static let snapDistance: CGFloat = 44
    /// The pointer must move this far before a press becomes a drag (so a click does not move Wisp).
    private static let dragThreshold: CGFloat = 3

    /// Hide Wisp (the right-click menu): the app turns the Pet setting off.
    var onHide: () -> Void = {}

    private let settings: IslandSettings
    private let window: NSPanel
    private let content: PetContentView
    private let state = PetState()
    private var brain = PetBrain(width: 800, now: PetController.now)
    private var timer: Timer?
    private var observers: [NSObjectProtocol] = []
    private let trace: (String) -> Void

    // Where things are, in screen coordinates (origin bottom-left of the primary display).
    private var walkMinX: CGFloat = 0
    private var walkY: CGFloat = 0
    /// Wisp's feet now (what the window shows).
    private var feet = CGPoint.zero
    /// Where Wisp's feet are headed; while `settling`, `feet` eases toward it.
    private var settling = false
    private var lastFrameOrigin = CGPoint(x: CGFloat.nan, y: CGFloat.nan)
    private var lastTick = PetController.now
    private var lastTrace = 0.0

    // A press on Wisp.
    private var pressed = false
    private var dragging = false
    private var grabOffset = CGSize.zero
    private var pressStart = CGPoint.zero

    static var now: Double { ProcessInfo.processInfo.systemUptime }

    init(settings: IslandSettings, trace: @escaping (String) -> Void = { _ in }) {
        self.settings = settings
        self.trace = trace
        let side = Self.side
        window = NSPanel(contentRect: NSRect(x: 0, y: 0, width: side, height: side), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        window.isReleasedWhenClosed = false
        content = PetContentView(frame: NSRect(x: 0, y: 0, width: side, height: side))
        let hosting = NSHostingView(rootView: PetStage(state: state, size: Self.size))
        hosting.frame = content.bounds
        hosting.autoresizingMask = [.width, .height]
        content.addSubview(hosting)
        window.contentView = content
        content.onDown = { [weak self] event in self?.pointerDown(event) }
        content.onDrag = { [weak self] in self?.pointerDragged() }
        content.onUp = { [weak self] in self?.pointerUp() }
        content.onHome = { [weak self] in self?.sendHome() }
        content.onHide = { [weak self] in self?.onHide() }
        content.isParked = { [weak self] in self?.brain.pinned ?? false }
    }

    var isShown: Bool { window.isVisible }

    /// Shows or hides Wisp; safe to call repeatedly.
    func setEnabled(_ enabled: Bool) {
        if enabled == window.isVisible { return }
        if enabled {
            let now = Self.now
            brain = PetBrain(width: 800, now: now)
            place()
            if let spot = settings.petSpot, screenContains(CGPoint(x: spot.x, y: spot.y)) {
                brain.drop(homeX: nil, at: now)
                feet = CGPoint(x: spot.x, y: spot.y)
            } else {
                if settings.petSpot != nil { settings.petSpot = nil } // its screen is gone
                feet = walkwayFeet()
            }
            lastTick = now
            move(to: feet)
            window.orderFrontRegardless()
            startTimer()
            if observers.isEmpty { observe() }
            trace("pet shown \(brain.pinned ? "parked" : "walking")")
        } else {
            timer?.invalidate()
            timer = nil
            endDrag()
            window.orderOut(nil)
            trace("pet hidden")
        }
    }

    /// ZENO's state changed.
    func update(_ kind: IslandStatus.Kind) {
        brain.update(status: kind, at: Self.now)
    }

    /// Something the user did (a shortcut, opening the island): wakes a napping Wisp.
    func poke() {
        brain.poke(at: Self.now)
    }

    func stop() {
        for o in observers { NotificationCenter.default.removeObserver(o) }
        observers.removeAll()
        setEnabled(false)
    }

    // MARK: - Frame loop

    private func startTimer() {
        timer?.invalidate()
        let t = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(t, forMode: .common) // keeps running while the pointer is dragging
        timer = t
    }

    private func tick() {
        let now = Self.now
        let dt = CGFloat(min(max(now - lastTick, 0), 0.1))
        lastTick = now

        let mood = brain.step(to: now)
        state.mood = mood
        state.facing = brain.facing
        state.time = now

        if !dragging {
            let target = brain.pinned ? parkedFeet() : walkwayFeet()
            if settling {
                // An ease-out toward the target: quick at first, gentle at the end.
                let k = 1 - exp(-14 * dt)
                feet.x += (target.x - feet.x) * k
                feet.y += (target.y - feet.y) * k
                if abs(target.x - feet.x) < 0.5, abs(target.y - feet.y) < 0.5 {
                    feet = target
                    settling = false
                }
            } else {
                feet = target
            }
            move(to: feet)
        }

        // Only listen to the pointer while it is over Wisp (or Wisp is being dragged).
        let over = dragging || bodyRect().contains(NSEvent.mouseLocation)
        if window.ignoresMouseEvents == over { window.ignoresMouseEvents = !over }

        if now - lastTrace >= 1 {
            lastTrace = now
            trace("pet \(mood) feet=\(Int(feet.x)),\(Int(feet.y)) facing=\(Int(brain.facing)) \(brain.pinned ? "parked" : "walking")")
        }
    }

    private func move(to feet: CGPoint) {
        let origin = CGPoint(x: (feet.x - Self.side / 2).rounded(), y: (feet.y - Self.groundInset).rounded())
        if origin == lastFrameOrigin { return }
        lastFrameOrigin = origin
        window.setFrameOrigin(origin)
    }

    /// Wisp's body in screen coordinates: where a press grabs it.
    private func bodyRect() -> CGRect {
        CGRect(x: feet.x - 22, y: feet.y - 4, width: 44, height: 54)
    }

    // MARK: - The walkway

    /// The primary display (the one with the menu bar and Dock), same as the island. Not `NSScreen.main`:
    /// that is whichever display has the focused window, so Wisp would jump between displays.
    private func place() {
        guard let screen = NSScreen.screens.first else { return }
        let visible = screen.visibleFrame
        walkMinX = visible.minX + Self.margin
        walkY = visible.minY + Self.dockLift
        let width = max(visible.width - Self.margin * 2 - Self.size, 0)
        brain.resize(width: Double(width))
        trace("pet walkway x=\(Int(walkMinX)) y=\(Int(walkY)) width=\(Int(width))")
    }

    /// Where Wisp's feet are when it is walking: the brain's position along the walkway.
    private func walkwayFeet() -> CGPoint {
        CGPoint(x: walkMinX + CGFloat(brain.x) + Self.size / 2, y: walkY)
    }

    private func parkedFeet() -> CGPoint {
        guard let spot = settings.petSpot else { return feet }
        return CGPoint(x: spot.x, y: spot.y)
    }

    private func observe() {
        observers.append(NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.screensChanged() }
        })
    }

    private func screensChanged() {
        place()
        // A parked Wisp whose display went away comes home instead of being lost off-screen.
        if brain.pinned, let spot = settings.petSpot, !screenContains(CGPoint(x: spot.x, y: spot.y)) {
            trace("pet display gone, going home")
            sendHome()
        }
    }

    private func screenContains(_ point: CGPoint) -> Bool {
        NSScreen.screens.contains { $0.frame.insetBy(dx: -1, dy: -1).contains(point) }
    }

    // MARK: - Dragging

    private func pointerDown(_ event: NSEvent) {
        poke()
        if event.clickCount >= 2 {
            sendHome()
            return
        }
        pressed = true
        pressStart = NSEvent.mouseLocation
        grabOffset = CGSize(width: NSEvent.mouseLocation.x - feet.x, height: NSEvent.mouseLocation.y - feet.y)
    }

    private func pointerDragged() {
        guard pressed else { return }
        let mouse = NSEvent.mouseLocation
        if !dragging {
            guard hypot(mouse.x - pressStart.x, mouse.y - pressStart.y) >= Self.dragThreshold else { return }
            dragging = true
            settling = false
            brain.grab(at: Self.now)
            NSCursor.closedHand.push()
            trace("pet grabbed")
        }
        feet = clamped(CGPoint(x: mouse.x - grabOffset.width, y: mouse.y - grabOffset.height), near: mouse)
        move(to: feet)
    }

    private func pointerUp() {
        pressed = false
        if dragging { drop() }
    }

    private func endDrag() {
        pressed = false
        if dragging {
            dragging = false
            NSCursor.pop()
        }
    }

    private func drop() {
        dragging = false
        NSCursor.pop()
        let now = Self.now
        if isOnWalkway(feet) {
            // Put down on the Dock: it settles to the walkway and wanders from there.
            brain.drop(homeX: Double(feet.x - Self.size / 2 - walkMinX), at: now)
            settings.petSpot = nil
            settling = true
            trace("pet dropped on the Dock")
        } else {
            brain.drop(homeX: nil, at: now)
            settings.petSpot = PetSpot(x: Double(feet.x), y: Double(feet.y))
            trace("pet parked \(Int(feet.x)),\(Int(feet.y))")
        }
    }

    /// Sends a parked Wisp back to wandering the Dock walkway.
    private func sendHome() {
        endDrag()
        brain.goHome(at: Self.now)
        settings.petSpot = nil
        settling = true
        trace("pet going home")
    }

    private func isOnWalkway(_ feet: CGPoint) -> Bool {
        guard let primary = NSScreen.screens.first else { return false }
        let visible = primary.visibleFrame
        return abs(feet.y - walkY) <= Self.snapDistance
            && feet.x >= visible.minX && feet.x <= visible.maxX
    }

    /// Keeps Wisp fully on the display the pointer is over.
    private func clamped(_ point: CGPoint, near mouse: CGPoint) -> CGPoint {
        let screens = NSScreen.screens
        guard let frame = (screens.first { $0.frame.contains(mouse) } ?? screens.first)?.frame else { return point }
        let half = Self.size / 2
        let top = frame.maxY - (Self.side - Self.groundInset)
        return CGPoint(
            x: min(max(point.x, frame.minX + half), frame.maxX - half),
            y: min(max(point.y, frame.minY + 2), top)
        )
    }
}

/// What the stage draws, written by the controller each frame.
@MainActor @Observable
final class PetState {
    var mood = PetBrain.Mood.resting
    var facing = 1.0
    var time = 0.0
}

/// Draws Wisp for the current state.
struct PetStage: View {
    let state: PetState
    let size: CGFloat

    var body: some View {
        WispView(mood: state.mood, time: state.time, facing: state.facing, size: size)
    }
}

/// The window's content: takes the mouse and reports presses, drags, double-clicks and the right-click menu.
final class PetContentView: NSView {
    var onDown: (NSEvent) -> Void = { _ in }
    var onDrag: () -> Void = {}
    var onUp: () -> Void = {}
    var onHome: () -> Void = {}
    var onHide: () -> Void = {}
    var isParked: () -> Bool = { false }

    override func hitTest(_ point: NSPoint) -> NSView? { frame.contains(point) ? self : nil }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { onDown(event) }
    override func mouseDragged(with event: NSEvent) { onDrag() }
    override func mouseUp(with event: NSEvent) { onUp() }

    override func rightMouseDown(with event: NSEvent) {
        let menu = NSMenu()
        let home = NSMenuItem(title: "Back to the Dock", action: #selector(goHome), keyEquivalent: "")
        home.target = self
        home.isEnabled = isParked()
        menu.addItem(home)
        let hide = NSMenuItem(title: "Hide Wisp", action: #selector(hideWisp), keyEquivalent: "")
        hide.target = self
        menu.addItem(hide)
        NSMenu.popUpContextMenu(menu, with: event, for: self)
    }

    @objc private func goHome() { onHome() }
    @objc private func hideWisp() { onHide() }
}
