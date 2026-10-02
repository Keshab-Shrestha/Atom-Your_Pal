import AppKit
import SwiftUI
import ZenoIslandCore

/// Places the island at the left edge of the display with the menu bar, below the menu bar (ADR-037),
/// and slides it in and out as the pointer reaches that edge. Pointer tracking uses mouse-moved events,
/// which need no permission. Clicking the card expands it in place (ADR-038); a click elsewhere, Esc or
/// the collapse button folds it back.
@MainActor
final class IslandController {
    let model: IslandModel
    let shortcuts: ShortcutEngine
    /// Wisp, shown while the Pet setting is on (ADR-042).
    let pet: PetController
    private let panel = IslandPanel()
    /// Wisp's speech bubble (ADR-050): while Wisp is shown and the island is closed, status appears here, not at the left edge.
    private let bubble: BubbleController
    /// The bubble stays up until this time (uptime) after a turn, so the outcome can be read.
    private var bubbleUntil = 0.0
    private var bubbleTimer: Timer?
    /// Talk was started by its shortcut and not yet sent or cancelled: show the island at once.
    private var talking = false
    /// Dictation (ADR-047): hold, speak, let go, and the text is typed into the app in front.
    let dictation: DictationController
    /// A dictation is in progress (listening or transcribing): the island stays out.
    private var dictating = false
    private let hosting: NSHostingView<IslandView>
    private var hover = HoverController()
    private var geometry: IslandGeometry
    private var presentation = IslandGeometry.Presentation.compact
    private var shown = false
    private var monitors: [Any] = []
    private var observers: [NSObjectProtocol] = []
    private var recheck: Timer?
    private var lastTrigger = false
    private var lastTitle = ""
    /// Development only: when set, a PNG of the island is written here each time its title changes.
    private let snapshotDirectory = ProcessInfo.processInfo.environment["ZENO_ISLAND_SNAPSHOTS"].map { URL(fileURLWithPath: $0) }
    private var snapshotCount = 0
    private let trace: (String) -> Void

    /// Slide duration; with Reduce Motion the island fades instead.
    private let slideDuration = 0.24
    /// How long the island stays out after a turn ends, so the outcome can be seen.
    private let afterTurn = 2.5
    /// How long a notice or problem stays out.
    private let afterProblem = 6.0

    init(settings: IslandSettings, log: @escaping (String, [String: Any]) -> Void, trace: @escaping (String) -> Void = { _ in }) {
        self.trace = trace
        model = IslandModel(settings: settings)
        bubble = BubbleController(model: model)
        shortcuts = ShortcutEngine(settings: settings, recorder: model.recorder, log: log)
        pet = PetController(settings: settings, trace: trace)
        dictation = DictationController(vocabularyURL: IslandController.vocabularyURL)
        dictation.log = log
        model.shortcuts = shortcuts
        geometry = IslandController.currentGeometry()
        hosting = NSHostingView(rootView: IslandView(model: model))
        hosting.sizingOptions = [] // the controller sets the size; SwiftUI must not resize the window
        panel.contentView = hosting
        panel.setFrame(geometry.frame(presentation, visible: false), display: false)
        model.setExpanded = { [weak self] expanded in self?.setExpanded(expanded) }
        panel.onCancel = { [weak self] in self?.setExpanded(false) }
        shortcuts.onTrigger = { [weak self] trigger in self?.shortcut(trigger) }
        dictation.onPhase = { [weak self] phase in self?.dictationPhase(phase) }
        dictation.onLevel = { [weak self] peak in
            guard let self, self.model.status.showsLevel else { return }
            self.model.meter.add(Double(peak))
        }
        dictation.playSound = { [weak self] sound in self?.playTone(sound) }
        dictation.options = { [weak self] in self?.model.settings.dictationOptions ?? DictationOptions() }
        dictation.onPreview = { [weak self] text in
            guard let self else { return }
            self.model.status.setPreview(text)
        }
        dictation.conversationBusy = { [weak self] in self.map { $0.talking || $0.model.status.isBusy && !$0.dictating } ?? false }
        shortcuts.trace = trace
        model.petChanged = { [weak self] enabled in
            guard let self else { return }
            self.pet.setEnabled(enabled)
            self.statusChanged() // the status moves between Wisp's bubble and the island
        }
        pet.onMove = { [weak self] feet in self?.bubble.follow(feet) }
        pet.onHide = { [weak model] in model?.setPet(false) } // right-click → Hide Wisp
    }

    func start() {
        let move: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged]
        // Moves over other apps (global) and over the island itself (local).
        if let global = NSEvent.addGlobalMonitorForEvents(matching: move, handler: { [weak self] _ in
            MainActor.assumeIsolated { self?.evaluate() }
        }) { monitors.append(global) }
        if let local = NSEvent.addLocalMonitorForEvents(matching: move, handler: { [weak self] event in
            MainActor.assumeIsolated { self?.evaluate() }
            return event
        }) { monitors.append(local) }

        // A click in another app folds the expanded island back.
        if let outside = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown], handler: { [weak self] _ in
            MainActor.assumeIsolated { self?.clickedOutside() }
        }) { monitors.append(outside) }
        // While a shortcut is being recorded, its keys go to the recorder and nowhere else.
        // Local monitors run on the main thread, so the event never leaves it.
        if let keys = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp, .flagsChanged], handler: { [weak self] event in
            nonisolated(unsafe) let event = event
            let used = MainActor.assumeIsolated { self?.model.recorder.handle(event) ?? false }
            return used ? nil : event
        }) { monitors.append(keys) }

        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.screensChanged() }
        })
        // After switching Spaces (including into a full-screen app), make sure the island is still in front.
        observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.spaceChanged() }
        })
        shortcuts.start()
        pet.setEnabled(model.settings.petEnabled)
        dictation.warmUp()
        if ProcessInfo.processInfo.environment["ZENO_BUBBLE_DEMO"] != nil { playBubbleDemo() }
                if let files = ProcessInfo.processInfo.environment["ZENO_DICTATION_FILE"] { dictation.selfTest(files: files.split(separator: ",").map(String.init)) }
    }

    func stop() {
        shortcuts.stop()
        dictation.stop()
        pet.stop()
        bubbleTimer?.invalidate()
        bubble.stop()
        for monitor in monitors { NSEvent.removeMonitor(monitor) }
        monitors = []
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
        }
        observers = []
        recheck?.invalidate()
        panel.orderOut(nil)
    }

    // MARK: - Runtime

    func apply(_ status: RuntimeSupervisor.Status) {
        model.status.apply(status)
        statusChanged()
    }

    func apply(_ event: IslandEvent) {
        if case .micLevel = event {} else { model.apply(event) }
        switch event {
        case .micLevel(let peak):
            // 20 updates a second: only the meter changes, and only while it is shown.
            if model.status.showsLevel { model.meter.add(peak) }
            return
        case .state(.listening):
            model.meter.reset()
        default:
            break
        }
        let wasBusy = model.status.isBusy
        model.status.apply(event)
        if case .state(.idle) = event, wasBusy {
            // A turn just ended: stay out briefly so the outcome is seen.
            linger(model.status.needsAttention ? afterProblem : afterTurn)
        }
        statusChanged()
    }

    /// Keeps the island out during a turn, and brings it out for a notice or problem.
    private func statusChanged() {
        pet.update(model.status.kind)
        if model.status.title != lastTitle {
            lastTitle = model.status.title
            trace("status \(model.status.title) — \(model.status.detail)")
            snapshotSoon()
        }
        if model.status.needsAttention { linger(afterProblem) }
        updateHeld()
        updateBubble()
        evaluate()
    }

    // MARK: - Shortcuts

    private func shortcut(_ trigger: ShortcutTrigger) {
        trace("shortcut \(trigger)")
        pet.poke()
        switch trigger {
        case .holdBegan(.talk):
            talking = true
            model.send(.talkStart)
        case .holdEnded(.talk):
            talking = false
            model.send(.talkSend)
        case .holdCancelled(.talk):
            talking = false
            model.send(.talkCancel)
        case .pressed(.toggleIsland):
            setExpanded(!model.expanded)
        case .pressed(.cancel):
            talking = false
            if dictation.isActive { dictation.cancel() } else { model.send(.talkCancel) }
        case .holdBegan(.dictate):
            model.meter.reset()
            dictation.holdBegan()
        case .holdEnded(.dictate):
            dictation.holdEnded()
        case .holdCancelled(.dictate):
            dictation.holdCancelled()
        default:
            break
        }
        updateHeld()
        evaluate()
    }

    /// Kept out during a turn, while talking or dictating by shortcut and while expanded.
    private func updateHeld() {
        shortcuts.setBusy(model.status.isBusy || talking || dictating)
        // With Wisp out, a turn shows in its bubble and the card at the edge stays put.
        let working = model.status.isBusy || talking || dictating
        let held = model.expanded || (working && !bubbleMode)
        if hover.held != held {
            hover.held = held
            trace("held \(held)")
        }
    }

    private func linger(_ seconds: Double) {
        let until = ProcessInfo.processInfo.systemUptime + seconds
        if bubbleMode {
            bubbleUntil = max(bubbleUntil, until)
        } else {
            hover.linger(until: until)
        }
    }

    /// Wisp is on screen and the island is closed: status goes in Wisp's bubble.
    private var bubbleMode: Bool { pet.isShown && !model.expanded }

    /// Shows or hides the bubble: up while a turn is in progress, and for a moment after.
    private func updateBubble() {
        let now = ProcessInfo.processInfo.systemUptime
        let wanted = bubbleMode && (model.status.isBusy || talking || dictating || now < bubbleUntil)
        if wanted {
            if !bubble.isVisible { trace("bubble show") }
            bubble.show(at: pet.feetPoint)
            bubbleTimer?.invalidate()
            bubbleTimer = nil
            // Once nothing is happening, re-check when the linger ends.
            if !(model.status.isBusy || talking || dictating), bubbleUntil > now {
                let timer = Timer(timeInterval: bubbleUntil - now + 0.02, repeats: false) { [weak self] _ in
                    MainActor.assumeIsolated { self?.updateBubble() }
                }
                RunLoop.main.add(timer, forMode: .common)
                bubbleTimer = timer
            }
        } else if bubble.isVisible {
            trace("bubble hide")
            bubble.hide()
            if bubbleMode { model.status.acknowledge() } // seen: a notice goes back to Ready, as when the island hides
        }
    }

    // MARK: - Dictation

    /// Shows a dictation's progress on the island, and keeps it out while one is in progress.
    private func dictationPhase(_ phase: DictationPhase) {
        model.status.apply(phase)
        switch phase {
        case .loading, .listening, .listeningHandsFree, .transcribing:
            dictating = true
        case .done(let outcome):
            dictating = false
            linger(model.status.needsAttention ? afterProblem : (outcome == .busy ? afterProblem : 1.8))
        case .cancelled:
            dictating = false
        }
        statusChanged()
        syncWidth()
    }

    /// The card is wider while dictating with the live preview, so the words fit. Not while expanded.
    private func syncWidth() {
        guard !model.expanded else { return }
        if bubbleMode, presentation != .compact { presentation = .compact }
        let wanted: IslandGeometry.Presentation = model.status.kind == .listening && model.settings.livePreview && dictating && !bubbleMode ? .wide : .compact
        guard wanted != presentation else { return }
        presentation = wanted
        guard shown else { return }
        let target = geometry.frame(presentation, visible: true)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.2
            context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1)
            panel.animator().setFrame(target, display: true)
        }
    }

    /// Where the user's spelling fixes live: `vocabulary.txt` in ZENO's folder under Application Support.
    static var vocabularyURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/ZENO/vocabulary.txt")
    }

    private func playTone(_ sound: DictationController.Sound) {
        guard model.settings.soundsEnabled else { return }
        NSSound(named: sound == .start ? "Tink" : "Pop")?.play()
    }

    // MARK: - Pointer

    private func evaluate() {
        let point = NSEvent.mouseLocation
        let trigger = geometry.inTrigger(point)
        if trigger != lastTrigger {
            lastTrigger = trigger
            trace("trigger \(trigger) at \(point)")
        }
        let output = hover.update(
            inTrigger: trigger,
            inKeepZone: shown && geometry.inKeepZone(point, presentation),
            now: ProcessInfo.processInfo.systemUptime)
        setShown(output.visible)
        scheduleRecheck(at: output.recheckAt)
    }

    /// Re-evaluates when a delay ends even if the pointer has stopped moving (e.g. resting at the edge).
    private func scheduleRecheck(at time: Double?) {
        recheck?.invalidate()
        recheck = nil
        guard let time else { return }
        let delay = max(0, time - ProcessInfo.processInfo.systemUptime) + 0.005
        let timer = Timer(timeInterval: delay, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.evaluate() }
        }
        RunLoop.main.add(timer, forMode: .common)
        recheck = timer
    }

    // MARK: - Expanding

    private func setExpanded(_ expanded: Bool) {
        pet.poke()
        guard expanded != model.expanded else { return }
        trace(expanded ? "expand" : "collapse")
        if !expanded { model.recorder.stop() }
        model.expanded = expanded
        presentation = expanded ? .expanded : .compact
        panel.acceptsKeyFocus = expanded
        updateHeld()
        updateBubble()

        let target = geometry.frame(presentation, visible: true)
        if !shown {
            shown = true
            panel.setFrame(target, display: false)
            panel.orderFrontRegardless()
        } else {
            let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
            NSAnimationContext.runAnimationGroup { context in
                context.duration = reduceMotion ? 0 : 0.28
                context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1)
                panel.animator().setFrame(target, display: true)
            }
        }
        if expanded {
            // Key, so the recorder and Esc get keys, without activating ZENO: the app you were in stays active.
            panel.makeKey()
        } else {
            panel.resignKey()
            hover.dismiss() // hide soon unless the pointer is over the card
        }
        evaluate()
    }

    private func clickedOutside() {
        guard model.expanded else { return }
        // Global monitors only see clicks in other apps, so this was not on the island.
        setExpanded(false)
    }

    // MARK: - Showing and hiding

    private func setShown(_ visible: Bool) {
        guard visible != shown else { return }
        shown = visible
        trace(visible ? "panel show" : "panel hide")
        let target = geometry.frame(presentation, visible: visible)
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

        if visible, !panel.isVisible {
            // Start from the hidden position (or in place, faded out, with Reduce Motion).
            panel.setFrame(reduceMotion ? target : geometry.frame(presentation, visible: false), display: false)
            panel.alphaValue = reduceMotion ? 0 : 1
            panel.orderFrontRegardless()
        }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = slideDuration
            context.timingFunction = visible
                ? CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1) // quick out, soft landing
                : CAMediaTimingFunction(name: .easeIn)
            if reduceMotion {
                panel.animator().alphaValue = visible ? 1 : 0
            } else {
                panel.animator().setFrame(target, display: true)
            }
        }, completionHandler: { [weak self] in
            MainActor.assumeIsolated {
                guard let self, !self.shown else { return }
                // Fully hidden: take it off screen so it cannot catch clicks or appear on another display.
                self.panel.orderOut(nil)
                self.panel.alphaValue = 1
                self.model.status.acknowledge()
                self.model.meter.reset()
            }
        })
    }

    // MARK: - Development demo

    /// Development only (`ZENO_BUBBLE_DEMO=1`): plays a dictation's phases through the real controller, with no
    /// microphone and no keys, so the bubble's window can be measured on the real screen.
    private func playBubbleDemo() {
        let steps: [(Double, @MainActor () -> Void)] = [
            (4, { [self] in model.meter.reset(); dictationPhase(.listening) }),
            (6, { [self] in model.status.setPreview("send the deck before the call"); trace("demo preview") }),
            (9, { [self] in dictationPhase(.listeningHandsFree) }),
            (12, { [self] in dictationPhase(.transcribing) }),
            (14, { [self] in dictationPhase(.done(.typed(words: 6))) }),
        ]
        for (delay, step) in steps {
            let timer = Timer(timeInterval: delay, repeats: false) { _ in MainActor.assumeIsolated { step() } }
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    // MARK: - Development snapshots

    private func snapshotSoon() {
        guard snapshotDirectory != nil else { return }
        // Long enough for some mic levels to arrive while listening.
        let timer = Timer(timeInterval: 0.6, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.writeSnapshot() }
        }
        RunLoop.main.add(timer, forMode: .common)
    }

    private func writeSnapshot() {
        guard let directory = snapshotDirectory else { return }
        let size = geometry.size(presentation)
        let renderer = ImageRenderer(content: IslandView(model: model, snapshot: true).frame(width: size.width, height: size.height))
        renderer.scale = 2
        guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
              let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return }
        snapshotCount += 1
        let name = String(format: "%02d-%@.png", snapshotCount, model.status.title.replacingOccurrences(of: " ", with: "-"))
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? png.write(to: directory.appendingPathComponent(name))
    }

    // MARK: - Displays and Spaces

    private static func currentGeometry() -> IslandGeometry {
        // The first screen is always the one with the menu bar.
        guard let screen = NSScreen.screens.first else {
            return IslandGeometry(screen: CGRect(x: 0, y: 0, width: 1440, height: 900))
        }
        return IslandGeometry(screen: screen.frame, menuBarBottom: menuBarBottom(of: screen))
    }

    /// The bottom of the menu bar. `visibleFrame` also excludes a Dock on the left or right, so only its top is used.
    private static func menuBarBottom(of screen: NSScreen) -> CGFloat {
        let fromVisible = screen.visibleFrame.maxY
        // A menu bar that hides itself: the visible frame reaches the top. Keep below where it appears.
        if fromVisible >= screen.frame.maxY {
            return screen.frame.maxY - max(NSStatusBar.system.thickness, screen.safeAreaInsets.top)
        }
        return fromVisible
    }

    private func screensChanged() {
        let next = IslandController.currentGeometry()
        guard next != geometry else { return }
        geometry = next
        trace("screens changed: \(next.screen) menuBarBottom=\(next.menuBarBottom)")
        panel.setFrame(next.frame(presentation, visible: shown), display: shown)
        evaluate()
    }

    private func spaceChanged() {
        trace("space changed shown=\(shown)")
        if shown { panel.orderFrontRegardless() }
    }
}
