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
    /// Asks the user before a risky action (ADR-054): replaces the bubble while a request is waiting.
    private let approvalCard = ApprovalController()
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
    /// The features panel is open (or fading out) beside Wisp rather than at the left edge (ADR-051).
    private var anchored = false
    /// Counts opens and closes, so a fade that finished late cannot hide a panel that was opened again.
    private var panelGeneration = 0
    private var lastTrigger = false
    private var lastTitle = ""
    /// Development only: when set, a PNG of the island is written here each time its title changes.
    private let snapshotDirectory = ProcessInfo.processInfo.environment["ZENO_ISLAND_SNAPSHOTS"].map { URL(fileURLWithPath: $0) }
    private var snapshotCount = 0
    private let trace: (String) -> Void

    /// Slide duration; with Reduce Motion the island fades instead.
    private let slideDuration = 0.24
    /// How long the island or bubble stays out after a turn or dictation ends, so the outcome can be seen
    /// (Settings → Bubble → Stays).
    private var afterTurn: Double { model.settings.bubbleStay.seconds }
    /// How long a notice or problem stays out.
    private let afterProblem = 6.0

    init(settings: IslandSettings, log: @escaping (String, [String: Any]) -> Void, trace: @escaping (String) -> Void = { _ in }) {
        self.trace = trace
        model = IslandModel(settings: settings)
        bubble = BubbleController(model: model)
        approvalCard.onAnswer = { [weak model] approved in model?.answerApproval(approved) }
        shortcuts = ShortcutEngine(settings: settings, recorder: model.recorder, log: log)
        pet = PetController(settings: settings, trace: trace)
        dictation = DictationController(vocabularyURL: IslandController.vocabularyURL)
        dictation.log = log
        model.shortcuts = shortcuts
        geometry = IslandController.currentGeometry(panel: settings.panelSize)
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
            if !enabled, self.anchored, self.model.expanded { self.moveToLeftEdge() } // Wisp is gone: the panel goes back to the edge
            self.statusChanged() // the status moves between Wisp's bubble and the island
        }
        pet.onMove = { [weak self] feet in
            guard let self else { return }
            self.bubble.follow(feet)
            self.approvalCard.follow(feet)
            self.followWisp()
        }
        pet.onArrive = { [weak self] in self?.arrivedAtPoint() }
        pet.onClick = { [weak self] count in self?.wispClicked(count) }
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
        watchSettings()
        pet.setEnabled(model.settings.petEnabled)
        dictation.warmUp()
        if ProcessInfo.processInfo.environment["ZENO_BUBBLE_DEMO"] != nil { playBubbleDemo() }
        if ProcessInfo.processInfo.environment["ZENO_PANEL_DEMO"] != nil { playPanelDemo() }
        if ProcessInfo.processInfo.environment["ZENO_LOOK_DEMO"] != nil { playLookDemo() }
        if ProcessInfo.processInfo.environment["ZENO_HIDE_DEMO"] != nil { playHideDemo() }
        if let spots = ProcessInfo.processInfo.environment["ZENO_POINT_DEMO"] { playPointDemo(spots) }
        if let files = ProcessInfo.processInfo.environment["ZENO_DICTATION_FILE"] { dictation.selfTest(files: files.split(separator: ",").map(String.init)) }
    }

    func stop() {
        shortcuts.stop()
        dictation.stop()
        pet.stop()
        bubbleTimer?.invalidate()
        bubble.stop()
        approvalCard.stop()
        pointTimer?.invalidate()
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
        if case .running = status {} else { model.approval.runtimeStopped(); model.pointing.runtimeStopped() } // whatever it asked or showed is over
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
        if case .computerPoint(let target) = event { startPointing(target) }
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
        updateApproval()
        updatePointing()
        let now = ProcessInfo.processInfo.systemUptime
        let wanted = bubbleMode && model.approval.pending == nil && (model.status.isBusy || talking || dictating || now < bubbleUntil || model.pointing.target != nil)
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

    /// The approval card (ADR-054): over Wisp while a request waits, wherever Wisp is. The bubble steps aside for it.
    /// Without Wisp it stands at the bottom of the main display, so a request is never missed.
    private func updateApproval() {
        if let request = model.approval.pending {
            if !approvalCard.isVisible { trace("approval show") }
            pet.poke() // brings Wisp out of hiding and wakes it: the question is for the user
            let feet = pet.isShown ? pet.feetPoint : Self.bottomCentre()
            let height = 54 * model.settings.wispSize.scale
            approvalCard.show(request, at: feet, wispHeight: pet.isShown ? height : 0)
        } else if approvalCard.isVisible {
            trace("approval hide")
            approvalCard.hide()
        }
    }

    // MARK: - Pointing (ADR-054, Task 0.6.4)

    /// How long Wisp stays at the place once it gets there, so the user has time to look.
    private static let pointDwell: Double = 7
    private var pointTimer: Timer?

    /// The model named a place: Wisp flies there, the bubble goes on the side that leaves the place clear.
    private func startPointing(_ target: PointTarget) {
        guard pet.isShown else { // no Wisp: nothing to fly. The bubble line still says what it is.
            trace("point without Wisp: \(target.label)")
            return
        }
        let areas = NSScreen.screens.map { ScreenArea(frame: $0.frame, visible: $0.visibleFrame) }
        let scale = model.settings.wispSize.scale
        let bubbleScale = model.settings.bubbleSize.scale
        guard let flight = PointPlacement.flight(to: target, screens: areas, wispHeight: 54 * scale, wispHalfWidth: 22 * scale,
                                                 bubbleHeight: BubbleLayout.size.height * bubbleScale) else {
            trace("point off every display, not flown to")
            model.pointing.clear()
            return
        }
        pointTimer?.invalidate()
        pointTimer = nil
        bubble.preferredSide = flight.bubbleSide
        pet.point(at: flight.feet)
        trace("point \(target.label) side=\(flight.bubbleSide == .above ? "above" : "below")")
    }

    /// Wisp got there: the dwell starts now.
    private func arrivedAtPoint() {
        pointTimer?.invalidate()
        let timer = Timer(timeInterval: Self.pointDwell, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.finishPointing() }
        }
        RunLoop.main.add(timer, forMode: .common)
        pointTimer = timer
    }

    private func finishPointing() {
        pointTimer?.invalidate()
        pointTimer = nil
        model.pointing.clear()
        statusChanged()
    }

    /// Keeps Wisp and the bubble in step with the pointing state: it ended (a new turn, a reset, the dwell) → go back.
    private func updatePointing() {
        guard model.pointing.target == nil, pet.isPointing || bubble.preferredSide != nil else { return }
        pointTimer?.invalidate()
        pointTimer = nil
        pet.endPointing()
        bubble.preferredSide = nil
    }

    private static func bottomCentre() -> CGPoint {
        let frame = NSScreen.screens.first?.visibleFrame ?? .zero
        return CGPoint(x: frame.midX, y: frame.minY + 24)
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
            linger(model.status.needsAttention ? afterProblem : (outcome == .busy ? afterProblem : afterTurn))
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
        // With Wisp out, the left edge is left alone (ADR-051): Wisp carries status and opens the panel, so the
        // edge never collides with other apps that live there. Only an old edge card still on screen is put away.
        if pet.isShown {
            if shown, !model.expanded, !model.closing { setShown(false) }
            return
        }
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
        if expanded ? pet.isShown : anchored {
            setExpandedBesideWisp(expanded)
        } else {
            setExpandedAtEdge(expanded)
        }
    }

    /// The features panel opens above (or below) Wisp, and fades away when closed.
    private func setExpandedBesideWisp(_ expanded: Bool) {
        panelGeneration += 1
        let generation = panelGeneration
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        model.expanded = expanded
        model.closing = !expanded
        presentation = expanded ? .expanded : .compact
        panel.acceptsKeyFocus = expanded
        pet.setFrozen(expanded)
        updateHeld()
        updateBubble()

        if expanded {
            anchored = true
            let target = wispPanelFrame()
            if !shown || !panel.isVisible {
                // Grows out of Wisp: starts a little smaller, nearer Wisp, and transparent.
                panel.setFrame(reduceMotion ? target : Self.shrunk(target, toward: pet.anchorFeet), display: false)
                panel.alphaValue = 0
                panel.orderFrontRegardless()
            }
            shown = true
            NSAnimationContext.runAnimationGroup { context in
                context.duration = reduceMotion ? 0.12 : 0.26
                context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1)
                if !reduceMotion { panel.animator().setFrame(target, display: true) }
                panel.animator().alphaValue = 1
            }
            panel.makeKey() // key, without activating ZENO: the app you were in stays active
        } else {
            panel.resignKey()
            let target = Self.shrunk(panel.frame, toward: pet.anchorFeet)
            NSAnimationContext.runAnimationGroup({ context in
                context.duration = reduceMotion ? 0.1 : 0.18
                context.timingFunction = CAMediaTimingFunction(name: .easeIn)
                if !reduceMotion { panel.animator().setFrame(target, display: true) }
                panel.animator().alphaValue = 0
            }, completionHandler: { [weak self] in
                MainActor.assumeIsolated {
                    guard let self, generation == self.panelGeneration else { return }
                    self.panel.orderOut(nil)
                    self.panel.alphaValue = 1
                    self.shown = false
                    self.anchored = false
                    self.model.closing = false
                    self.model.status.acknowledge()
                    self.model.meter.reset()
                    self.updateHeld()
                    self.updateBubble()
                    self.evaluate()
                }
            })
        }
    }

    /// The old behaviour, with no Wisp: the card at the left edge grows into the panel and folds back.
    private func setExpandedAtEdge(_ expanded: Bool) {
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

    /// Wisp was switched off while its panel was open: the panel goes to the left edge, where it opens without Wisp.
    private func moveToLeftEdge() {
        anchored = false
        pet.setFrozen(false)
        let target = geometry.frame(.expanded, visible: true)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.28
            context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1)
            panel.animator().setFrame(target, display: true)
        }
    }

    /// A press on Wisp that was not a drag: opens the features panel, or closes it (ADR-051).
    private func wispClicked(_ count: Int) {
        trace("wisp click \(count)")
        switch PetClickAction.forPress(clickCount: count, panelOpen: model.expanded) {
        case .open: setExpanded(true)
        case .close: setExpanded(false)
        case .none: break
        }
    }

    /// Where the features panel goes: beside Wisp, on Wisp's display, inside it.
    private func wispPanelFrame() -> CGRect {
        let feet = pet.anchorFeet
        guard let bounds = BubbleController.displayBounds(containing: feet) else { return geometry.frame(.expanded, visible: true) }
        let base = geometry.metrics.expanded
        let size = CGSize(width: min(base.width, bounds.width - 16), height: min(base.height, bounds.height - 16))
        return BubbleLayout.place(feet: feet, gap: 8, size: size, in: bounds).frame
    }

    /// The panel keeps its place beside Wisp while Wisp is dragged.
    private func followWisp() {
        guard anchored, model.expanded, panel.isVisible else { return }
        let target = wispPanelFrame()
        if panel.frame != target { panel.setFrame(target, display: true) }
    }

    /// `frame` made a little smaller around its edge nearest `point`: how the panel grows out of, and folds back into, Wisp.
    private static func shrunk(_ frame: CGRect, toward point: CGPoint) -> CGRect {
        let scale: CGFloat = 0.82
        let size = CGSize(width: frame.width * scale, height: frame.height * scale)
        let fx = frame.width > 0 ? min(max((point.x - frame.minX) / frame.width, 0), 1) : 0.5
        let fy = frame.height > 0 ? min(max((point.y - frame.minY) / frame.height, 0), 1) : 0.5
        return CGRect(x: frame.minX + (frame.width - size.width) * fx, y: frame.minY + (frame.height - size.height) * fy,
                      width: size.width, height: size.height)
    }

    private func clickedOutside() {
        guard model.expanded, !model.closing else { return }
        // Global monitors only see clicks in other apps, so this was not on the island or Wisp.
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

    /// Development only (`ZENO_PANEL_DEMO=1`): tucks Wisp away, brings it back with a click, opens and closes the
    /// features panel, and runs a dictation while Wisp is hiding, all through the real controller (no pointer, no keys).
    private func playPanelDemo() {
        func note(_ label: String) { trace("demo \(label) | \(pet.debugState) | panel shown=\(shown) expanded=\(model.expanded) anchored=\(anchored)") }
        let steps: [(Double, @MainActor () -> Void)] = [
            (3, { note("start") }),
            (4, { [self] in pet.tuckAway(); note("tuck") }),
            (6, { note("tucked") }),
            (7, { [self] in model.meter.reset(); dictationPhase(.listening); note("dictation starts while hidden") }),
            (9, { note("dictating") }),
            (10, { [self] in dictationPhase(.cancelled); note("dictation over") }),
            (13, { [self] in pet.tuckAway(); note("tuck again") }),
            (15, { [self] in wispClicked(1); note("click 1 opens") }),
            (17, { note("panel open") }),
            (18, { [self] in wispClicked(1); wispClicked(1); note("click closes") }),
            (19.5, { note("closed") }),
            (20, { [self] in wispClicked(1); wispClicked(2); note("double-click opens and stays") }),
            (22, { note("still open") }),
            (23, { [self] in setExpanded(false); note("closing") }),
            (24.5, { note("closed again") }),
        ]
        for (delay, step) in steps {
            let timer = Timer(timeInterval: delay, repeats: false) { _ in MainActor.assumeIsolated { step() } }
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    /// Development only (`ZENO_POINT_DEMO="x,y,w,h,label;x,y,w,h,label"`): plays each place through the real event path,
    /// 11 s apart, as the runtime would send them (Cua's coordinates: points, origin top-left of the main display).
    private func playPointDemo(_ spots: String) {
        for (index, spot) in spots.split(separator: ";").enumerated() {
            let parts = spot.split(separator: ",", maxSplits: 4).map(String.init)
            guard parts.count == 5, let x = Double(parts[0]), let y = Double(parts[1]), let w = Double(parts[2]), let h = Double(parts[3]) else { continue }
            let target = PointTarget(x: x, y: y, w: w, h: h, label: parts[4])
            let timer = Timer(timeInterval: 3 + Double(index) * 11, repeats: false) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    self.trace("demo point \(target.label)")
                    self.apply(.state(.thinking))
                    self.apply(.computerPoint(target))
                    self.apply(.state(.idle))
                }
            }
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    /// Development only (`ZENO_HIDE_DEMO`): Wisp hides, then shows each lean, then the user's own lean comes back.
    private func playHideDemo() {
        let settings = model.settings
        let saved = settings.wispLean
        let steps: [(Double, @MainActor () -> Void)] = [
            (2, { [self] in pet.tuckAway() }),
            (5, { settings.wispLean = .slight }),
            (8, { settings.wispLean = .deep }),
            (11, { settings.wispLean = saved }),
        ]
        for (delay, step) in steps {
            let timer = Timer(timeInterval: delay, repeats: false) { _ in MainActor.assumeIsolated { step() } }
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    /// Development only (`ZENO_LOOK_DEMO`): changes the look settings while the app runs, so the real windows can
    /// be measured, then puts the user's own values back.
    private func playLookDemo() {
        let settings = model.settings
        let saved = (settings.wispSize, settings.wispGlow, settings.bubbleSize, settings.bubbleOpacity, settings.panelSize, settings.panelBackground, settings.bubbleStay)
        func note(_ label: String) {
            trace("look \(label) | wisp=\(Int(settings.wispSize.points)) | panel frame=\(Int(panel.frame.width))x\(Int(panel.frame.height)) visible=\(panel.isVisible) expanded=\(model.expanded) | bubble=\(bubble.isVisible)")
        }
        let steps: [(Double, @MainActor () -> Void)] = [
            (3, { note("start") }),
            (4, { settings.wispSize = .huge }),
            (5.5, { note("wisp huge") }),
            (6, { settings.bubbleSize = .large; settings.bubbleOpacity = .solid; settings.wispGlow = .bright }),
            (6.5, { [self] in model.meter.reset(); dictationPhase(.listening) }),
            (8, { note("bubble large while listening") }),
            (9, { [self] in dictationPhase(.cancelled) }),
            (10, { settings.wispSize = .small; settings.bubbleSize = .normal }),
            (11, { note("wisp small") }),
            (12, { settings.panelSize = .large; settings.panelBackground = .solid }),
            (12.5, { [self] in wispClicked(1) }),
            (14.5, { note("panel large") }),
            (15, { settings.panelSize = .compact }),
            (16.5, { note("panel compact while open") }),
            (17, { [self] in setExpanded(false) }),
            (18.5, { [self] in
                (settings.wispSize, settings.wispGlow, settings.bubbleSize, settings.bubbleOpacity, settings.panelSize, settings.panelBackground, settings.bubbleStay) = saved
                note("restored")
            }),
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

    private static func currentGeometry(panel: PanelSize = .normal) -> IslandGeometry {
        var metrics = IslandMetrics()
        metrics.expanded = panel.size
        // The first screen is always the one with the menu bar.
        guard let screen = NSScreen.screens.first else {
            return IslandGeometry(screen: CGRect(x: 0, y: 0, width: 1440, height: 900), metrics: metrics)
        }
        return IslandGeometry(screen: screen.frame, menuBarBottom: menuBarBottom(of: screen), metrics: metrics)
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

    /// Re-applies the look settings whenever one changes (the bubble and the panel; Wisp reads its own each frame).
    private func watchSettings() {
        withObservationTracking {
            _ = model.settings.revision
        } onChange: { [weak self] in
            // `onChange` fires just before the value changes, on whichever thread changed it: look again next turn.
            Task { @MainActor [weak self] in
                self?.applyLook()
                self?.watchSettings()
            }
        }
    }

    private func applyLook() {
        bubble.lookChanged()
        let next = IslandController.currentGeometry(panel: model.settings.panelSize)
        guard next != geometry else { return }
        geometry = next
        trace("panel size \(Int(next.metrics.expanded.width))x\(Int(next.metrics.expanded.height))")
        guard model.expanded, panel.isVisible else { return }
        let target = anchored ? wispPanelFrame() : geometry.frame(.expanded, visible: true)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.2
            panel.animator().setFrame(target, display: true)
        }
    }

    private func screensChanged() {
        let next = IslandController.currentGeometry(panel: model.settings.panelSize)
        guard next != geometry else { return }
        geometry = next
        trace("screens changed: \(next.screen) menuBarBottom=\(next.menuBarBottom)")
        if anchored, model.expanded {
            panel.setFrame(wispPanelFrame(), display: true)
        } else {
            panel.setFrame(next.frame(presentation, visible: shown), display: shown)
        }
        evaluate()
    }

    private func spaceChanged() {
        trace("space changed shown=\(shown)")
        if shown { panel.orderFrontRegardless() }
    }
}
