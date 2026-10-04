import AppKit
import SwiftUI
import ZenoIslandCore

/// Gives each part of ZENO's face a fixed home (ADR-056):
/// - the panel (Conversation, Status, Settings) hangs below ZENO's menu-bar icon; a click on the icon or on Wisp,
///   or the shortcut, opens it, and a click elsewhere, Esc or the collapse button closes it;
/// - the status goes in Wisp's bubble, or — with Wisp off — in a small card under the icon during a turn;
/// - while ZENO works on the Mac, a strip at the bottom centre shows the step, Stop, and any approval request;
/// - while Wisp points, a short label sits beside it and nothing else is near it.
@MainActor
final class IslandController {
    let model: IslandModel
    let shortcuts: ShortcutEngine
    /// Wisp, shown while the Pet setting is on (ADR-042).
    let pet: PetController
    private let panel = IslandPanel()
    private let menuIcon = MenuBarIcon()
    /// Wisp's speech bubble (ADR-050): status for talk and dictation while Wisp is shown.
    private let bubble: BubbleController
    /// What ZENO is doing on the Mac, Stop, and approval requests (ADR-054, ADR-056).
    private let strip: WorkStripController
    /// The short label beside Wisp while it points.
    private let pointLabel = PointLabelController()
    /// Talk was started by its shortcut and not yet sent or cancelled.
    private var talking = false
    /// This Talk is going through the app's own microphone and Parakeet (ADR-063), not the runtime's.
    private var talkingLocally = false
    /// Listening or transcribing locally: the runtime's "idle" (from stopping its turn) must not hide it.
    private var localListening = false
    /// `ZENO_TALK_ENGINE=whisper` keeps the old path: the runtime records and Whisper transcribes.
    private let talkLocally = ProcessInfo.processInfo.environment["ZENO_TALK_ENGINE"] != "whisper"
    /// Dictation (ADR-047): hold, speak, let go, and the text is typed into the app in front.
    let dictation: DictationController
    /// A dictation is in progress (listening or transcribing).
    private var dictating = false
    private let hosting: NSHostingView<IslandView>
    /// What the panel window shows now: nil when it is off screen.
    private var current: MenuPanelLayout.Presentation?
    /// The status stays up until this time (uptime) after a turn, so the outcome can be read.
    private var statusUntil = 0.0
    /// Wakes the controller when a linger ends.
    private var wakeTimer: Timer?
    /// Counts panel changes, so a fade that finished late cannot hide a panel that was shown again.
    private var panelGeneration = 0
    private var monitors: [Any] = []
    private var observers: [NSObjectProtocol] = []
    private var lastTitle = ""
    /// Wisp reached the place it points at: its label shows from then on.
    private var pointArrived = false
    /// Development only: when set, a PNG of the panel is written here each time its title changes.
    private let snapshotDirectory = ProcessInfo.processInfo.environment["ZENO_ISLAND_SNAPSHOTS"].map { URL(fileURLWithPath: $0) }
    private var snapshotCount = 0
    private let trace: (String) -> Void

    /// How long the status stays after a turn or dictation ends (Settings → Bubble → Stays).
    private var afterTurn: Double { model.settings.bubbleStay.seconds }
    /// How long a notice or problem stays out.
    private let afterProblem = 6.0

    init(settings: IslandSettings, log: @escaping (String, [String: Any]) -> Void, trace: @escaping (String) -> Void = { _ in }) {
        self.trace = trace
        model = IslandModel(settings: settings)
        bubble = BubbleController(model: model)
        strip = WorkStripController(model: model)
        shortcuts = ShortcutEngine(settings: settings, recorder: model.recorder, log: log)
        pet = PetController(settings: settings, trace: trace)
        dictation = DictationController(vocabularyURL: IslandController.vocabularyURL)
        dictation.log = log
        model.shortcuts = shortcuts
        hosting = NSHostingView(rootView: IslandView(model: model))
        hosting.sizingOptions = [] // the controller sets the size; SwiftUI must not resize the window
        panel.contentView = hosting
        model.setExpanded = { [weak self] expanded in self?.setExpanded(expanded) }
        model.stopWork = { [weak self] in self?.stopWork() }
        panel.onCancel = { [weak self] in self?.setExpanded(false) }
        menuIcon.onClick = { [weak self] in
            guard let self else { return }
            self.setExpanded(!self.model.expanded)
        }
        menuIcon.isWispShown = { [weak model] in model?.settings.petEnabled ?? false }
        menuIcon.onShowWisp = { [weak model] enabled in model?.setPet(enabled) }
        shortcuts.onTrigger = { [weak self] trigger in self?.shortcut(trigger) }
        dictation.onPhase = { [weak self] phase in self?.dictationPhase(phase) }
        dictation.onLevel = { [weak self] peak in
            guard let self, self.model.status.showsLevel else { return }
            self.model.meter.add(Double(peak))
        }
        dictation.playSound = { [weak self] sound in self?.playTone(sound) }
        dictation.options = { [weak self] in self?.model.settings.dictationOptions ?? DictationOptions() }
        dictation.onPreview = { [weak self] text in self?.model.status.setPreview(text) }
        dictation.onTalk = { [weak self] phase in self?.talkPhase(phase) }
        dictation.conversationBusy = { [weak self] in self.map { $0.talking || $0.model.status.isBusy && !$0.dictating } ?? false }
        shortcuts.trace = trace
        model.petChanged = { [weak self] enabled in
            guard let self else { return }
            self.pet.setEnabled(enabled)
            self.refresh() // the status moves between Wisp's bubble and the card under the icon
        }
        pet.onMove = { [weak self] feet in
            guard let self else { return }
            self.bubble.follow(feet)
            self.pointLabel.follow(feet)
        }
        pet.onArrive = { [weak self] in self?.arrivedAtPoint() }
        pet.onClick = { [weak self] count in self?.wispClicked(count) }
        pet.onHide = { [weak model] in model?.setPet(false) } // right-click → Hide Wisp
    }

    func start() {
        // A click in another app closes the panel.
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
        // After switching Spaces (including into a full-screen app), keep ZENO's windows in front.
        observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.spaceChanged() }
        })
        shortcuts.start()
        watchSettings()
        pet.setEnabled(model.settings.petEnabled)
        dictation.warmUp()
        refresh()
        let env = ProcessInfo.processInfo.environment
        if env["ZENO_BUBBLE_DEMO"] != nil { playBubbleDemo() }
        if env["ZENO_PANEL_DEMO"] != nil { playPanelDemo() }
        if env["ZENO_LOOK_DEMO"] != nil { playLookDemo() }
        if env["ZENO_HIDE_DEMO"] != nil { playHideDemo() }
        if env["ZENO_WORK_DEMO"] != nil { playWorkDemo() }
        if let spots = env["ZENO_POINT_DEMO"] { playPointDemo(spots) }
        if let files = env["ZENO_DICTATION_FILE"] { dictation.selfTest(files: files.split(separator: ",").map(String.init)) }
    }

    func stop() {
        shortcuts.stop()
        dictation.stop()
        pet.stop()
        wakeTimer?.invalidate()
        pointTimer?.invalidate()
        bubble.stop()
        strip.stop()
        pointLabel.stop()
        menuIcon.remove()
        for monitor in monitors { NSEvent.removeMonitor(monitor) }
        monitors = []
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
        }
        observers = []
        panel.orderOut(nil)
    }

    // MARK: - Runtime

    func apply(_ status: RuntimeSupervisor.Status) {
        model.status.apply(status)
        if case .running = status {} else { // whatever it asked or showed is over
            model.approval.runtimeStopped()
            model.pointing.runtimeStopped()
            model.work.runtimeStopped()
        }
        statusChanged()
    }

    func apply(_ event: IslandEvent) {
        if localListening, case .state(.idle) = event { return } // the turn we interrupted, ending
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
        model.work.apply(event, now: Self.now)
        if case .computerPoint(let target) = event { startPointing(target) }
        if case .timer = event { pet.poke() } // out of hiding: the user should see it (the runtime chimed and spoke)
        let wasBusy = model.status.isBusy
        model.status.apply(event)
        if case .state(.idle) = event, wasBusy {
            // A turn just ended: stay out briefly so the outcome is seen.
            linger(model.status.needsAttention ? afterProblem : afterTurn)
        }
        if case .timer = event, model.status.kind == .notice { linger(afterProblem) }
        if case .reply(let text) = event { lastReply = text }
        if case .turnComplete = event { maybeFollowUp() }
        statusChanged()
    }

    // MARK: - Follow-up (ADR-067)

    private var lastReply = ""

    /// ZENO's reply ended in a question: open the microphone for the answer, once its voice has stopped.
    private func maybeFollowUp() {
        let reply = lastReply
        lastReply = ""
        guard model.settings.followUpEnabled, talkLocally, SpeechEndpoint.invitesAnswer(reply) else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self, !self.talking, !self.dictating, !self.model.status.isBusy else { return }
            if self.dictation.followUpBegan() {
                self.talkingLocally = true
                self.trace("follow-up listening")
            }
        }
    }

    private func statusChanged() {
        pet.update(model.status.kind)
        if model.status.title != lastTitle {
            lastTitle = model.status.title
            trace("status \(model.status.title) — \(model.status.detail)")
            snapshotSoon()
        }
        if model.status.needsAttention { linger(afterProblem) }
        refresh()
    }

    // MARK: - Shortcuts

    private func shortcut(_ trigger: ShortcutTrigger) {
        trace("shortcut \(trigger)")
        pet.poke()
        switch trigger {
        case .holdBegan(.talk):
            dictation.followUpCancelled() // the keys take over from listening for an answer
            talking = true
            let interrupting = model.status.isBusy
            if talkLocally, dictation.talkBegan() {
                talkingLocally = true
                if interrupting { model.send(.talkCancel) } // stop ZENO speaking: the microphone is open
            } else {
                talkingLocally = false
                model.send(.talkStart)
            }
        case .holdEnded(.talk):
            talking = false
            if talkingLocally { dictation.talkEnded() } else { model.send(.talkSend) }
        case .holdCancelled(.talk):
            talking = false
            if talkingLocally { dictation.talkCancelled() } else { model.send(.talkCancel) }
        case .pressed(.toggleIsland):
            setExpanded(!model.expanded)
        case .pressed(.cancel):
            talking = false
            if dictation.isActive { dictation.cancel() } else { stopWork() }
        case .holdBegan(.dictate):
            dictation.followUpCancelled()
            model.meter.reset()
            dictation.holdBegan()
        case .holdEnded(.dictate):
            dictation.holdEnded()
        case .holdCancelled(.dictate):
            dictation.holdCancelled()
        default:
            break
        }
        refresh()
    }

    /// Esc or the strip's Stop: ends the turn, declines anything waiting, and the strip says "Stopped".
    private func stopWork() {
        talking = false
        dictation.talkCancelled()
        model.send(.talkCancel)
        if model.work.isShown(at: Self.now), model.work.outcome == .working { model.work.stopped(now: Self.now) }
        trace("stop")
        refresh()
    }

    private func linger(_ seconds: Double) {
        statusUntil = max(statusUntil, Self.now + seconds)
    }

    private static var now: Double { ProcessInfo.processInfo.systemUptime }

    // MARK: - What shows where

    /// Puts every window in step with the state. Cheap: each part only acts on a change.
    private func refresh() {
        menuIcon.update(model.status.kind, title: model.status.title)
        shortcuts.setBusy(model.status.isBusy || talking || dictating)
        updateStrip()
        updatePointing()
        updateBubble()
        updatePanel()
        scheduleWake()
    }

    /// A turn or dictation is in progress, or just ended and its outcome is still showing.
    private var statusWanted: Bool {
        model.status.isBusy || talking || dictating || Self.now < statusUntil
    }

    /// This turn works on the Mac: the strip has the floor, Wisp's bubble and the card stay away.
    private var workTurn: Bool { model.work.active }

    private func updateStrip() {
        let now = Self.now
        let show = model.work.isShown(at: now)
        if model.approval.pending != nil { pet.poke() } // the question is for the user: Wisp comes out of hiding
        let clearance = pet.isShown ? 54 * model.settings.wispSize.scale + 10 : 0
        if show != strip.isVisible { trace(show ? "strip show" : "strip hide") }
        strip.update(show: show, asking: model.approval.pending != nil, clearance: clearance)
        if show, model.approval.pending != nil { trace("strip asking \(strip.frame.integral)") }
    }

    /// Wisp's bubble: the status during talk and dictation, never while it points or while the strip is up.
    private func updateBubble() {
        let wanted = pet.isShown && !model.expanded && !workTurn && model.pointing.target == nil && statusWanted
        if wanted {
            if !bubble.isVisible { trace("bubble show") }
            bubble.show(at: pet.feetPoint)
        } else if bubble.isVisible {
            trace("bubble hide")
            bubble.hide()
            if pet.isShown, !statusWanted { model.status.acknowledge() } // seen: a notice goes back to Ready
        }
    }

    /// The panel window: open (expanded), the status card (Wisp off, a turn running), or off screen.
    private func wantedPresentation() -> MenuPanelLayout.Presentation? {
        if model.expanded { return .expanded }
        guard !pet.isShown, !workTurn, statusWanted else { return nil }
        let wide = model.status.kind == .listening && model.settings.livePreview && dictating
        return wide ? .wide : .compact
    }

    private func updatePanel() {
        let wanted = wantedPresentation()
        guard wanted != current || (wanted != nil && !panel.isVisible) else { return }
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        panelGeneration += 1
        let generation = panelGeneration
        if let wanted {
            let target = layout().frame(wanted)
            if current == nil || !panel.isVisible {
                // Drops a little from the menu bar as it fades in.
                panel.setFrame(reduceMotion ? target : target.offsetBy(dx: 0, dy: 6), display: false)
                panel.alphaValue = 0
                panel.orderFrontRegardless()
            }
            NSAnimationContext.runAnimationGroup { context in
                context.duration = reduceMotion ? 0.12 : 0.22
                context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1)
                panel.animator().setFrame(target, display: true)
                panel.animator().alphaValue = 1
            }
            trace("panel \(wanted) \(target.integral)")
        } else {
            let start = panel.frame
            NSAnimationContext.runAnimationGroup({ context in
                context.duration = reduceMotion ? 0.1 : 0.16
                context.timingFunction = CAMediaTimingFunction(name: .easeIn)
                if !reduceMotion { panel.animator().setFrame(start.offsetBy(dx: 0, dy: 4), display: true) }
                panel.animator().alphaValue = 0
            }, completionHandler: { [weak self] in
                MainActor.assumeIsolated {
                    guard let self, generation == self.panelGeneration else { return }
                    self.panel.orderOut(nil)
                    self.panel.alphaValue = 1
                    self.model.closing = false
                    self.model.status.acknowledge()
                    self.model.meter.reset()
                }
            })
            trace("panel hide")
        }
        current = wanted
    }

    /// Re-checks when a linger ends, even if nothing else happens.
    private func scheduleWake() {
        wakeTimer?.invalidate()
        wakeTimer = nil
        let now = Self.now
        var times: [Double] = []
        if statusUntil > now { times.append(statusUntil) }
        if let hideAt = model.work.hideAt, hideAt > now { times.append(hideAt) }
        guard let next = times.min() else { return }
        let timer = Timer(timeInterval: next - now + 0.02, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        RunLoop.main.add(timer, forMode: .common)
        wakeTimer = timer
    }

    // MARK: - Pointing (ADR-054, ADR-056)

    /// How long Wisp stays at the place once it gets there, so the user has time to look.
    private static let pointDwell: Double = 7
    private var pointTimer: Timer?

    /// The model named a place: Wisp flies there. Its label shows on arrival, beside it.
    private func startPointing(_ target: PointTarget) {
        guard pet.isShown else { // no Wisp: nothing to fly. The strip says what it is.
            trace("point without Wisp: \(target.label)")
            return
        }
        let areas = NSScreen.screens.map { ScreenArea(frame: $0.frame, visible: $0.visibleFrame) }
        let scale = model.settings.wispSize.scale
        // No bubble goes with Wisp now (ADR-056): it only needs room for itself.
        guard let flight = PointPlacement.flight(to: target, screens: areas, wispHeight: 54 * scale, wispHalfWidth: 22 * scale,
                                                 bubbleHeight: 0) else {
            trace("point off every display, not flown to")
            model.pointing.clear()
            return
        }
        pointTimer?.invalidate()
        pointTimer = nil
        pointArrived = false
        pointLabel.hide()
        pet.point(at: flight.feet)
        trace("point \(target.label) feet=\(Int(flight.feet.x)),\(Int(flight.feet.y))")
    }

    /// Wisp got there: the label shows and the dwell starts.
    private func arrivedAtPoint() {
        pointArrived = true
        pointTimer?.invalidate()
        let timer = Timer(timeInterval: Self.pointDwell, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.finishPointing() }
        }
        RunLoop.main.add(timer, forMode: .common)
        pointTimer = timer
        refresh()
    }

    private func finishPointing() {
        pointTimer?.invalidate()
        pointTimer = nil
        model.pointing.clear()
        statusChanged()
    }

    /// Keeps Wisp and its label in step with the pointing state: it ended (a new turn, a reset, the dwell) → go back.
    private func updatePointing() {
        if let target = model.pointing.target, pet.isShown, pointArrived {
            let scale = model.settings.wispSize.scale
            pointLabel.show(PointingState.line(for: target), palette: model.settings.theme.palette, feet: pet.feetPoint, wispHeight: 54 * scale, wispHalfWidth: 22 * scale)
            if !pointLabel.isVisible { trace("point label show") }
            return
        }
        if pointLabel.isVisible { pointLabel.hide() }
        guard model.pointing.target == nil, pet.isPointing else { return }
        pointTimer?.invalidate()
        pointTimer = nil
        pointArrived = false
        pet.endPointing()
    }

    // MARK: - Talk through Parakeet (ADR-063)

    /// Shown exactly like the runtime's own states, so the island looks the same whichever path heard the words.
    private func talkPhase(_ phase: DictationController.TalkPhase) {
        switch phase {
        case .listening:
            localListening = false
            apply(.state(.listening))
            localListening = true
        case .heard(let text):
            localListening = false
            model.ask(text) // the runtime answers with transcript, thinking, reply, speaking
        case .nothing:
            localListening = false
            apply(.notice(kind: "no_speech", message: "Didn't catch that. Hold the keys while you speak, then let go."))
            apply(.state(.idle))
        case .failed(let message):
            localListening = false
            apply(.notice(kind: "no_speech", message: "Couldn't transcribe: \(message)"))
            apply(.state(.idle))
        case .cancelled:
            localListening = false
            apply(.state(.idle))
        }
    }

    // MARK: - Dictation

    /// Shows a dictation's progress, and keeps the status out while one is in progress.
    private func dictationPhase(_ phase: DictationPhase) {
        model.status.apply(phase)
        switch phase {
        case .loading, .listening, .listeningHandsFree, .transcribing:
            if !dictating { model.work.dismiss() } // a new request: the last Mac work is out of the way
            dictating = true
        case .done(let outcome):
            dictating = false
            linger(model.status.needsAttention ? afterProblem : (outcome == .busy ? afterProblem : afterTurn))
        case .cancelled:
            dictating = false
        }
        statusChanged()
    }

    /// Where the user's spelling fixes live: `vocabulary.txt` in ZENO's folder under Application Support.
    static var vocabularyURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/ZENO/vocabulary.txt")
    }

    private func playTone(_ sound: DictationController.Sound) {
        guard model.settings.soundsEnabled else { return }
        NSSound(named: sound == .start ? "Tink" : "Pop")?.play()
    }

    // MARK: - Opening and closing the panel

    private func setExpanded(_ expanded: Bool) {
        pet.poke()
        guard expanded != model.expanded else { return }
        trace(expanded ? "expand" : "collapse")
        if !expanded {
            model.recorder.stop()
            panel.resignKey()
        }
        model.expanded = expanded
        panel.acceptsKeyFocus = expanded
        menuIcon.setHighlighted(expanded)
        // Closing to nothing: keep drawing the expanded view while it fades.
        model.closing = !expanded && wantedPresentation() == nil
        refresh()
        if expanded { panel.makeKey() } // key, without activating ZENO: the app you were in stays active
    }

    /// A press on Wisp that was not a drag: opens the panel under the icon, or closes it (ADR-051, ADR-056).
    private func wispClicked(_ count: Int) {
        trace("wisp click \(count)")
        switch PetClickAction.forPress(clickCount: count, panelOpen: model.expanded) {
        case .open: setExpanded(true)
        case .close: setExpanded(false)
        case .none: break
        }
    }

    private func clickedOutside() {
        guard model.expanded else { return }
        // Global monitors only see clicks in other apps, so this was not on the panel, the icon or Wisp.
        setExpanded(false)
    }

    // MARK: - Displays and Spaces

    /// The panel hangs from the icon; if the icon's place is unknown, from the top-right of the main display.
    private func layout() -> MenuPanelLayout {
        var metrics = IslandMetrics()
        metrics.expanded = model.settings.panelSize.size
        if let anchor = menuIcon.anchor {
            return MenuPanelLayout(screen: anchor.screen.frame, menuBarBottom: Self.menuBarBottom(of: anchor.screen), iconMidX: anchor.midX, metrics: metrics)
        }
        guard let screen = NSScreen.screens.first else {
            return MenuPanelLayout(screen: CGRect(x: 0, y: 0, width: 1440, height: 900), metrics: metrics)
        }
        return MenuPanelLayout(screen: screen.frame, menuBarBottom: Self.menuBarBottom(of: screen), metrics: metrics)
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
        guard let current, panel.isVisible else { return }
        let target = layout().frame(current)
        guard target != panel.frame else { return }
        trace("panel size \(Int(target.width))x\(Int(target.height))")
        NSAnimationContext.runAnimationGroup { context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.2
            panel.animator().setFrame(target, display: true)
        }
    }

    private func screensChanged() {
        trace("screens changed")
        if let current, panel.isVisible { panel.setFrame(layout().frame(current), display: true) }
        refresh()
    }

    private func spaceChanged() {
        if panel.isVisible { panel.orderFrontRegardless() }
        strip.bringToFront()
    }

    // MARK: - Development demos

    private func schedule(_ steps: [(Double, @MainActor () -> Void)]) {
        for (delay, step) in steps {
            let timer = Timer(timeInterval: delay, repeats: false) { _ in MainActor.assumeIsolated { step() } }
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    private func note(_ label: String) {
        trace("demo \(label) | \(pet.debugState) | panel=\(current.map { "\($0)" } ?? "off") frame=\(panel.isVisible ? "\(panel.frame.integral)" : "-") expanded=\(model.expanded) | icon=\(menuIcon.anchor.map { "\(Int($0.midX))" } ?? "?")")
    }

    /// Development only (`ZENO_BUBBLE_DEMO=1`): plays a dictation's phases through the real controller, with no
    /// microphone and no keys, so the bubble's window can be measured on the real screen.
    private func playBubbleDemo() {
        schedule([
            (4, { [self] in model.meter.reset(); dictationPhase(.listening) }),
            (6, { [self] in model.status.setPreview("send the deck before the call"); trace("demo preview") }),
            (9, { [self] in dictationPhase(.listeningHandsFree) }),
            (12, { [self] in dictationPhase(.transcribing) }),
            (14, { [self] in dictationPhase(.done(.typed(words: 6))) }),
        ])
    }

    /// Development only (`ZENO_PANEL_DEMO=1`): opens and closes the panel from the icon and from Wisp, and checks
    /// that Wisp does not move while it is open (ADR-056).
    private func playPanelDemo() {
        schedule([
            (3, { [self] in note("start") }),
            (4, { [self] in menuIcon.onClick(); note("icon click opens") }),
            (5.5, { [self] in note("open") }),
            (6, { [self] in menuIcon.onClick(); note("icon click closes") }),
            (7.5, { [self] in note("closed") }),
            (8, { [self] in wispClicked(1); note("wisp click opens") }),
            (9.5, { [self] in note("open from wisp") }),
            (12, { [self] in note("wisp while open (should have moved freely)") }),
            (12.5, { [self] in setExpanded(false); note("closing") }),
            (14, { [self] in note("closed again") }),
        ])
    }

    /// Development only (`ZENO_WORK_DEMO=1`): a turn that works on the Mac, through the real event path: steps, an
    /// approval request (answered by the demo), a point at the top-right corner, then the end of the turn.
    private func playWorkDemo() {
        let top = NSScreen.screens.first?.frame ?? .zero
        let corner = PointTarget(x: Double(top.width) - 70, y: 4, w: 40, h: 22, label: "the Control Centre icon")
        schedule([
            (3, { [self] in apply(.state(.thinking)); note("thinking") }),
            (4, { [self] in apply(.computerStep("Looking at TextEdit")); note("step 1") }),
            (6, { [self] in apply(.computerStep("Typing in TextEdit")); note("step 2") }),
            (8, { [self] in apply(.approvalRequest(ApprovalRequest(id: "demo", summary: "Press return in TextEdit", reason: "it uses the Return key"))); note("asking") }),
            (12, { [self] in apply(.approvalClosed(id: "demo")); note("answered") }),
            (13, { [self] in apply(.computerPoint(corner)); note("pointing top-right") }),
            (18, { [self] in note("pointed") }),
            (19, { [self] in apply(.state(.speaking)) }),
            (21, { [self] in apply(.state(.idle)); note("turn over") }),
            (22, { [self] in note("lingering") }),
            (25, { [self] in note("strip gone") }),
        ])
    }

    /// Development only (`ZENO_POINT_DEMO="x,y,w,h,label;x,y,w,h,label"`): plays each place through the real event path,
    /// 11 s apart, as the runtime would send them (Cua's coordinates: points, origin top-left of the main display).
    private func playPointDemo(_ spots: String) {
        for (index, spot) in spots.split(separator: ";").enumerated() {
            let parts = spot.split(separator: ",", maxSplits: 4).map(String.init)
            guard parts.count == 5, let x = Double(parts[0]), let y = Double(parts[1]), let w = Double(parts[2]), let h = Double(parts[3]) else { continue }
            let target = PointTarget(x: x, y: y, w: w, h: h, label: parts[4])
            schedule([(3 + Double(index) * 11, { [self] in
                trace("demo point \(target.label)")
                apply(.state(.thinking))
                apply(.computerPoint(target))
                apply(.state(.idle))
            })])
        }
    }

    /// Development only (`ZENO_HIDE_DEMO`): Wisp hides, then shows each lean, then the user's own lean comes back.
    private func playHideDemo() {
        let settings = model.settings
        let saved = settings.wispLean
        schedule([
            (2, { [self] in pet.tuckAway() }),
            (5, { settings.wispLean = .slight }),
            (8, { settings.wispLean = .deep }),
            (11, { settings.wispLean = saved }),
        ])
    }

    /// Development only (`ZENO_LOOK_DEMO`): changes the look settings while the app runs, so the real windows can
    /// be measured, then puts the user's own values back.
    private func playLookDemo() {
        let settings = model.settings
        let saved = (settings.wispSize, settings.wispGlow, settings.bubbleSize, settings.bubbleOpacity, settings.panelSize, settings.panelBackground, settings.bubbleStay)
        func look(_ label: String) {
            trace("look \(label) | wisp=\(Int(settings.wispSize.points)) | panel frame=\(Int(panel.frame.width))x\(Int(panel.frame.height)) visible=\(panel.isVisible) expanded=\(model.expanded) | bubble=\(bubble.isVisible)")
        }
        schedule([
            (3, { look("start") }),
            (4, { settings.wispSize = .huge }),
            (5.5, { look("wisp huge") }),
            (6, { settings.bubbleSize = .large; settings.bubbleOpacity = .solid; settings.wispGlow = .bright }),
            (6.5, { [self] in model.meter.reset(); dictationPhase(.listening) }),
            (8, { look("bubble large while listening") }),
            (9, { [self] in dictationPhase(.cancelled) }),
            (10, { settings.wispSize = .small; settings.bubbleSize = .normal }),
            (11, { look("wisp small") }),
            (12, { settings.panelSize = .large; settings.panelBackground = .solid }),
            (12.5, { [self] in setExpanded(true) }),
            (14.5, { look("panel large") }),
            (15, { settings.panelSize = .compact }),
            (16.5, { look("panel compact while open") }),
            (17, { [self] in setExpanded(false) }),
            (18.5, {
                (settings.wispSize, settings.wispGlow, settings.bubbleSize, settings.bubbleOpacity, settings.panelSize, settings.panelBackground, settings.bubbleStay) = saved
                look("restored")
            }),
        ])
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
        let size = layout().size(current ?? .compact)
        let renderer = ImageRenderer(content: IslandView(model: model, snapshot: true).frame(width: size.width, height: size.height))
        renderer.scale = 2
        guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
              let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return }
        snapshotCount += 1
        let name = String(format: "%02d-%@.png", snapshotCount, model.status.title.replacingOccurrences(of: " ", with: "-"))
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? png.write(to: directory.appendingPathComponent(name))
    }
}
