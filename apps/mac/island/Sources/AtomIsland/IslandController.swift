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
    private let panel = IslandPanel()
    private let menuIcon = MenuBarIcon()
    /// Pal's speech bubble (ADR-050): status for talk and dictation while Pal is shown.
    private let bubble: BubbleController
    /// What ATOM is doing on the Mac, Stop, and approval requests (ADR-054, ADR-056).
    private let strip: WorkStripController
    /// The short label beside Pal while it points.
    private let pointLabel = PointLabelController()
    /// The ATOM window (ADR-081).
    private let helpersWindow: MainWindowController
    /// ADR-091: ATOM's macOS notifications.
    private let notifier: Notifier
    /// Talk was started by its shortcut and not yet sent or cancelled.
    private var talking = false
    /// This Talk is going through the app's own microphone and Parakeet (ADR-063), not the runtime's.
    private var talkingLocally = false
    /// Listening or transcribing locally: the runtime's "idle" (from stopping its turn) must not hide it.
    private var localListening = false
    /// `ATOM_TALK_ENGINE=whisper` keeps the old path: the runtime records and Whisper transcribes.
    private let talkLocally = AtomEnv.read("ATOM_TALK_ENGINE") != "whisper"
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
    /// Pal reached the place it points at: its label shows from then on.
    private var pointArrived = false
    /// Development only: when set, a PNG of the panel is written here each time its title changes.
    private let snapshotDirectory = AtomEnv.read("ATOM_ISLAND_SNAPSHOTS").map { URL(fileURLWithPath: $0) }
    private var snapshotCount = 0
    private let trace: (String) -> Void
    private let log: (String, [String: Any]) -> Void
    /// The runtime said `ready` and has not stopped since: a dropped Pal can ask it something (ADR-074).
    private var runtimeReady = false
    /// The app Pal was last dropped on, until the runtime answers `context.ready`.
    private var pointedBundleId: String?
    /// Starts the runtime again with a fresh restart policy (ADR-075). Set by the app.
    var restartRuntime: () -> Void = {}
    /// ATOM's log file, for "Open log". Set by the app.
    var logURL: URL?
    /// The first-run tour (ADR-075) and the timer for its next step.
    private var tour = FirstRunTour()
    private var tourTimer: Timer?
    /// The screens are asleep or the Mac is locked (ADR-076): Pal stops drawing and the microphone is left alone.
    private var sleep = SleepState()
    /// The Talk keys went down while paused and were ignored: their release is ignored too.
    private var talkHeldWhilePaused = false

    /// How long the status stays after a turn or dictation ends (Settings → Bubble → Stays).
    private var afterTurn: Double { model.settings.bubbleStay.seconds }
    /// How long a notice or problem stays out.
    private let afterProblem = 6.0

    init(settings: IslandSettings, log: @escaping (String, [String: Any]) -> Void, trace: @escaping (String) -> Void = { _ in }) {
        self.trace = trace
        self.log = log
        model = IslandModel(settings: settings)
        bubble = BubbleController(model: model)
        strip = WorkStripController(model: model)
        helpersWindow = MainWindowController(model: model)
        notifier = Notifier(settings: settings)
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

    // MARK: - Sleep and lock (ADR-076)

    /// Screens asleep or awake (NSWorkspace) and the session locked or unlocked (distributed notifications). A launch
    /// while locked starts paused, from the session's own flag.
    private func observeSleep() {
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

    private func sleepSignal(_ signal: SleepState.Signal) {
        guard sleep.apply(signal) else { return }
        log(sleep.paused ? "system.pause" : "system.resume", [:])
        pet.setPaused(sleep.paused)
        dictation.setPaused(sleep.paused)
    }

    // MARK: - Runtime

    func apply(_ status: RuntimeSupervisor.Status) {
        model.status.apply(status)
        if case .running = status {} else { // whatever it asked or showed is over
            runtimeReady = false
            model.approval.runtimeStopped()
            model.pointing.runtimeStopped()
            model.work.runtimeStopped()
        }
        statusChanged()
    }

    func apply(_ event: IslandEvent) {
        if localListening, case .state(.idle) = event { return } // the turn we interrupted, ending
        let helperRefusal = model.helpers.claims(event) // shown in the ATOM window, not as ATOM's status
        if case .micLevel = event {} else { model.apply(event) }
        // ADR-091: what is new in the team, and an OK asked for, become notifications.
        switch event {
        case .helpers, .planUsage: notifier.update(model.helpers.list, plan: model.planUsage)
        case .approvalRequest(let request): notifier.approval(request)
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
    private func press(_ key: MediaKey) {
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

    // MARK: - Follow-up (ADR-067)

    private var lastReply = ""

    /// ATOM's reply ended in a question: open the microphone for the answer, once its voice has stopped.
    private func maybeFollowUp() {
        let reply = lastReply
        lastReply = ""
        let typed = model.typedTurn
        model.typedTurn = false
        guard !typed, model.settings.followUpEnabled, talkLocally, SpeechEndpoint.invitesAnswer(reply) else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self, !self.talking, !self.dictating, !self.model.status.isBusy else { return }
            if self.dictation.followUpBegan() {
                self.talkingLocally = true
                self.trace("follow-up listening")
            }
        }
    }

    // MARK: - Drop Pal on a window (ADR-074)

    /// Pal was dropped with Option on this app's window: bring the app to the front, then ask the runtime to read it.
    private func pointedAt(_ app: NSRunningApplication) {
        let name = app.localizedName ?? "this app"
        guard let bundleId = app.bundleIdentifier else {
            log("pal.pointed.refused", ["reason": "no_bundle_id"])
            refusePoint(name, "ATOM doesn't read \(name).")
            return
        }
        guard runtimeReady else {
            log("pal.pointed.refused", ["bundleId": bundleId, "reason": "not_connected"])
            refusePoint(name, "ATOM isn't running.")
            return
        }
        log("pal.pointed", ["bundleId": bundleId])
        trace("pal pointed")
        pointedBundleId = bundleId
        Task { [weak self] in
            await Self.bringToFront(app)
            self?.model.send(.contextWindow(bundleId: bundleId, name: name))
        }
    }

    /// Shown like the runtime's own refusal: a bubble, no microphone.
    private func refusePoint(_ app: String, _ message: String) {
        apply(.contextReady(app: app, ok: false, message: message))
    }

    /// The runtime read the app (or refused it). The user pointed on purpose, so the microphone opens whatever the
    /// follow-up setting says; the bubble then names the app (`IslandStatus`).
    private func contextReady(ok: Bool) {
        let bundleId = pointedBundleId
        pointedBundleId = nil
        guard ok else {
            if let bundleId { log("pal.pointed.refused", ["bundleId": bundleId]) }
            return
        }
        guard talkLocally, !talking, !dictating, !model.status.isBusy, dictation.followUpBegan() else { return }
        talkingLocally = true
        trace("pointed: listening")
    }

    /// Activates the app and waits until it is in front (at most half a second), so the runtime reads that app.
    private static func bringToFront(_ app: NSRunningApplication) async {
        guard !app.isTerminated, NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier else { return }
        app.activate()
        let deadline = ProcessInfo.processInfo.systemUptime + 0.5
        while NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier,
              ProcessInfo.processInfo.systemUptime < deadline {
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    private func statusChanged() {
        pet.update(model.status.kind, micLive: model.status.micLive)
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
        // Asleep or locked: Talk does not open any microphone, the app's or the runtime's (dictation checks for itself).
        switch trigger {
        case .holdBegan(.talk) where sleep.paused:
            talkHeldWhilePaused = true
            return
        case .holdEnded(.talk), .holdCancelled(.talk):
            if talkHeldWhilePaused { talkHeldWhilePaused = false; return }
        default:
            break
        }
        pet.poke()
        switch trigger {
        case .holdBegan(.talk):
            skipTour()
            dictation.followUpCancelled() // the keys take over from listening for an answer
            model.typedTurn = false
            talking = true
            let interrupting = model.status.isBusy
            if talkLocally, dictation.talkBegan() {
                talkingLocally = true
                if interrupting { model.send(.talkCancel) } // stop ATOM speaking: the microphone is open
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
            toggleWindow()
        case .pressed(.cancel):
            talking = false
            if dictation.isActive { dictation.cancel() } else { stopWork() }
        case .holdBegan(.dictate):
            skipTour()
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
        menuIcon.update(model.status.kind, title: model.status.title, flat: !model.settings.theme.palette.usesGlow)
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

    /// This turn works on the Mac: the strip has the floor, Pal's bubble and the card stay away.
    private var workTurn: Bool { model.work.active }

    private func updateStrip() {
        let now = Self.now
        let show = model.work.isShown(at: now)
        if model.approval.pending != nil { pet.poke() } // the question is for the user: Pal comes out of hiding
        let clearance = pet.isShown ? 54 * model.settings.palSize.scale + 10 : 0
        if show != strip.isVisible { trace(show ? "strip show" : "strip hide") }
        strip.update(show: show, asking: model.approval.pending != nil, clearance: clearance)
        if show, model.approval.pending != nil { trace("strip asking \(strip.frame.integral)") }
    }

    /// Pal's bubble: only when the status needs words (a problem, a notice, a question), never while it points or
    /// while the strip is up.
    private func updateBubble() {
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
    private func wantedPresentation() -> MenuPanelLayout.Presentation? {
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

    /// How long Pal stays at the place once it gets there, so the user has time to look.
    private static let pointDwell: Double = 7
    private var pointTimer: Timer?

    /// The model named a place: Pal flies there. Its label shows on arrival, beside it.
    private func startPointing(_ target: PointTarget) {
        guard pet.isShown else { // no Pal: nothing to fly. The strip says what it is.
            trace("point without Pal: \(target.label)")
            return
        }
        let areas = NSScreen.screens.map { ScreenArea(frame: $0.frame, visible: $0.visibleFrame) }
        let scale = model.settings.palSize.scale
        // No bubble goes with Pal now (ADR-056): it only needs room for itself.
        guard let flight = PointPlacement.flight(to: target, screens: areas, palHeight: 54 * scale, palHalfWidth: 22 * scale,
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

    /// Pal got there: the label shows and the dwell starts.
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

    /// Keeps Pal and its label in step with the pointing state: it ended (a new turn, a reset, the dwell) → go back.
    private func updatePointing() {
        if let target = model.pointing.target, pet.isShown, pointArrived {
            let scale = model.settings.palSize.scale
            pointLabel.show(PointingState.line(for: target), palette: model.settings.theme.palette, feet: pet.feetPoint, palHeight: 54 * scale, palHalfWidth: 22 * scale)
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
            apply(.micReady) // ADR-093: this microphone is already capturing (talkBegan started it): "Speak now"
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

    /// Where the user's spelling fixes live: `vocabulary.txt` in ATOM's folder under Application Support.
    static var vocabularyURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/ATOM/vocabulary.txt")
    }

    private func playTone(_ sound: DictationController.Sound) {
        guard model.settings.soundsEnabled else { return }
        NSSound(named: sound == .start ? "Tink" : "Pop")?.play()
    }

    // MARK: - Opening and closing the panel

    /// ADR-089: the menu-bar icon and the toggle shortcut open the ATOM window, or close it when it is in front.
    private func toggleWindow() {
        if helpersWindow.isInFront { helpersWindow.close() } else { setExpanded(true) }
    }

    private func setExpanded(_ expanded: Bool) {
        pet.poke()
        // ADR-089: chat, the board and Settings live in the ATOM window, so "open" opens it on the page asked for; the
        // drop-down panel stays closed (the island shows its compact card).
        if expanded {
            helpersWindow.show(page: model.tab == .settings ? .settings : .chat)
        }
    }

    /// A press on Pal that was not a drag: opens the ATOM window, or closes it when it is in front, like the menu-bar
    /// icon (ADR-051, ADR-089, ADR-093).
    private func palClicked(_ count: Int) {
        trace("pal click \(count)")
        switch PetClickAction.forPress(clickCount: count, windowOpen: helpersWindow.isInFront) {
        case .open: setExpanded(true)
        case .close:
            pet.poke()
            helpersWindow.close()
        case .none: break
        }
    }

    // MARK: - Setup and errors (ADR-075)

    /// The runtime stopped for good (config error, repeated crashes): open the panel so its card is seen.
    func showSetupProblem() {
        model.tab = .conversation
        setExpanded(true)
    }

    private func perform(_ action: FailureAction) {
        switch action {
        case .openTerminal(let command):
            openTerminal(running: command)
        case .openModelSettings:
            model.tab = .settings
            model.settingsPage = .model
            setExpanded(true)
        case .showCommand:
            break // the card shows the text itself
        case .openSettingsPane(let url):
            NSWorkspace.shared.open(url)
        case .restartRuntime:
            log("island.runtime.restart_by_user", [:])
            restartRuntime()
        case .openLog:
            openLog()
        case .switchModel(let provider, let model):
            log("model.switch_by_user", ["provider": provider, "model": model])
            self.model.chooseModel(provider: provider, model: model)
        }
    }

    /// Opens Terminal running a fixed command from the failure table, through a `.command` file, so ATOM needs no
    /// permission to script Terminal.
    private func openTerminal(running command: String) {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("atom-setup.command")
        let script = "#!/bin/zsh -il\n\(command)\necho\necho 'Done. You can close this window and try ATOM again.'\n"
        do {
            try script.write(to: file, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.path)
        } catch {
            log("setup.terminal_failed", ["message": "\(error)"])
            return
        }
        guard let terminal = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Terminal") else {
            log("setup.terminal_failed", ["message": "Terminal not found"])
            return
        }
        NSWorkspace.shared.open([file], withApplicationAt: terminal, configuration: NSWorkspace.OpenConfiguration())
    }

    /// The log in Console; if Console cannot open it, the file (or its folder) in Finder.
    private func openLog() {
        guard let url = logURL else { return }
        guard FileManager.default.fileExists(atPath: url.path) else {
            NSWorkspace.shared.activateFileViewerSelecting([url.deletingLastPathComponent()])
            return
        }
        let console = URL(fileURLWithPath: "/System/Applications/Utilities/Console.app")
        NSWorkspace.shared.open([url], withApplicationAt: console, configuration: NSWorkspace.OpenConfiguration()) { _, error in
            guard error != nil else { return }
            DispatchQueue.main.async { NSWorkspace.shared.activateFileViewerSelecting([url]) }
        }
    }

    /// Never asked: the click asks macOS (Microphone, Input Monitoring). Otherwise: the row's pane.
    private func permissionButton(_ row: PermissionRow) {
        let state = model.permissions.states[row]
        log("setup.permission_button", ["row": row.title, "state": state.map { "\($0)" } ?? "unknown"])
        if PermissionRowView.asksOnClick(row, state) {
            switch row {
            case .microphone:
                Task { [weak self] in
                    _ = await DictationCapture.requestPermission()
                    self?.model.permissions.refresh()
                }
                return
            case .inputMonitoring:
                shortcuts.requestKeyAccess()
                model.permissions.refresh()
                return
            default:
                break
            }
        }
        NSWorkspace.shared.open(row.settingsURL)
    }

    // MARK: - First-run tour (ADR-075)

    private func maybeStartTour() {
        guard !tour.isRunning, !model.settings.tourDone else { return }
        guard !talking, !dictating, !model.status.isBusy else { return skipTour() } // the user talked first
        guard FirstRunTour.shouldStart(palShown: pet.isShown, tourDone: model.settings.tourDone, runtimeReady: runtimeReady) else { return }
        log("tour.start", [:])
        runTourStep(tour.start())
    }

    private func replayTour() {
        guard pet.isShown, !tour.isRunning else { return }
        pet.poke()
        log("tour.replay", [:])
        schedule([(0.4, { [self] in if !tour.isRunning, pet.isShown { runTourStep(tour.start()) } })])
    }

    private func runTourStep(_ step: TourStep) {
        switch step {
        case .hello:
            pet.react(.hello)
        case .say(let title, let detail):
            model.status.say(title, detail)
            statusChanged()
        case .point(let label):
            model.status.acknowledge() // the greeting is over; the label beside Pal takes over
            pointAtMenuIcon(label)
        case .back:
            if model.pointing.target != nil { finishPointing() }
        case .done:
            endTour(outcome: "done")
            return
        }
        guard let index = tour.index, index + 1 < FirstRunTour.script.count else { return }
        let timer = Timer(timeInterval: FirstRunTour.script[index + 1].after, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let next = self.tour.advance() else { return }
                self.runTourStep(next)
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        tourTimer = timer
    }

    /// Pal flies to ATOM's menu-bar icon, the same way it points for the model (ADR-054).
    private func pointAtMenuIcon(_ label: String) {
        guard let anchor = menuIcon.anchor, let primary = NSScreen.screens.first else {
            trace("tour: menu-bar icon not on screen")
            return
        }
        let screen = anchor.screen.frame
        let barHeight = max(1, screen.maxY - Self.menuBarBottom(of: anchor.screen))
        // Pointing takes the driver's coordinates: points from the top-left of the main display, y down.
        let target = PointTarget(x: Double(anchor.midX - 11 - primary.frame.minX), y: Double(primary.frame.maxY - screen.maxY),
                                 w: 22, h: Double(barHeight), label: label)
        model.pointing.apply(.computerPoint(target))
        startPointing(target)
        refresh()
    }

    /// The user talked or dictated before or during the tour: it ends, and is not offered again.
    private func skipTour() {
        guard tour.isRunning || !model.settings.tourDone else { return }
        let wasRunning = tour.userTalked()
        if wasRunning, model.pointing.target != nil { finishPointing() }
        endTour(outcome: "skipped")
    }

    private func endTour(outcome: String) {
        tourTimer?.invalidate()
        tourTimer = nil
        _ = tour.userTalked() // not running any more
        if !model.settings.tourDone { model.settings.tourDone = true }
        log("tour.end", ["outcome": outcome])
    }

    // MARK: - Displays and Spaces

    /// The panel hangs from the icon; if the icon's place is unknown, from the top-right of the main display.
    private func layout() -> MenuPanelLayout {
        let metrics = IslandMetrics()
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

    /// Re-applies the look settings whenever one changes (the bubble and the panel; Pal reads its own each frame).
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
        panel.hasShadow = model.settings.theme.palette.usesShadows
        menuIcon.update(model.status.kind, title: model.status.title, flat: !model.settings.theme.palette.usesGlow)
        guard let current, panel.isVisible else { return }
        let target = layout().frame(current)
        guard target != panel.frame else { return }
        trace("panel size \(Int(target.width))x\(Int(target.height))")
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.2
            panel.animator().setFrame(target, display: true)
        }, completionHandler: { [weak self] in
            MainActor.assumeIsolated { self?.settleShadow() }
        })
    }

    /// The window's shadow is traced from what the panel drew when it was last computed. Re-trace it once the
    /// panel has its final size and corners (a stale trace from the smaller status card, or from mid-animation, shows
    /// as a squared-off edge around the rounded panel). After the content's own cross-fade.
    private func settleShadow() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.panel.isVisible else { return }
                self.panel.display()
                self.panel.invalidateShadow()
            }
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
        trace("demo \(label) | \(pet.debugState) | panel=\(current.map { "\($0)" } ?? "off") frame=\(panel.isVisible ? "\(panel.frame.integral)" : "-") window=\(helpersWindow.isVisible) | icon=\(menuIcon.anchor.map { "\(Int($0.midX))" } ?? "?")")
    }

    /// Development only (`ATOM_BUBBLE_DEMO=1`): plays a dictation's phases through the real controller, with no
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

    /// Development only (`ATOM_WORK_DEMO=1`): a turn that works on the Mac, through the real event path: steps, an
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

    /// Development only (`ATOM_POINT_DEMO="x,y,w,h,label;x,y,w,h,label"`): plays each place through the real event path,
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

    /// Development only (`ATOM_LOOK_DEMO`): changes the look settings while the app runs, so the real windows can
    /// be measured, then puts the user's own values back.
    private func playLookDemo() {
        let settings = model.settings
        let saved = (settings.palSize, settings.bubbleSize, settings.bubbleOpacity, settings.bubbleStay)
        func look(_ label: String) {
            trace("look \(label) | pal=\(Int(settings.palSize.points)) | panel frame=\(Int(panel.frame.width))x\(Int(panel.frame.height)) visible=\(panel.isVisible) | bubble=\(bubble.isVisible)")
        }
        schedule([
            (3, { look("start") }),
            (4, { settings.palSize = .huge }),
            (5.5, { look("pal huge") }),
            (6, { settings.bubbleSize = .large; settings.bubbleOpacity = .solid }),
            (6.5, { [self] in model.meter.reset(); dictationPhase(.listening) }),
            (8, { look("bubble large while listening") }),
            (9, { [self] in dictationPhase(.cancelled) }),
            (10, { settings.palSize = .small; settings.bubbleSize = .normal }),
            (11, { look("pal small") }),
            (18.5, {
                (settings.palSize, settings.bubbleSize, settings.bubbleOpacity, settings.bubbleStay) = saved
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
