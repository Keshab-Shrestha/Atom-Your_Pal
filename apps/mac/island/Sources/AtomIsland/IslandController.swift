import AppKit
import SwiftUI
import AtomIslandCore

/// Gives each part of ATOM's face a fixed home (ADR-056):
/// - the panel (Conversation, Status, Settings) hangs below ATOM's menu-bar icon; a click on the icon or on Pal,
///   or the shortcut, opens it, and a click elsewhere, Esc or the collapse button closes it;
/// - the status goes in Pal's bubble, or — with Pal off — in a small card under the icon during a turn;
/// - while ATOM works on the Mac, a strip at the bottom centre shows the step, Stop, and any approval request;
/// - while Pal points, a short label sits beside it and nothing else is near it.
@MainActor
final class IslandController {
    let model: IslandModel
    let shortcuts: ShortcutEngine
    /// Pal, shown while the Pet setting is on (ADR-042).
    let pet: PetController
    let panel = IslandPanel()
    let menuIcon = MenuBarIcon()
    /// Pal's speech bubble (ADR-050): status for talk and dictation while Pal is shown.
    let bubble: BubbleController
    /// What ATOM is doing on the Mac, Stop, and approval requests (ADR-054, ADR-056).
    let strip: WorkStripController
    /// The short label beside Pal while it points.
    let pointLabel = PointLabelController()
    /// The ATOM window (ADR-081).
    let helpersWindow: MainWindowController
    /// ADR-091: ATOM's macOS notifications.
    let notifier: Notifier
    /// Quick actions (upgrades.md C4): the shortcut reads the selection and offers what to do with it.
    let quickActions: QuickActionController
    /// Talk was started by its shortcut and not yet sent or cancelled.
    var talking = false
    /// This Talk is going through the app's own microphone and Parakeet (ADR-063), not the runtime's.
    var talkingLocally = false
    /// Listening or transcribing locally: the runtime's "idle" (from stopping its turn) must not hide it.
    var localListening = false
    /// `ATOM_TALK_ENGINE=whisper` keeps the old path: the runtime records and Whisper transcribes.
    let talkLocally = AtomEnv.read("ATOM_TALK_ENGINE") != "whisper"
    /// Dictation (ADR-047): hold, speak, let go, and the text is typed into the app in front.
    let dictation: DictationController
    /// A dictation is in progress (listening or transcribing).
    var dictating = false
    let hosting: NSHostingView<IslandView>
    /// What the panel window shows now: nil when it is off screen.
    var current: MenuPanelLayout.Presentation?
    /// The status stays up until this time (uptime) after a turn, so the outcome can be read.
    var statusUntil = 0.0
    /// Wakes the controller when a linger ends.
    var wakeTimer: Timer?
    /// Counts panel changes, so a fade that finished late cannot hide a panel that was shown again.
    var panelGeneration = 0
    var monitors: [Any] = []
    var observers: [NSObjectProtocol] = []
    var lastTitle = ""
    /// Pal reached the place it points at: its label shows from then on.
    var pointArrived = false
    /// Development only: when set, a PNG of the panel is written here each time its title changes.
    let snapshotDirectory = AtomEnv.read("ATOM_ISLAND_SNAPSHOTS").map { URL(fileURLWithPath: $0) }
    var snapshotCount = 0
    let trace: (String) -> Void
    let log: (String, [String: Any]) -> Void
    /// The runtime said `ready` and has not stopped since: a dropped Pal can ask it something (ADR-074).
    var runtimeReady = false
    /// The app Pal was last dropped on, until the runtime answers `context.ready`.
    var pointedBundleId: String?
    /// Starts the runtime again with a fresh restart policy (ADR-075). Set by the app.
    var restartRuntime: () -> Void = {}
    /// ATOM's log file, for "Open log". Set by the app.
    var logURL: URL?
    /// The first-run tour (ADR-075) and the timer for its next step.
    var tour = FirstRunTour()
    var tourTimer: Timer?
    /// The screens are asleep or the Mac is locked (ADR-076): Pal stops drawing and the microphone is left alone.
    var sleep = SleepState()
    /// The Talk keys went down while paused and were ignored: their release is ignored too.
    var talkHeldWhilePaused = false

    /// How long the status stays after a turn or dictation ends (Settings → Bubble → Stays).
    var afterTurn: Double { model.settings.bubbleStay.seconds }
    /// How long a notice or problem stays out.
    let afterProblem = 6.0

    init(settings: IslandSettings, log: @escaping (String, [String: Any]) -> Void, trace: @escaping (String) -> Void = { _ in }) {
        self.trace = trace
        self.log = log
        model = IslandModel(settings: settings, inputURL: ChatInputStore.defaultURL)
        bubble = BubbleController(model: model)
        strip = WorkStripController(model: model)
        helpersWindow = MainWindowController(model: model)
        notifier = Notifier(settings: settings)
        quickActions = QuickActionController(model: model)
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
        model.perform = { [weak self] action in self?.perform(action) }
        model.permissionButton = { [weak self] row in self?.permissionButton(row) }
        model.replayTour = { [weak self] in self?.replayTour() }
        model.openHelpers = { [weak self] in
            self?.helpersWindow.show(page: .agents)
        }
        menuIcon.onClick = { [weak self] in self?.toggleWindow() }
        menuIcon.isPalShown = { [weak model] in model?.settings.petEnabled ?? false }
        menuIcon.onShowPal = { [weak model] enabled in model?.setPet(enabled) }
        menuIcon.onHelpers = { [weak model] in model?.openHelpers() }
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
            self.refresh() // the status moves between Pal's bubble and the card under the icon
        }
        pet.onMove = { [weak self] feet in
            guard let self else { return }
            self.bubble.follow(feet)
            self.pointLabel.follow(feet)
        }
        pet.onArrive = { [weak self] in self?.arrivedAtPoint() }
        pet.onClick = { [weak self] count in self?.palClicked(count) }
        pet.onHide = { [weak model] in model?.setPet(false) } // right-click → Hide Pal
        pet.onPointAt = { [weak self] app in self?.pointedAt(app) }
    }

    func start() {
        // ADR-091: a clicked notification opens the window, on its task when it names one.
        notifier.onOpen = { [weak self] task in
            guard let self else { return }
            helpersWindow.show()
            let model = self.model
            model.navigate {
                model.windowPage = .agents
                if let task { model.sendHelpers(model.helpers.openThread(task)) }
            }
        }
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
        // After switching Spaces (including into a full-screen app), keep ATOM's windows in front.
        observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.spaceChanged() }
        })
        // ADR-075: permissions are re-read whenever ATOM comes to the front (the user may be back from System Settings).
        observers.append(center.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.model.permissions.refresh() }
        })
        observeSleep()
        model.permissions.refresh()
        shortcuts.start()
        watchSettings()
        panel.hasShadow = model.settings.theme.palette.usesShadows // Void has no drop shadow (ADR-086)
        pet.setEnabled(model.settings.petEnabled)
        dictation.warmUp() // skips the microphone if launched while locked
        refresh()
        let env = ProcessInfo.processInfo.environment
        if AtomEnv.read("ATOM_BUBBLE_DEMO", env) != nil { playBubbleDemo() }
        // Development and the UI check (scripts/ui-check.sh): open the window at launch, as a click on the menu bar icon does.
        if AtomEnv.read("ATOM_OPEN_WINDOW", env) == "1" { helpersWindow.show(page: .chat) }
        if AtomEnv.read("ATOM_LOOK_DEMO", env) != nil { playLookDemo() }
        if AtomEnv.read("ATOM_WORK_DEMO", env) != nil { playWorkDemo() }
        if let spots = AtomEnv.read("ATOM_POINT_DEMO", env) { playPointDemo(spots) }
        if let files = AtomEnv.read("ATOM_DICTATION_FILE", env) { dictation.selfTest(files: files.split(separator: ",").map(String.init)) }
    }

    func stop() {
        shortcuts.stop()
        dictation.stop()
        pet.stop()
        wakeTimer?.invalidate()
        pointTimer?.invalidate()
        tourTimer?.invalidate()
        bubble.stop()
        strip.stop()
        pointLabel.stop()
        menuIcon.remove()
        for monitor in monitors { NSEvent.removeMonitor(monitor) }
        monitors = []
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
            DistributedNotificationCenter.default().removeObserver(observer)
        }
        observers = []
        panel.orderOut(nil)
    }

    // Stored state used by the extension files (an extension cannot hold stored properties).
    var lastReply = ""
    var pointTimer: Timer?

    // MARK: - Sleep and lock (ADR-076)

    /// Screens asleep or awake (NSWorkspace) and the session locked or unlocked (distributed notifications). A launch
    /// while locked starts paused, from the session's own flag.
    func observeSleep() {
        let workspace = NSWorkspace.shared.notificationCenter
        let screens: [(Notification.Name, SleepState.Signal)] = [
            (NSWorkspace.screensDidSleepNotification, .screensSlept), (NSWorkspace.screensDidWakeNotification, .screensWoke),
        ]
        for (name, signal) in screens {
            observers.append(workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.sleepSignal(signal) }
            })
        }
        let distributed = DistributedNotificationCenter.default()
        for (name, signal) in [("com.apple.screenIsLocked", SleepState.Signal.locked), ("com.apple.screenIsUnlocked", .unlocked)] {
            observers.append(distributed.addObserver(forName: Notification.Name(name), object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.sleepSignal(signal) }
            })
        }
        // ponytail: an undocumented session key, read once at launch; the notifications are the real source after that.
        let session = CGSessionCopyCurrentDictionary() as? [String: Any]
        if session?["CGSSessionScreenIsLocked"] as? Bool == true { sleepSignal(.locked) }
    }

    func sleepSignal(_ signal: SleepState.Signal) {
        guard sleep.apply(signal) else { return }
        log(sleep.paused ? "system.pause" : "system.resume", [:])
        pet.setPaused(sleep.paused)
        dictation.setPaused(sleep.paused)
        // A Talk that went through the runtime keeps the runtime's microphone open: the app-side cancel above does not reach it.
        if sleep.paused, talking, !talkingLocally {
            talking = false
            model.send(.talkCancel)
        }
    }

    // MARK: - Runtime

    func apply(_ status: RuntimeSupervisor.Status) {
        model.status.apply(status)
        if ComputerRestart.endsWithout(ready: status) { model.computerRestarting = false } // the switch is not stuck on "Restarting…"
        if case .running = status {} else { // whatever it asked or showed is over
            runtimeReady = false
            model.runtimeStopped()
            model.approval.runtimeStopped()
            model.pointing.runtimeStopped()
            model.work.runtimeStopped()
        }
        statusChanged()
    }

    /// A command was not sent because the runtime is not running (restarting, failed or stopped). The user hears about what they did, not
    /// about the app's own housekeeping; the error goes through the same path as the runtime's own, so the status card shows it (code review, 2026-10-16:
    /// it went to the model only, which changed nothing visible and could mark a turn in progress as failed).
    func commandDropped(_ command: IslandCommand) {
        guard let error = model.droppedCommandError(for: command) else { return }
        apply(.error(error))
    }

    func apply(_ event: IslandEvent) {
        if localListening, case .state(.idle) = event { return } // the turn we interrupted, ending
        let helperRefusal = model.helpers.claims(event) // shown in the ATOM window, not as ATOM's status
        if case .micLevel = event {} else { model.apply(event) }
        // ADR-091: what is new in the team, and an OK asked for, become notifications.
        switch event {
        case .helpers, .planUsage: notifier.update(model.helpers.list, plan: model.planUsage)
        case .approvalRequest(let request): notifier.approval(request)
        case .brief:
            if let entry = model.dailyBrief.takeFresh(), model.dailyBrief.settings.notify { notifier.brief(entry) }
        default: break
        }
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
        if case .ready = event {
            runtimeReady = true
            schedule([(1.5, { [self] in maybeStartTour() })]) // after Pal's launch hello
        }
        if case .contextReady(_, let ok, _) = event { contextReady(ok: ok) } // before the status: it opens the microphone
        model.work.apply(event, now: Self.now)
        if case .computerPoint(let target) = event { startPointing(target) }
        if case .settingsOpen = event { // ADR-071: as if the user opened Settings by hand
            model.tab = .settings
            setExpanded(true)
        }
        if case .mediaKey(let key) = event { press(key) }
        if case .timer = event { pet.poke() } // out of hiding: the user should see it (the runtime chimed and spoke)
        // Task 3.15: Pal flies over to the menu-bar icon with the team's line while ATOM says it.
        if case .workerLine(let line) = event, !model.status.isBusy {
            pet.poke()
            pointAtMenuIcon(IslandStatus.short(line))
        }
        let wasBusy = model.status.isBusy
        if !helperRefusal { model.status.apply(event) }
        if case .state(.idle) = event, wasBusy {
            // A turn just ended: stay out briefly so the outcome is seen.
            linger(model.status.needsAttention ? afterProblem : afterTurn)
        }
        if case .timer = event, model.status.kind == .notice { linger(afterProblem) }
        if case .reply(let text) = event { lastReply = text }
        if case .turnComplete = event { maybeFollowUp() }
        statusChanged()
    }

    /// Presses a system media key once (ADR-071). Posting needs Accessibility, which typing dictated text already uses.
    func press(_ key: MediaKey) {
        guard AXIsProcessTrusted() else {
            apply(.notice(kind: "media_key_permission",
                          message: "To press play/pause, allow ATOM in System Settings → Privacy & Security → Accessibility."))
            return
        }
        for down in [true, false] {
            let (flags, data1) = key.event(down: down)
            NSEvent.otherEvent(with: .systemDefined, location: .zero, modifierFlags: NSEvent.ModifierFlags(rawValue: flags),
                               timestamp: 0, windowNumber: 0, context: nil, subtype: 8, data1: data1, data2: -1)?
                .cgEvent?.post(tap: .cghidEventTap)
        }
    }

    // MARK: - What shows where

    /// Puts every window in step with the state. Cheap: each part only acts on a change.
    func refresh() {
        menuIcon.update(model.status.kind, title: model.status.title, flat: !model.settings.theme.palette.usesGlow)
        shortcuts.setBusy(model.status.isBusy || talking || dictating)
        updateStrip()
        updatePointing()
        updateBubble()
        updatePanel()
        scheduleWake()
    }

    /// A turn or dictation is in progress, or just ended and its outcome is still showing.
    var statusWanted: Bool {
        model.status.isBusy || talking || dictating || Self.now < statusUntil
    }

    /// This turn works on the Mac: the strip has the floor, Pal's bubble and the card stay away.
    var workTurn: Bool { model.work.active }

    func updateStrip() {
        let now = Self.now
        let show = model.work.isShown(at: now)
        if model.approval.pending != nil { pet.poke() } // the question is for the user: Pal comes out of hiding
        let clearance = pet.isShown ? 54 * model.settings.palSize.scale + 10 : 0
        if show != strip.isVisible { trace(show ? "strip show" : "strip hide") }
        strip.update(show: show, asking: model.approval.pending != nil, clearance: clearance, accessChange: model.approval.pending?.accessChange == true)
        if show, model.approval.pending != nil { trace("strip asking \(strip.frame.integral)") }
    }

    /// Pal's bubble: only when the status needs words (a problem, a notice, a question), never while it points or
    /// while the strip is up.
    func updateBubble() {
        let wanted = pet.isShown && !workTurn && model.pointing.target == nil && statusWanted && model.status.needsBubble
        if wanted {
            if !bubble.isVisible { trace("bubble show") }
            bubble.show(at: pet.feetPoint)
        } else if bubble.isVisible {
            trace("bubble hide")
            bubble.hide()
            if pet.isShown, !statusWanted { model.status.acknowledge() } // seen: a notice goes back to Ready
        }
    }

    /// The panel window: the status card (Pal off, a turn running), or off screen.
    func wantedPresentation() -> MenuPanelLayout.Presentation? {
        guard !pet.isShown, !workTurn, statusWanted else { return nil }
        let wide = model.status.kind == .listening && model.settings.livePreview && dictating
        return wide ? .wide : .compact
    }

    func updatePanel() {
        let wanted = wantedPresentation()
        guard wanted != current || (wanted != nil && !panel.isVisible) else { return }
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        panelGeneration += 1
        let generation = panelGeneration
        if let wanted {
            let target = layout().frame(wanted)
            let opening = current == nil || !panel.isVisible
            if opening {
                // ADR-084: drops a little from the menu bar and fades in while the content grows from the icon on the
                // open spring. The content starts small, without animation, before the window is shown.
                model.openAnchorX = layout().openAnchorX(wanted)
                var still = Transaction()
                still.disablesAnimations = true
                withTransaction(still) { model.presented = false }
                panel.setFrame(reduceMotion ? target : target.offsetBy(dx: 0, dy: 6), display: false)
                panel.alphaValue = 0
                panel.orderFrontRegardless()
                DispatchQueue.main.async { [weak self] in
                    MainActor.assumeIsolated {
                        guard let self, generation == self.panelGeneration else { return }
                        withAnimation(Motion.open(reduceMotion)) { self.model.presented = true }
                    }
                }
            }
            NSAnimationContext.runAnimationGroup({ context in
                context.duration = reduceMotion ? 0.15 : (opening ? 0.3 : 0.22)
                context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1)
                panel.animator().setFrame(target, display: true)
                panel.animator().alphaValue = 1
            }, completionHandler: { [weak self] in
                MainActor.assumeIsolated { self?.settleShadow() }
            })
            trace("panel \(wanted) \(target.integral)")
        } else {
            // Leaves quickly and without a bounce (`Motion.close`): rises a touch, shrinks a little and fades.
            let start = panel.frame
            withAnimation(Motion.close(reduceMotion)) { model.presented = false }
            NSAnimationContext.runAnimationGroup({ context in
                context.duration = reduceMotion ? 0.15 : 0.26
                context.timingFunction = CAMediaTimingFunction(controlPoints: 0.45, 0, 0.2, 1)
                if !reduceMotion { panel.animator().setFrame(start.offsetBy(dx: 0, dy: 4), display: true) }
                panel.animator().alphaValue = 0
            }, completionHandler: { [weak self] in
                MainActor.assumeIsolated {
                    guard let self, generation == self.panelGeneration else { return }
                    self.panel.orderOut(nil)
                    self.panel.alphaValue = 1
                    self.model.status.acknowledge()
                    self.model.meter.reset()
                }
            })
            trace("panel hide")
        }
        current = wanted
    }

    /// Re-checks when a linger ends, even if nothing else happens.
    func scheduleWake() {
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

    // MARK: - Opening and closing the panel

    /// ADR-089: the menu-bar icon and the toggle shortcut open the ATOM window, or close it when it is in front.
    func toggleWindow() {
        if helpersWindow.isInFront { helpersWindow.close() } else { setExpanded(true) }
    }

    func setExpanded(_ expanded: Bool) {
        pet.poke()
        // ADR-089: chat, the board and Settings live in the ATOM window, so "open" opens it on the page asked for; the
        // drop-down panel stays closed (the island shows its compact card).
        if expanded {
            helpersWindow.show(page: model.tab == .settings ? .settings : .chat)
        }
    }

    /// A press on Pal that was not a drag: opens the ATOM window, or closes it when it is in front, like the menu-bar
    /// icon (ADR-051, ADR-089, ADR-093).
    func palClicked(_ count: Int) {
        trace("pal click \(count)")
        switch PetClickAction.forPress(clickCount: count, windowOpen: helpersWindow.isInFront) {
        case .open: setExpanded(true)
        case .close:
            pet.poke()
            helpersWindow.close()
        case .none: break
        }
    }

}
