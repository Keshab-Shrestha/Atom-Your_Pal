import Foundation
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
    var workspace = ProjectWorkspaceState()
    let workspaceBrowser = WorkspaceBrowserSession()
    var chatControls = ChatControlsState()
    var recovery = ForegroundRecoveryState()
    var dispatchedInputIDs = Set<String>()
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
    /// Remembering by itself (upgrades.md C2): facts waiting for Accept.
    var suggestions = SuggestionsState()
    /// Daily brief (upgrades.md C3): the settings and the newest briefs.
    var dailyBrief = DailyBriefState()
    /// Ask ATOM (upgrades.md B3): the answers to edit requests, by request id. A view that asked takes its answer with `takeEditAnswer`.
    var editAnswers: [String: EditAnswer] = [:]
    @ObservationIgnored private var briefPending = false
    @ObservationIgnored private var suggestionPending = false
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
    private(set) var projectCommandPending = false
    private(set) var projectCommandTarget: String?
    var projectSettingsProject: ProjectInfo?
    var showsProjectSources = false
    var projectSource = ProjectSourceState()
    var canCreateProject: Bool { inputRuntimeReady && chats?.projects != nil }
    var sidebarProjectFilter: String? {
        guard chats?.projects != nil else { return nil }
        return settings.projectFilter
    }
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
    /// ADR-141: the panel and window share one composer per chat, persisted on every edit.
    private(set) var input = ChatInput()
    var inputNotice: String?
    @ObservationIgnored private var inputStore: ChatInputStore?
    @ObservationIgnored private var inputRuntimeReady = false
    private var inputChat: String { chats?.current ?? "" }
    var composerText: String {
        get { input.entry(for: inputChat).text }
        set { var entry = input.entry(for: inputChat); entry.text = newValue; input.set(entry, for: inputChat); saveInput() }
    }
    var composerFiles: ComposerDraft {
        get { input.entry(for: inputChat).files }
        set { var entry = input.entry(for: inputChat); entry.files = newValue; input.set(entry, for: inputChat); saveInput() }
    }
    var heldInputs: [QueuedMessage] {
        let live = Set(queue.messages.map(\.id)).union(dispatchedInputIDs)
        return input.entry(for: inputChat).waiting.filter { !live.contains($0.id) }
    }
    var otherInputChats: [String] { input.entries.keys.filter { $0 != inputChat }.sorted() }
    var composerEmpty: Bool { composerText.isEmpty && composerFiles.isEmpty }
    var composerFocusTick = 0

    /// Other paste routes still receive a visible review step before composer submission.
    @discardableResult
    func cleanComposerForReview() -> Bool {
        guard chats?.currentReadOnlyNotice == nil else { return false }
        let result = HiddenCharacters.strip(composerText)
        guard result.removed > 0 else { return false }
        composerText = result.text
        composerFiles.refuse("Removed \(result.removed) hidden controls. Review the message, then send again.")
        return true
    }

    /// Reads the current turn at invocation, so an old chat's control cannot quote into a new chat.
    func quoteReply(_ id: Int) {
        guard chats?.currentReadOnlyNotice == nil,
              let turn = conversation.turns.first(where: { $0.id == id }), !turn.isStreaming,
              let reply = turn.reply else { return }
        guard let text = ComposerQuote.appending(reply, to: composerText) else {
            composerFiles.refuse("The quote will not fit. Shorten the draft or copy a smaller excerpt.")
            return
        }
        composerText = text
        composerFocusTick += 1
    }

    @discardableResult
    func saveInput() -> Bool {
        guard let inputStore else { return false }
        do { try inputStore.save(input); inputNotice = nil; return true }
        catch { inputNotice = "Input could not be saved. Keep ATOM open and free disk space. Nothing new will be sent without a saved local copy."; return false }
    }

    /// Existing chats open in their own context. Orphaned/new-chat input moves only on this explicit click into an empty box.
    func openSavedInput(_ id: String) {
        if chats?.chats.contains(where: { $0.id == id }) == true { send(.chatOpen(id: id)); return }
        guard chats?.currentReadOnlyNotice == nil, composerEmpty, queue.next == nil, heldInputs.isEmpty else { return }
        input.move(from: id, to: inputChat)
        saveInput()
    }

    func savedInputTitle(_ id: String) -> String {
        if let chat = chats?.chats.first(where: { $0.id == id }) { return chat.title }
        let entry = input.entry(for: id)
        let text = entry.text.isEmpty ? entry.waiting.first?.text ?? "" : entry.text
        return "Unfinished chat: " + (text.isEmpty ? "Attachments" : String(text.prefix(45)))
    }

    func canOpenSavedInput(_ id: String) -> Bool {
        chats?.chats.contains(where: { $0.id == id }) == true
            || (chats?.currentReadOnlyNotice == nil && composerEmpty && queue.next == nil && heldInputs.isEmpty)
    }
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
    /// The row the arrow keys chose in the search results (upgrades.md C1).
    var searchCursor = SearchCursor()
    /// ADR-128: ⌘F with the sidebar hidden shows it first; the field focuses itself when it appears.
    var searchFocusPending = false

    /// ADR-152: transient literal search of loaded turns, separate from global/sidebar search.
    var chatFindShown = false
    var chatFindQuery = ""
    var chatFindSelection = 0
    var chatFindFocusTick = 0
    var chatFindScrollTick = 0

    func openChatFind() {
        chatFindShown = true
        chatFindFocusTick += 1
        chatFindScrollTick += 1
    }

    func setChatFindQuery(_ query: String) {
        chatFindQuery = query
        chatFindSelection = 0
        chatFindScrollTick += 1
    }

    func moveChatFind(_ direction: Int) {
        let count = ChatFind.search(conversation.turns, query: chatFindQuery).matches.count
        guard count > 0 else { return }
        chatFindSelection = (min(chatFindSelection, count - 1) + direction + count) % count
        chatFindScrollTick += 1
    }

    private func resetChatFind() {
        chatFindShown = false; chatFindQuery = ""; chatFindSelection = 0
    }

    /// ADR-128: hide or show the window's left panel (⌥⌘H, the View menu, the button).
    func toggleSidebar() { settings.sidebarHidden.toggle() }

    /// ⌘F: focus the sidebar's search, showing the sidebar first when it is hidden.
    func focusSearch() {
        if settings.sidebarHidden {
            searchFocusPending = true
            settings.sidebarHidden = false
        } else {
            searchFocusTick += 1
        }
    }
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

    /// Carries a command to the runtime. Set by the app.
    @ObservationIgnored var transport: (IslandCommand) -> Void = { _ in }

    /// Sends a command to the runtime. ADR-127: a stop, or leaving the chat, settles a waiting message first.
    func send(_ command: IslandCommand) {
        if command == .talkCancel {
            queue.stopped()
            queue.takeAll() // Stop holds every unsent entry immediately, without waiting for a later idle
        }
        queue.sending(command) // pending copies remain in their own chat for review
        if case .chatDelete(let id) = command {
            input.remove(id); saveInput()
            recovery.record = nil; recovery.reading = nil
            recovery.attempts.removeAll { $0.chat == id }
        }
        transport(command)
        if case .chatDelete = command { refreshForegroundRecovery() }
    }

    // MARK: ADR-127: a message typed while ATOM answers

    /// The message waiting for the answer to end, and whether a turn is running.
    private(set) var queue = MessageQueue()
    /// Gallery fixtures and ordinary submissions use the same bounded FIFO.
    func queueMessage(_ text: String, draft: ComposerDraft) {
        var entry = input.entry(for: inputChat)
        guard entry.waiting.count < MessageQueue.limit,
              let message = queue.add(text: text, files: draft, chat: inputChat) else { return }
        entry.waiting.append(message)
        input.set(entry, for: inputChat)
        saveInput()
    }

    /// Return appends one message while busy; Command-Return appends then sends the oldest live entry now.
    /// An empty Command-Return can send the existing head without adding anything.
    func submitComposer(now: Bool) {
        guard chatControls.mutation == nil else { composerFiles.refuse("Wait for the chat change to be confirmed before sending."); return }
        guard inputRuntimeReady else {
            composerFiles.refuse("ATOM is starting or restarting. Your message stays here; send it when Ready.")
            return
        }
        guard chats?.currentReadOnlyNotice == nil else { return }
        if cleanComposerForReview() { return }
        let text = composerText
        let files = composerFiles
        if let why = inputRefusal(text, files: files) { composerFiles.refuse(why); return }
        guard files.command(text: text) != nil else {
            if now { sendQueuedNow() }
            return
        }
        var entry = input.entry(for: inputChat)
        if queue.running || !queue.messages.isEmpty {
            guard entry.waiting.count < MessageQueue.limit,
                  let message = queue.add(text: text, files: files, chat: inputChat) else {
                composerFiles.refuse("A chat holds \(MessageQueue.limit) unsent messages. Send, edit or remove one before queuing more.")
                return
            }
            entry.waiting.append(message)
            entry.text = ""
            entry.files.clear()
            input.set(entry, for: inputChat)
            saveInput()
            if now { sendQueuedNow() }
        } else {
            guard entry.waiting.count < MessageQueue.limit else { composerFiles.refuse("Review held input before sending more."); return }
            let message = QueuedMessage(text: text, files: files, chat: inputChat)
            entry.waiting.append(message)
            entry.text = ""
            entry.files.clear()
            input.set(entry, for: inputChat)
            guard saveInput() else { return }
            if ask(text, draft: files, deliveryID: message.id) { queue.didDispatch() }
        }
    }

    private func inputRefusal(_ text: String, files: ComposerDraft) -> String? {
        if let why = ComposerDraft.refusal(forText: text) { return why }
        if files.files.contains(where: { !FileManager.default.fileExists(atPath: $0.path) }) {
            return "An attached file is missing. Remove it or attach it again before sending."
        }
        return nil
    }

    func sendQueuedNow() {
        guard inputRuntimeReady, !queue.awaitingStart, let message = queue.take() else { return }
        sendQueued(message)
    }

    /// Editing one entry never merges it with a draft or consumes another queue item.
    func editWaitingInput(_ id: String) {
        guard !recovery.syncPending, composerEmpty, chats?.currentReadOnlyNotice == nil else { return }
        var entry = input.entry(for: inputChat)
        guard let message = entry.waiting.first(where: { $0.id == id }) else { return }
        _ = queue.take(id: id)
        entry.text = message.text
        entry.files = message.files
        entry.waiting.removeAll { $0.id == id }
        input.set(entry, for: inputChat)
        saveInput()
    }

    func discardWaitingInput(_ id: String) {
        _ = queue.take(id: id)
        var entry = input.entry(for: inputChat)
        entry.waiting.removeAll { $0.id == id }
        input.set(entry, for: inputChat)
        saveInput()
    }

    private func sendQueued(_ message: QueuedMessage) {
        guard inputRuntimeReady, message.chat == inputChat, chats?.currentReadOnlyNotice == nil else {
            queue.takeAll()
            return // all persisted entries remain held in their source chat
        }
        if let why = inputRefusal(message.text, files: message.files) {
            queue.takeAll()
            composerFiles.refuse(why)
            return
        }
        if ask(message.text, draft: message.files, deliveryID: message.id) { queue.didDispatch() }
    }

    private func settleQueue(_ event: IslandEvent) {
        switch event {
        case .state(let state):
            switch queue.turn(state, chat: chats?.current) {
            case .none, .backToBox: break // persisted entries are held automatically when absent from the live queue
            case .send(let message): sendQueued(message)
            }
        case .error(let error) where error.stage != "settings" || queue.awaitingStart:
            dispatchedInputIDs = []
            queue.failed()
            queue.takeAll() // includes refused attachments before a turn starts; no later idle may send the tail
        default: break
        }
    }
    /// A command was not sent because the runtime is not running: tell the user, and stop any "waiting" that expected its answer.
    func droppedCommandError(for command: IslandCommand) -> RuntimeError? {
        if case .projectCreate(let request) = command { projectSource.expire(request.request); return nil }
        if case .projectCreateCancel(let id) = command { projectSource.expire(id); return nil }
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
        projectSource.stopped()
        workspaceBrowser.reset()
        dispatchedInputIDs = []
        recovery.syncPending = false
        conversation.interruptWork()
        inputRuntimeReady = false
        queue = MessageQueue() // all unsent copies remain held in the snapshot
        helpers.runtimeStopped()
        skillCommandPending = false
        brainCommandPending = false
        projectCommandPending = false
        pendingModel = nil
        refreshingModels = false
        // Not the Computer-switch timer: a restart passes through "stopped" on its way, and cancelling it here left the switch disabled for good
        // when the new runtime hung before `ready` (code check, 2026-10-16). Only `ready` or a newer toggle ends that timer.
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

    init(settings: IslandSettings, inputURL: URL? = nil) {
        self.settings = settings
        recorder = ShortcutRecorder(settings: settings)
        workspace.tab = settings.workspaceSurface
        if let inputURL {
            let store = ChatInputStore(url: inputURL)
            do { input = try store.load(); inputStore = store }
            catch { inputNotice = "Saved input could not be opened. The file is unchanged; new drafts will not be saved this launch. See Library/Application Support/ATOM/ChatInput/input.json." }
        }
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

    func chooseChatAccess(chat: String, mode: ChatAccessMode, expected: ChatAccessMode) {
        guard chats?.current == chat, chats?.access == expected, chats?.currentReadOnlyNotice == nil,
              !status.isBusy, !queue.running else { return }
        modelError = nil
        send(.chatAccess(id: chat, mode: mode, expected: expected))
    }

    func chooseChatReasoning(chat: String, choice: ChatReasoning, effort: String) {
        guard chats?.current == chat, chats?.reasoning == choice, chats?.currentReadOnlyNotice == nil,
              !status.isBusy, !queue.running, effort.isEmpty || choice.levels.contains(effort) else { return }
        modelError = nil
        send(.chatReasoning(id: chat, provider: choice.provider, model: choice.model, effort: effort))
    }

    /// The user clicked Allow or Decline on the approval card.
    func answerApproval(_ approved: Bool, rememberFile: Bool = false) {
        guard let command = approval.answer(approved: approved, rememberFile: rememberFile) else { return }
        send(command)
    }

    func openFileReview() {
        navigate {
            self.windowPage = .agents
            self.helpers.selectBoard()
            self.boardView = .needsYou
            self.setExpanded(true)
        }
    }

    /// Captured request/token, so an old rendered button cannot answer a newer approval.
    func answerFileReview(id: String, token: String, approved: Bool) {
        guard approval.pending?.id == id, approval.pending?.fileReview?.token == token,
              let command = approval.answer(approved: approved, reviewToken: token) else { return }
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

    @discardableResult
    func answerChatQuestion(work: ChatWorkSnapshot, question: ChatWorkSnapshot.Question, text: String?) -> Bool {
        guard chats?.current == work.chat,
              let current = conversation.turns.last?.work, current.turn == work.turn, current.state == "working",
              current.questions.contains(where: { $0.id == question.id && $0.state == "pending" }),
              text.map({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) ?? true else { return false }
        if let text {
            var entry = input.entry(for: work.chat)
            entry.questionAnswers.removeAll { $0.id == question.id }
            guard entry.questionAnswers.count < 20 else { recovery.notice = "Review saved question answers in Recovery before sending more."; return false }
            entry.questionAnswers.append(PendingQuestionAnswer(id: question.id, turn: work.turn, chat: work.chat, question: question.prompt, answer: text.trimmingCharacters(in: .whitespacesAndNewlines)))
            input.set(entry, for: work.chat)
            guard saveInput() else { recovery.notice = "The answer could not be saved locally and was not sent. Free storage and try again."; return false }
        }
        send(.chatQuestionAnswer(chat: work.chat, turn: work.turn, id: question.id, text: text))
        return true
    }

    /// ADR-107: a new chat inside a project.
    func newChat(inProject id: String) { send(.chatNew(projectId: id)) }

    /// ADR-107: a project command; a refusal arrives as an `error` with stage `settings` and shows under "Projects".
    func sendProject(_ command: IslandCommand) {
        projectError = nil
        projectCommandPending = true
        switch command {
        case .projectRename(let id, _), .projectRemove(let id, _), .projectArchive(let id, _),
             .projectModel(let id, _, _), .projectWeb(let id, _): projectCommandTarget = id
        default: projectCommandTarget = nil
        }
        send(command)
        if case .projectRemove = command {
            recovery.record = nil; recovery.reading = nil
            refreshForegroundRecovery()
        }
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

    /// The chat shows the "Remember?" rows: ask for the suggestions once; the runtime then sends its changes.
    /// The window shows the brief: ask once; the runtime then sends its changes.
    func loadBrief() { if let command = dailyBrief.open() { send(command) } }
    /// Ask ATOM: sends an edit request; the answer arrives in `editAnswers[id]`.
    func askAtom(id: String, request: EditRequest) {
        editAnswers[id] = nil
        send(.textEdit(id: id, request: request))
    }
    func cancelAskAtom(id: String) {
        editAnswers[id] = nil
        send(.textEditCancel(id: id))
    }
    func takeEditAnswer(_ id: String) -> EditAnswer? { editAnswers.removeValue(forKey: id) }

    /// "Brief me": makes one now.
    func briefMe() {
        guard let command = dailyBrief.runNow() else { return }
        briefPending = true
        send(command)
    }
    func setBrief(_ change: BriefSettingsChange) {
        briefPending = true
        send(dailyBrief.set(change))
    }

    func loadSuggestions() { if let command = suggestions.open() { send(command) } }
    func acceptSuggestion(_ id: Int) { suggestionCommand(suggestions.accept(id)) }
    func denySuggestion(_ id: Int) { suggestionCommand(suggestions.deny(id)) }
    func acceptSuggestionEdit() { suggestionCommand(suggestions.acceptEdit()) }
    func setSuggestionsEnabled(_ on: Bool) { send(suggestions.setEnabled(on)) }
    private func suggestionCommand(_ command: IslandCommand?) {
        guard let command else { return }
        suggestionPending = true
        send(command)
    }

    /// The second brain's page opened: ask for the graph. From then on the runtime also sends its changes.
    func openBrain() { send(brain.open()) }
    /// ADR-126: "@" in the chat box lists notes; the graph is asked for once, then kept up to date.
    func loadNotesForMentions() { if !brain.opened { openBrain() } }
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

    /// The complete words as sent, with surrounding whitespace removed.
    var searchQuery: String { searchText.trimmingCharacters(in: .whitespacesAndNewlines) }

    func clearSearch() {
        searchText = ""
        searchResults = nil
        searchCursor.reset()
    }

    /// ↓ or ↑ in the search field: choose the next or the previous row.
    func moveSearchCursor(_ delta: Int) {
        searchCursor.move(delta, count: searchResults?.entries.count ?? 0)
    }

    /// Return in the search field: open the chosen row; with none chosen, search now.
    func submitSearch() {
        if let entry = searchCursor.entry(in: searchResults?.entries ?? []) { openSearchEntry(entry) } else { runSearch() }
    }

    /// ADR-106: the current turn was typed. A typed turn never opens the microphone afterwards.
    var typedTurn = false

    /// A typed request from the Conversation tab. Ignored when empty or too long for the runtime.
    @discardableResult
    func ask(_ text: String, draft: ComposerDraft = ComposerDraft(), spoken: Bool = false, deliveryID: String? = nil) -> Bool {
        // A spoken question (the local Talk path) is not a typed turn: ATOM may listen for an answer to its follow-up (ADR-067). It used to be
        // marked as typed, so follow-up listening never began for a voice question (code check, 2026-10-16).
        typedTurn = !spoken
        guard inputRuntimeReady, chats?.currentReadOnlyNotice == nil, draft.command(text: text) != nil else { return false }
        let id = deliveryID ?? UUID().uuidString
        var entry = input.entry(for: inputChat)
        if !entry.waiting.contains(where: { $0.id == id }) {
            guard entry.waiting.count < MessageQueue.limit else { recovery.notice = "Review held input before sending more."; return false }
            entry.waiting.append(QueuedMessage(text: text, files: draft, chat: inputChat, id: id))
            input.set(entry, for: inputChat)
        }
        guard saveInput() else { recovery.notice = "The request was not sent because its local copy could not be saved."; return false }
        dispatchedInputIDs.insert(id)
        send(.textSendAttempt(text: text.trimmingCharacters(in: .whitespacesAndNewlines), files: draft.files.map(\.path), notes: draft.notes.map(\.id), chat: inputChat, request: id))
        return true
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
        settleQueue(event)
        approval.apply(event)
        pointing.apply(event)
        switch event {
        case .projectCreated(let response):
            let matches = projectSource.pending?.request == response.request
            projectSource.accept(response)
            if matches, response.ok, let id = response.project, chats?.projects?.contains(where: { $0.id == id }) == true {
                settings.projectFilter = id
            }
        case .workspace(let result):
            workspace.accept(result, chat: chats?.current, project: chats?.currentProjectId)
        case .foregroundReceipt(let receipt):
            confirmForegroundInput(ids: [receipt.id], answers: [])
            if receipt.archived && receipt.state == "completed" {
                send(.foregroundAck(id: receipt.id)); refreshForegroundRecovery()
            }
            else if !["prepared", "running"].contains(receipt.state) { refreshForegroundRecovery() }
        case .foregroundRecovery(let response):
            acceptForegroundRecovery(response)
        case .chatWork(let work):
            let accepted = work.questions.filter { q in q.state == "answered" && unconfirmedAnswers.contains(where: { $0.id == q.id && $0.answer == q.answer }) }.map(\.id)
            confirmForegroundInput(ids: [], answers: accepted)
        case .chatControl(let response):
            acceptChatControl(response)
        case .chats(let list):
            if ProjectWorkspaceState.identity(chats) != ProjectWorkspaceState.identity(list) { workspace.clear(); workspaceBrowser.reset() }
            if chats?.current != list.current { resetChatControlReading() }
            if list.currentReadOnlyNotice != nil { queue.takeAll() }
            if chats?.current != list.current { resetChatFind() }
            if chats?.current != list.current { queue.takeAll() }
            if (chats == nil || chats?.current == ""), !list.current.isEmpty {
                input.move(from: "", to: list.current)
            }
            chats = list
            settings.projectFilter = ProjectSidebarScope.resolved(settings.projectFilter, projects: list.projects)
            inputRuntimeReady = true
            saveInput()
            projectCommandPending = false
            projectError = nil
            syncChatModelName()
        case .chatOpened(let id, _, _, let trimmed):
            if chats?.current != id { workspaceBrowser.reset() }
            resetChatControlReading()
            resetChatFind()
            trimmedChatId = trimmed ? id : nil
        case .conversationReset:
            workspace.clear(); workspaceBrowser.reset()
            resetChatControlReading()
            resetChatFind()
            trimmedChatId = nil
        case .api(let status):
            apiStatus = status
        case .searchResults(let results) where results.query == searchQuery:
            searchResults = results // an answer to older words is dropped
            searchCursor.reset()
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
        case .textEditResult(let id, let answer):
            editAnswers[id] = answer
        case .brief(let list):
            briefPending = false
            dailyBrief.apply(list)
        case .suggestions(let list):
            suggestionPending = false
            suggestions.apply(list)
        case .capabilities(let items):
            capabilities = items
        case .planUsage(let usage):
            planUsage = (planUsage ?? PlanUsage()).merging(usage)
        case .ready(let ready):
            projectSource.stopped()
            workspace.clear(); workspaceBrowser.reset()
            resetChatControlReading()
            if chatControls.mutation != nil {
                chatControls.waitingExpired = true
                chatControls.notice = "ATOM restarted before the chat change was confirmed. Check its result before trying again."
            }
            queue = MessageQueue() // a restarted runtime never resumes the persisted queue
            inputRuntimeReady = false // wait for the restarted runtime's current chat before submitting drafts
            telegramConnected = ready.telegram // ADR-098
            computerOn = ready.computer // ADR-054
            computerRestarting = false
            computerTimeout?.cancel()
            send(.telegramSet(push: settings.telegramPush))
            send(.apiSet(on: settings.localApi)) // ADR-098 item 5
            if memory != nil { send(.memoryList) } // a restarted runtime: ask again so updates keep coming
            if suggestions.asked { send(.suggestionsGet) }
            if dailyBrief.asked { send(.briefGet) }
            if brain.opened { send(.brainGet) }
            send(.helpersList) // Task 3.15: busy workers show on the island too, so the list is always kept
            sendSpeech() // ADR-091
            // A restarted runtime, or a window opened before the runtime was ready (its first ask was dropped): ask again.
            send(.chatsList) // ADR-141: input must bind to the runtime's confirmed chat, including after restart
            send(.chatWorkWatch) // ADR-156: only a UI that can render cards opts into waiting for an answer
            refreshForegroundRecovery()
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
        case .error(let error) where error.stage == "settings" && briefPending:
            briefPending = false
            dailyBrief.fail(error.message)
        case .error(let error) where error.stage == "settings" && suggestionPending:
            suggestionPending = false
            suggestions.fail(error.message)
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

extension IslandModel {
    func confirmForegroundInput(ids: [String], answers: [String]) {
        guard !ids.isEmpty || !answers.isEmpty else { return }
        let known = Set(ids.map { $0.lowercased() }), knownAnswers = Set(answers.map { $0.lowercased() })
        dispatchedInputIDs = dispatchedInputIDs.filter { !known.contains($0.lowercased()) }
        for chat in Array(input.entries.keys) {
            var entry = input.entry(for: chat)
            entry.waiting.removeAll { known.contains($0.id.lowercased()) }
            entry.questionAnswers.removeAll { knownAnswers.contains($0.id.lowercased()) }
            input.set(entry, for: chat)
        }
        saveInput()
    }
    func dismissLocalAnswer(_ answer: PendingQuestionAnswer) {
        var entry = input.entry(for: answer.chat)
        entry.questionAnswers.removeAll { $0.id == answer.id }
        input.set(entry, for: answer.chat); saveInput()
    }
}
