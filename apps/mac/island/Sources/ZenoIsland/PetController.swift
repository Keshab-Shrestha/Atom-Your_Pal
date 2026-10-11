import AppKit
import SwiftUI
import ZenoIslandCore

/// Pal's home (ADR-042, ADR-043): a small transparent window that follows Pal.
///
/// - By default Pal wanders the "walkway" along the top of the Dock on its home display (ADR-078: the main display,
///   the display with the pointer, or a chosen one).
/// - Drag it anywhere, on any display: it stays there ("parked", remembered across launches). Drop it back on
///   the Dock walkway and it wanders again. Right-click → "Back to the Dock" sends it home.
/// - A click or double-click opens the features panel beside it (ADR-051); Pal stands still while it is open.
/// - Clicks pass straight through everything except Pal's body: the window only listens while the pointer is
///   over Pal, so the transparent margin never blocks the app underneath.
/// - It never takes focus. It joins every Space and shows over full-screen apps. Shown only while the Pet
///   setting is on.
@MainActor
final class PetController {
    /// Pal's original drawn size in points; the Size setting scales it (the window is 1.5× the drawn size: see `PalView`).
    static let size: CGFloat = 56
    /// Pal's drawn size now (Settings → Pal → Size).
    private var size: CGFloat { settings.palSize.points }
    private var side: CGFloat { size * 1.5 }
    /// From the bottom of the window up to Pal's feet.
    private var groundInset: CGFloat { PalView.groundInset(for: size) }
    /// How much bigger or smaller than the original Pal is: what is placed around its body scales with it.
    private var unit: CGFloat { size / Self.size }
    /// Keeps the walkway off the very edges of the screen.
    private static let margin: CGFloat = 24
    /// How far above the Dock's top edge Pal's feet rest.
    private static let dockLift: CGFloat = 3
    /// Dropped within this distance of the walkway's height, Pal joins the walkway.
    private static let snapDistance: CGFloat = 44
    /// The pointer must move this far before a press becomes a drag (so a click does not move Pal).
    private static let dragThreshold: CGFloat = 3

    /// Hide Pal (the right-click menu): the app turns the Pet setting off.
    var onHide: () -> Void = {}
    /// Pal moved (walking, dragged, or settling): its feet in screen coordinates. The speech bubble follows.
    var onMove: (CGPoint) -> Void = { _ in }
    /// Pal was pressed and let go without being dragged: the click count (2 for a double-click).
    var onClick: (Int) -> Void = { _ in }
    /// The point on the ground under Pal now.
    var feetPoint: CGPoint { feet }
    /// Pal reached the place it was sent to point at (once per flight).
    var onArrive: () -> Void = {}
    /// Pal is out pointing at something: it flew there and stays until `endPointing`.
    var isPointing: Bool { pointFeet != nil }
    /// ADR-074: Pal was dropped with Option held on this app's window. Pal has already gone back to its spot.
    var onPointAt: (NSRunningApplication) -> Void = { _ in }

    private let settings: IslandSettings
    private let window: NSPanel
    private let content: PetContentView
    /// Where Pal stands to point (ADR-054), or nil. Overrides the walkway and a parked spot, never the user's hand.
    private var pointFeet: CGPoint?
    private var pointArrived = false
    private var pointFacing = 1.0
    /// ADR-077: the curved flight to point or back, while it is in the air. Nil with Reduce Motion (the straight ease).
    private var flight: PalFlight?
    private var lastKind = IslandStatus.Kind.starting
    private let state = PetState()
    private var brain = PetBrain(width: 800, now: PetController.now)
    private var timer: Timer?
    /// ADR-077: frames while awake, and while napping with nothing moving.
    private static let awakeInterval = 1.0 / 30
    private static let restingInterval = 1.0 / 10
    /// Asleep or locked (ADR-076): no frames are drawn.
    private var paused = false
    private var observers: [NSObjectProtocol] = []
    private let trace: (String) -> Void

    // Where things are, in screen coordinates (origin bottom-left of the primary display).
    private var walkMinX: CGFloat = 0
    private var walkY: CGFloat = 0
    /// The visible frame of the display the walkway is on.
    private var walkFrame = CGRect.zero
    /// ADR-078: the display the walkway is on (`NSScreen.displayUUID`); nil until first placed.
    private var homeUUID: String?
    /// The display the pointer is on and since when (for "Display with the pointer").
    private var pointerDisplay: (uuid: String, since: Double)?
    private var lastHomeCheck = 0.0
    /// Pal's feet now (what the window shows).
    private var feet = CGPoint.zero
    /// Where Pal's feet are headed; while `settling`, `feet` eases toward it.
    private var settling = false
    private var lastFrameOrigin = CGPoint(x: CGFloat.nan, y: CGFloat.nan)
    private var lastTick = PetController.now
    private var lastTrace = 0.0

    // A press on Pal.
    private var pressed = false
    private var dragging = false
    private var grabOffset = CGSize.zero
    private var pressStart = CGPoint.zero
    private var pressCount = 1
    /// The pointer is over Pal (read by the next frame).
    private var pointerOver = false
    /// ADR-074: the outline around the window Pal would ask about while Option is held.
    private let outline = WindowOutline()

    // ADR-073: Pal notices you while ZENO is idle.
    private var reactions = PalReactionPlayer()
    /// Where the eyes look and how much the pointer is over Pal, eased each frame.
    private var gaze = (x: 0.0, y: 0.0)
    private var hover = 0.0
    private var lastMood = PetBrain.Mood.resting
    /// Pal's eyes above its feet, in design points (64 = Pal's drawn size).
    private static let eyeHeight: CGFloat = 25

    static var now: Double { ProcessInfo.processInfo.systemUptime }

    init(settings: IslandSettings, trace: @escaping (String) -> Void = { _ in }) {
        self.settings = settings
        self.trace = trace
        let side = settings.palSize.points * 1.5
        window = PetPanel(contentRect: NSRect(x: 0, y: 0, width: side, height: side), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        window.isReleasedWhenClosed = false
        content = PetContentView(frame: NSRect(x: 0, y: 0, width: side, height: side))
        state.size = settings.palSize.points
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
        content.isParked = { [weak self] in self?.brain.pinned ?? false }
    }

    var isShown: Bool { window.isVisible }

    /// Shows or hides Pal; safe to call repeatedly.
    func setEnabled(_ enabled: Bool) {
        if enabled == window.isVisible { return }
        if enabled {
            let now = Self.now
            brain = PetBrain(width: 800, now: now)
            homeUUID = resolveHome(now: now)
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
            flight = nil
            endDrag()
            window.orderOut(nil)
            trace("pet hidden")
        }
    }

    /// ZENO's state changed.
    func update(_ kind: IslandStatus.Kind) {
        brain.update(status: kind, at: Self.now)
        if kind != lastKind { lastKind = kind }
    }

    /// Something the user did (a shortcut, opening the window): wakes a napping Pal.
    func poke() {
        brain.poke(at: Self.now)
    }

    /// Flies to `feet` (ADR-054) and stays there, awake, until `endPointing`.
    func point(at feet: CGPoint) {
        pointFeet = feet
        pointArrived = false
        settling = true
        poke() // awake
        fly(to: feet)
        if abs(feet.x - self.feet.x) > 1 { pointFacing = feet.x > self.feet.x ? 1 : -1 }
        trace("pet flying to \(Int(feet.x)),\(Int(feet.y))")
    }

    /// Back to where Pal was: its place on the Dock, or its parked spot.
    func endPointing() {
        guard pointFeet != nil else { return }
        pointFeet = nil
        pointArrived = false
        settling = true
        fly(to: restingTarget())
        trace("pet going back from pointing")
    }

    /// ADR-077: arcs from where Pal is now to `target`. With Reduce Motion there is no flight: the straight ease runs.
    private func fly(to target: CGPoint) {
        flight = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? nil : PalFlight(from: feet, to: target, at: Self.now)
    }

    /// Pal's size, pace and sleepiness from the settings, applied as soon as they change.
    private func applyLook() {
        let next = PetBrain.Tuning(wander: settings.palWander, nap: settings.palNap)
        if brain.tuning != next { brain.tuning = next }
        if state.palette != settings.theme.palette { state.palette = settings.theme.palette }
        let drawn = settings.palSize.points
        guard state.size != drawn else { return }
        state.size = drawn
        window.setContentSize(NSSize(width: side, height: side))
        place() // the walkway is shorter by Pal's width
        lastFrameOrigin = CGPoint(x: CGFloat.nan, y: CGFloat.nan)
        trace("pet size \(Int(drawn))")
    }

    /// Development only: a snapshot of where Pal is, for the live demo.
    var debugState: String { "feet=\(Int(feet.x)),\(Int(feet.y)) pointing=\(pointFeet != nil)" }

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

    private func startTimer(interval: TimeInterval = PetController.awakeInterval) {
        timer?.invalidate()
        let t = Timer(timeInterval: interval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(t, forMode: .common) // keeps running while the pointer is dragging
        timer = t
    }

    private func tick() {
        let now = Self.now
        let dt = CGFloat(min(max(now - lastTick, 0), 0.1))
        lastTick = now

        applyLook()
        let over = dragging || bodyRect().contains(NSEvent.mouseLocation)
        pointerOver = over
        let mood = brain.step(to: now)
        state.mood = mood
        state.facing = pointFeet != nil ? pointFacing : brain.facing
        if let flight, abs(flight.end.x - flight.start.x) > 1 { state.facing = flight.end.x > flight.start.x ? 1 : -1 }
        state.time = now
        if mood == .napping, lastMood != .napping { react(.yawn) }
        lastMood = mood
        notice(mood, now: now, dt: Double(dt))

        if dragging { updateOutline() }
        if !dragging {
            let target = pointFeet ?? restingTarget()
            if let current = flight {
                // ADR-077: along the arc, landing exactly on its end. If the target moved meanwhile (Pal's place
                // on the walkway), the ease below covers the rest.
                feet = current.position(at: now)
                if current.isDone(at: now) { flight = nil }
            } else if settling {
                // An ease-out toward the target: quick at first, gentle at the end.
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

        // Only listen to the pointer while it is over Pal (or Pal is being dragged).
        if window.ignoresMouseEvents == over { window.ignoresMouseEvents = !over }

        // ADR-077: fewer frames while napping, once nothing is moving; the timer is only replaced on a change.
        let resting = mood == .napping && flight == nil && !settling && !pointerOver && state.reaction == nil
        let interval = resting ? Self.restingInterval : Self.awakeInterval
        if let timer, timer.timeInterval != interval { startTimer(interval: interval) }

        if now - lastHomeCheck >= 1 {
            lastHomeCheck = now
            checkHome(now: now)
        }

        if now - lastTrace >= 1 {
            lastTrace = now
            trace("pet \(mood) feet=\(Int(feet.x)),\(Int(feet.y)) facing=\(Int(brain.facing)) \(brain.pinned ? "parked" : "walking")")
        }
    }

    /// ADR-073: the eyes ease toward the pointer, Pal grows a touch under it, and the reaction for this frame. Nothing
    /// while the setting is off or while pointing; ZENO's state ends a reaction (`PalReactionPlayer`).
    private func notice(_ mood: PetBrain.Mood, now: Double, dt: Double) {
        let on = settings.palReacts && pointFeet == nil
        var wanted = (x: 0.0, y: 0.0)
        if on {
            let mouse = NSEvent.mouseLocation
            let eyes = CGPoint(x: feet.x, y: feet.y + size * Self.eyeHeight / 64)
            wanted = PalGaze.offset(dx: Double(mouse.x - eyes.x), dy: Double(mouse.y - eyes.y), mood: mood)
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
    func react(_ reaction: PalReaction) {
        guard settings.palReacts else { return }
        reactions.start(reaction, at: Self.now, mood: state.mood, reduceMotion: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
    }

    private func move(to feet: CGPoint) {
        let origin = CGPoint(x: (feet.x - side / 2).rounded(), y: (feet.y - groundInset).rounded())
        if origin == lastFrameOrigin { return }
        lastFrameOrigin = origin
        window.setFrameOrigin(origin)
        onMove(feet)
    }

    /// Pal's body in screen coordinates: where a press grabs it.
    private func bodyRect() -> CGRect {
        let u = unit
        return CGRect(x: feet.x - 22 * u, y: feet.y - 4 * u, width: 44 * u, height: 54 * u)
    }

    /// Where Pal's feet are when it is out: its place on the Dock walkway, or its parked spot.
    private func standingFeet() -> CGPoint {
        brain.pinned ? parkedFeet() : walkwayFeet()
    }

    /// Where Pal's feet go when it is not pointing: its place on the Dock, or its parked spot.
    private func restingTarget() -> CGPoint { standingFeet() }

    // MARK: - The walkway

    /// The walkway along the bottom of the home display's visible frame (above its Dock, if it has one). Falls back to
    /// the menu-bar display, never `NSScreen.main`: that is whichever display has the focused window.
    private func place() {
        let screens = NSScreen.screens
        guard let screen = screens.first(where: { $0.displayUUID == homeUUID }) ?? screens.first else { return }
        let visible = screen.visibleFrame
        walkFrame = visible
        walkMinX = visible.minX + Self.margin
        walkY = visible.minY + Self.dockLift
        let width = max(visible.width - Self.margin * 2 - size, 0)
        brain.resize(width: Double(width))
        trace("pet walkway x=\(Int(walkMinX)) y=\(Int(walkY)) width=\(Int(width))")
    }

    /// Where Pal's feet are when it is walking: the brain's position along the walkway.
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
        checkHome(now: Self.now)
        place()
        // A parked Pal whose display went away comes home instead of being lost off-screen.
        if brain.pinned, let spot = settings.petSpot, !screenContains(CGPoint(x: spot.x, y: spot.y)) {
            trace("pet display gone, going home")
            sendHome()
        }
    }

    // MARK: - Home display (ADR-078)

    /// Where the settings and the pointer say home is now, as a display UUID.
    private func resolveHome(now: Double) -> String? {
        let displays = NSScreen.homeDisplays()
        let mouse = NSEvent.mouseLocation
        let pointerIndex = displays.firstIndex { $0.frame.contains(mouse) }
        if let pointerIndex, pointerDisplay?.uuid != displays[pointerIndex].uuid {
            pointerDisplay = (displays[pointerIndex].uuid, now)
        }
        let current = displays.firstIndex { $0.uuid == homeUUID }
        return PalHomeResolver.resolve(settings.palHomeDisplay, displays: displays, pointerIndex: pointerIndex,
                                        pointerDwell: pointerDisplay.map { now - $0.since } ?? 0, currentHome: current)
            .map { displays[$0.index].uuid }
    }

    /// Moves the walkway to the resolved home display. A walking Pal flies there only while idle (otherwise the next
    /// check tries again); a parked Pal stays put. If the old home display is gone, the walkway moves at once.
    private func checkHome(now: Double) {
        guard window.isVisible, let wanted = resolveHome(now: now), wanted != homeUUID else { return }
        let oldGone = !NSScreen.screens.contains { $0.displayUUID == homeUUID }
        let idle = !pressed && !dragging && pointFeet == nil && flight == nil
            && !state.mood.isReacting && state.reaction == nil
        guard brain.pinned || idle || oldGone else { return }
        trace("pet home display \(homeUUID ?? "-") -> \(wanted)")
        homeUUID = wanted
        place()
        guard !brain.pinned, !dragging, pointFeet == nil else { return } // pointing returns to the new walkway when it ends
        settling = true
        fly(to: walkwayFeet())
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
            pointFeet = nil // the user took Pal: it stops pointing
            flight = nil
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
            react(PalReaction.forClick(count: pressCount))
            onClick(pressCount) // pressed and let go without moving: open (or close) the ZENO window
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
            // ADR-074: not parked. Pal settles back where it was picked up, and the app is asked about.
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

    /// Sends a parked Pal back to wandering the Dock walkway.
    private func sendHome() {
        endDrag()
        brain.goHome(at: Self.now)
        settings.petSpot = nil
        settling = true
        trace("pet going home")
    }

    private func isOnWalkway(_ feet: CGPoint) -> Bool {
        abs(feet.y - walkY) <= Self.snapDistance && feet.x >= walkFrame.minX && feet.x <= walkFrame.maxX
    }

    /// Keeps Pal fully on the display the pointer is over.
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

extension NSScreen {
    /// ADR-078: the display's UUID, stable across restarts and rearranged layouts (the display ID is not).
    var displayUUID: String {
        let id = (deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
        guard let uuid = CGDisplayCreateUUIDFromDisplayID(id)?.takeRetainedValue() else { return "display-\(id)" }
        return CFUUIDCreateString(nil, uuid) as String
    }

    /// The connected displays for `PalHomeResolver`, in `NSScreen.screens` order (the menu-bar display first).
    static func homeDisplays() -> [HomeDisplay] {
        screens.enumerated().map { i, screen in
            HomeDisplay(uuid: screen.displayUUID, frame: screen.frame, visibleFrame: screen.visibleFrame, isMain: i == 0)
        }
    }
}

/// What the stage draws, written by the controller each frame.
@MainActor @Observable
final class PetState {
    var mood = PetBrain.Mood.resting
    var facing = 1.0
    var time = 0.0
    /// Drawn size from the settings, and the theme.
    var size: CGFloat = 56
    var palette = ThemePalette.lantern
    /// ADR-073: gaze toward the pointer, hover, and the reaction playing.
    var gaze = CGSize.zero
    var hover = 0.0
    var reaction: PalReaction?
    var reactionProgress = 0.0
}

/// Draws Pal for the current state.
struct PetStage: View {
    let state: PetState

    var body: some View {
        PalView(mood: state.mood, time: state.time, facing: state.facing, size: state.size,
                gaze: state.gaze, hover: state.hover, reaction: state.reaction, reactionProgress: state.reactionProgress)
            .environment(\.theme, state.palette)
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
        let hide = NSMenuItem(title: "Hide Pal", action: #selector(hidePal), keyEquivalent: "")
        hide.target = self
        menu.addItem(hide)
        NSMenu.popUpContextMenu(menu, with: event, for: self)
    }

    @objc private func goHome() { onHome() }
    @objc private func hidePal() { onHide() }
}

/// ADR-074: a rounded stroke in the theme's accent around the window Pal would ask about. It only shows: it never
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

    /// Outlines `rect` (AppKit screen coordinates), just under Pal's own window.
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

/// Pal's window. AppKit must not move it: ZENO places it (dragged to any display, or along the Dock).
final class PetPanel: NSPanel {
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}
