import Observation
import ZenoIslandCore

/// Everything the island's views show, and the actions they can take. Owned by `IslandController`.
@MainActor @Observable
final class IslandModel {
    /// Conversation and Settings (ADR-084: the Status tab became Settings' "now" card).
    typealias Tab = PanelTab
    typealias SettingsPage = ZenoIslandCore.SettingsPage

    var status = IslandStatus()
    /// What ZENO is waiting for the user to allow (ADR-054).
    var approval = ApprovalState()
    /// The place ZENO is showing the user, if any (ADR-054).
    var pointing = PointingState()
    /// The strip above the Dock while ZENO works on the Mac (ADR-056). Written by the controller, which knows the time.
    var work = WorkStripState()
    var meter = LevelMeter(bars: 14)
    var conversation = Conversation()
    /// The model in use and the choices, from the runtime's `info` event.
    var modelInfo: ModelInfo?
    /// A model switch sent to the runtime and not yet confirmed (model id).
    var pendingModel: String?
    /// Why the last model switch was refused, shown under the model list until the next attempt.
    var modelError: String?
    /// What ZENO keeps (ADR-058). Nil until the Memory page first asks the runtime.
    var memory: MemoryList?
    /// What ZENO can do (ADR-076), from the runtime's `capabilities` event. Nil until it arrives: only the shortcuts show.
    var capabilities: [CapabilityItem]?
    /// Claude plan usage (ADR-076), merged from `plan.usage` events. Nil until one arrives: no meters.
    var planUsage: PlanUsage?
    /// The ZENO window's content (ADR-081): helpers, their jobs, the report being read.
    var helpers = HelpersState()
    /// The ZENO window is open: a restarted runtime is asked for the list again.
    var helpersWindowOpen = false

    var expanded = false {
        didSet { if expanded && !oldValue { settingsCascaded = false } } // each opening cascades Settings once
    }
    /// Settings home has already cascaded in since the panel opened (ADR-084).
    @ObservationIgnored var settingsCascaded = false
    /// The panel is fading out after being closed: it still draws the expanded view until it is gone.
    var closing = false
    /// The panel's content at full size (ADR-084). False for the moment it opens, so it can grow in from the menu-bar
    /// icon, and while it closes. Set by the controller, inside the open and close animations.
    var presented = true
    /// Where the panel grows from, as a fraction of its width (0 left, 1 right). Set by the controller.
    var openAnchorX = 1.0
    var tab = Tab.conversation
    /// ADR-089: the page the ZENO window shows.
    var windowPage = WindowPage.chat
    /// The Settings page open inside the Settings tab; nil shows the list of pages (ADR-057).
    var settingsPage: SettingsPage?

    /// Draw the expanded view (open, or fading out).
    var showsExpanded: Bool { expanded || closing }

    let settings: IslandSettings
    let recorder: ShortcutRecorder
    /// Open ZENO at login (General). Read from macOS, never saved by ZENO.
    let loginItem = LoginItem()
    /// The permissions checklist (ADR-075). Read from macOS, never saved by ZENO.
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
    /// Opens or closes the expanded view. Set by the controller.
    @ObservationIgnored var setExpanded: (Bool) -> Void = { _ in }
    /// The work strip's Stop button: the same as Esc. Set by the controller.
    @ObservationIgnored var stopWork: () -> Void = {}
    /// An error card's button (ADR-075). Set by the controller.
    @ObservationIgnored var perform: (FailureAction) -> Void = { _ in }
    /// A permission row's button: asks macOS (only for one never asked, on the user's click) or opens its pane.
    @ObservationIgnored var permissionButton: (PermissionRow) -> Void = { _ in }
    /// Settings → General → Replay the tour. Set by the controller.
    @ObservationIgnored var replayTour: () -> Void = {}
    /// Opens the ZENO window (ADR-081). Set by the controller.
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

    /// The user clicked Allow or Decline on the approval card.
    func answerApproval(_ approved: Bool) {
        guard let command = approval.answer(approved: approved) else { return }
        send(command)
    }

    /// Opens Settings → What can I ask? (the link under the empty conversation).
    func showExamples() {
        tab = .settings
        settingsPage = .examples
    }

    func newConversation() {
        send(.conversationReset)
    }

    /// The Memory page opened: ask for the list. From then on the runtime also sends its changes.
    func loadMemory() { send(.memoryList) }
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

    /// Sends what a ZENO window action produced, if anything.
    func sendHelpers(_ command: IslandCommand?) {
        if let command { send(command) }
    }

    /// A typed request from the Conversation tab. Ignored when empty or too long for the runtime.
    func ask(_ text: String) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.count <= 4000 else { return }
        send(.textSend(clean))
    }

    /// Keeps the conversation and model list in step with the runtime. The status is applied by the controller.
    func apply(_ event: IslandEvent) {
        let helperRefusal = helpers.claims(event)
        helpers.apply(event)
        if let refresh = helpers.takeRefresh() { send(refresh) } // the open task changed: ask for its thread again
        if helperRefusal { return } // a refused helper command is shown in the ZENO window only
        conversation.apply(event)
        approval.apply(event)
        pointing.apply(event)
        switch event {
        case .memory(let list):
            memory = list
        case .capabilities(let items):
            capabilities = items
        case .planUsage(let usage):
            planUsage = (planUsage ?? PlanUsage()).merging(usage)
        case .ready:
            if memory != nil { send(.memoryList) } // a restarted runtime: ask again so updates keep coming
            send(.helpersList) // Task 3.15: busy workers show on the island too, so the list is always kept
        case .info(let info):
            modelInfo = info
            pendingModel = nil
            modelError = nil
        case .error(let error) where error.stage == "settings":
            pendingModel = nil
            modelError = error.message
        default:
            break
        }
    }
}

/// ADR-089: the ZENO window's pages: the conversation, the board and the team, and Settings.
enum WindowPage: Equatable {
    case overview, chat, inbox, issues, agents, settings
}
