// The messages exchanged with the ATOM runtime. Specification: docs/island-protocol.md.
import Foundation

public let supportedProtocolVersion = 1

/// The voice loop's state, as reported by the runtime.
public enum LoopState: String, Sendable, Equatable {
    case idle, listening, transcribing, thinking, speaking
}

/// Commands the island sends to the runtime.
public enum IslandCommand: Sendable, Equatable {
    case talkStart, talkSend, talkCancel, conversationReset, quit
    /// Switch the AI model (ADR-040). Answered with `info`, or an `error` with stage `settings`.
    case modelSet(provider: String, model: String)
    /// ADR-097: ask for the providers' model lists again (answered with `info`).
    case modelRefresh
    /// ADR-097: a chat's own model (`id` "" for the chat in use; provider and model "" for the default again).
    case chatModel(id: String, provider: String, model: String)
    /// The user's answer to an `approval.request` (ADR-054).
    case approvalAnswer(id: String, approved: Bool)
    /// Memory (ADR-058): ask for the list (and its changes from then on), forget one, or forget everything.
    case memoryList, memoryClear
    case memoryForget(id: Int)
    /// Conversation notes (ADR-059): forget one, or all.
    case episodeForget(id: Int)
    case episodeClear
    /// A typed request: answered and spoken like a voice turn.
    case textSend(String)
    /// The user dropped Pal on a window to ask about it (ADR-074): its app, never the window's title.
    case contextWindow(bundleId: String, name: String)
    /// Helpers (ADR-081): ask for the list (and its changes from then on), give a helper its app (`""` for none),
    /// give it a job, stop or forget a job.
    case helpersList
    /// ADR-091: whether ATOM says reports, and timers and updates, aloud.
    case speechSet(reports: Bool, updates: Bool, chime: Bool)
    /// ADR-098: Settings' "Send to Telegram" switch.
    case telegramSet(push: Bool)
    /// ADR-098 item 5: Settings' "Local API" switch. The runtime answers with an `api` event.
    case apiSet(on: Bool)
    /// ADR-093: look for the AI tools on this Mac again.
    case toolsScan
    /// ADR-091: Keshab's chats: list them, continue one, delete one.
    case chatsList
    case chatOpen(id: String)
    case chatDelete(id: String)
    /// ADR-097: keep a chat in memory (summary, sections and exact lines), or remove it from memory.
    case memoryKeepChat(id: String)
    case memoryDropChat(id: String)
    /// ADR-091: ATOM's task branches; push one (Keshab confirmed); a branch's changes.
    case gitList
    case gitPush(repo: String, branch: String)
    case gitDiff(repo: String, branch: String)
    case helperSet(helper: String, app: String)
    case jobAdd(helper: String, task: String, blockedBy: [Int] = [])
    /// ADR-087: change what a queued task waits for; add a note to a task; ask for a task's thread.
    case jobBlock(id: Int, blockedBy: [Int])
    case commentAdd(id: Int, text: String)
    /// ADR-098 item 3: a message to a running task (it reads it at its next step); interrupt its current step.
    case jobSteer(id: Int, text: String)
    case jobInterrupt(id: Int)
    case threadGet(id: Int)
    /// ADR-098: one search over chats, tasks and reports (answered with `search.results`); a task's labels.
    case search(query: String)
    case jobLabelAdd(id: Int, label: String)
    case jobLabelRemove(id: Int, label: String)
    case jobStop(id: Int)
    /// Task 3.6: forget a task's Claude session; an ended task runs again from the start.
    case jobFresh(id: Int)
    /// B3.4: put back the file edits of a task's run (one `path`, or all of them); `force` also restores a file that changed since.
    case jobUndo(id: Int, path: String? = nil, force: Bool = false)
    /// Task 3.8: approve or reject a task's waiting plan; whether a worker's new tasks plan first.
    case planApprove(id: Int)
    case planReject(id: Int)
    case helperPlanFirst(helper: String, on: Bool)
    /// ADR-098: whether a worker's runs get the browser.
    case helperBrowser(helper: String, on: Bool)
    /// Task 3.9: remove a routine.
    case routineDelete(id: Int)
    /// ADR-094: pause or resume a routine; post a task to the team (nil role: anyone) or take one back; a worker's
    /// wake-ups ("off", "15m", "1h", "4h", "1d") and pausing them.
    case routinePause(id: Int, paused: Bool)
    /// ADR-097: Keshab's own schedule from the Scheduled page, new or changed.
    case routineAdd(RoutineDraft)
    case routineUpdate(id: Int, RoutineDraft)
    case teamAdd(task: String, role: String?)
    case teamDelete(id: Int)
    case helperWakeUp(helper: String, every: String)
    case helperWakeUpPause(helper: String, paused: Bool)
    /// Task 3.11: grant a folder to a worker, or take it back.
    case grantAdd(helper: String, path: String)
    /// Task 3.12: the skills chosen for a worker (the whole list).
    case helperSkills(helper: String, skills: [String])
    /// Task 3.13: rate a finished task; answer Tinker's proposal.
    case jobRate(id: Int, good: Bool, comment: String?)
    case proposalAccept(id: Int)
    case proposalReject(id: Int)
    case proposalUndo(id: Int)
    /// ADR-094: ask Tinker for a skill from a done task; answer its skill drafts and skill edits.
    case skillMake(id: Int)
    case skillApprove(id: Int)
    case skillReject(id: Int)
    case skillEditAccept(id: Int)
    case skillEditReject(id: Int)
    case skillEditUndo(id: Int)
    /// B3.5: the skills hub: search, fetch one for review, answer a fetched one, uninstall or check an installed one for an update.
    case skillHubSearch(query: String)
    case skillHubPreview(source: Int, path: String)
    case skillHubApprove(id: Int)
    case skillHubReject(id: Int)
    case skillHubUninstall(name: String, force: Bool = false)
    case skillHubUpdate(name: String)
    /// ADR-098 item 8: save a done task as a test case, delete one, run a proposal's or skill edit's test cases again.
    case testcaseSave(jobId: Int, kind: String, target: String)
    case testcaseDelete(id: Int)
    case testcaseRun(kind: String, id: Int)
    /// Task 3.14: open a task's report in its worker's app.
    case jobOpen(id: Int)
    /// ADR-090: run a failed or stopped task again.
    case jobRetry(id: Int)
    /// ADR-090: Keshab's MCP servers.
    case mcpAdd(McpServerDraft)
    case mcpRemove(id: Int)
    case mcpSet(id: Int, enabled: Bool?, trusted: Bool?, workers: [String]?)
    case mcpTest(id: Int)
    /// ADR-088: add an agent (its soul.md), or remove one Keshab added.
    case agentCreate(name: String, role: String, kit: String, soul: HelperSoul)
    case agentRemove(id: String)
    /// ADR-095: Managers: add one (mode "plan" or "group"), rename it, switch its mode, remove it (refused while it has
    /// Agents); put an Agent under a Manager.
    case managerCreate(name: String, mode: String)
    case managerRename(id: String, name: String)
    case managerMode(id: String, mode: String)
    case managerDelete(id: String)
    case agentManager(helper: String, manager: String)
    case grantRemove(helper: String, path: String)
    case jobDelete(id: Int)
    /// ADR-083: pin a helper to a model (`""` lets Laya choose again); allow or forbid the large model for jobs.
    case helperPin(helper: String, model: String)
    case helpersSettings(allowLarge: Bool)
    /// Task 3.7: a worker's or the team's ("team") daily cap, nil for none; the plan limit in percent.
    case helperBudget(helper: String, cap: Double?)
    case helpersPlanLimit(Int)
    /// ADR-095: "Runs at once", the team-wide limit (1 to 10).
    case helpersMaxRunning(Int)
    /// ADR-098 item 7: "Use Codex when the Claude plan limit is reached" (default off).
    case helpersCodexFallback(Bool)
    /// Task 3.3: save a worker's edited soul as a new version; make an older version current again.
    case soulSet(helper: String, soul: HelperSoul)
    case soulRestore(helper: String, version: Int)
    /// ADR-107: Projects. `project.model` with "" and "" clears the project's own model.
    case projectAdd(name: String, path: String)
    case projectRename(id: String, name: String)
    case projectRemove(id: String, deleteChats: Bool)
    case projectArchive(id: String, archived: Bool)
    case projectModel(id: String, provider: String, model: String)
    case projectWeb(id: String, web: Bool)
    /// A new chat, in a project when `projectId` is set (`conversationReset` is the plain one).
    case chatNew(projectId: String?)
    case chatRename(id: String, title: String)

    /// The command's `type` field. Safe for logs: never includes values.
    public var type: String {
        switch self {
        case .talkStart: "talk.start"
        case .talkSend: "talk.send"
        case .talkCancel: "talk.cancel"
        case .conversationReset: "conversation.reset"
        case .quit: "quit"
        case .modelSet: "model.set"
        case .modelRefresh: "model.refresh"
        case .chatModel: "chat.model"
        case .approvalAnswer: "approval.answer"
        case .memoryList: "memory.list"
        case .memoryClear: "memory.clear"
        case .memoryForget: "memory.forget"
        case .episodeForget: "episode.forget"
        case .episodeClear: "episode.clear"
        case .textSend: "text.send"
        case .contextWindow: "context.window"
        case .helpersList: "helpers.list"
        case .speechSet: "speech.set"
        case .telegramSet: "telegram.set"
        case .apiSet: "api.set"
        case .toolsScan: "tools.scan"
        case .chatsList: "chats.list"
        case .chatOpen: "chat.open"
        case .chatDelete: "chat.delete"
        case .memoryKeepChat: "memory.keepChat"
        case .memoryDropChat: "memory.dropChat"
        case .gitList: "git.list"
        case .gitPush: "git.push"
        case .gitDiff: "git.diff"
        case .helperSet: "helper.set"
        case .jobAdd: "job.add"
        case .jobBlock: "job.block"
        case .commentAdd: "comment.add"
        case .jobSteer: "job.steer"
        case .jobInterrupt: "job.interrupt"
        case .threadGet: "thread.get"
        case .search: "search"
        case .jobLabelAdd: "job.label.add"
        case .jobLabelRemove: "job.label.remove"
        case .jobStop: "job.stop"
        case .jobFresh: "job.fresh"
        case .jobUndo: "job.undo"
        case .planApprove: "plan.approve"
        case .planReject: "plan.reject"
        case .helperPlanFirst: "helper.planFirst"
        case .helperBrowser: "helper.browser"
        case .routineDelete: "routine.delete"
        case .routinePause: "routine.pause"
        case .routineAdd: "routine.add"
        case .routineUpdate: "routine.update"
        case .teamAdd: "team.add"
        case .teamDelete: "team.delete"
        case .helperWakeUp: "helper.wakeUp"
        case .helperWakeUpPause: "helper.wakeUp.pause"
        case .grantAdd: "grant.add"
        case .helperSkills: "helper.skills"
        case .jobRate: "job.rate"
        case .proposalAccept: "proposal.accept"
        case .proposalReject: "proposal.reject"
        case .proposalUndo: "proposal.undo"
        case .skillMake: "skill.make"
        case .skillApprove: "skill.approve"
        case .skillReject: "skill.reject"
        case .skillEditAccept: "skill.edit.accept"
        case .skillEditReject: "skill.edit.reject"
        case .skillEditUndo: "skill.edit.undo"
        case .skillHubSearch: "skill.hub.search"
        case .skillHubPreview: "skill.hub.preview"
        case .skillHubApprove: "skill.hub.approve"
        case .skillHubReject: "skill.hub.reject"
        case .skillHubUninstall: "skill.hub.uninstall"
        case .skillHubUpdate: "skill.hub.update"
        case .testcaseSave: "testcase.save"
        case .testcaseDelete: "testcase.delete"
        case .testcaseRun: "testcase.run"
        case .jobOpen: "job.open"
        case .jobRetry: "job.retry"
        case .mcpAdd: "mcp.add"
        case .mcpRemove: "mcp.remove"
        case .mcpSet: "mcp.set"
        case .mcpTest: "mcp.test"
        case .agentCreate: "agent.create"
        case .agentRemove: "agent.remove"
        case .managerCreate: "manager.create"
        case .managerRename: "manager.rename"
        case .managerMode: "manager.mode"
        case .managerDelete: "manager.delete"
        case .agentManager: "agent.manager"
        case .grantRemove: "grant.remove"
        case .jobDelete: "job.delete"
        case .helperPin: "helper.pin"
        case .helpersSettings, .helpersPlanLimit, .helpersMaxRunning, .helpersCodexFallback: "helpers.settings"
        case .helperBudget: "helper.budget"
        case .soulSet: "soul.set"
        case .soulRestore: "soul.restore"
        case .projectAdd: "project.add"
        case .projectRename: "project.rename"
        case .projectRemove: "project.remove"
        case .projectArchive: "project.archive"
        case .projectModel: "project.model"
        case .projectWeb: "project.web"
        case .chatNew: "chat.new"
        case .chatRename: "chat.rename"
        }
    }

    /// One JSON line, ending with a newline. Values are escaped by JSONSerialization.
    public var line: String {
        var fields: [String: Any] = ["type": type]
        if case .modelSet(let provider, let model) = self {
            fields["provider"] = provider
            fields["model"] = model
        }
        if case .approvalAnswer(let id, let approved) = self {
            fields["id"] = id
            fields["approved"] = approved // a real JSON boolean: the runtime refuses the strings "true" and "yes"
        }
        if case .memoryForget(let id) = self {
            fields["id"] = id // a JSON number: the runtime refuses "2"
        }
        if case .episodeForget(let id) = self {
            fields["id"] = id
        }
        if case .textSend(let text) = self {
            fields["text"] = text
        }
        if case .contextWindow(let bundleId, let name) = self {
            fields["bundleId"] = bundleId
            fields["name"] = name
        }
        switch self {
        case .helperSet(let helper, let app):
            fields["helper"] = helper
            fields["app"] = app
        case .jobAdd(let helper, let task, let blockedBy):
            fields["helper"] = helper
            fields["task"] = task
            if !blockedBy.isEmpty { fields["blockedBy"] = blockedBy }
        case .jobBlock(let id, let blockedBy):
            fields["id"] = id
            fields["blockedBy"] = blockedBy
        case .commentAdd(let id, let text), .jobSteer(let id, let text):
            fields["id"] = id
            fields["text"] = text
        case .search(let query):
            fields["query"] = String(query.prefix(200))
        case .jobLabelAdd(let id, let label), .jobLabelRemove(let id, let label):
            fields["id"] = id
            fields["label"] = label
        case .jobRate(let id, let good, let comment):
            fields["id"] = id
            fields["good"] = good // a real JSON boolean
            if let comment, !comment.isEmpty { fields["comment"] = comment }
        case .agentCreate(let name, let role, let kit, let soul):
            fields["name"] = name
            fields["role"] = role
            fields["kit"] = kit
            fields["personality"] = soul.personality
            fields["howItWorks"] = soul.howItWorks
            fields["rules"] = soul.rules
        case .mcpAdd(let d):
            fields["name"] = d.name
            fields["kind"] = d.kind
            if d.kind == "command" {
                fields["command"] = d.command
                fields["args"] = Self.lines(d.args)
                fields["env"] = Self.lines(d.env)
            } else {
                fields["url"] = d.url
                fields["transport"] = d.transport
                fields["headers"] = Self.lines(d.headers)
            }
        case .chatModel(let id, let provider, let model):
            fields["id"] = id
            fields["provider"] = provider
            fields["model"] = model
        case .chatOpen(let id), .chatDelete(let id), .memoryKeepChat(let id), .memoryDropChat(let id):
            fields["id"] = id
        case .gitPush(let repo, let branch), .gitDiff(let repo, let branch):
            fields["repo"] = repo
            fields["branch"] = branch
        case .telegramSet(let push):
            fields["push"] = push
        case .apiSet(let on):
            fields["on"] = on
        case .speechSet(let reports, let updates, let chime):
            fields["reports"] = reports
            fields["updates"] = updates
            fields["chime"] = chime
        case .mcpSet(let id, let enabled, let trusted, let workers):
            fields["id"] = id
            if let enabled { fields["enabled"] = enabled }
            if let trusted { fields["trusted"] = trusted }
            if let workers { fields["workers"] = workers }
        case .agentRemove(let id), .managerDelete(let id):
            fields["id"] = id
        case .managerCreate(let name, let mode):
            fields["name"] = name
            fields["mode"] = mode
        case .managerRename(let id, let name):
            fields["id"] = id
            fields["name"] = name
        case .managerMode(let id, let mode):
            fields["id"] = id
            fields["mode"] = mode
        case .agentManager(let helper, let manager):
            fields["helper"] = helper
            fields["manager"] = manager
        case .proposalAccept(let id), .proposalReject(let id), .proposalUndo(let id), .jobOpen(let id), .jobRetry(let id), .mcpRemove(let id), .mcpTest(let id),
             .skillMake(let id), .skillApprove(let id), .skillReject(let id), .skillEditAccept(let id), .skillEditReject(let id), .skillEditUndo(let id),
             .skillHubApprove(let id), .skillHubReject(let id):
            fields["id"] = id
        case .skillHubSearch(let query):
            fields["query"] = String(query.prefix(60))
        case .skillHubPreview(let source, let path):
            fields["source"] = source
            fields["path"] = path
        case .skillHubUninstall(let name, let force):
            fields["name"] = name
            if force { fields["force"] = true }
        case .skillHubUpdate(let name):
            fields["name"] = name
        case .helperSkills(let helper, let skills):
            fields["helper"] = helper
            fields["skills"] = skills
        case .testcaseSave(let jobId, let kind, let target):
            fields["jobId"] = jobId
            fields["kind"] = kind
            fields["target"] = target
        case .testcaseDelete(let id):
            fields["id"] = id
        case .testcaseRun(let kind, let id):
            fields["proposalKind"] = kind
            fields["id"] = id
        case .grantAdd(let helper, let path), .grantRemove(let helper, let path):
            fields["helper"] = helper
            fields["path"] = path
        case .helperPlanFirst(let helper, let on), .helperBrowser(let helper, let on):
            fields["helper"] = helper
            fields["on"] = on // a real JSON boolean
        case .jobStop(let id), .jobInterrupt(let id), .jobFresh(let id), .planApprove(let id), .planReject(let id), .routineDelete(let id), .jobDelete(let id), .threadGet(let id), .teamDelete(let id):
            fields["id"] = id // a JSON number
        case .jobUndo(let id, let path, let force):
            fields["id"] = id
            if let path { fields["path"] = path }
            if force { fields["force"] = true } // a real JSON boolean
        case .routinePause(let id, let paused):
            fields["id"] = id
            fields["paused"] = paused // a real JSON boolean
        case .routineAdd(let draft):
            Self.routineFields(draft, into: &fields)
        case .routineUpdate(let id, let draft):
            fields["id"] = id
            Self.routineFields(draft, into: &fields)
        case .teamAdd(let task, let role):
            fields["task"] = task
            if let role, !role.isEmpty { fields["role"] = role }
        case .helperWakeUp(let helper, let every):
            fields["helper"] = helper
            fields["every"] = every
        case .helperWakeUpPause(let helper, let paused):
            fields["helper"] = helper
            fields["paused"] = paused
        case .helperPin(let helper, let model):
            fields["helper"] = helper
            fields["model"] = model
        case .helpersSettings(let allowLarge):
            fields["allowLarge"] = allowLarge // a real JSON boolean
        case .helperBudget(let helper, let cap):
            fields["helper"] = helper
            fields["cap"] = cap.map { $0 as Any } ?? NSNull()
        case .helpersPlanLimit(let percent):
            fields["planLimit"] = percent
        case .helpersMaxRunning(let count):
            fields["maxRunning"] = count
        case .helpersCodexFallback(let on):
            fields["codexFallback"] = on // a real JSON boolean
        case .soulSet(let helper, let soul):
            fields["helper"] = helper
            fields["soul"] = ["name": soul.name, "personality": soul.personality, "howItWorks": soul.howItWorks,
                              "rules": soul.rules, "lessons": soul.lessons]
        case .soulRestore(let helper, let version):
            fields["helper"] = helper
            fields["version"] = version // a JSON number
        case .projectAdd(let name, let path):
            fields["name"] = name
            fields["path"] = path
        case .projectRename(let id, let name):
            fields["id"] = id
            fields["name"] = name
        case .projectRemove(let id, let deleteChats):
            fields["id"] = id
            fields["deleteChats"] = deleteChats // a real JSON boolean
        case .projectArchive(let id, let archived):
            fields["id"] = id
            fields["archived"] = archived
        case .projectModel(let id, let provider, let model):
            fields["id"] = id
            fields["provider"] = provider
            fields["model"] = model
        case .projectWeb(let id, let web):
            fields["id"] = id
            fields["web"] = web
        case .chatNew(let projectId):
            if let projectId { fields["projectId"] = projectId }
        case .chatRename(let id, let title):
            fields["id"] = id
            fields["title"] = title
        default:
            break
        }
        // A dictionary of strings and booleans is always valid JSON, so this cannot fail.
        guard let data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys, .withoutEscapingSlashes]),
              let json = String(data: data, encoding: .utf8)
        else { preconditionFailure("command \(type) could not be encoded") }
        return json + "\n"
    }

    /// ADR-097: a schedule's fields: only the numbers its kind uses, and an hourly one's first time.
    private static func routineFields(_ draft: RoutineDraft, into fields: inout [String: Any]) {
        fields["helper"] = draft.helper
        fields["task"] = draft.task
        fields["kind"] = draft.schedule.kind.rawValue
        switch draft.schedule.kind {
        case .daily:
            fields["minute"] = draft.schedule.minute
        case .weekly:
            fields["minute"] = draft.schedule.minute
            fields["weekday"] = draft.schedule.weekday
        case .hours:
            fields["every"] = draft.schedule.every
            fields["startAt"] = ISO8601DateFormatter().string(from: draft.startAt)
        }
        fields["notifyTelegram"] = draft.notifyTelegram // ADR-098
        fields["webhook"] = draft.webhook // ADR-098 item 5
    }
}

public struct ModelOption: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

public struct ProviderOption: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    /// False when the provider's API key is missing from `.env`.
    public var available: Bool
    public var models: [ModelOption]

    public init(id: String, name: String, available: Bool, models: [ModelOption]) {
        self.id = id
        self.name = name
        self.available = available
        self.models = models
    }
}

/// The model in use and the choices, from the `info` event.
public struct ModelInfo: Sendable, Equatable {
    public var provider: String
    public var model: String
    public var providers: [ProviderOption]
    /// ADR-093: the AI tools found on this Mac.
    public var tools: [AiTool]

    public init(provider: String, model: String, providers: [ProviderOption], tools: [AiTool] = []) {
        self.provider = provider
        self.model = model
        self.providers = providers
        self.tools = tools
    }

    public var currentProvider: ProviderOption? { providers.first { $0.id == provider } }

    /// ADR-097: a model id typed as "Custom model…": 1 to 100 letters, digits, ".", "_", ":" or "-" (as the runtime checks).
    public static func isValidModelId(_ id: String) -> Bool {
        id.count <= 100 && id.range(of: "^[A-Za-z0-9._:-]+$", options: .regularExpression) != nil
    }

    /// ADR-097: a model's name from its provider's list, else the id itself.
    public func modelName(provider: String, model: String) -> String {
        providers.first { $0.id == provider }?.models.first { $0.id == model }?.name ?? model
    }

    /// The model's name from the list, else one derived from its id.
    public var currentModelName: String {
        currentProvider?.models.first { $0.id == model }?.name
            ?? IslandStatus.displayName(provider: provider, model: model)
    }
}

/// One fact ATOM keeps (ADR-058), as listed in Settings. Never written to a log.
public struct MemoryItem: Sendable, Equatable, Identifiable {
    public var id: Int
    public var text: String
    public var createdAt: Date?
    /// "voice" or "text".
    public var source: String

    public init(id: Int, text: String, createdAt: Date?, source: String) {
        self.id = id
        self.text = text
        self.createdAt = createdAt
        self.source = source
    }
}

/// ATOM's note about one past conversation (ADR-059). Never written to a log.
public struct EpisodeItem: Sendable, Equatable, Identifiable {
    public var id: Int
    public var summary: String
    public var endedAt: Date?
    public var exchanges: Int

    public init(id: Int, summary: String, endedAt: Date?, exchanges: Int) {
        self.id = id
        self.summary = summary
        self.endedAt = endedAt
        self.exchanges = exchanges
    }
}

/// What ATOM keeps, from the `memory` event.
public struct MemoryList: Sendable, Equatable {
    /// False when memory is off in the runtime (`ATOM_MEMORY=0`, or the file could not be opened).
    public var enabled: Bool
    public var count: Int
    /// Newest first.
    public var memories: [MemoryItem]
    /// Notes from recent conversations, newest first. Empty from an older runtime.
    public var episodes: [EpisodeItem]
    /// ADR-097: recent chats (newest first), then kept chats no longer in the chat list. Empty from an older runtime.
    public var chats: [MemoryChatItem]

    public init(enabled: Bool, count: Int, memories: [MemoryItem], episodes: [EpisodeItem] = [], chats: [MemoryChatItem] = []) {
        self.enabled = enabled
        self.count = count
        self.memories = memories
        self.episodes = episodes
        self.chats = chats
    }
}

/// ADR-097: a recent or kept chat on the Memory page. Never written to a log.
public struct MemoryChatItem: Sendable, Equatable, Identifiable {
    public var id: String
    public var title: String
    public var updatedAt: Date?
    public var messages: Int
    public var kept: Bool
    /// True while ATOM writes the chat's summary and index.
    public var indexing: Bool
    public var keptAt: Date?

    public init(id: String, title: String, updatedAt: Date?, messages: Int, kept: Bool, indexing: Bool = false, keptAt: Date? = nil) {
        self.id = id
        self.title = title
        self.updatedAt = updatedAt
        self.messages = messages
        self.kept = kept
        self.indexing = indexing
        self.keptAt = keptAt
    }
}

/// One thing ATOM can do, with phrases to try (ADR-076), from the `capabilities` event. Only tools that are on are listed.
public struct CapabilityItem: Sendable, Equatable {
    public var title: String
    public var examples: [String]

    public init(title: String, examples: [String]) {
        self.title = title
        self.examples = examples
    }

    /// For the empty conversation: the first example of each capability, up to `limit`, so they show variety.
    public static func firstExamples(_ items: [CapabilityItem], limit: Int = 4) -> [String] {
        Array(items.compactMap(\.examples.first).prefix(limit))
    }
}

/// How much of the Claude plan is used (ADR-076), from the `plan.usage` event. Fractions: 0.42 is 42%.
/// Every field is optional: an event may report one window only.
public struct PlanUsage: Sendable, Equatable {
    public var fiveHour: Double?
    public var sevenDay: Double?
    public var overage: Bool?

    public init(fiveHour: Double? = nil, sevenDay: Double? = nil, overage: Bool? = nil) {
        self.fiveHour = fiveHour
        self.sevenDay = sevenDay
        self.overage = overage
    }

    /// Values outside this range are ignored, as in Coucou.
    public static let validRange = 0.0...2.0

    /// Nothing usable arrived: the meters stay hidden.
    public var isEmpty: Bool { fiveHour == nil && sevenDay == nil }

    /// A newer report: its fields replace these, fields it does not carry are kept.
    public func merging(_ newer: PlanUsage) -> PlanUsage {
        PlanUsage(fiveHour: newer.fiveHour ?? fiveHour, sevenDay: newer.sevenDay ?? sevenDay, overage: newer.overage ?? overage)
    }

    public enum Level: Sendable, Equatable { case normal, attention, problem }

    /// The meter's colour: attention from 80%, problem from 95%.
    public static func level(_ fraction: Double) -> Level {
        fraction >= 0.95 ? .problem : fraction >= 0.8 ? .attention : .normal
    }

    /// What the meter shows, held to 0–100%.
    public static func percent(_ fraction: Double) -> Int { Int((min(max(fraction, 0), 1) * 100).rounded()) }
}

public struct ReadyInfo: Sendable, Equatable {
    public var protocolVersion: Int
    public var provider: String
    public var model: String
    public var microphone: String
    /// False if the voice failed to load; replies still arrive as text.
    public var voice: Bool
    /// ADR-098: ATOM's Telegram bot is set up in .env (false from an older runtime).
    public var telegram: Bool = false
}

/// ADR-098 item 5: the local API's state. `tokenFile` is a path; the island reads the file only for "Copy token".
public struct ApiStatus: Sendable, Equatable {
    public var on: Bool
    public var port: Int
    public var tokenFile: String
    public var error: String?

    public init(on: Bool, port: Int, tokenFile: String, error: String? = nil) {
        self.on = on
        self.port = port
        self.tokenFile = tokenFile
        self.error = error
    }
}

public struct TurnTimings: Sendable, Equatable {
    public var speechMs: Int
    public var transcriptionMs: Int
    public var modelMs: Int
    public var firstSoundMs: Int?
}

/// Something ATOM will not do until the user says yes (ADR-054). Wording comes from the runtime and carries
/// the app and the action, never typed text or screen content.
public struct ApprovalRequest: Sendable, Equatable {
    public var id: String
    /// What ATOM is about to do, e.g. `Click "Send" in Mail`.
    public var summary: String
    /// Why it asks.
    public var reason: String

    public init(id: String, summary: String, reason: String) {
        self.id = id
        self.summary = summary
        self.reason = reason
    }
}

public struct RuntimeError: Sendable, Equatable {
    /// microphone, transcription, model, speech, config, protocol, settings or runtime.
    public var stage: String
    /// Plain language, free of credentials.
    public var message: String
    public var kind: String?
}

/// Events the runtime sends to the island.
public enum IslandEvent: Sendable, Equatable {
    case ready(ReadyInfo)
    case state(LoopState)
    case micReady
    case micLevel(Double)
    case micSilent(microphone: String)
    case transcript(String)
    case reply(String)
    case turnComplete(TurnTimings)
    case notice(kind: String, message: String)
    case conversationReset
    /// ATOM is about to do something on the Mac, in plain words (ADR-054).
    case computerStep(String)
    /// ATOM shows the user a place on screen: Pal flies there and the bubble says what it is (ADR-054).
    case computerPoint(PointTarget)
    /// ATOM is waiting for the user to allow or decline an action.
    case approvalRequest(ApprovalRequest)
    /// That request is no longer waiting: answered, declined, timed out or cancelled.
    case approvalClosed(id: String)
    case info(ModelInfo)
    /// What ATOM keeps (ADR-058): after `memory.list`, and after every change from then on.
    case memory(MemoryList)
    /// A timer ended (ADR-061). The runtime also says `message` aloud.
    case timer(id: Int, label: String, message: String)
    /// Task 3.15: a line from the team, just before ATOM says it.
    case workerLine(String)
    /// The answer to `context.window` (ADR-074): the app was read for the next question, or refused with `message`.
    case contextReady(app: String, ok: Bool, message: String?)
    /// What ATOM can do, once after `ready` (ADR-076).
    case capabilities([CapabilityItem])
    /// Claude plan usage, whenever the plan reports it (ADR-076).
    case planUsage(PlanUsage)
    /// Open the panel on Settings (ADR-071).
    case settingsOpen
    /// Press a system media key once (ADR-071).
    case mediaKey(MediaKey)
    /// Every helper and its recent jobs (ADR-081): after every helper command, and on changes once asked.
    case helpers(HelpersList)
    /// ADR-091: Keshab's chats and the one ATOM is in; a chat opened, with its turns.
    case chats(ChatList)
    case chatOpened(id: String, lines: [ChatLine], projectId: String? = nil, trimmed: Bool = false)
    /// ADR-091: ATOM's task branches; one branch's changes as a patch.
    case git([GitBranch])
    case gitDiff(GitDiff)
    case thread(HelperThread)
    /// ADR-098: the answer to `search`.
    case searchResults(SearchResults)
    /// ADR-098 item 5: the local API's state, after `api.set`.
    case api(ApiStatus)
    case error(RuntimeError)
    /// A newer runtime sent an event this island does not know; ignored for forward compatibility.
    case unknown(type: String)

    /// Event name, for logs and traces. Never includes what was said or replied.
    public var name: String {
        switch self {
        case .ready: "ready"
        case .state(let s): "state:\(s.rawValue)"
        case .micReady: "mic.ready"
        case .micLevel: "mic.level"
        case .micSilent: "mic.silent"
        case .transcript: "transcript"
        case .reply: "reply"
        case .turnComplete: "turn.complete"
        case .notice(let kind, _): "notice:\(kind)"
        case .conversationReset: "conversation.reset"
        case .computerStep: "computer.step"
        case .computerPoint: "computer.point"
        case .approvalRequest: "approval.request"
        case .approvalClosed: "approval.closed"
        case .info: "info"
        case .memory: "memory"
        case .timer: "timer"
        case .workerLine: "worker.line"
        case .contextReady: "context.ready"
        case .capabilities: "capabilities"
        case .planUsage: "plan.usage"
        case .settingsOpen: "settings.open"
        case .mediaKey: "media.key"
        case .helpers: "helpers"
        case .chats: "chats"
        case .git: "git"
        case .gitDiff: "git.diff"
        case .chatOpened: "chat.opened"
        case .thread: "thread"
        case .searchResults: "search.results"
        case .api: "api"
        case .error(let e): "error:\(e.stage)"
        case .unknown(let type): "unknown:\(type)"
        }
    }
}

public enum ProtocolError: Error, Equatable, CustomStringConvertible {
    case notJSON
    case missingType
    case missingField(event: String, field: String)
    case invalidValue(event: String, field: String)

    public var description: String {
        switch self {
        case .notJSON: "not a JSON object"
        case .missingType: "no \"type\""
        case .missingField(let event, let field): "\(event) is missing \"\(field)\""
        case .invalidValue(let event, let field): "\(event) has an invalid \"\(field)\""
        }
    }
}

/// Decodes one line of runtime output into an event.
public func decodeEvent(_ line: String) throws -> IslandEvent {
    guard let data = line.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data),
          let fields = object as? [String: Any]
    else { throw ProtocolError.notJSON }
    guard let type = fields["type"] as? String else { throw ProtocolError.missingType }
    let f = Fields(event: type, values: fields)

    switch type {
    case "ready":
        return .ready(ReadyInfo(
            protocolVersion: try f.int("protocol"),
            provider: try f.string("provider"),
            model: try f.string("model"),
            microphone: try f.string("microphone"),
            voice: try f.bool("voice"),
            telegram: f.optionalBool("telegram") ?? false))
    case "api":
        return .api(ApiStatus(on: try f.bool("on"), port: try f.int("port"), tokenFile: f.optionalString("tokenFile") ?? "", error: f.optionalString("error")))
    case "state":
        let raw = try f.string("state")
        guard let state = LoopState(rawValue: raw) else { throw ProtocolError.invalidValue(event: type, field: "state") }
        return .state(state)
    case "mic.ready":
        return .micReady
    case "mic.level":
        let peak = try f.double("peak")
        return .micLevel(min(max(peak, 0), 1))
    case "mic.silent":
        return .micSilent(microphone: try f.string("microphone"))
    case "transcript":
        return .transcript(try f.string("text"))
    case "reply":
        return .reply(try f.string("text"))
    case "turn.complete":
        return .turnComplete(TurnTimings(
            speechMs: try f.int("speechMs"),
            transcriptionMs: try f.int("transcriptionMs"),
            modelMs: try f.int("modelMs"),
            firstSoundMs: f.optionalInt("firstSoundMs")))
    case "notice":
        return .notice(kind: try f.string("kind"), message: try f.string("message"))
    case "conversation.reset":
        return .conversationReset
    case "computer.step":
        return .computerStep(try f.string("text"))
    case "computer.point":
        let w = try f.double("w"), h = try f.double("h")
        guard w > 0, h > 0 else { throw ProtocolError.invalidValue(event: "computer.point", field: w > 0 ? "h" : "w") }
        return .computerPoint(PointTarget(x: try f.double("x"), y: try f.double("y"), w: w, h: h, label: try f.string("label")))
    case "approval.request":
        return .approvalRequest(ApprovalRequest(id: try f.string("id"), summary: try f.string("summary"), reason: try f.string("reason")))
    case "approval.closed":
        return .approvalClosed(id: try f.string("id"))
    case "info":
        return .info(ModelInfo(
            provider: try f.string("provider"),
            model: try f.string("model"),
            providers: try f.providers(),
            tools: Fields.tools(f.values["tools"])))
    case "worker.line":
        return .workerLine(try f.string("line"))
    case "timer":
        return .timer(id: try f.int("id"), label: (try? f.string("label")) ?? "", message: try f.string("message"))
    case "context.ready":
        return .contextReady(app: try f.string("app"), ok: try f.bool("ok"), message: f.optionalString("message"))
    case "memory":
        return .memory(MemoryList(enabled: try f.bool("enabled"), count: try f.int("count"), memories: try f.memories(), episodes: try f.episodes(), chats: try f.memoryChats()))
    case "capabilities":
        return .capabilities(try f.capabilities())
    case "plan.usage":
        return .planUsage(PlanUsage(fiveHour: f.usageFraction("fiveHour"), sevenDay: f.usageFraction("sevenDay"), overage: f.optionalBool("overage")))
    case "settings.open":
        return .settingsOpen
    case "media.key":
        guard let key = MediaKey(rawValue: try f.string("key")) else { throw ProtocolError.invalidValue(event: type, field: "key") }
        return .mediaKey(key)
    case "git":
        return .git(Fields.branches(f.values["branches"]))
    case "git.diff":
        return .gitDiff(GitDiff(repo: try f.string("repo"), branch: try f.string("branch"), text: try f.string("text"), truncated: f.optionalBool("truncated") ?? false))
    case "chats":
        return .chats(ChatList(chats: Fields.chats(f.values["chats"]), current: f.optionalString("current") ?? "",
                               currentProvider: f.optionalString("currentProvider"), currentModel: f.optionalString("currentModel"),
                               currentProjectId: f.optionalString("currentProjectId"),
                               projects: f.values["projects"] == nil ? nil : Fields.projects(f.values["projects"])))
    case "chat.opened":
        return .chatOpened(id: try f.string("id"), lines: Fields.chatLines(f.values["messages"]),
                           projectId: f.optionalString("projectId"), trimmed: f.values["trimmed"] as? Bool ?? false)
    case "helpers":
        return .helpers(HelpersList(helpers: try f.helpers(), apps: try f.strings("apps"),
                                    allowLarge: try f.optionalStrictBool("allowLarge") ?? true, models: try f.helperModels(),
                                    team: Fields.budget(f.values["team"]), planLimit: (f.values["planLimit"] as? NSNumber)?.intValue,
                                    maxRunning: (f.values["maxRunning"] as? NSNumber)?.intValue,
                                    paperclip: Fields.paperclip(f.values["paperclip"]),
                                    mcp: Fields.mcp(f.values["mcp"]),
                                    usage: Fields.usage(f.values["usage"]),
                                    skills: (f.values["skills"] as? [Any] ?? []).compactMap { entry in
                                        guard let s = entry as? [String: Any], let name = s["name"] as? String else { return nil }
                                        return SkillInfo(name: name, description: s["description"] as? String ?? "", source: s["source"] as? String ?? "yours")
                                    },
                                    skillDrafts: Fields.skillDrafts(f.values["skillDrafts"]),
                                    skillEdits: Fields.skillEdits(f.values["skillEdits"]),
                                    skillHub: Fields.skillHub(f.values["skillHub"]),
                                    agentProblems: Fields.agentProblems(f.values["agentProblems"]),
                                    teamTasks: Fields.teamTasks(f.values["teamTasks"]),
                                    managers: f.managers(),
                                    codexFallback: f.optionalBool("codexFallback") ?? false,
                                    codexReady: f.optionalBool("codexReady") ?? false,
                                    testCases: Fields.testCases(f.values["testCases"])))
    case "thread":
        return .thread(try f.thread())
    case "search.results":
        return .searchResults(SearchResults(query: f.optionalString("query") ?? "", chats: Fields.searchHits(f.values["chats"]),
                                            tasks: Fields.searchHits(f.values["tasks"]), reports: Fields.searchHits(f.values["reports"])))
    case "error":
        return .error(RuntimeError(
            stage: try f.string("stage"),
            message: try f.string("message"),
            kind: f.optionalString("kind")))
    default:
        return .unknown(type: String(type.prefix(40)))
    }
}

/// Typed access to an event's fields, with errors naming the event and field.
private struct Fields {
    let event: String
    let values: [String: Any]

    func string(_ key: String) throws -> String {
        guard let value = values[key] else { throw ProtocolError.missingField(event: event, field: key) }
        guard let s = value as? String else { throw ProtocolError.invalidValue(event: event, field: key) }
        return s
    }

    func optionalString(_ key: String) -> String? { values[key] as? String }

    func number(_ key: String) throws -> NSNumber {
        guard let value = values[key] else { throw ProtocolError.missingField(event: event, field: key) }
        // JSON booleans are NSNumbers too; reject them where a number is expected.
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else {
            throw ProtocolError.invalidValue(event: event, field: key)
        }
        return n
    }

    func int(_ key: String) throws -> Int { try number(key).intValue }
    func double(_ key: String) throws -> Double { try number(key).doubleValue }

    func optionalInt(_ key: String) -> Int? {
        guard let n = values[key] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        return n.intValue
    }

    func bool(_ key: String) throws -> Bool {
        guard let value = values[key] else { throw ProtocolError.missingField(event: event, field: key) }
        guard let n = value as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else {
            throw ProtocolError.invalidValue(event: event, field: key)
        }
        return n.boolValue
    }

    /// The `providers` list of an `info` event; any malformed entry makes the whole list invalid.
    func providers() throws -> [ProviderOption] {
        guard let value = values["providers"] else { throw ProtocolError.missingField(event: event, field: "providers") }
        let invalid = ProtocolError.invalidValue(event: event, field: "providers")
        guard let entries = value as? [Any] else { throw invalid }
        return try entries.map { entry in
            guard let p = entry as? [String: Any],
                  let id = p["id"] as? String,
                  let name = p["name"] as? String,
                  let available = p["available"] as? NSNumber, CFGetTypeID(available) == CFBooleanGetTypeID(),
                  let models = p["models"] as? [Any]
            else { throw invalid }
            return ProviderOption(id: id, name: name, available: available.boolValue, models: try models.map { model in
                guard let m = model as? [String: Any], let id = m["id"] as? String, let name = m["name"] as? String
                else { throw invalid }
                return ModelOption(id: id, name: name)
            })
        }
    }

    /// The `memories` list of a `memory` event; any malformed entry makes the whole list invalid.
    func memories() throws -> [MemoryItem] {
        guard let value = values["memories"] else { throw ProtocolError.missingField(event: event, field: "memories") }
        let invalid = ProtocolError.invalidValue(event: event, field: "memories")
        guard let entries = value as? [Any] else { throw invalid }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return try entries.map { entry in
            guard let m = entry as? [String: Any],
                  let id = m["id"] as? NSNumber, CFGetTypeID(id) != CFBooleanGetTypeID(),
                  let text = m["text"] as? String
            else { throw invalid }
            let date = (m["createdAt"] as? String).flatMap { iso.date(from: $0) }
            return MemoryItem(id: id.intValue, text: text, createdAt: date, source: m["source"] as? String ?? "voice")
        }
    }

    /// ADR-097: the optional `chats` list of a `memory` event (absent from older runtimes).
    func memoryChats() throws -> [MemoryChatItem] {
        guard let value = values["chats"] else { return [] }
        let invalid = ProtocolError.invalidValue(event: event, field: "chats")
        guard let entries = value as? [Any] else { throw invalid }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return try entries.map { entry in
            guard let c = entry as? [String: Any],
                  let id = c["id"] as? String,
                  let title = c["title"] as? String
            else { throw invalid }
            return MemoryChatItem(
                id: id,
                title: title,
                updatedAt: (c["updatedAt"] as? String).flatMap { iso.date(from: $0) },
                messages: (c["messages"] as? NSNumber)?.intValue ?? 0,
                kept: (c["kept"] as? Bool) ?? false,
                indexing: (c["indexing"] as? Bool) ?? false,
                keptAt: (c["keptAt"] as? String).flatMap { iso.date(from: $0) }
            )
        }
    }

    /// The optional `episodes` list of a `memory` event (absent from older runtimes).
    func episodes() throws -> [EpisodeItem] {
        guard let value = values["episodes"] else { return [] }
        let invalid = ProtocolError.invalidValue(event: event, field: "episodes")
        guard let entries = value as? [Any] else { throw invalid }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return try entries.map { entry in
            guard let e = entry as? [String: Any],
                  let id = e["id"] as? NSNumber, CFGetTypeID(id) != CFBooleanGetTypeID(),
                  let summary = e["summary"] as? String
            else { throw invalid }
            let exchanges = (e["exchanges"] as? NSNumber)?.intValue ?? 0
            return EpisodeItem(id: id.intValue, summary: summary, endedAt: (e["endedAt"] as? String).flatMap { iso.date(from: $0) }, exchanges: exchanges)
        }
    }

    /// The `items` of a `capabilities` event. A malformed item is skipped (and a non-text example dropped), so one bad
    /// tool cannot hide the others.
    func capabilities() throws -> [CapabilityItem] {
        guard let value = values["items"] else { throw ProtocolError.missingField(event: event, field: "items") }
        guard let entries = value as? [Any] else { throw ProtocolError.invalidValue(event: event, field: "items") }
        return entries.compactMap { entry in
            guard let c = entry as? [String: Any], let title = c["title"] as? String, !title.isEmpty,
                  let examples = c["examples"] as? [Any]
            else { return nil }
            return CapabilityItem(title: title, examples: examples.compactMap { $0 as? String }.filter { !$0.isEmpty })
        }
    }

    /// A usage fraction from `plan.usage`, or nil when absent, not a number, or outside `PlanUsage.validRange`.
    func usageFraction(_ key: String) -> Double? {
        guard let n = values[key] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
              PlanUsage.validRange.contains(n.doubleValue) else { return nil }
        return n.doubleValue
    }

    /// A list of strings (the `apps` of a `helpers` event); anything else in it makes it invalid.
    func strings(_ key: String) throws -> [String] {
        guard let value = values[key] else { throw ProtocolError.missingField(event: event, field: key) }
        guard let list = value as? [Any], let strings = list as? [String] else { throw ProtocolError.invalidValue(event: event, field: key) }
        return strings
    }

    /// The `helpers` list of a `helpers` event; any malformed helper or job makes the whole list invalid.
    func helpers() throws -> [Helper] {
        guard let value = values["helpers"] else { throw ProtocolError.missingField(event: event, field: "helpers") }
        let invalid = ProtocolError.invalidValue(event: event, field: "helpers")
        guard let entries = value as? [Any] else { throw invalid }
        return try entries.map { entry in
            guard let h = entry as? [String: Any],
                  let id = h["id"] as? String, let name = h["name"] as? String,
                  let available = h["available"] as? NSNumber, CFGetTypeID(available) == CFBooleanGetTypeID(),
                  let jobs = h["jobs"] as? [Any]
            else { throw invalid }
            // `app` and `pinnedModel` are text or null (absent is read as null).
            let app = h["app"], pinned = h["pinnedModel"]
            guard app == nil || app is NSNull || app is String, pinned == nil || pinned is NSNull || pinned is String
            else { throw invalid }
            // Task 3.3: role, soul and versions; absent from older runtimes, malformed when present makes it invalid.
            var soul: HelperSoul?
            if let raw = h["soul"] {
                guard let s = raw as? [String: Any], let name = s["name"] as? String, let personality = s["personality"] as? String,
                      let how = s["howItWorks"] as? String, let rules = s["rules"] as? String, let lessons = s["lessons"] as? String
                else { throw invalid }
                soul = HelperSoul(name: name, personality: personality, howItWorks: how, rules: rules, lessons: lessons)
            }
            let versions = try (h["soulVersions"] as? [Any] ?? []).map { entry -> SoulVersion in
                guard let v = entry as? [String: Any], let n = v["version"] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID()
                else { throw invalid }
                return SoulVersion(version: n.intValue, createdAt: (v["createdAt"] as? String).flatMap(Self.date))
            }
            return Helper(id: id, name: name, available: available.boolValue, app: app as? String, jobs: try jobs.map { entry in
                guard let job = job(entry) else { throw invalid }
                return job
            }, pinnedModel: pinned as? String, role: h["role"] as? String ?? "", soul: soul,
               soulVersion: (h["soulVersion"] as? NSNumber)?.intValue ?? 1, soulVersions: versions, budget: Self.budget(h["budget"]),
               planFirst: Self.flag(h["planFirst"]), routines: Self.routines(h["routines"]),
               grants: (h["grants"] as? [Any])?.compactMap { $0 as? String } ?? [],
               skills: (h["skills"] as? [Any])?.compactMap { $0 as? String } ?? [],
               proposals: Self.proposals(h["proposals"]), kit: h["kit"] as? String, custom: Self.flag(h["custom"]),
               wakeUp: Self.wakeUp(h["wakeUp"]), manager: h["manager"] as? String, browser: Self.flag(h["browser"]))
        }
    }

    /// ADR-095: the Managers; absent (none, or an older runtime) is empty. A malformed Manager is left out; its jobs
    /// read as the helpers' do (a malformed job is left out).
    func managers() -> [HelperManager] {
        (values["managers"] as? [Any] ?? []).compactMap { entry in
            guard let m = entry as? [String: Any], let id = m["id"] as? String, let name = m["name"] as? String else { return nil }
            var soul: HelperSoul?
            if let s = m["soul"] as? [String: Any], let n = s["name"] as? String, let p = s["personality"] as? String {
                soul = HelperSoul(name: n, personality: p, howItWorks: s["howItWorks"] as? String ?? "", rules: s["rules"] as? String ?? "", lessons: s["lessons"] as? String ?? "")
            }
            return HelperManager(id: id, name: name, mode: m["mode"] as? String == "plan" ? "plan" : "group", soul: soul,
                                 soulVersion: (m["soulVersion"] as? NSNumber)?.intValue ?? 1, budget: Self.budget(m["budget"]),
                                 agents: (m["agents"] as? [Any])?.compactMap { $0 as? String } ?? [],
                                 jobs: (m["jobs"] as? [Any] ?? []).compactMap(job))
        }
    }

    private func job(_ entry: Any) -> HelperJob? {
        guard let j = entry as? [String: Any],
              let id = j["id"] as? NSNumber, CFGetTypeID(id) != CFBooleanGetTypeID(),
              let task = j["task"] as? String,
              let state = (j["state"] as? String).flatMap(JobState.init(rawValue:)),
              let createdAt = j["createdAt"] as? String
        else { return nil }
        let partial = (j["partial"] as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() && $0.boolValue } ?? false
        return HelperJob(id: id.intValue, task: task, state: state, createdAt: Self.date(createdAt),
                         endedAt: (j["endedAt"] as? String).flatMap(Self.date), step: j["step"] as? String, partial: partial,
                         title: j["title"] as? String, summary: j["summary"] as? String, error: j["error"] as? String,
                         model: j["model"] as? String, modelReason: j["modelReason"] as? String,
                         blockedBy: Self.ids(j["blockedBy"]), waitingFor: Self.ids(j["waitingFor"]),
                         comments: (j["comments"] as? NSNumber)?.intValue ?? 0, goal: j["goal"] as? String,
                         parentId: (j["parentId"] as? NSNumber)?.intValue, goalId: (j["goalId"] as? NSNumber)?.intValue,
                         goalEnded: Self.flag(j["goalEnded"]), resumable: Self.flag(j["resumable"]), held: j["held"] as? String,
                         interrupted: Self.flag(j["interrupted"]),
                         planFirst: Self.flag(j["planFirst"]), planStatus: j["planStatus"] as? String, planSummary: j["planSummary"] as? String,
                         rating: j["rating"] as? String, reviews: (j["reviews"] as? NSNumber)?.intValue,
                         autoRetries: (j["autoRetries"] as? NSNumber)?.intValue ?? 0, subAgents: Self.subAgents(j["subAgents"]),
                         labels: (j["labels"] as? [Any] ?? []).compactMap { $0 as? String })
    }

    /// ADR-098: search results of one kind; a malformed one is left out. Chat ids are strings, task ids numbers.
    static func searchHits(_ value: Any?) -> [SearchHit] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let h = entry as? [String: Any], let title = h["title"] as? String else { return nil }
            let id: String
            if let s = h["id"] as? String { id = s } else if let n = h["id"] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() { id = String(n.intValue) } else { return nil }
            return SearchHit(id: id, title: title, snippet: h["snippet"] as? String ?? "", at: (h["at"] as? String).flatMap(Self.date))
        }
    }

    /// ADR-095: a task's sub-agents; a malformed one is left out, anything else reads as none.
    private static func subAgents(_ value: Any?) -> [HelperSubAgent] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let s = entry as? [String: Any], let name = s["name"] as? String,
                  let state = (s["state"] as? String).flatMap(HelperSubAgent.State.init(rawValue:)) else { return nil }
            return HelperSubAgent(name: name, state: state, description: s["description"] as? String ?? "", result: s["result"] as? String)
        }
    }

    /// Task 3.7: `{ "cap": number | null, "spent": number }`; anything else reads as none.
    static func budget(_ value: Any?) -> HelperBudget? {
        guard let b = value as? [String: Any], let spent = b["spent"] as? NSNumber, CFGetTypeID(spent) != CFBooleanGetTypeID() else { return nil }
        let cap = b["cap"] as? NSNumber
        return HelperBudget(cap: cap.flatMap { CFGetTypeID($0) == CFBooleanGetTypeID() ? nil : $0.doubleValue }, spent: spent.doubleValue)
    }

    /// ADR-091: the Dashboard's tokens; nil when absent or malformed.
    static func usage(_ value: Any?) -> TokenUsageSummary? {
        guard let u = value as? [String: Any], let today = totals(u["today"]), let week = totals(u["week"]) else { return nil }
        let list = { (k: String) in (u[k] as? [Any]) ?? [] }
        return TokenUsageSummary(
            today: today, week: week,
            days: list("days").compactMap { d in (d as? [String: Any]).flatMap { m in totals(m).flatMap { t in (m["day"] as? String).map { DayTokens(day: $0, totals: t) } } } },
            byWorker: list("byWorker").compactMap { w in (w as? [String: Any]).flatMap { m in totals(m).map { WorkerTokens(helper: m["helper"] as? String, name: m["name"] as? String ?? "", totals: $0) } } },
            byModel: list("byModel").compactMap { x in (x as? [String: Any]).flatMap { m in totals(m).flatMap { t in (m["model"] as? String).map { ModelTokens(model: $0, totals: t) } } } },
            chatCacheCold: u["chatCacheCold"] as? Bool ?? false,
            recent: list("recent").compactMap(recentRun))
    }

    /// Token cost, job 4: one entry of `usage.recent`; a malformed entry is left out.
    private static func recentRun(_ value: Any) -> RecentTokens? {
        guard let m = value as? [String: Any], let kind = (m["kind"] as? String).flatMap(RecentTokens.Kind.init(rawValue:)), let model = m["model"] as? String else { return nil }
        let n = { (k: String) in (m[k] as? NSNumber)?.intValue ?? 0 }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return RecentTokens(at: (m["at"] as? String).flatMap { iso.date(from: $0) }, kind: kind, model: model, input: n("input"), output: n("output"),
                            cacheRead: n("cacheRead"), cacheWrite: n("cacheWrite"), gapMs: (m["gapMs"] as? NSNumber)?.intValue)
    }

    private static func totals(_ value: Any?) -> TokenTotals? {
        guard let m = value as? [String: Any] else { return nil }
        let n = { (k: String) in (m[k] as? NSNumber)?.intValue ?? 0 }
        return TokenTotals(input: n("input"), output: n("output"), cacheRead: n("cacheRead"), cacheWrite: n("cacheWrite"),
                           dollars: (m["dollars"] as? NSNumber)?.doubleValue ?? 0, runs: n("runs"))
    }

    /// ADR-090: Keshab's MCP servers (never a secret value); a malformed entry is left out.
    static func mcp(_ value: Any?) -> [McpServerItem] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let m = entry as? [String: Any], let id = m["id"] as? NSNumber, let name = m["name"] as? String, let kind = m["kind"] as? String else { return nil }
            let strings = { (k: String) in (m[k] as? [Any])?.compactMap { $0 as? String } ?? [] }
            return McpServerItem(id: id.intValue, name: name, kind: kind, command: m["command"] as? String, args: strings("args"), url: m["url"] as? String,
                                 transport: m["transport"] as? String ?? "http", envKeys: strings("envKeys"), headerKeys: strings("headerKeys"),
                                 enabled: flag(m["enabled"]), trusted: flag(m["trusted"]), workers: strings("workers"), tools: strings("tools"),
                                 tested: m["testedAt"] is String, problem: m["problem"] as? String)
        }
    }

    /// ADR-093: agent folders that could not be loaded; absent (an older runtime, or none) is empty. A malformed entry is left out.
    static func agentProblems(_ value: Any?) -> [AgentProblem] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let p = entry as? [String: Any], let id = p["id"] as? String, let problem = p["problem"] as? String else { return nil }
            return AgentProblem(id: id, problem: problem)
        }
    }

    /// Task 3.16: the tasks handed to Keshab's Paperclip; nil when the connection is off.
    static func paperclip(_ value: Any?) -> [PaperclipTask]? {
        guard let p = value as? [String: Any], let issues = p["issues"] as? [Any] else { return nil }
        return issues.compactMap { entry in
            guard let i = entry as? [String: Any], let id = i["id"] as? String, let title = i["title"] as? String, let agent = i["agent"] as? String,
                  let status = i["status"] as? String else { return nil }
            return PaperclipTask(id: id, identifier: i["identifier"] as? String, title: title, agent: agent, status: status, result: i["result"] as? String)
        }
    }

    /// ADR-094: Tinker's skill drafts; absent (an older runtime) is empty. A malformed entry is left out.
    static func skillDrafts(_ value: Any?) -> [SkillDraftItem] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let d = entry as? [String: Any], let id = d["id"] as? NSNumber, let name = d["name"] as? String, let state = d["state"] as? String else { return nil }
            return SkillDraftItem(id: id.intValue, jobId: (d["jobId"] as? NSNumber)?.intValue ?? 0, helper: d["helper"] as? String ?? "", name: name,
                                  description: d["description"] as? String ?? "", preview: d["preview"] as? String ?? "", state: state)
        }
    }

    /// ADR-094: Tinker's edits to ATOM's skills; absent (an older runtime) is empty. A malformed entry is left out.
    static func skillEdits(_ value: Any?) -> [SkillEditItem] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let e = entry as? [String: Any], let id = e["id"] as? NSNumber, let skill = e["skill"] as? String, let state = e["state"] as? String else { return nil }
            return SkillEditItem(id: id.intValue, skill: skill, jobId: (e["jobId"] as? NSNumber)?.intValue ?? 0, reason: e["reason"] as? String ?? "",
                                 before: e["before"] as? String ?? "", after: e["after"] as? String ?? "", state: state, tests: Self.tests(e["tests"]))
        }
    }

    /// Task 3.13: Tinker's proposals for a helper's soul; a malformed entry is left out.
    static func proposals(_ value: Any?) -> [SoulProposal] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let p = entry as? [String: Any], let id = p["id"] as? NSNumber, let field = p["field"] as? String, let text = p["text"] as? String,
                  let reason = p["reason"] as? String, let state = p["state"] as? String else { return nil }
            return SoulProposal(id: id.intValue, field: field, text: text, reason: reason, jobId: (p["jobId"] as? NSNumber)?.intValue ?? 0, state: state,
                                tests: Self.tests(p["tests"]))
        }
    }

    /// ADR-097: a routine's schedule as numbers; nil when absent or malformed.
    static func routineSchedule(_ value: Any?) -> RoutineSchedule? {
        guard let s = value as? [String: Any], let kind = (s["kind"] as? String).flatMap(RoutineSchedule.Kind.init(rawValue:)) else { return nil }
        let number = { (key: String) in (s[key] as? NSNumber)?.intValue }
        var schedule = RoutineSchedule(kind: kind)
        if let minute = number("minute") { schedule.minute = minute }
        if let weekday = number("weekday") { schedule.weekday = weekday }
        if let every = number("every") { schedule.every = every }
        return schedule
    }

    /// Task 3.9: a helper's routines; a malformed entry is left out.
    static func routines(_ value: Any?) -> [HelperRoutine] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let r = entry as? [String: Any], let id = r["id"] as? NSNumber, let task = r["task"] as? String, let when = r["when"] as? String
            else { return nil }
            return HelperRoutine(id: id.intValue, task: task, when: when, lastAt: (r["lastAt"] as? String).flatMap(Self.date),
                                 lastSkipped: flag(r["lastSkipped"]), paused: flag(r["paused"]), nextAt: (r["nextAt"] as? String).flatMap(Self.date),
                                 schedule: routineSchedule(r["schedule"]), notifyTelegram: flag(r["notifyTelegram"]), webhook: flag(r["webhook"]))
        }
    }

    /// ADR-094: a worker's wake-ups; absent (off, or an older runtime) or malformed is nil.
    static func wakeUp(_ value: Any?) -> HelperWakeUp? {
        guard let w = value as? [String: Any], let every = w["every"] as? String, let when = w["when"] as? String,
              let nextAt = (w["nextAt"] as? String).flatMap(Self.date) else { return nil }
        return HelperWakeUp(every: every, when: when, paused: flag(w["paused"]), lastAt: (w["lastAt"] as? String).flatMap(Self.date), nextAt: nextAt)
    }

    /// ADR-094: the team tasks waiting to be taken; absent (an older runtime) is empty. A malformed entry is left out.
    static func teamTasks(_ value: Any?) -> [TeamTask] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let t = entry as? [String: Any], let id = t["id"] as? NSNumber, CFGetTypeID(id) != CFBooleanGetTypeID(), let task = t["task"] as? String
            else { return nil }
            return TeamTask(id: id.intValue, task: task, role: t["role"] as? String, createdAt: (t["createdAt"] as? String).flatMap(Self.date))
        }
    }

    /// An optional JSON boolean; anything else reads as false.
    private static func flag(_ value: Any?) -> Bool {
        (value as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() && $0.boolValue } ?? false
    }

    /// A list of task ids; anything else reads as none.
    private static func ids(_ value: Any?) -> [Int] {
        (value as? [Any])?.compactMap { ($0 as? NSNumber).flatMap { CFGetTypeID($0) == CFBooleanGetTypeID() ? nil : $0.intValue } } ?? []
    }

    /// The `thread` event (ADR-087): notes and activity, and the report when there is one.
    func thread() throws -> HelperThread {
        let invalid = { (field: String) in ProtocolError.invalidValue(event: event, field: field) }
        guard let comments = values["comments"] as? [Any] else { throw invalid("comments") }
        guard let activity = values["activity"] as? [Any] else { throw invalid("activity") }
        func report(_ value: Any?, id: Int, field: String) throws -> HelperReport? {
            guard let value else { return nil }
            guard let r = value as? [String: Any], let title = r["title"] as? String, let summary = r["summary"] as? String,
                  let body = r["body"] as? String else { throw invalid(field) }
            let sources = try Fields(event: event, values: ["sources": r["sources"] ?? []]).sources()
            return HelperReport(id: id, title: title, summary: summary, body: body, sources: sources)
        }
        // Task 3.8: the plan a plan-first run wrote.
        var plan: JobPlan?
        if let p = values["plan"] {
            guard let p = p as? [String: Any], let summary = p["summary"] as? String, let steps = p["steps"] as? String else { throw invalid("plan") }
            plan = JobPlan(summary: summary, steps: steps)
        }
        // Task 3.5: the task's goal; absent from older runtimes and for tasks added in the window.
        var goal: HelperGoal?
        if let g = values["goal"] {
            guard let g = g as? [String: Any], let id = g["id"] as? NSNumber, CFGetTypeID(id) != CFBooleanGetTypeID(),
                  let text = g["text"] as? String, let ended = g["ended"] as? NSNumber, CFGetTypeID(ended) == CFBooleanGetTypeID()
            else { throw invalid("goal") }
            goal = HelperGoal(id: id.intValue, text: text, ended: ended.boolValue, tasks: Self.ids(g["tasks"]),
                              report: try report(g["report"], id: id.intValue, field: "goal"))
        }
        return HelperThread(id: try int("id"), comments: try comments.map { entry in
            guard let c = entry as? [String: Any], let id = c["id"] as? NSNumber, let text = c["text"] as? String else { throw invalid("comments") }
            return TaskComment(id: id.intValue, text: text, createdAt: (c["createdAt"] as? String).flatMap(Self.date),
                               delivery: c["delivery"] as? String)
        }, activity: try activity.map { entry in
            guard let a = entry as? [String: Any], let kind = a["kind"] as? String else { throw invalid("activity") }
            return TaskActivity(kind: kind, at: (a["at"] as? String).flatMap(Self.date))
        }, report: try report(values["report"], id: try int("id"), field: "report"), goal: goal, plan: plan,
           handOffs: Self.ids(values["handOffs"]), testSkills: values["testSkills"] as? [String] ?? [],
           toolCalls: Self.toolCalls(values["toolCalls"]), checkpoints: Self.checkpoints(values["checkpoints"]),
           bashRan: (values["bashRan"] as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() && $0.boolValue } ?? false)
    }

    /// B3.4: a task's file checkpoints; a malformed one is left out, anything else reads as none.
    private static func checkpoints(_ value: Any?) -> [HelperCheckpoint] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let c = entry as? [String: Any], let path = c["path"] as? String,
                  let kind = (c["kind"] as? String).flatMap(HelperCheckpoint.Kind.init(rawValue:)),
                  let state = (c["state"] as? String).flatMap(HelperCheckpoint.State.init(rawValue:)) else { return nil }
            return HelperCheckpoint(path: path, kind: kind, state: state, reason: c["reason"] as? String)
        }
    }

    /// B3.1: a task's tool calls; a malformed one is left out, anything else reads as none.
    private static func toolCalls(_ value: Any?) -> [HelperToolCall] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let t = entry as? [String: Any], let id = t["id"] as? String, let tool = t["tool"] as? String,
                  let state = (t["state"] as? String).flatMap(HelperToolCall.State.init(rawValue:)),
                  let at = (t["at"] as? String).flatMap(Self.date) else { return nil }
            return HelperToolCall(id: id, agent: t["agent"] as? String, tool: tool, input: t["input"] as? String ?? "", state: state,
                                  result: t["result"] as? String, at: at, durationMs: (t["ms"] as? NSNumber)?.intValue)
        }
    }

    /// The optional `models` of a `helpers` event (ADR-083; absent from older runtimes). Strict like the helpers list:
    /// a malformed entry, or a tier other than small, medium or large, makes the whole event invalid.
    func helperModels() throws -> [HelperModel] {
        guard let value = values["models"] else { return [] }
        let invalid = ProtocolError.invalidValue(event: event, field: "models")
        guard let entries = value as? [Any] else { throw invalid }
        return try entries.map { entry in
            guard let m = entry as? [String: Any], let id = m["id"] as? String, let name = m["name"] as? String,
                  let tier = (m["tier"] as? String).flatMap(ModelTier.init(rawValue:))
            else { throw invalid }
            return HelperModel(id: id, name: name, tier: tier)
        }
    }

    /// An optional boolean that, when present, must be a real JSON boolean.
    func optionalStrictBool(_ key: String) throws -> Bool? {
        guard let value = values[key] else { return nil }
        guard let n = value as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else {
            throw ProtocolError.invalidValue(event: event, field: key)
        }
        return n.boolValue
    }

    /// ADR-093: the AI tools found on this Mac; a malformed entry is left out.
    static func tools(_ value: Any?) -> [AiTool] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let m = entry as? [String: Any], let id = m["id"] as? String, let name = m["name"] as? String else { return nil }
            let signedIn = (m["signedIn"] as? NSNumber).map(\.boolValue)
            return AiTool(id: id, name: name, found: flag(m["found"]), signedIn: signedIn, provider: m["provider"] as? String, note: m["note"] as? String ?? "")
        }
    }

    /// ADR-091: ATOM's task branches; a malformed entry is left out.
    static func branches(_ value: Any?) -> [GitBranch] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let m = entry as? [String: Any], let repo = m["repo"] as? String, let branch = m["branch"] as? String, let task = m["task"] as? NSNumber else { return nil }
            let commits = (m["commits"] as? [Any] ?? []).compactMap { c -> GitCommit? in
                guard let c = c as? [String: Any], let sha = c["sha"] as? String else { return nil }
                return GitCommit(sha: sha, subject: c["subject"] as? String ?? "", at: (c["at"] as? String).flatMap(date))
            }
            let files = (m["files"] as? [Any] ?? []).compactMap { x -> GitFile? in
                guard let x = x as? [String: Any], let path = x["path"] as? String else { return nil }
                return GitFile(path: path, added: (x["added"] as? NSNumber)?.intValue, removed: (x["removed"] as? NSNumber)?.intValue)
            }
            return GitBranch(repo: repo, repoName: m["repoName"] as? String ?? repo, branch: branch, task: task.intValue, title: m["title"] as? String,
                             base: m["base"] as? String ?? "", commits: commits, files: files, remote: m["remote"] as? String,
                             pushed: GitBranch.Pushed(rawValue: m["pushed"] as? String ?? "") ?? .no)
        }
    }

    /// ADR-091: the chats, newest first; a malformed entry is left out.
    static func chats(_ value: Any?) -> [ChatInfo] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let m = entry as? [String: Any], let id = m["id"] as? String, let title = m["title"] as? String else { return nil }
            return ChatInfo(id: id, title: title, updatedAt: (m["updatedAt"] as? String).flatMap(date), messages: (m["messages"] as? NSNumber)?.intValue ?? 0,
                            readOnly: m["readOnly"] as? Bool ?? false, projectId: m["projectId"] as? String)
        }
    }

    /// ADR-107: the projects; a malformed entry is left out, a missing flag is false.
    static func projects(_ value: Any?) -> [ProjectInfo] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let m = entry as? [String: Any], let id = m["id"] as? String, let name = m["name"] as? String else { return nil }
            return ProjectInfo(id: id, name: name, folderLabel: m["folderLabel"] as? String ?? "", missing: m["missing"] as? Bool ?? false,
                               archived: m["archived"] as? Bool ?? false, chatCount: (m["chatCount"] as? NSNumber)?.intValue ?? 0,
                               web: m["web"] as? Bool ?? false, agent: m["agent"] as? String,
                               provider: m["provider"] as? String, model: m["model"] as? String)
        }
    }

    static func chatLines(_ value: Any?) -> [ChatLine] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let m = entry as? [String: Any], let role = m["role"] as? String, let text = m["text"] as? String else { return nil }
            return ChatLine(fromUser: role == "user", text: text)
        }
    }

    /// ISO 8601, with or without fractional seconds.
    private static func date(_ string: String) -> Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: string) { return date }
        iso.formatOptions = [.withInternetDateTime]
        return iso.date(from: string)
    }

    /// The `sources` of a report. A source that is not an http(s) address is dropped: nothing else is opened.
    func sources() throws -> [ReportSource] {
        guard let value = values["sources"] else { throw ProtocolError.missingField(event: event, field: "sources") }
        let invalid = ProtocolError.invalidValue(event: event, field: "sources")
        guard let entries = value as? [Any] else { throw invalid }
        return try entries.compactMap { entry in
            guard let s = entry as? [String: Any], let title = s["title"] as? String, let url = s["url"] as? String
            else { throw invalid }
            return ReportSource.webURL(url).map { ReportSource(title: title, url: $0) }
        }
    }

    func optionalBool(_ key: String) -> Bool? {
        guard let n = values[key] as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }
        return n.boolValue
    }
}

extension IslandCommand {
    /// A multi-line field as its non-empty lines.
    static func lines(_ text: String) -> [String] {
        text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
}

/// ADR-093: an AI tool found (or looked for) on this Mac.
public struct AiTool: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var found: Bool
    /// Nil when the tool cannot be asked without reading its login.
    public var signedIn: Bool?
    /// The provider ATOM runs it as; nil for tools ATOM does not use (local models).
    public var provider: String?
    public var note: String

    public init(id: String, name: String, found: Bool, signedIn: Bool? = nil, provider: String? = nil, note: String = "") {
        self.id = id
        self.name = name
        self.found = found
        self.signedIn = signedIn
        self.provider = provider
        self.note = note
    }
}

// ADR-098 item 8: test cases and test runs; absent (an older runtime) is empty or nil. A malformed entry is left out.
extension Fields {
    static func testCases(_ value: Any?) -> [TestCaseItem] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let c = entry as? [String: Any], let id = c["id"] as? NSNumber, let kind = c["kind"] as? String, let target = c["target"] as? String else { return nil }
            return TestCaseItem(id: id.intValue, kind: kind, target: target, jobId: (c["jobId"] as? NSNumber)?.intValue ?? 0, task: c["task"] as? String ?? "")
        }
    }

    static func tests(_ value: Any?) -> TestRunSummary? {
        guard let t = value as? [String: Any] else { return nil }
        let count = { (key: String) in (t[key] as? NSNumber)?.intValue ?? 0 }
        let results: [TestCaseResult] = (t["results"] as? [Any] ?? []).compactMap { entry in
            guard let r = entry as? [String: Any], let caseId = r["caseId"] as? NSNumber, let state = r["state"] as? String else { return nil }
            return TestCaseResult(caseId: caseId.intValue, task: r["task"] as? String ?? "", state: state, better: r["better"] as? String, reason: r["reason"] as? String,
                                  oldAnswer: r["oldAnswer"] as? String, newAnswer: r["newAnswer"] as? String)
        }
        return TestRunSummary(better: count("better"), same: count("same"), worse: count("worse"), notRun: count("notRun"), failed: count("failed"),
                              running: count("running"), results: results)
    }
}

extension Fields {
    /// B3.5: the skills hub; absent (an older runtime) is empty. A malformed entry is left out.
    static func skillHub(_ value: Any?) -> HubState {
        guard let h = value as? [String: Any] else { return .empty }
        func list(_ key: String) -> [[String: Any]] { (h[key] as? [Any] ?? []).compactMap { $0 as? [String: Any] } }
        let results = list("results").compactMap { r -> HubSkillResult? in
            guard let name = r["name"] as? String, let repo = r["repo"] as? String, let path = r["path"] as? String,
                  let source = r["source"] as? NSNumber else { return nil }
            return HubSkillResult(name: name, description: r["description"] as? String ?? "", repo: repo, path: path, sha: r["sha"] as? String ?? "", source: source.intValue)
        }
        let pending = list("pending").compactMap { p -> HubSkillPending? in
            guard let id = p["id"] as? NSNumber, let kind = p["kind"] as? String, kind == "new" || kind == "update",
                  let name = p["name"] as? String, let text = p["text"] as? String else { return nil }
            let flags = (p["flags"] as? [Any] ?? []).compactMap { entry -> HubFlag? in
                guard let f = entry as? [String: Any], let kind = f["kind"] as? String else { return nil }
                return HubFlag(kind: kind, severity: f["severity"] as? String == "warn" ? .warn : .info, excerpt: f["excerpt"] as? String ?? "")
            }
            return HubSkillPending(id: id.intValue, isUpdate: kind == "update", name: name, description: p["description"] as? String ?? "",
                                   repo: p["repo"] as? String ?? "", path: p["path"] as? String ?? "", sha: p["sha"] as? String ?? "", text: text, flags: flags)
        }
        let installed = list("installed").compactMap { i -> HubSkillInstalled? in
            guard let name = i["name"] as? String else { return nil }
            return HubSkillInstalled(name: name, repo: i["repo"] as? String ?? "", path: i["path"] as? String ?? "", sha: i["sha"] as? String ?? "")
        }
        return HubState(results: results, pending: pending, installed: installed, message: h["message"] as? String)
    }
}
