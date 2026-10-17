// The commands the island sends to the runtime, and how each is written as one JSON line (split out of Protocol.swift, 2026-10-16).
import Foundation

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
    /// Remembering by itself (upgrades.md C2): the suggestions (and their changes from then on), accept one (with the user's own
    /// words if he edited it), deny one, and the switch.
    case suggestionsGet
    case suggestionsAccept(id: Int, text: String?)
    case suggestionsDeny(id: Int)
    case suggestionsSet(enabled: Bool)
    /// The second brain: the graph (and its changes from then on), one note, a save (`id` nil: a new note; else a change or rename),
    /// a delete, a search.
    case brainGet
    case brainNote(id: Int)
    case brainSave(id: Int?, title: String, body: String)
    case brainDelete(id: Int)
    case brainSearch(query: String)
    /// Plugins → Skills: open one skill's SKILL.md for the editor, and save Keshab's edit of it (the answer is `skillFile`).
    /// The "/" picker: ask for Keshab's Claude commands (ADR-117; the answer is `commands`).
    case commandsList
    case skillGet(name: String)
    case skillSave(name: String, text: String)
    /// Conversation notes (ADR-059): forget one, or all.
    case episodeForget(id: Int)
    case episodeClear
    /// A typed request: answered and spoken like a voice turn.
    case textSend(String)
    /// A typed request with attached files (ADR-113): full paths; the runtime copies and checks them. At most 5.
    /// ADR-126: `notes` are Second brain note ids; the runtime sends each as "<title>.md".
    case textSendFiles(text: String, files: [String], notes: [Int] = [])
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
    /// Settings' "Regenerate" next to "Copy token": the runtime makes a new token and answers with an `api` event.
    case apiRegenerate
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
    case grantRemove(helper: String, path: String)
    case jobDelete(id: Int)
    /// ADR-083: pin a helper to a model (`""` lets Laya choose again); allow or forbid the large model for jobs.
    case helperPin(helper: String, model: String)
    case helpersSettings(allowLarge: Bool)
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
        case .suggestionsGet: "suggestions.get"
        case .suggestionsAccept: "suggestions.accept"
        case .suggestionsDeny: "suggestions.deny"
        case .suggestionsSet: "suggestions.set"
        case .brainGet: "brain.get"
        case .brainNote: "brain.note"
        case .brainSave: "brain.save"
        case .brainDelete: "brain.delete"
        case .brainSearch: "brain.search"
        case .commandsList: "commands.list"
        case .skillGet: "skill.get"
        case .skillSave: "skill.save"
        case .episodeForget: "episode.forget"
        case .episodeClear: "episode.clear"
        case .textSend, .textSendFiles: "text.send"
        case .contextWindow: "context.window"
        case .helpersList: "helpers.list"
        case .speechSet: "speech.set"
        case .telegramSet: "telegram.set"
        case .apiSet: "api.set"
        case .apiRegenerate: "api.regenerate"
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
        case .grantRemove: "grant.remove"
        case .jobDelete: "job.delete"
        case .helperPin: "helper.pin"
        case .helpersSettings: "helpers.settings"
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
        switch self {
        case .suggestionsAccept(let id, let text):
            fields["id"] = id
            if let text { fields["text"] = text }
        case .suggestionsDeny(let id):
            fields["id"] = id
        case .suggestionsSet(let enabled):
            fields["enabled"] = enabled // a real JSON boolean
        default:
            break
        }
        switch self {
        case .brainNote(let id), .brainDelete(let id):
            fields["id"] = id
        case .brainSave(let id, let title, let body):
            if let id { fields["id"] = id }
            fields["title"] = title
            fields["body"] = body
        case .brainSearch(let query):
            fields["query"] = query
        case .skillGet(let name):
            fields["name"] = name
        case .skillSave(let name, let text):
            fields["name"] = name
            fields["text"] = text
        default:
            break
        }
        if case .textSend(let text) = self {
            fields["text"] = text
        }
        if case .textSendFiles(let text, let files, let notes) = self {
            fields["text"] = text
            fields["files"] = files
            if !notes.isEmpty { fields["notes"] = notes }
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
        case .agentRemove(let id):
            fields["id"] = id
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
        case .jobStop(let id), .jobInterrupt(let id), .jobFresh(let id), .planApprove(let id), .planReject(let id), .routineDelete(let id), .jobDelete(let id), .threadGet(let id):
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
        case .helperPin(let helper, let model):
            fields["helper"] = helper
            fields["model"] = model
        case .helpersSettings(let allowLarge):
            fields["allowLarge"] = allowLarge // a real JSON boolean
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

extension IslandCommand {
    /// A multi-line field as its non-empty lines.
    static func lines(_ text: String) -> [String] {
        text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
}
