import Observation
import AtomIslandCore

/// Everything the island's views show, and the actions they can take. Owned by `IslandController`.
@MainActor @Observable
final class IslandModel {
    /// Conversation or Settings: the window page "open" goes to (ADR-089).
    typealias Tab = PanelTab
    typealias SettingsPage = AtomIslandCore.SettingsPage

    var status = IslandStatus()
    /// What ATOM is waiting for the user to allow (ADR-054).
    var approval = ApprovalState()
    /// The place ATOM is showing the user, if any (ADR-054).
    var pointing = PointingState()
    /// The strip above the Dock while ATOM works on the Mac (ADR-056). Written by the controller, which knows the time.
    var work = WorkStripState()
    var meter = LevelMeter(bars: 14)
    var conversation = Conversation()
    /// The model in use and the choices, from the runtime's `info` event.
    var modelInfo: ModelInfo?
    /// A model switch sent to the runtime and not yet confirmed (model id).
    var pendingModel: String?
    /// Why the last model switch was refused, shown under the model list until the next attempt.
    var modelError: String?
    /// ADR-097: the model lists were asked for again and no `info` has come back yet.
    var refreshingModels = false
    /// What ATOM keeps (ADR-058). Nil until the Memory page first asks the runtime.
    var memory: MemoryList?
    /// The second brain: the notes, their links and the open note. Empty until the page first asks the runtime.
    var brain = BrainState()
    @ObservationIgnored private var brainCommandPending = false
    /// What ATOM can do (ADR-076), from the runtime's `capabilities` event. Nil until it arrives: only the shortcuts show.
    var capabilities: [CapabilityItem]?
    /// Claude plan usage (ADR-076), merged from `plan.usage` events. Nil until one arrives: no meters.
    var planUsage: PlanUsage?
    /// ADR-091: Keshab's chats and the one ATOM is in; nil until the window asks.
    var chats: ChatList?
    /// The skill open in Plugins → Skills (its whole SKILL.md), the last answer to `skillGet` or `skillSave`.
    var skillFile: SkillFileData?
    /// Keshab's Claude commands for the "/" picker (ADR-117), as the runtime listed them.
    var claudeCommands: [SlashCommandInfo] = []
    var skillError: String?
    @ObservationIgnored private var skillCommandPending = false
    /// ADR-107: the chat that was opened with only its newest turns given to the model; its note shows over the chat.
    var trimmedChatId: String?
    /// ADR-107: why the last project command was refused; shown under "Projects" until the next one.
    var projectError: String?
    @ObservationIgnored private var projectCommandPending = false
    /// ADR-098: ATOM's Telegram bot is set up in .env (from the runtime's `ready`).
    var telegramConnected = false
    /// ADR-054: computer control is on in the running runtime (from `ready`). The switch in Settings → General shows it.
    var computerOn = false
    /// The runtime is restarting to apply the switch.
    var computerRestarting = false
    /// ADR-098 item 5: the local API's state, from the runtime's `api` event (nil until Settings' switch is sent).
    var apiStatus: ApiStatus?
    /// The ATOM window's content (ADR-081): helpers, their jobs, the report being read.
    var helpers = HelpersState()
    /// The ATOM window is open: a restarted runtime is asked for the list again.
    var helpersWindowOpen = false

    /// Settings home has already cascaded in (ADR-084): once per launch, now that the drop-down panel that reset it on
    /// each opening is gone (ADR-093).
    @ObservationIgnored var settingsCascaded = false
    /// The card's content at full size (ADR-084). False for the moment it opens, so it can grow in from the menu-bar
    /// icon, and while it closes. Set by the controller, inside the open and close animations.
    var presented = true
    /// Where the card grows from, as a fraction of its width (0 left, 1 right). Set by the controller.
    var openAnchorX = 1.0
    var tab = Tab.conversation
    /// ADR-089: the page the ATOM window shows.
    var windowPage = WindowPage.chat
    /// ADR-090: what the Board shows: Overview, the office floor or the columns.
    var boardView = BoardView.floor
    /// ADR-098: the Board shows only the tasks with this label (nil: all).
    var boardLabel: String?
    /// ADR-098: the sidebar's search: the words typed, the answer to them, and a request to focus the field (⌘F).
    var searchText = ""
    var searchResults: SearchResults?
    var searchFocusTick = 0
    /// ADR-094: the Board's "All agents" list is open (from its chip or a "+N" sign on the floor).
    var showsAllAgents = false
    /// The Settings page open inside the Settings tab; nil shows the list of pages (ADR-057).
    var settingsPage: SettingsPage?

    let settings: IslandSettings
    let recorder: ShortcutRecorder
    /// Open ATOM at login (General). Read from macOS, never saved by ATOM.
    let loginItem = LoginItem()
    /// The permissions checklist (ADR-075). Read from macOS, never saved by ATOM.
    let permissions = PermissionChecker()
    /// Shows or hides Pal. Set by the controller.
    @ObservationIgnored var petChanged: (Bool) -> Void = { _ in }

    /// Turns the pet on or off: saves the setting and shows or hides Pal at once.
    func setPet(_ enabled: Bool) {
        settings.petEnabled = enabled
        petChanged(enabled)
    }

    /// Listens for shortcuts in every app. Set by the controller.
    @ObservationIgnored weak var shortcuts: ShortcutEngine?

    /// Sends a command to the runtime. Set by the app.
    @ObservationIgnored var send: (IslandCommand) -> Void = { _ in }
    /// A command was not sent because the runtime is not running: tell the user, and stop any "waiting" that expected its answer.
    func droppedCommandError(for command: IslandCommand) -> RuntimeError? {
        guard DroppedCommand.shouldTell(commandType: command.type) else { return nil }
        let waiting = skillCommandPending || brainCommandPending || projectCommandPending || helpers.isWaiting || pendingModel != nil || refreshingModels
        return DroppedCommand.error(waitingInSettings: waiting)
    }

    /// Restarts the runtime with computer control on or off (set by main.swift).
    @ObservationIgnored var applyComputer: (Bool) -> Void = { _ in }

    /// ADR-054: the switch in Settings → General. The choice is saved; the runtime restarts to apply it, because ATOM's tools
    /// are made once at start and computer control is not among them when it is off.
    func setComputer(_ on: Bool) {
        guard on != computerOn || settings.computerOverride != on else { return }
        settings.computerOverride = on
        computerRestarting = true
        applyComputer(on)
        // A restart that never reports `ready` (the runtime hangs while loading) must not leave the switch disabled for good. One timer for
        // the latest toggle: an earlier one used to enable the switch in the middle of a newer restart.
        computerTimeout?.cancel()
        computerTimeout = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(ComputerRestart.patience))
            guard !Task.isCancelled else { return }
            self?.computerRestarting = false
        }
    }
    @ObservationIgnored private var computerTimeout: Task<Void, Never>?

    /// The runtime stopped or restarted: what the window was waiting for will not be answered (code review, 2026-10-16). Nothing reset
    /// these before, so a Save or a model switch could stay "waiting" for good.
    func runtimeStopped() {
        helpers.runtimeStopped()
        skillCommandPending = false
        brainCommandPending = false
        projectCommandPending = false
        pendingModel = nil
        refreshingModels = false
        computerTimeout?.cancel()
    }
    /// `true` opens the ATOM window (ADR-089; the compact card's click). Set by the controller.
    @ObservationIgnored var setExpanded: (Bool) -> Void = { _ in }
    /// The work strip's Stop button: the same as Esc. Set by the controller.
    @ObservationIgnored var stopWork: () -> Void = {}
    /// An error card's button (ADR-075). Set by the controller.
    @ObservationIgnored var perform: (FailureAction) -> Void = { _ in }
    /// A permission row's button: asks macOS (only for one never asked, on the user's click) or opens its pane.
    @ObservationIgnored var permissionButton: (PermissionRow) -> Void = { _ in }
    /// Settings → General → Replay the tour. Set by the controller.
    @ObservationIgnored var replayTour: () -> Void = {}
    /// Opens the ATOM window (ADR-081). Set by the controller.
    @ObservationIgnored var openHelpers: () -> Void = {}

    init(settings: IslandSettings) {
        self.settings = settings
        recorder = ShortcutRecorder(settings: settings)
    }

    func chooseModel(provider: String, model: String) {
        guard modelInfo?.provider != provider || modelInfo?.model != model else { return }
        pendingModel = model
        modelError = nil
        send(.modelSet(provider: provider, model: model))
    }

    /// ADR-097: ask the providers for their model lists again.
    func refreshModels() {
        refreshingModels = true
        modelError = nil
        send(.modelRefresh)
    }

    /// ADR-097: the chat in use gets its own model (nil: the default again). Voice and new chats keep the default.
    func chooseChatModel(provider: String?, model: String?) {
        modelError = nil
        send(.chatModel(id: chats?.current ?? "", provider: provider ?? "", model: model ?? ""))
    }

    /// The user clicked Allow or Decline on the approval card.
    func answerApproval(_ approved: Bool) {
        guard let command = approval.answer(approved: approved) else { return }
        send(command)
    }

    /// Opens Settings → What can I ask? (the link under the empty conversation).
    func showExamples() {
        openSettings(.examples)
    }

    /// Opens the ATOM window on Settings (a page, or the list). `tab` alone is read only when the window opens: with the window already open
    /// on Chat, "What can I ask?" and "Details in Settings" did nothing visible (code review, 2026-10-16).
    func openSettings(_ page: SettingsPage?) {
        tab = .settings
        settingsPage = page
        windowPage = .settings
        setExpanded(true)
    }

    func newConversation() {
        send(.conversationReset)
    }

    /// Stops the answer ATOM is working on or saying (the same as Esc while it speaks).
    func stopReply() { send(.talkCancel) }

    /// ADR-107: a new chat inside a project.
    func newChat(inProject id: String) { send(.chatNew(projectId: id)) }

    /// ADR-107: a project command; a refusal arrives as an `error` with stage `settings` and shows under "Projects".
    func sendProject(_ command: IslandCommand) {
        projectError = nil
        projectCommandPending = true
        send(command)
    }

    /// ADR-107: the quiet line over a chat the model saw only in part.
    var trimmedNotice: String? {
        guard let id = trimmedChatId, id == chats?.current else { return nil }
        return "Long chat: older turns are summarized."
    }

    /// Token cost, job 4: the quiet line over a chat whose stored prompt has expired.
    var cacheExpiredNotice: String? { chats?.cacheExpiredNotice() }

    /// The Memory page opened: ask for the list. From then on the runtime also sends its changes.
    func loadMemory() { send(.memoryList) }

    /// The second brain's page opened: ask for the graph. From then on the runtime also sends its changes.
    func openBrain() { send(brain.open()) }
    func selectBrainNote(_ id: Int?) {
        guard let command = brain.select(id) else { return }
        brainCommandPending = true
        send(command)
    }
    func searchBrain(_ words: String) {
        if let command = brain.search(words) { send(command) }
    }
    /// A new note (`id` nil), or a change or rename of the note with `id`. The runtime answers with the note, or an error shown on the page.
    func saveBrainNote(id: Int?, title: String, body: String) {
        brainCommandPending = true
        send(brain.saveCommand(id: id, title: title, body: body))
    }
    func deleteBrainNote(_ id: Int) {
        brainCommandPending = true
        send(.brainDelete(id: id))
    }
    /// One of ATOM's own "/" commands (ADR-117): the window runs it; the model never sees it. `help` is the composer's (it opens
    /// the full list).
    func runSlash(_ action: SlashAction) {
        switch action {
        case .newChat: navigate { self.newConversation(); self.windowPage = .chat }
        case .model: navigate { self.windowPage = .settings; self.settingsPage = .model }
        case .skills: navigate { self.windowPage = .plugins }
        case .memory: navigate { self.windowPage = .brain }
        case .help: break
        }
    }
    /// Plugins → Skills: open a skill's SKILL.md in the editor (the runtime answers with `skillFile`, or an error shown there).
    func openSkill(_ name: String) {
        skillError = nil
        skillCommandPending = true
        send(.skillGet(name: name))
    }
    /// Keshab's Save: the runtime writes the file (the old text stays as SKILL.md.bak) and answers with it.
    func saveSkill(_ name: String, text: String) {
        skillError = nil
        skillCommandPending = true
        send(.skillSave(name: name, text: text))
    }
    func forgetMemory(_ id: Int) {
        memory?.memories.removeAll { $0.id == id } // at once; the runtime's answer confirms
        send(.memoryForget(id: id))
    }
    func forgetAllMemory() { send(.memoryClear) }
    func forgetEpisode(_ id: Int) {
        memory?.episodes.removeAll { $0.id == id }
        send(.episodeForget(id: id))
    }
    func forgetAllEpisodes() { send(.episodeClear) }
    /// ADR-097: keep the chosen chats in memory; the runtime's `memory` events show them indexing, then kept.
    func keepChats(_ ids: Set<String>) {
        for id in ids.sorted() { send(.memoryKeepChat(id: id)) }
    }
    func dropKeptChat(_ id: String) { send(.memoryDropChat(id: id)) }

    /// Sends what a ATOM window action produced, if anything.
    func sendHelpers(_ command: IslandCommand?) {
        if let command { send(command) }
    }

    /// ADR-098: asks the runtime for the current words' results (nothing for empty words).
    func runSearch() {
        let query = searchQuery
        guard !query.isEmpty else { searchResults = nil; return }
        send(.search(query: query))
    }

    /// The words as sent: trimmed, at most 200 characters.
    var searchQuery: String { String(searchText.trimmingCharacters(in: .whitespacesAndNewlines).prefix(TaskLabels.maxQuery)) }

    func clearSearch() {
        searchText = ""
        searchResults = nil
    }

    /// ADR-106: the current turn was typed. A typed turn never opens the microphone afterwards.
    var typedTurn = false

    /// A typed request from the Conversation tab. Ignored when empty or too long for the runtime.
    func ask(_ text: String, draft: ComposerDraft = ComposerDraft()) {
        typedTurn = true
        guard let command = draft.command(text: text) else { return }
        send(command)
    }

    // MARK: ADR-096: Back, and leaving unsaved edits

    /// Where the window is now, as one step of its history.
    var location: WindowLocation { WindowLocation(page: windowPage, helpers: helpers, allAgents: showsAllAgents, boardView: boardView) }
    /// The steps Back returns to.
    private(set) var history = WindowHistory()
    /// The step last recorded: a change from it is Keshab's next step.
    @ObservationIgnored private var lastLocation: WindowLocation?

    /// Called on every change of `location` (the window's `onChange`): the step before becomes a Back step.
    func recordLocation() {
        let now = location
        if let last = lastLocation, last != now {
            history.recordMove(from: last, up: leavingUp == last)
            leavingUp = nil
        }
        lastLocation = now
    }

    /// The page the last "‹" (up one level) came from, so recording that move does not make it a Back step.
    @ObservationIgnored private var leavingUp: WindowLocation?

    /// A page's own "‹" button: goes up one level (after "Discard changes?" when needed) and does not add the page it leaves to Back.
    func navigateUp(_ change: @escaping () -> Void) {
        navigate { [self] in
            leavingUp = location
            change()
        }
    }

    /// Back (the top bar's arrow, ⌘[ and the mouse's back button): the newest step that still exists.
    func goBack() {
        navigate { [self] in
            recordLocation()
            let current = location
            guard let target = history.back(where: { $0 != current && $0.isValid(in: helpers.list) }) else { return }
            windowPage = target.page
            showsAllAgents = target.allAgents
            boardView = target.boardView
            if target.page == .agents { sendHelpers(helpers.show(target)) }
            lastLocation = location // a Back is not a new step
        }
    }

    /// The editing fields with a change not saved yet, by name ("soul", "note"…). Set by the editing views.
    @ObservationIgnored private var editedFields: Set<String> = []
    var hasUnsavedEdits: Bool { !editedFields.isEmpty }
    /// "Discard changes?" is open; `pendingLeave` runs on Discard.
    var asksDiscard = false
    @ObservationIgnored private var pendingLeave: (() -> Void)?
    /// The field just saved, for its "Saved" check (1.5 s).
    private(set) var savedField: String?

    func markEdited(_ field: String, _ edited: Bool) {
        if edited { editedFields.insert(field) } else { editedFields.remove(field) }
    }

    /// Leaves the page with `change`, after "Discard changes?" when an edit is not saved.
    func navigate(_ change: @escaping () -> Void) {
        guard hasUnsavedEdits else { change(); return }
        pendingLeave = change
        asksDiscard = true
    }

    func discardEdits() {
        editedFields = []
        asksDiscard = false
        let leave = pendingLeave
        pendingLeave = nil
        leave?()
    }

    func keepEditing() {
        asksDiscard = false
        pendingLeave = nil
    }

    func showSaved(_ field: String) {
        savedField = field
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(1.5))
            if self?.savedField == field { self?.savedField = nil }
        }
    }

    /// ADR-097: the status line names the chat's own model, not the default, once both lists are known.
    private func syncChatModelName() {
        guard let info = modelInfo, let provider = chats?.currentProvider, let own = chats?.currentModel else { return status.setChatModel(nil) }
        status.setChatModel(info.modelName(provider: provider, model: own))
    }

    /// Keeps the conversation and model list in step with the runtime. The status is applied by the controller.
    func apply(_ event: IslandEvent) {
        let helperRefusal = helpers.claims(event)
        recordLocation() // Keshab's last step, before the runtime moves the page (a new agent, a removed one)
        helpers.apply(event)
        lastLocation = location // a change the runtime made is not a step
        if let refresh = helpers.takeRefresh() { send(refresh) } // the open task changed: ask for its thread again
        if helperRefusal { return } // a refused helper command is shown in the ATOM window only
        conversation.apply(event)
        approval.apply(event)
        pointing.apply(event)
        switch event {
        case .chats(let list):
            chats = list
            projectCommandPending = false
            projectError = nil
            syncChatModelName()
        case .chatOpened(let id, _, _, let trimmed):
            trimmedChatId = trimmed ? id : nil
        case .conversationReset:
            trimmedChatId = nil
        case .api(let status):
            apiStatus = status
        case .searchResults(let results) where results.query == searchQuery:
            searchResults = results // an answer to older words is dropped
        case .commands(let list):
            claudeCommands = list
        case .skillFile(let file):
            skillFile = file
            skillCommandPending = false
            skillError = nil
        case .error(let error) where error.stage == "settings" && skillCommandPending:
            skillCommandPending = false
            skillError = error.message
        case .memory(let list):
            memory = list
        case .capabilities(let items):
            capabilities = items
        case .planUsage(let usage):
            planUsage = (planUsage ?? PlanUsage()).merging(usage)
        case .ready(let ready):
            telegramConnected = ready.telegram // ADR-098
            computerOn = ready.computer // ADR-054
            computerRestarting = false
            computerTimeout?.cancel()
            send(.telegramSet(push: settings.telegramPush))
            send(.apiSet(on: settings.localApi)) // ADR-098 item 5
            if memory != nil { send(.memoryList) } // a restarted runtime: ask again so updates keep coming
            if brain.opened { send(.brainGet) }
            send(.helpersList) // Task 3.15: busy workers show on the island too, so the list is always kept
            sendSpeech() // ADR-091
            // A restarted runtime, or a window opened before the runtime was ready (its first ask was dropped): ask again.
            if ChatList.shouldAskAfterReady(listKnown: chats != nil, windowOpen: helpersWindowOpen) { send(.chatsList) }
            if helpersWindowOpen { send(.commandsList) } // the "/" picker (ADR-117)
        case .info(let info):
            modelInfo = info
            syncChatModelName()
            pendingModel = nil
            modelError = nil
            refreshingModels = false
        case .brain(let graph):
            brain.setGraph(graph)
            // A note delete answers with the graph only (a save answers with the note), so the flag must end here too; left set, it sent
            // the next unrelated Settings error to the brain page and left the model menus disabled (code review, 2026-10-16).
            brainCommandPending = false
        case .brainNote(let note):
            brainCommandPending = false
            brain.setNote(note)
        case .brainHits(let query, let hits):
            brain.setHits(query: query, hits)
        case .error(let error) where error.stage == "settings" && brainCommandPending:
            brainCommandPending = false
            brain.fail(error.message)
        case .error(let error) where error.stage == "settings" && projectCommandPending:
            projectCommandPending = false
            projectError = error.message
        case .error(let error) where error.stage == "settings":
            pendingModel = nil
            refreshingModels = false
            modelError = error.message
        default:
            break
        }
    }
}
