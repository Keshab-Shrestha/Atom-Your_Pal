import AppKit
import SwiftUI
import ZenoIslandCore

/// Wisp's home (ADR-042, ADR-043): a small transparent window that follows Wisp.
///
/// - By default Wisp wanders the "walkway" along the top of the Dock on the primary display.
/// - Drag it anywhere, on any display: it stays there ("parked", remembered across launches). Drop it back on
///   the Dock walkway and it wanders again. Right-click → "Back to the Dock" sends it home.
/// - A click or double-click opens the features panel beside it (ADR-051); Wisp stands still while it is open.
/// - After the idle timeout it tucks against a side edge, turned so only its head shows (ADR-051), and comes
///   back when the pointer reaches it or ZENO has something to show.
/// - Clicks pass straight through everything except Wisp's body: the window only listens while the pointer is
///   over Wisp, so the transparent margin never blocks the app underneath.
/// - It never takes focus. It joins every Space and shows over full-screen apps. Shown only while the Pet
///   setting is on.
@MainActor
final class PetController {
    /// Wisp's original drawn size in points; the Size setting scales it (the window is 1.5× the drawn size: see `WispView`).
    static let size: CGFloat = 56
    /// Wisp's drawn size now (Settings → Wisp → Size).
    private var size: CGFloat { settings.wispSize.points }
    private var side: CGFloat { size * 1.5 }
    /// From the bottom of the window up to Wisp's feet.
    private var groundInset: CGFloat { WispView.groundInset(for: size) }
    /// How much bigger or smaller than the original Wisp is: what is placed around its body scales with it.
    private var unit: CGFloat { size / Self.size }
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
    /// Wisp moved (walking, dragged, or settling): its feet in screen coordinates. The speech bubble follows.
    var onMove: (CGPoint) -> Void = { _ in }
    /// Wisp was pressed and let go without being dragged: the click count (2 for a double-click).
    var onClick: (Int) -> Void = { _ in }
    /// The point on the ground under Wisp now.
    var feetPoint: CGPoint { feet }
    /// Wisp is tucked against an edge.
    var isHidden: Bool { peek != nil }
    /// Wisp reached the place it was sent to point at (once per flight).
    var onArrive: () -> Void = {}
    /// Wisp is out pointing at something: it flew there and stays until `endPointing`.
    var isPointing: Bool { pointFeet != nil }
    /// ADR-074: Wisp was dropped with Option held on this app's window. Wisp has already gone back to its spot.
    var onPointAt: (NSRunningApplication) -> Void = { _ in }

    private let settings: IslandSettings
    private let window: NSPanel
    private let content: PetContentView
    /// When Wisp is due to tuck away.
    private var retreat: PetRetreat
    /// Where Wisp is hiding, if it is.
    private var peek: Peek?
    /// How far Wisp is turned now, in degrees: eases toward the hiding angle and back.
    private var rotation = 0.0
    /// Where Wisp stands to point (ADR-054), or nil. Overrides the walkway and a parked spot, never the user's hand.
    private var pointFeet: CGPoint?
    private var pointArrived = false
    private var pointFacing = 1.0
    private var lastKind = IslandStatus.Kind.starting
    private let state = PetState()
    private var brain = PetBrain(width: 800, now: PetController.now)
    private var timer: Timer?
    /// Asleep or locked (ADR-076): no frames are drawn.
    private var paused = false
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
    private var pressCount = 1
    /// The pointer is over Wisp (read by the next frame).
    private var pointerOver = false
    /// ADR-074: the outline around the window Wisp would ask about while Option is held.
    private let outline = WindowOutline()

    // ADR-073: Wisp notices you while ZENO is idle.
    private var reactions = WispReactionPlayer()
    /// Where the eyes look and how much the pointer is over Wisp, eased each frame.
    private var gaze = (x: 0.0, y: 0.0)
    private var hover = 0.0
    private var lastMood = PetBrain.Mood.resting
    /// Wisp's eyes above its feet, in design points (64 = Wisp's drawn size).
    private static let eyeHeight: CGFloat = 25

    static var now: Double { ProcessInfo.processInfo.systemUptime }

    init(settings: IslandSettings, trace: @escaping (String) -> Void = { _ in }) {
        self.settings = settings
        self.trace = trace
        retreat = PetRetreat(timeout: settings.wispHideAfter.seconds, now: PetController.now)
        let side = settings.wispSize.points * 1.5
        window = PetPanel(contentRect: NSRect(x: 0, y: 0, width: side, height: side), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        window.isReleasedWhenClosed = false
        content = PetContentView(frame: NSRect(x: 0, y: 0, width: side, height: side))
        state.size = settings.wispSize.points
        state.style = settings.wispStyle
        let hosting = NSHostingView(rootView: PetStage(state: state))
        hosting.frame = content.bounds
        hosting.autoresizingMask = [.width, .height]
        content.addSubview(hosting)
        window.contentView = content
        content.onDown = { [weak self] event in self?.pointerDown(event) }
        content.onDrag = { [weak self] in self?.pointerDragged() }
        content.onUp = { [weak self] in self?.pointerUp() }
        content.onHome = { [weak self] in self?.sendHome() }
        content.onHide = { [weak self] in self?.onHide() }
        content.onTuck = { [weak self] in self?.tuckAway() }
        content.isTucked = { [weak self] in self?.peek != nil }
        content.isParked = { [weak self] in self?.brain.pinned ?? false }
    }

    var isShown: Bool { window.isVisible }

    /// Shows or hides Wisp; safe to call repeatedly.
    func setEnabled(_ enabled: Bool) {
        if enabled == window.isVisible { return }
        if enabled {
            let now = Self.now
            brain = PetBrain(width: 800, now: now)
            retreat.wake(at: now)
            peek = nil
            rotation = 0
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
            if !paused { startTimer() }
            if observers.isEmpty { observe() }
            react(.hello)
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
        if kind != lastKind {
            lastKind = kind
            wake() // ZENO has something to show: Wisp comes out of hiding to show it
        }
    }

    /// Something the user did (a shortcut, opening the panel): wakes a napping Wisp and brings it out of hiding.
    func poke() {
        brain.poke(at: Self.now)
        wake()
    }

    /// Flies to `feet` (ADR-054) and stays there, out of hiding and awake, until `endPointing`.
    func point(at feet: CGPoint) {
        pointFeet = feet
        pointArrived = false
        settling = true
        poke() // out of hiding and awake
        trace("pet flying to \(Int(feet.x)),\(Int(feet.y))")
    }

    /// Back to where Wisp was: its place on the Dock, or its parked spot.
    func endPointing() {
        guard pointFeet != nil else { return }
        pointFeet = nil
        pointArrived = false
        settling = true
        trace("pet going back from pointing")
    }

    /// Wisp's size, glow, pace and sleepiness from the settings, applied as soon as they change.
    private func applyLook() {
        let next = PetBrain.Tuning(wander: settings.wispWander, nap: settings.wispNap)
        if brain.tuning != next { brain.tuning = next }
        state.glow = settings.wispGlow.strength
        if state.style != settings.wispStyle { state.style = settings.wispStyle }
        let drawn = settings.wispSize.points
        guard state.size != drawn else { return }
        state.size = drawn
        window.setContentSize(NSSize(width: side, height: side))
        place() // the walkway is shorter by Wisp's width
        lastFrameOrigin = CGPoint(x: CGFloat.nan, y: CGFloat.nan)
        trace("pet size \(Int(drawn))")
    }

    /// Restarts the idle timer, and brings Wisp out if it was hiding.
    private func wake() {
        retreat.wake(at: Self.now)
        guard peek != nil else { return }
        peek = nil
        settling = true
        trace("pet out of hiding")
    }

    /// Development only: a snapshot of where Wisp is, for the live demo.
    var debugState: String { "feet=\(Int(feet.x)),\(Int(feet.y)) hidden=\(peek != nil) edge=\(peek.map { $0.edge == .left ? "left" : "right" } ?? "-") turn=\(Int(rotation)) pointing=\(pointFeet != nil)" }

    /// Tucks Wisp against the nearest free edge now (the right-click menu), or does nothing if neither is free.
    func tuckAway() {
        guard peek == nil, window.isVisible, !dragging else { return }
        let displays = NSScreen.screens.map(\.frame)
        guard let chosen = PeekLayout.choose(feet: standingFeet(), displays: displays) else {
            trace("pet cannot hide: both edges touch another display")
            return
        }
        peek = chosen
        settling = true
        trace("pet hiding at the \(chosen.edge == .left ? "left" : "right") edge")
    }

    func stop() {
        for o in observers { NotificationCenter.default.removeObserver(o) }
        observers.removeAll()
        setEnabled(false)
    }

    /// Stops the frame timer while the screens sleep or the Mac is locked, and starts it again after (ADR-076).
    func setPaused(_ paused: Bool) {
        self.paused = paused
        if paused {
            timer?.invalidate()
            timer = nil
        } else if window.isVisible, timer == nil {
            lastTick = Self.now
            startTimer()
        }
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

        retreat.timeout = settings.wispHideAfter.seconds
        applyLook()
        let over = dragging || bodyRect().contains(NSEvent.mouseLocation)
        pointerOver = over
        // Hiding: the brain does not wander, so Wisp comes back to where it was.
        var mood = peek != nil ? brain.mood : brain.step(to: now)
        if peek != nil, !mood.isReacting { mood = .resting } // hiding: awake, eyes open, not a nap with z's turned sideways
        if mood == .napping, peek != nil { mood = .resting }
        state.mood = mood
        state.facing = pointFeet != nil ? pointFacing : brain.facing
        state.time = now
        if mood == .napping, lastMood != .napping { react(.yawn) }
        lastMood = mood
        notice(mood, now: now, dt: Double(dt))

        if over, peek == nil { retreat.wake(at: now) } // never hides from under the pointer
        if peek == nil, retreat.isDue(at: now, blocked: dragging || mood.isReacting || pointFeet != nil) { tuckAway() }
        if peek != nil, retreat.timeout == 0 { wake() } // the setting was switched to Never

        if dragging { updateOutline() }
        if !dragging {
            let normal = standingFeet()
            let target = pointFeet ?? peek.map { PeekLayout.feet(for: $0, y: normal.y, revealed: pointerOver, scale: unit) } ?? normal
            let wantedTurn = peek.map { PeekLayout.rotation(for: $0, lean: settings.wispLean) } ?? 0
            rotation += (wantedTurn - rotation) * Double(1 - exp(-12 * dt))
            if abs(wantedTurn - rotation) < 0.3 { rotation = wantedTurn }
            state.rotation = rotation
            state.hide = PeekLayout.amount(rotation: rotation)
            state.tilt = rotation
            state.edgeGap = -Double((PeekLayout.inset + (pointerOver ? PeekLayout.revealExtra : 0)) * unit) * 64 / Double(state.size)
            if settling || peek != nil {
                // An ease-out toward the target: quick at first, gentle at the end. While hiding it also
                // eases the head out and back as the pointer comes and goes.
                // A flight to point is slower, so the eye can follow it to the place.
                let k = 1 - exp(-(pointFeet != nil ? 5 : 14) * dt)
                feet.x += (target.x - feet.x) * k
                feet.y += (target.y - feet.y) * k
                if abs(target.x - feet.x) < 0.5, abs(target.y - feet.y) < 0.5 {
                    feet = target
                    settling = false
                }
                if pointFeet != nil, abs(target.x - feet.x) > 1 { pointFacing = target.x > feet.x ? 1 : -1 }
            } else {
                feet = target
            }
            move(to: feet)
            if pointFeet != nil, !pointArrived, !settling {
                pointArrived = true
                trace("pet arrived")
                onArrive()
            }
        }

        // Only listen to the pointer while it is over Wisp (or Wisp is being dragged).
        if window.ignoresMouseEvents == over { window.ignoresMouseEvents = !over }

        if now - lastTrace >= 1 {
            lastTrace = now
            trace("pet \(mood) feet=\(Int(feet.x)),\(Int(feet.y)) facing=\(Int(brain.facing)) \(brain.pinned ? "parked" : "walking")")
        }
    }

    /// ADR-073: the eyes ease toward the pointer, the glow toward hover, and the reaction for this frame. Nothing
    /// while the setting is off, while hiding, or while pointing; ZENO's state ends a reaction (`WispReactionPlayer`).
    private func notice(_ mood: PetBrain.Mood, now: Double, dt: Double) {
        let on = settings.wispReacts && peek == nil && pointFeet == nil
        var wanted = (x: 0.0, y: 0.0)
        if on {
            let mouse = NSEvent.mouseLocation
            let eyes = CGPoint(x: feet.x, y: feet.y + size * Self.eyeHeight / 64)
            wanted = WispGaze.offset(dx: Double(mouse.x - eyes.x), dy: Double(mouse.y - eyes.y), mood: mood)
        }
        let k = 1 - exp(-10 * dt)
        gaze.x += (wanted.x - gaze.x) * k
        gaze.y += (wanted.y - gaze.y) * k
        hover += ((on && pointerOver && !dragging ? 1 : 0) - hover) * k
        let playing = on ? reactions.active(at: now, mood: mood) : nil
        state.gaze = CGSize(width: gaze.x, height: gaze.y)
        state.hover = hover
        state.reaction = playing?.reaction
        state.reactionProgress = playing?.progress ?? 0
    }

    /// Starts a reaction if the setting is on (ADR-073). ZENO's state and Reduce Motion are checked by the player.
    func react(_ reaction: WispReaction) {
        guard settings.wispReacts else { return }
        reactions.start(reaction, at: Self.now, mood: state.mood, reduceMotion: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
    }

    private func move(to feet: CGPoint) {
        let origin = CGPoint(x: (feet.x - side / 2).rounded(), y: (feet.y - groundInset).rounded())
        if origin == lastFrameOrigin { return }
        lastFrameOrigin = origin
        window.setFrameOrigin(origin)
        onMove(feet)
    }

    /// Wisp's body in screen coordinates: where a press grabs it.
    private func bodyRect() -> CGRect {
        let u = unit
        // Hiding: only the head, tipped toward the display, is on screen.
        if abs(rotation) > 10 {
            let side: CGFloat = rotation > 0 ? 1 : -1
            return CGRect(x: feet.x + side * 20 * u - 24 * u, y: feet.y + 6 * u, width: 48 * u, height: 46 * u)
        }
        return CGRect(x: feet.x - 22 * u, y: feet.y - 4 * u, width: 44 * u, height: 54 * u)
    }

    /// Where Wisp's feet are when it is out: its place on the Dock walkway, or its parked spot.
    private func standingFeet() -> CGPoint {
        brain.pinned ? parkedFeet() : walkwayFeet()
    }

    // MARK: - The walkway

    /// The primary display (the one with the menu bar and Dock), same as the island. Not `NSScreen.main`:
    /// that is whichever display has the focused window, so Wisp would jump between displays.
    private func place() {
        guard let screen = NSScreen.screens.first else { return }
        let visible = screen.visibleFrame
        walkMinX = visible.minX + Self.margin
        walkY = visible.minY + Self.dockLift
        let width = max(visible.width - Self.margin * 2 - size, 0)
        brain.resize(width: Double(width))
        trace("pet walkway x=\(Int(walkMinX)) y=\(Int(walkY)) width=\(Int(width))")
    }

    /// Where Wisp's feet are when it is walking: the brain's position along the walkway.
    private func walkwayFeet() -> CGPoint {
        CGPoint(x: walkMinX + CGFloat(brain.x) + size / 2, y: walkY)
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
        pressCount = event.clickCount
        pressed = true
        pressStart = NSEvent.mouseLocation
        grabOffset = CGSize(width: NSEvent.mouseLocation.x - feet.x, height: NSEvent.mouseLocation.y - feet.y)
    }

    private func pointerDragged() {
        guard pressed else { return }
        let mouse = NSEvent.mouseLocation
        if !dragging {
            pointFeet = nil // the user took Wisp: it stops pointing
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
        let wasClick = pressed && !dragging
        pressed = false
        if dragging {
            drop()
        } else if wasClick {
            react(WispReaction.forClick(count: pressCount))
            onClick(pressCount) // pressed and let go without moving: open (or close) the features panel
        }
    }

    private func endDrag() {
        pressed = false
        outline.hide()
        if dragging {
            dragging = false
            NSCursor.pop()
        }
    }

    private func drop() {
        dragging = false
        NSCursor.pop()
        outline.hide()
        let now = Self.now
        if case .ask(let target) = PetDrop.decide(optionHeld: NSEvent.modifierFlags.contains(.option), window: windowUnderPointer()) {
            // ADR-074: not parked. Wisp settles back where it was picked up, and the app is asked about.
            brain.putBack(at: now)
            settling = true
            guard let app = NSRunningApplication(processIdentifier: target.pid) else {
                trace("pet dropped on a window whose app is gone")
                return
            }
            trace("pet dropped on a window to ask")
            onPointAt(app)
            return
        }
        if isOnWalkway(feet) {
            // Put down on the Dock: it settles to the walkway and wanders from there.
            brain.drop(homeX: Double(feet.x - size / 2 - walkMinX), at: now)
            settings.petSpot = nil
            settling = true
            trace("pet dropped on the Dock")
        } else {
            brain.drop(homeX: nil, at: now)
            settings.petSpot = PetSpot(x: Double(feet.x), y: Double(feet.y))
            trace("pet parked \(Int(feet.x)),\(Int(feet.y))")
        }
    }

    // MARK: - Asking about a window (ADR-074)

    /// While Option is held during a drag, outlines the window under the pointer; otherwise hides the outline.
    private func updateOutline() {
        guard NSEvent.modifierFlags.contains(.option), let target = windowUnderPointer() else {
            outline.hide()
            return
        }
        outline.show(around: target.bounds, color: settings.theme.palette.accent.nsColor, below: window)
    }

    /// The window under the pointer, from the window list: owner, layer and frame only. No titles, so no Screen Recording.
    private func windowUnderPointer() -> WindowInfo? {
        guard let primary = NSScreen.screens.first,
              let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
        else { return nil }
        let windows = list.compactMap { entry -> WindowInfo? in
            guard let pid = entry[kCGWindowOwnerPID as String] as? Int32,
                  let layer = entry[kCGWindowLayer as String] as? Int,
                  let raw = entry[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: raw as CFDictionary)
            else { return nil }
            let onScreen = entry[kCGWindowIsOnscreen as String] as? Bool ?? true // the list is on-screen only
            return WindowInfo(pid: pid, layer: layer, bounds: WindowPick.appKitRect(bounds, primaryHeight: primary.frame.height), isOnScreen: onScreen)
        }
        return WindowPick.window(at: NSEvent.mouseLocation, in: windows, ownPID: ProcessInfo.processInfo.processIdentifier)
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
        let half = size / 2
        let top = frame.maxY - (side - groundInset)
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
    /// Degrees clockwise: 0 upright, ±90 while hiding at an edge.
    var rotation = 0.0
    /// Drawn size and halo strength from the settings.
    var size: CGFloat = 56
    var glow = 1.0
    /// How Wisp is drawn (Settings → Appearance).
    var style = WispStyle.orb
    /// The hiding pose: 0 standing, ±1 hiding (the sign is the edge).
    var hide = 0.0
    var tilt = 0.0
    var edgeGap = 4.5
    /// ADR-073: gaze toward the pointer, hover, and the reaction playing.
    var gaze = CGSize.zero
    var hover = 0.0
    var reaction: WispReaction?
    var reactionProgress = 0.0
}

/// Draws Wisp for the current state.
struct PetStage: View {
    let state: PetState

    var body: some View {
        WispView(mood: state.mood, time: state.time, facing: state.facing, size: state.size, glow: state.glow, hide: state.hide, tilt: state.tilt, edgeGap: state.edgeGap, style: state.style,
                 gaze: state.gaze, hover: state.hover, reaction: state.reaction, reactionProgress: state.reactionProgress)
            // Leans from the feet, so the body stays behind the edge while the head tips into the display.
            .rotationEffect(.degrees(state.rotation), anchor: UnitPoint(x: 0.5, y: WispView.feetFraction))
    }
}

/// The window's content: takes the mouse and reports presses, drags, double-clicks and the right-click menu.
final class PetContentView: NSView {
    var onDown: (NSEvent) -> Void = { _ in }
    var onDrag: () -> Void = {}
    var onUp: () -> Void = {}
    var onHome: () -> Void = {}
    var onHide: () -> Void = {}
    var onTuck: () -> Void = {}
    var isParked: () -> Bool = { false }
    var isTucked: () -> Bool = { false }

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
        let tuck = NSMenuItem(title: "Tuck away", action: #selector(tuckAway), keyEquivalent: "")
        tuck.target = self
        tuck.isEnabled = !isTucked()
        menu.addItem(tuck)
        let hide = NSMenuItem(title: "Hide Wisp", action: #selector(hideWisp), keyEquivalent: "")
        hide.target = self
        menu.addItem(hide)
        NSMenu.popUpContextMenu(menu, with: event, for: self)
    }

    @objc private func goHome() { onHome() }
    @objc private func tuckAway() { onTuck() }
    @objc private func hideWisp() { onHide() }
}

/// ADR-074: a rounded stroke in the theme's accent around the window Wisp would ask about. It only shows: it never
/// takes clicks or focus.
@MainActor
final class WindowOutline {
    private static let width: CGFloat = 3
    private static let radius: CGFloat = 12
    private let panel: NSPanel
    private var shown: CGRect?

    init() {
        panel = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        let view = NSView()
        view.wantsLayer = true
        view.layer?.borderWidth = Self.width
        view.layer?.cornerRadius = Self.radius
        view.layer?.cornerCurve = .continuous
        panel.contentView = view
    }

    /// Outlines `rect` (AppKit screen coordinates), just under Wisp's own window.
    func show(around rect: CGRect, color: NSColor, below pet: NSWindow) {
        panel.contentView?.layer?.borderColor = color.cgColor
        let frame = rect.insetBy(dx: -Self.width, dy: -Self.width)
        guard shown != frame else { return }
        let wasShown = shown != nil
        shown = frame
        panel.setFrame(frame, display: true)
        if !wasShown { panel.order(.below, relativeTo: pet.windowNumber) }
    }

    func hide() {
        guard shown != nil else { return }
        shown = nil
        panel.orderOut(nil)
    }
}

/// Wisp's window. Hiding puts most of Wisp past the edge of the display, so AppKit must not pull it back on.
final class PetPanel: NSPanel {
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}
