// The messages exchanged with the ATOM runtime. Specification: docs/island-protocol.md.
import Foundation

public let supportedProtocolVersion = 1

/// The voice loop's state, as reported by the runtime.
public enum LoopState: String, Sendable, Equatable {
    case idle, listening, transcribing, thinking, speaking
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
    /// ADR-054: no step for a while and no approval waits: the computer work is over (any turn, not only the voice loop's).
    case computerEnd
    /// ATOM shows the user a place on screen: Pal flies there and the bubble says what it is (ADR-054).
    case computerPoint(PointTarget)
    /// ATOM is waiting for the user to allow or decline an action.
    case approvalRequest(ApprovalRequest)
    /// That request is no longer waiting: answered, declined, timed out or cancelled.
    case approvalClosed(id: String)
    case info(ModelInfo)
    /// What ATOM keeps (ADR-058): after `memory.list`, and after every change from then on.
    case memory(MemoryList)
    /// Remembering by itself (upgrades.md C2): whether suggestions are made, and the ones that wait (after `suggestions.get`, and after each change).
    case suggestions(SuggestionsList)
    /// Daily brief: the settings, the newest briefs and whether one is being made (after `brief.get`, and after each change).
    case brief(BriefList)
    /// Ask ATOM: the answer to a `text.edit`, by its id.
    case textEditResult(id: String, answer: EditAnswer)
    /// The second brain: the notes and their links (after `brain.get`, and after each change from then on); one note; search hits.
    case brain(BrainGraphData)
    case brainNote(BrainNoteData)
    case brainHits(query: String, hits: [BrainHit])
    /// Keshab's Claude commands for the "/" picker (ADR-117).
    case commands([SlashCommandInfo])
    /// A skill's whole SKILL.md for the editor (the answer to `skillGet` and `skillSave`).
    case skillFile(SkillFileData)
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
    case chatControl(ChatControlResponse)
    case chatWork(ChatWorkSnapshot)
    case foregroundReceipt(ForegroundReceipt)
    case foregroundRecovery(ForegroundRecoveryResponse)
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
        case .computerEnd: "computer.end"
        case .computerPoint: "computer.point"
        case .approvalRequest: "approval.request"
        case .approvalClosed: "approval.closed"
        case .info: "info"
        case .memory: "memory"
        case .suggestions: "suggestions"
        case .brief: "brief"
        case .textEditResult: "text.edit.result"
        case .brain: "brain"
        case .brainNote: "brain.note"
        case .brainHits: "brain.hits"
        case .commands: "commands"
        case .skillFile: "skill.file"
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
        case .chatControl: "chat.control"
        case .chatWork: "chat.work"
        case .foregroundReceipt: "foreground.receipt"
        case .foregroundRecovery: "foreground.recovery"
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
            telegram: f.optionalBool("telegram") ?? false,
            computer: f.optionalBool("computer") ?? false))
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
    case "computer.end":
        return .computerEnd
    case "computer.point":
        let w = try f.double("w"), h = try f.double("h")
        guard w > 0, h > 0 else { throw ProtocolError.invalidValue(event: "computer.point", field: w > 0 ? "h" : "w") }
        return .computerPoint(PointTarget(x: try f.double("x"), y: try f.double("y"), w: w, h: h, label: try f.string("label")))
    case "approval.request":
        return .approvalRequest(ApprovalRequest(id: try f.string("id"), summary: try f.string("summary"), reason: try f.string("reason"), rememberFile: f.optionalBool("rememberFile") ?? false))
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
    case "suggestions":
        return .suggestions(SuggestionsList(enabled: f.optionalBool("enabled") ?? false, items: Fields.suggestions(f.values["items"])))
    case "brief":
        return .brief(Fields.briefList(f.values))
    case "text.edit.result":
        let id = try f.string("id")
        if let message = f.optionalString("error") { return .textEditResult(id: id, answer: .failed(message)) }
        guard let answer = f.values["answer"] as? String else { throw ProtocolError.missingField(event: type, field: "answer") }
        return .textEditResult(id: id, answer: .answer(answer, changed: f.optionalBool("changed") ?? true))
    case "brain":
        return .brain(Fields.brainGraph(f.values))
    case "brain.note":
        guard let note = Fields.brainNote(f.values["note"]) else { throw ProtocolError.invalidValue(event: type, field: "note") }
        return .brainNote(note)
    case "commands":
        return .commands(Fields.slashCommands(f.values["commands"]))
    case "skill.file":
        return .skillFile(SkillFileData(name: try f.string("name"), source: f.optionalString("source") ?? "yours", text: try f.string("text")))
    case "brain.hits":
        return .brainHits(query: f.optionalString("query") ?? "", hits: Fields.brainHits(f.values["hits"]))
    case "capabilities":
        return .capabilities(try f.capabilities())
    case "plan.usage":
        return .planUsage(PlanUsage(fiveHour: f.usageFraction("fiveHour"), sevenDay: f.usageFraction("sevenDay"), overage: f.optionalBool("overage"),
                                    resetAt: (f.values["resetAt"] as? NSNumber).map(\.doubleValue).flatMap { $0.isFinite && $0 > 0 && $0 < 4_102_444_800 ? $0 : nil },
                                    limited: f.optionalBool("limited")))
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
    case "chat.control":
        return .chatControl(try JSONDecoder().decode(ChatControlResponse.self, from: JSONSerialization.data(withJSONObject: f.values)))
    case "chat.work":
        let work = try JSONDecoder().decode(ChatWorkSnapshot.self, from: JSONSerialization.data(withJSONObject: f.values))
        guard work.valid else { throw ProtocolError.invalidValue(event: "chat.work", field: "payload") }
        return .chatWork(work)
    case "foreground.receipt":
        return .foregroundReceipt(try JSONDecoder().decode(ForegroundReceipt.self, from: JSONSerialization.data(withJSONObject: f.values)))
    case "foreground.recovery":
        return .foregroundRecovery(try JSONDecoder().decode(ForegroundRecoveryResponse.self, from: JSONSerialization.data(withJSONObject: f.values)))
    case "chat.opened":
        return .chatOpened(id: try f.string("id"), lines: Fields.chatLines(f.values["messages"]),
                           projectId: f.optionalString("projectId"), trimmed: f.values["trimmed"] as? Bool ?? false)
    case "helpers":
        return .helpers(HelpersList(helpers: try f.helpers(), apps: try f.strings("apps"),
                                    allowLarge: try f.optionalStrictBool("allowLarge") ?? true, models: try f.helperModels(),
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
                                    testCases: Fields.testCases(f.values["testCases"]),
                                    plans: Fields.plans(f.values["plans"])))
    case "thread":
        return .thread(try f.thread())
    case "search.results":
        return .searchResults(SearchResults(query: f.optionalString("query") ?? "", chats: Fields.searchHits(f.values["chats"]),
                                            tasks: Fields.searchHits(f.values["tasks"]), reports: Fields.searchHits(f.values["reports"]),
                                            groups: Dictionary(uniqueKeysWithValues: SearchKind.allCases.map { ($0, Fields.searchHits(f.values[$0.rawValue])) })))
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
               soulVersion: (h["soulVersion"] as? NSNumber)?.intValue ?? 1, soulVersions: versions,
               planFirst: Self.flag(h["planFirst"]), routines: Self.routines(h["routines"]),
               grants: (h["grants"] as? [Any])?.compactMap { $0 as? String } ?? [],
               skills: (h["skills"] as? [Any])?.compactMap { $0 as? String } ?? [],
               proposals: Self.proposals(h["proposals"]), kit: h["kit"] as? String, custom: Self.flag(h["custom"]),
               browser: Self.flag(h["browser"]))
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
                         labels: (j["labels"] as? [Any] ?? []).compactMap { $0 as? String }, recoveryNeeded: Self.flag(j["recoveryNeeded"]),
                         retryOf: (j["retryOf"] as? NSNumber)?.intValue, retriedAs: (j["retriedAs"] as? NSNumber)?.intValue)
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

    private static func wholeNumber(_ value: Any?) -> Int? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        return n.intValue
    }

    private static func brainKind(_ value: Any?) -> BrainKind {
        (value as? String).flatMap(BrainKind.init(rawValue:)) ?? .note
    }

    private static func brainLinks(_ value: Any?) -> [BrainLink] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let l = entry as? [String: Any], let id = wholeNumber(l["id"]), let title = l["title"] as? String else { return nil }
            return BrainLink(id: id, title: title, kind: brainKind(l["kind"]), ghost: flag(l["ghost"]), auto: flag(l["auto"]))
        }
    }

    /// The second brain's graph; absent fields read as empty, and a malformed node or edge is left out.
    static func brainGraph(_ values: [String: Any]) -> BrainGraphData {
        let nodes: [BrainNode] = (values["nodes"] as? [Any] ?? []).compactMap { entry in
            guard let n = entry as? [String: Any], let id = wholeNumber(n["id"]), let title = n["title"] as? String else { return nil }
            return BrainNode(id: id, title: title, kind: brainKind(n["kind"]), ghost: flag(n["ghost"]),
                             tags: (n["tags"] as? [Any] ?? []).compactMap { $0 as? String }, degree: wholeNumber(n["degree"]) ?? 0,
                             updatedAt: (n["updatedAt"] as? String).flatMap(Self.date))
        }
        let edges: [BrainEdge] = (values["edges"] as? [Any] ?? []).compactMap { entry in
            guard let e = entry as? [String: Any], let a = wholeNumber(e["a"]), let b = wholeNumber(e["b"]) else { return nil }
            return BrainEdge(a: a, b: b, auto: flag(e["auto"]))
        }
        let tags: [BrainTag] = (values["tags"] as? [Any] ?? []).compactMap { entry in
            guard let t = entry as? [String: Any], let tag = t["tag"] as? String, let count = wholeNumber(t["count"]) else { return nil }
            return BrainTag(tag: tag, count: count)
        }
        return BrainGraphData(nodes: nodes, edges: edges, omitted: wholeNumber(values["omitted"]) ?? 0, tags: tags)
    }

    /// The "/" picker's commands; an entry without a name is left out.
    static func slashCommands(_ value: Any?) -> [SlashCommandInfo] {
        (value as? [[String: Any]] ?? []).compactMap { entry in
            guard let name = entry["name"] as? String, !name.isEmpty else { return nil }
            return SlashCommandInfo(name: name, description: entry["description"] as? String ?? "", hint: entry["hint"] as? String ?? "")
        }
    }

    static func brainNote(_ value: Any?) -> BrainNoteData? {
        guard let n = value as? [String: Any], let id = wholeNumber(n["id"]), let title = n["title"] as? String else { return nil }
        return BrainNoteData(id: id, title: title, body: n["body"] as? String ?? "", kind: brainKind(n["kind"]), ghost: flag(n["ghost"]),
                             tags: (n["tags"] as? [Any] ?? []).compactMap { $0 as? String }, links: brainLinks(n["links"]),
                             backlinks: brainLinks(n["backlinks"]), updatedAt: (n["updatedAt"] as? String).flatMap(Self.date))
    }

    static func brainHits(_ value: Any?) -> [BrainHit] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let h = entry as? [String: Any], let id = wholeNumber(h["id"]), let title = h["title"] as? String else { return nil }
            return BrainHit(id: id, title: title, kind: brainKind(h["kind"]), snippet: h["snippet"] as? String ?? "")
        }
    }

    /// ADR-111: the work plans; absent (an older runtime, or none) is empty. A malformed plan or portion is left out.
    static func plans(_ value: Any?) -> [WorkPlanItem] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let p = entry as? [String: Any], let id = p["id"] as? NSNumber, CFGetTypeID(id) != CFBooleanGetTypeID(),
                  let goal = p["goal"] as? String else { return nil }
            let portions: [PlanPortion] = (p["portions"] as? [Any] ?? []).compactMap { raw in
                guard let q = raw as? [String: Any], let n = q["n"] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
                      let agent = q["agent"] as? String, let task = q["task"] as? String,
                      let state = (q["state"] as? String).flatMap(PlanPortion.State.init(rawValue:)) else { return nil }
                let job = (q["job"] as? NSNumber).flatMap { CFGetTypeID($0) == CFBooleanGetTypeID() ? nil : $0.intValue }
                return PlanPortion(n: n.intValue, agent: agent, name: q["name"] as? String ?? agent, task: task, after: ids(q["after"]), job: job, state: state)
            }
            return WorkPlanItem(id: id.intValue, goal: goal, createdAt: (p["createdAt"] as? String).flatMap(Self.date), portions: portions,
                                complete: flag(p["complete"]), stuck: flag(p["stuck"]))
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
                            readOnly: m["readOnly"] as? Bool ?? false, projectId: m["projectId"] as? String,
                            pinned: m["pinned"] as? Bool ?? false, archived: m["archived"] as? Bool ?? false,
                            flagsVersion: (m["flagsVersion"] as? NSNumber)?.intValue ?? 0)
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
            return ChatLine(fromUser: role == "user", text: text, seq: (m["seq"] as? NSNumber)?.intValue)
        }
    }

    /// The daily brief's settings and history; absent fields read as the defaults, a malformed brief is left out.
    static func briefList(_ values: [String: Any]) -> BriefList {
        var settings = BriefSettings()
        if let s = values["settings"] as? [String: Any] {
            settings.enabled = flag(s["enabled"])
            settings.minute = wholeNumber(s["minute"]).map { min(1439, max(0, $0)) } ?? settings.minute
            settings.events = (s["events"] == nil) ? true : flag(s["events"])
            settings.reminders = (s["reminders"] == nil) ? true : flag(s["reminders"])
            settings.weather = (s["weather"] == nil) ? true : flag(s["weather"])
            settings.tasks = (s["tasks"] == nil) ? true : flag(s["tasks"])
            settings.needsYou = (s["needsYou"] == nil) ? true : flag(s["needsYou"])
            settings.notify = (s["notify"] == nil) ? true : flag(s["notify"])
            settings.telegram = flag(s["telegram"])
            settings.spoken = flag(s["spoken"])
        }
        let history: [BriefEntry] = (values["history"] as? [Any] ?? []).compactMap { entry in
            guard let b = entry as? [String: Any], let id = wholeNumber(b["id"]), let day = b["day"] as? String else { return nil }
            let lines = (b["lines"] as? [Any] ?? []).compactMap { $0 as? String }
            guard !lines.isEmpty else { return nil }
            return BriefEntry(id: id, day: day, createdAt: (b["createdAt"] as? String).flatMap(Self.date), lines: lines, isPlain: (b["source"] as? String) == "template")
        }
        return BriefList(settings: settings, history: history, running: flag(values["running"]))
    }

    /// Remembering by itself: the facts that wait; a malformed one is left out.
    static func suggestions(_ value: Any?) -> [FactSuggestion] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let s = entry as? [String: Any], let id = wholeNumber(s["id"]), let text = s["text"] as? String else { return nil }
            return FactSuggestion(id: id, text: text, createdAt: (s["createdAt"] as? String).flatMap(Self.date))
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
