// The messages exchanged with the ZENO runtime. Specification: docs/island-protocol.md.
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
    /// give it a job, stop or forget a job, ask for a job's report.
    case helpersList
    /// ADR-091: whether ZENO says reports, and timers and updates, aloud.
    case speechSet(reports: Bool, updates: Bool)
    /// ADR-093: look for the AI tools on this Mac again.
    case toolsScan
    /// ADR-091: Keshab's chats: list them, continue one, delete one.
    case chatsList
    case chatOpen(id: String)
    case chatDelete(id: String)
    /// ADR-091: ZENO's task branches; push one (Keshab confirmed); a branch's changes.
    case gitList
    case gitPush(repo: String, branch: String)
    case gitDiff(repo: String, branch: String)
    case helperSet(helper: String, app: String)
    case jobAdd(helper: String, task: String, blockedBy: [Int] = [])
    /// ADR-087: change what a queued task waits for; add a note to a task; ask for a task's thread.
    case jobBlock(id: Int, blockedBy: [Int])
    case commentAdd(id: Int, text: String)
    case threadGet(id: Int)
    case jobStop(id: Int)
    /// Task 3.6: forget a task's Claude session; an ended task runs again from the start.
    case jobFresh(id: Int)
    /// Task 3.8: approve or reject a task's waiting plan; whether a worker's new tasks plan first.
    case planApprove(id: Int)
    case planReject(id: Int)
    case helperPlanFirst(helper: String, on: Bool)
    /// Task 3.9: remove a routine.
    case routineDelete(id: Int)
    /// Task 3.11: grant a folder to a worker, or take it back.
    case grantAdd(helper: String, path: String)
    /// Task 3.12: the skills chosen for a worker (the whole list).
    case helperSkills(helper: String, skills: [String])
    /// Task 3.13: rate a finished task; answer Tinker's proposal.
    case jobRate(id: Int, good: Bool, comment: String?)
    case proposalAccept(id: Int)
    case proposalReject(id: Int)
    case proposalUndo(id: Int)
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
    case grantRemove(helper: String, path: String)
    case jobDelete(id: Int)
    case reportGet(id: Int)
    /// ADR-083: pin a helper to a model (`""` lets Laya choose again); allow or forbid the large model for jobs.
    case helperPin(helper: String, model: String)
    case helpersSettings(allowLarge: Bool)
    /// Task 3.7: a worker's or the team's ("team") daily cap, nil for none; the plan limit in percent.
    case helperBudget(helper: String, cap: Double?)
    case helpersPlanLimit(Int)
    /// Task 3.3: save a worker's edited soul as a new version; make an older version current again.
    case soulSet(helper: String, soul: HelperSoul)
    case soulRestore(helper: String, version: Int)

    /// The command's `type` field. Safe for logs: never includes values.
    public var type: String {
        switch self {
        case .talkStart: "talk.start"
        case .talkSend: "talk.send"
        case .talkCancel: "talk.cancel"
        case .conversationReset: "conversation.reset"
        case .quit: "quit"
        case .modelSet: "model.set"
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
        case .toolsScan: "tools.scan"
        case .chatsList: "chats.list"
        case .chatOpen: "chat.open"
        case .chatDelete: "chat.delete"
        case .gitList: "git.list"
        case .gitPush: "git.push"
        case .gitDiff: "git.diff"
        case .helperSet: "helper.set"
        case .jobAdd: "job.add"
        case .jobBlock: "job.block"
        case .commentAdd: "comment.add"
        case .threadGet: "thread.get"
        case .jobStop: "job.stop"
        case .jobFresh: "job.fresh"
        case .planApprove: "plan.approve"
        case .planReject: "plan.reject"
        case .helperPlanFirst: "helper.planFirst"
        case .routineDelete: "routine.delete"
        case .grantAdd: "grant.add"
        case .helperSkills: "helper.skills"
        case .jobRate: "job.rate"
        case .proposalAccept: "proposal.accept"
        case .proposalReject: "proposal.reject"
        case .proposalUndo: "proposal.undo"
        case .jobOpen: "job.open"
        case .jobRetry: "job.retry"
        case .mcpAdd: "mcp.add"
        case .mcpRemove: "mcp.remove"
        case .mcpSet: "mcp.set"
        case .mcpTest: "mcp.test"
        case .agentCreate: "agent.create"
        case .agentRemove: "agent.remove"
        case .grantRemove: "grant.remove"
        case .jobDelete: "job.delete"
        case .reportGet: "report.get"
        case .helperPin: "helper.pin"
        case .helpersSettings, .helpersPlanLimit: "helpers.settings"
        case .helperBudget: "helper.budget"
        case .soulSet: "soul.set"
        case .soulRestore: "soul.restore"
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
        case .commentAdd(let id, let text):
            fields["id"] = id
            fields["text"] = text
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
        case .chatOpen(let id), .chatDelete(let id):
            fields["id"] = id
        case .gitPush(let repo, let branch), .gitDiff(let repo, let branch):
            fields["repo"] = repo
            fields["branch"] = branch
        case .speechSet(let reports, let updates):
            fields["reports"] = reports
            fields["updates"] = updates
        case .mcpSet(let id, let enabled, let trusted, let workers):
            fields["id"] = id
            if let enabled { fields["enabled"] = enabled }
            if let trusted { fields["trusted"] = trusted }
            if let workers { fields["workers"] = workers }
        case .agentRemove(let id):
            fields["id"] = id
        case .proposalAccept(let id), .proposalReject(let id), .proposalUndo(let id), .jobOpen(let id), .jobRetry(let id), .mcpRemove(let id), .mcpTest(let id):
            fields["id"] = id
        case .helperSkills(let helper, let skills):
            fields["helper"] = helper
            fields["skills"] = skills
        case .grantAdd(let helper, let path), .grantRemove(let helper, let path):
            fields["helper"] = helper
            fields["path"] = path
        case .helperPlanFirst(let helper, let on):
            fields["helper"] = helper
            fields["on"] = on // a real JSON boolean
        case .jobStop(let id), .jobFresh(let id), .planApprove(let id), .planReject(let id), .routineDelete(let id), .jobDelete(let id), .reportGet(let id), .threadGet(let id):
            fields["id"] = id // a JSON number
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
        case .soulSet(let helper, let soul):
            fields["helper"] = helper
            fields["soul"] = ["name": soul.name, "personality": soul.personality, "howItWorks": soul.howItWorks,
                              "rules": soul.rules, "lessons": soul.lessons]
        case .soulRestore(let helper, let version):
            fields["helper"] = helper
            fields["version"] = version // a JSON number
        default:
            break
        }
        // A dictionary of strings and booleans is always valid JSON, so this cannot fail.
        guard let data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys, .withoutEscapingSlashes]),
              let json = String(data: data, encoding: .utf8)
        else { preconditionFailure("command \(type) could not be encoded") }
        return json + "\n"
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

    /// The model's name from the list, else one derived from its id.
    public var currentModelName: String {
        currentProvider?.models.first { $0.id == model }?.name
            ?? IslandStatus.displayName(provider: provider, model: model)
    }
}

/// One fact ZENO keeps (ADR-058), as listed in Settings. Never written to a log.
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

/// ZENO's note about one past conversation (ADR-059). Never written to a log.
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

/// What ZENO keeps, from the `memory` event.
public struct MemoryList: Sendable, Equatable {
    /// False when memory is off in the runtime (`ZENO_MEMORY=0`, or the file could not be opened).
    public var enabled: Bool
    public var count: Int
    /// Newest first.
    public var memories: [MemoryItem]
    /// Notes from recent conversations, newest first. Empty from an older runtime.
    public var episodes: [EpisodeItem]

    public init(enabled: Bool, count: Int, memories: [MemoryItem], episodes: [EpisodeItem] = []) {
        self.enabled = enabled
        self.count = count
        self.memories = memories
        self.episodes = episodes
    }
}

/// One thing ZENO can do, with phrases to try (ADR-076), from the `capabilities` event. Only tools that are on are listed.
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
}

public struct TurnTimings: Sendable, Equatable {
    public var speechMs: Int
    public var transcriptionMs: Int
    public var modelMs: Int
    public var firstSoundMs: Int?
    public var requestId: String?
}

/// Something ZENO will not do until the user says yes (ADR-054). Wording comes from the runtime and carries
/// the app and the action, never typed text or screen content.
public struct ApprovalRequest: Sendable, Equatable {
    public var id: String
    /// What ZENO is about to do, e.g. `Click "Send" in Mail`.
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
    public var retryable: Bool?
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
    /// ZENO is about to do something on the Mac, in plain words (ADR-054).
    case computerStep(String)
    /// ZENO shows the user a place on screen: Pal flies there and the bubble says what it is (ADR-054).
    case computerPoint(PointTarget)
    /// ZENO is waiting for the user to allow or decline an action.
    case approvalRequest(ApprovalRequest)
    /// That request is no longer waiting: answered, declined, timed out or cancelled.
    case approvalClosed(id: String)
    case info(ModelInfo)
    /// What ZENO keeps (ADR-058): after `memory.list`, and after every change from then on.
    case memory(MemoryList)
    /// A timer ended (ADR-061). The runtime also says `message` aloud.
    case timer(id: Int, label: String, message: String)
    /// Task 3.15: a line from the team, just before ZENO says it.
    case workerLine(String)
    /// The answer to `context.window` (ADR-074): the app was read for the next question, or refused with `message`.
    case contextReady(app: String, ok: Bool, message: String?)
    /// What ZENO can do, once after `ready` (ADR-076).
    case capabilities([CapabilityItem])
    /// Claude plan usage, whenever the plan reports it (ADR-076).
    case planUsage(PlanUsage)
    /// Open the panel on Settings (ADR-071).
    case settingsOpen
    /// Press a system media key once (ADR-071).
    case mediaKey(MediaKey)
    /// Every helper and its recent jobs (ADR-081): after every helper command, and on changes once asked.
    case helpers(HelpersList)
    /// ADR-091: Keshab's chats and the one ZENO is in; a chat opened, with its turns.
    case chats(ChatList)
    case chatOpened(id: String, lines: [ChatLine])
    /// ADR-091: ZENO's task branches; one branch's changes as a patch.
    case git([GitBranch])
    case gitDiff(GitDiff)
    /// One job's report, after `report.get`.
    case report(HelperReport)
    case thread(HelperThread)
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
        case .report: "report"
        case .thread: "thread"
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
            voice: try f.bool("voice")))
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
            firstSoundMs: f.optionalInt("firstSoundMs"),
            requestId: f.optionalString("requestId")))
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
        return .memory(MemoryList(enabled: try f.bool("enabled"), count: try f.int("count"), memories: try f.memories(), episodes: try f.episodes()))
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
        return .chats(ChatList(chats: Fields.chats(f.values["chats"]), current: f.optionalString("current") ?? ""))
    case "chat.opened":
        return .chatOpened(id: try f.string("id"), lines: Fields.chatLines(f.values["messages"]))
    case "helpers":
        return .helpers(HelpersList(helpers: try f.helpers(), apps: try f.strings("apps"),
                                    allowLarge: try f.optionalStrictBool("allowLarge") ?? true, models: try f.helperModels(),
                                    team: Fields.budget(f.values["team"]), planLimit: (f.values["planLimit"] as? NSNumber)?.intValue,
                                    paperclip: Fields.paperclip(f.values["paperclip"]),
                                    mcp: Fields.mcp(f.values["mcp"]),
                                    usage: Fields.usage(f.values["usage"]),
                                    skills: (f.values["skills"] as? [Any] ?? []).compactMap { entry in
                                        guard let s = entry as? [String: Any], let name = s["name"] as? String else { return nil }
                                        return SkillInfo(name: name, description: s["description"] as? String ?? "")
                                    }))
    case "thread":
        return .thread(try f.thread())
    case "report":
        return .report(HelperReport(id: try f.int("id"), title: try f.string("title"), summary: try f.string("summary"),
                                    body: try f.string("body"), sources: try f.sources()))
    case "error":
        return .error(RuntimeError(
            stage: try f.string("stage"),
            message: try f.string("message"),
            kind: f.optionalString("kind"),
            retryable: f.optionalBool("retryable")))
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
               proposals: Self.proposals(h["proposals"]), kit: h["kit"] as? String, custom: Self.flag(h["custom"]))
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
                         planFirst: Self.flag(j["planFirst"]), planStatus: j["planStatus"] as? String, planSummary: j["planSummary"] as? String,
                         rating: j["rating"] as? String, reviews: (j["reviews"] as? NSNumber)?.intValue,
                         autoRetries: (j["autoRetries"] as? NSNumber)?.intValue ?? 0)
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
            byModel: list("byModel").compactMap { x in (x as? [String: Any]).flatMap { m in totals(m).flatMap { t in (m["model"] as? String).map { ModelTokens(model: $0, totals: t) } } } })
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

    /// Task 3.16: the tasks handed to Keshab's Paperclip; nil when the connection is off.
    static func paperclip(_ value: Any?) -> [PaperclipTask]? {
        guard let p = value as? [String: Any], let issues = p["issues"] as? [Any] else { return nil }
        return issues.compactMap { entry in
            guard let i = entry as? [String: Any], let id = i["id"] as? String, let title = i["title"] as? String, let agent = i["agent"] as? String,
                  let status = i["status"] as? String else { return nil }
            return PaperclipTask(id: id, identifier: i["identifier"] as? String, title: title, agent: agent, status: status, result: i["result"] as? String)
        }
    }

    /// Task 3.13: Tinker's proposals for a helper's soul; a malformed entry is left out.
    static func proposals(_ value: Any?) -> [SoulProposal] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let p = entry as? [String: Any], let id = p["id"] as? NSNumber, let field = p["field"] as? String, let text = p["text"] as? String,
                  let reason = p["reason"] as? String, let state = p["state"] as? String else { return nil }
            return SoulProposal(id: id.intValue, field: field, text: text, reason: reason, jobId: (p["jobId"] as? NSNumber)?.intValue ?? 0, state: state)
        }
    }

    /// Task 3.9: a helper's routines; a malformed entry is left out.
    static func routines(_ value: Any?) -> [HelperRoutine] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let r = entry as? [String: Any], let id = r["id"] as? NSNumber, let task = r["task"] as? String, let when = r["when"] as? String
            else { return nil }
            return HelperRoutine(id: id.intValue, task: task, when: when, lastAt: (r["lastAt"] as? String).flatMap(Self.date),
                                 lastSkipped: flag(r["lastSkipped"]))
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
            return TaskComment(id: id.intValue, text: text, createdAt: (c["createdAt"] as? String).flatMap(Self.date))
        }, activity: try activity.map { entry in
            guard let a = entry as? [String: Any], let kind = a["kind"] as? String else { throw invalid("activity") }
            return TaskActivity(kind: kind, at: (a["at"] as? String).flatMap(Self.date))
        }, report: try report(values["report"], id: try int("id"), field: "report"), goal: goal, plan: plan,
           handOffs: Self.ids(values["handOffs"]))
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

    /// ADR-091: ZENO's task branches; a malformed entry is left out.
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
            return ChatInfo(id: id, title: title, updatedAt: (m["updatedAt"] as? String).flatMap(date), messages: (m["messages"] as? NSNumber)?.intValue ?? 0)
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

    /// The `sources` of a `report` event. A source that is not an http(s) address is dropped: nothing else is opened.
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
    /// The provider ZENO runs it as; nil for tools ZENO does not use (local models).
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
