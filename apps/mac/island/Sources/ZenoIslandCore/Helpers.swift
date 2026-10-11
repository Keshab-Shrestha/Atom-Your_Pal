// Helpers (ADR-081, Task 3.1; the team and souls, ADR-082, Task 3.3): the workers, their souls, jobs and reports, as
// the runtime reports them, and the ZENO window's state. Task text and reports are the user's own; never logged.
import Foundation

public enum JobState: String, Sendable, Equatable, CaseIterable {
    case queued, running, done, failed, stopped

    /// Stop applies only to these.
    public var isActive: Bool { self == .queued || self == .running }

    public var title: String {
        switch self {
        case .queued: "Queued"
        case .running: "Running"
        case .done: "Done"
        case .failed: "Failed"
        case .stopped: "Stopped"
        }
    }
}

public struct HelperJob: Sendable, Equatable, Identifiable {
    public var id: Int
    public var task: String
    public var state: JobState
    public var createdAt: Date?
    public var endedAt: Date?
    /// What a running job is doing, in plain words.
    public var step: String?
    /// The job hit a limit and ended with what it had.
    public var partial: Bool
    /// Present when the job has a report.
    public var title: String?
    public var summary: String?
    /// Why the job failed.
    public var error: String?
    /// The model id the job runs on, once chosen, and why in plain words ("Laya: moderate", "Pinned") (ADR-083).
    public var model: String?
    public var modelReason: String?
    /// ADR-087: the tasks it waits for, those not done yet, how many notes it has, its goal and the task that made it.
    public var blockedBy: [Int]
    public var waitingFor: [Int]
    public var comments: Int
    public var goal: String?
    public var parentId: Int?
    /// Task 3.5: the goal Pal made it part of, and whether that goal has ended with its combined report.
    public var goalId: Int?
    public var goalEnded: Bool
    /// Task 3.6: its next run continues the last one's Claude session ("Start fresh" forgets it).
    public var resumable: Bool
    /// Task 3.7: why a runnable task waits (a budget used up, the plan above its limit).
    public var held: String?
    /// Task 3.8: its first run only plans; "awaiting" (Keshab's OK) or "approved", and the plan in one line.
    public var planFirst: Bool
    public var planStatus: String?
    public var planSummary: String?
    public var awaitsApproval: Bool { state == .queued && planStatus == "awaiting" }
    /// Task 3.13: Keshab's rating ("good" or "bad"); for a Tinker task, the task it reviews.
    public var rating: String?
    public var reviews: Int?
    /// ADR-090: how many times a failure was retried by itself.
    public var autoRetries: Int
    public var isFinished: Bool { state == .done || state == .failed }

    public init(id: Int, task: String, state: JobState, createdAt: Date? = nil, endedAt: Date? = nil, step: String? = nil,
                partial: Bool = false, title: String? = nil, summary: String? = nil, error: String? = nil,
                model: String? = nil, modelReason: String? = nil, blockedBy: [Int] = [], waitingFor: [Int] = [],
                comments: Int = 0, goal: String? = nil, parentId: Int? = nil, goalId: Int? = nil, goalEnded: Bool = false,
                resumable: Bool = false, held: String? = nil, planFirst: Bool = false, planStatus: String? = nil,
                planSummary: String? = nil, rating: String? = nil, reviews: Int? = nil, autoRetries: Int = 0) {
        self.id = id
        self.task = task
        self.state = state
        self.createdAt = createdAt
        self.endedAt = endedAt
        self.step = step
        self.partial = partial
        self.title = title
        self.summary = summary
        self.error = error
        self.model = model
        self.modelReason = modelReason
        self.blockedBy = blockedBy
        self.waitingFor = waitingFor
        self.comments = comments
        self.goal = goal
        self.parentId = parentId
        self.goalId = goalId
        self.goalEnded = goalEnded
        self.resumable = resumable
        self.held = held
        self.planFirst = planFirst
        self.planStatus = planStatus
        self.planSummary = planSummary
        self.rating = rating
        self.reviews = reviews
        self.autoRetries = autoRetries
    }

    public var hasReport: Bool { title != nil }

    /// Queued but held back by tasks not done yet.
    public var isWaiting: Bool { state == .queued && !waitingFor.isEmpty }

    /// A short name for the task in other tasks' "Waits for": its report's title, else its own words.
    public var shortTitle: String {
        let text = title ?? task
        return text.count > 48 ? String(text.prefix(47)) + "…" : text
    }

    /// The state badge's word: a done job that hit a limit says so.
    public var badge: String { state == .done && partial ? "Partial" : state.title }

    /// How far a running job is, from its step's "n of m" ("Reading 3 of 8 pages" is 3/8), for the ZENO window's
    /// line of light (ADR-084). Nil when the job is not running or its step has no count it can trust.
    public var progress: Double? {
        guard state == .running, let step else { return nil }
        return Self.progress(in: step)
    }

    /// The first "n of m" in `text` as n/m, when 0 ≤ n ≤ m and m > 0.
    public static func progress(in text: String) -> Double? {
        let words = text.split(whereSeparator: \.isWhitespace).map(String.init)
        for i in words.indices.dropFirst().dropLast() where words[i].lowercased() == "of" {
            guard let done = Int(words[i - 1]), let total = Int(words[i + 1].trimmingCharacters(in: .punctuationCharacters)),
                  total > 0, done >= 0, done <= total else { continue }
            return Double(done) / Double(total)
        }
        return nil
    }
}

/// A worker's soul (ADR-082, Task 3.3): who it is and how it works, given to it as instructions for every job.
public struct HelperSoul: Sendable, Equatable {
    public static let limits = (name: 20, personality: 600, howItWorks: 1500, rules: 1500, lessons: 2000)

    public var name: String
    public var personality: String
    public var howItWorks: String
    public var rules: String
    public var lessons: String

    public init(name: String, personality: String, howItWorks: String = "", rules: String = "", lessons: String = "") {
        self.name = name
        self.personality = personality
        self.howItWorks = howItWorks
        self.rules = rules
        self.lessons = lessons
    }

    /// Every field trimmed, as the runtime stores it.
    public var trimmed: HelperSoul {
        let t = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines) }
        return HelperSoul(name: t(name), personality: t(personality), howItWorks: t(howItWorks), rules: t(rules), lessons: t(lessons))
    }

    /// Why the runtime would refuse it, for the obvious cases (the runtime checks again, and names unique); nil when fine.
    public var problem: String? {
        let soul = trimmed
        if soul.name.isEmpty { return "The name is empty." }
        if soul.personality.isEmpty { return "The personality is empty." }
        let over = [("name", soul.name, Self.limits.name), ("personality", soul.personality, Self.limits.personality),
                    ("how it works", soul.howItWorks, Self.limits.howItWorks), ("rules", soul.rules, Self.limits.rules),
                    ("lessons", soul.lessons, Self.limits.lessons)].first { $0.1.count > $0.2 }
        if let (label, text, limit) = over { return "The \(label) is too long (\(text.count) characters, limit \(limit))." }
        return nil
    }
}

/// One saved soul version (newest first in `Helper.soulVersions`).
public struct SoulVersion: Sendable, Equatable, Identifiable {
    public var version: Int
    public var createdAt: Date?
    public var id: Int { version }

    public init(version: Int, createdAt: Date?) {
        self.version = version
        self.createdAt = createdAt
    }
}

public struct Helper: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    /// False for a worker not ready for jobs yet: shown as "coming soon", its soul still editable.
    public var available: Bool
    public var app: String?
    /// Newest first.
    public var jobs: [HelperJob]
    /// The model id this helper is pinned to, skipping Laya; nil when Laya chooses (ADR-083).
    public var pinnedModel: String?
    /// "researcher", "coder", … (fixed in the runtime's code).
    public var role: String
    /// Nil from a runtime older than Task 3.3.
    public var soul: HelperSoul?
    public var soulVersion: Int
    public var soulVersions: [SoulVersion]
    /// Task 3.7: its daily cap and today's spend; nil from an older runtime.
    public var budget: HelperBudget?
    /// Task 3.8: its new tasks plan first.
    public var planFirst: Bool
    /// Task 3.9: its routines, oldest first.
    public var routines: [HelperRoutine]
    /// Task 3.11: the folders it may work in.
    public var grants: [String]
    /// Task 3.12: the skills chosen for it.
    public var skills: [String]
    /// Task 3.13: Tinker's proposals for its soul, newest first.
    public var proposals: [SoulProposal]
    /// ADR-088: what it may use ("research", "folders", "think"; nil from an older runtime), and whether Keshab added it.
    public var kit: String?
    public var custom: Bool
    /// The coder, designer and documenter work in folders Keshab grants.
    public var worksInFolders: Bool { kit.map { $0 == "folders" } ?? ["coder", "designer", "documenter"].contains(role) }
    /// ADR-088: the kit in words.
    public static func kitTitle(_ kit: String) -> String {
        switch kit {
        case "research": "Research: web search and pages"
        case "folders": "Folders: files in folders you grant"
        default: "Think only: no tools"
        }
    }

    public init(id: String, name: String, available: Bool, app: String?, jobs: [HelperJob], pinnedModel: String? = nil,
                role: String = "", soul: HelperSoul? = nil, soulVersion: Int = 1, soulVersions: [SoulVersion] = [],
                budget: HelperBudget? = nil, planFirst: Bool = false, routines: [HelperRoutine] = [], grants: [String] = [], skills: [String] = [], proposals: [SoulProposal] = [], kit: String? = nil, custom: Bool = false) {
        self.id = id
        self.name = name
        self.available = available
        self.app = app
        self.jobs = jobs
        self.pinnedModel = pinnedModel
        self.role = role
        self.soul = soul
        self.soulVersion = soulVersion
        self.soulVersions = soulVersions
        self.budget = budget
        self.planFirst = planFirst
        self.routines = routines
        self.grants = grants
        self.skills = skills
        self.proposals = proposals
        self.kit = kit
        self.custom = custom
    }

    /// The role as the window says it: "Researcher", "Financial information", "HR", ….
    public var roleTitle: String {
        switch role {
        case "financial adviser": "Financial information"
        case "hr": "HR"
        case "improver": "Improver"
        case "": ""
        default: role.prefix(1).uppercased() + role.dropFirst()
        }
    }

    /// The card's second line: the running job's step, or Idle.
    public var activity: String {
        guard let running = jobs.first(where: { $0.state == .running }) else { return "Idle" }
        return running.step ?? "Working…"
    }
}

public enum ModelTier: String, Sendable, Equatable, CaseIterable {
    case small, medium, large
}

/// One of the plan's offered models a helper can be pinned to (ADR-083).
public struct HelperModel: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var tier: ModelTier

    public init(id: String, name: String, tier: ModelTier) {
        self.id = id
        self.name = name
        self.tier = tier
    }
}

/// The task board's columns (ADR-087), in the order shown.
public enum BoardColumn: String, Sendable, Equatable, CaseIterable {
    case needsYou, running, toDo, done

    public var title: String {
        switch self {
        case .needsYou: "Needs you"
        case .running: "Running"
        case .toDo: "To do"
        case .done: "Done"
        }
    }

    /// Failed tasks need you, and (Task 3.7) tasks held by a budget or the plan's limit; stopped ones are done with.
    public static func of(_ job: HelperJob) -> BoardColumn {
        job.held != nil ? .needsYou : of(job.state)
    }

    public static func of(_ state: JobState) -> BoardColumn {
        switch state {
        case .failed: .needsYou
        case .running: .running
        case .queued: .toDo
        case .done, .stopped: .done
        }
    }
}

/// One task on the board, with the worker it belongs to.
public struct BoardItem: Sendable, Equatable, Identifiable {
    public var helperId: String
    public var helperName: String
    public var job: HelperJob
    public var id: Int { job.id }
}

/// One of Keshab's notes on a task.
public struct TaskComment: Sendable, Equatable, Identifiable {
    public var id: Int
    public var text: String
    public var createdAt: Date?

    public init(id: Int, text: String, createdAt: Date?) {
        self.id = id
        self.text = text
        self.createdAt = createdAt
    }
}

/// One line of a task's activity.
public struct TaskActivity: Sendable, Equatable {
    public var kind: String
    public var at: Date?

    public init(kind: String, at: Date?) {
        self.kind = kind
        self.at = at
    }

    /// In plain words.
    public var title: String {
        switch kind {
        case "created": "Added"
        case "waits": "Changed what it waits for"
        case "commented": "Note added"
        case "woken": "Asked again"
        case "fresh": "Set to start fresh"
        case "planned": "Wrote a plan"
        case "approved": "Plan approved"
        case "rejected": "Plan rejected"
        case "handed": "Handed off a sub-task"
        case "retried": "Tried again"
        case "running": "Started"
        case "done": "Finished"
        case "failed": "Failed"
        case "stopped": "Stopped"
        default: kind.prefix(1).uppercased() + kind.dropFirst()
        }
    }
}

/// The `thread` event: a task's notes, activity and report (ADR-087, Task 3.4).
public struct HelperThread: Sendable, Equatable {
    public var id: Int
    public var comments: [TaskComment]
    public var activity: [TaskActivity]
    public var report: HelperReport?
    public var goal: HelperGoal?
    public var plan: JobPlan?
    /// Task 3.10: the sub-tasks it handed off, oldest first.
    public var handOffs: [Int]

    public init(id: Int, comments: [TaskComment], activity: [TaskActivity], report: HelperReport? = nil, goal: HelperGoal? = nil,
                plan: JobPlan? = nil, handOffs: [Int] = []) {
        self.id = id
        self.comments = comments
        self.activity = activity
        self.report = report
        self.goal = goal
        self.plan = plan
        self.handOffs = handOffs
    }
}

/// Task 3.8: what a plan-first run means to do, for Keshab to approve or reject.
public struct JobPlan: Sendable, Equatable {
    public var summary: String
    public var steps: String

    public init(summary: String, steps: String) {
        self.summary = summary
        self.steps = steps
    }

    public var lines: [String] {
        steps.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
}

/// What Pal handed the team in one go (Task 3.5): its tasks, and the combined report once they have all ended.
public struct HelperGoal: Sendable, Equatable {
    public var id: Int
    public var text: String
    public var ended: Bool
    public var tasks: [Int]
    public var report: HelperReport?

    public init(id: Int, text: String, ended: Bool, tasks: [Int], report: HelperReport? = nil) {
        self.id = id
        self.text = text
        self.ended = ended
        self.tasks = tasks
        self.report = report
    }

    /// "2 of 3 tasks done" while it runs; how it ended once it has.
    public func progress(in list: HelpersList?) -> String {
        let done = tasks.filter { list?.item($0)?.job.state == .done }.count
        if ended { return report == nil ? "No task finished." : "\(done) of \(tasks.count) tasks done." }
        return "Working: \(done) of \(tasks.count) tasks done."
    }
}

/// The `helpers` event.
public struct HelpersList: Sendable, Equatable {
    public var helpers: [Helper]
    /// Installed app names, for the app picker.
    public var apps: [String]
    /// False caps every job at the medium tier (ADR-083). An older runtime sends none: allowed.
    public var allowLarge: Bool
    /// The plan's offered models; empty when the provider is not the Claude plan (or the runtime is older).
    public var models: [HelperModel]
    /// Task 3.7: the team's daily cap and spend, and the plan limit (percent); nil from an older runtime.
    public var team: HelperBudget?
    public var planLimit: Int?
    /// Task 3.12: Keshab's skills in ~/.claude/skills.
    public var skills: [SkillInfo]
    /// Task 3.16: the tasks handed to Keshab's Paperclip; nil when the connection is off.
    public var paperclip: [PaperclipTask]?
    /// ADR-090: Keshab's MCP servers.
    public var mcp: [McpServerItem]

    public init(helpers: [Helper], apps: [String], allowLarge: Bool = true, models: [HelperModel] = [], team: HelperBudget? = nil,
                planLimit: Int? = nil, paperclip: [PaperclipTask]? = nil, mcp: [McpServerItem] = [], skills: [SkillInfo] = []) {
        self.helpers = helpers
        self.apps = apps
        self.allowLarge = allowLarge
        self.models = models
        self.team = team
        self.planLimit = planLimit
        self.paperclip = paperclip
        self.mcp = mcp
        self.skills = skills
    }

    /// A model's short name ("Sonnet 4.5" for "Claude Sonnet 4.5"); the id itself when it is not in `models`.
    public func shortName(_ modelId: String) -> String {
        guard let name = models.first(where: { $0.id == modelId })?.name else { return modelId }
        return name.hasPrefix("Claude ") ? String(name.dropFirst("Claude ".count)) : name
    }

    /// Every task of every worker, in the board's columns: what needs you and what runs newest first, what is to do in
    /// the order it will run, what is done newest first. Empty columns are left out.
    public var board: [(column: BoardColumn, items: [BoardItem])] {
        let items = helpers.flatMap { h in h.jobs.map { BoardItem(helperId: h.id, helperName: h.name, job: $0) } }
        return BoardColumn.allCases.compactMap { column in
            let here = items.filter { BoardColumn.of($0.job) == column }
                .sorted { column == .toDo ? $0.job.id < $1.job.id : $0.job.id > $1.job.id }
            return here.isEmpty ? nil : (column, here)
        }
    }

    /// Any worker's task by id, with its worker.
    public func item(_ id: Int) -> BoardItem? {
        for h in helpers { if let job = h.jobs.first(where: { $0.id == id }) { return BoardItem(helperId: h.id, helperName: h.name, job: job) } }
        return nil
    }

    /// Tasks a new task may wait for: any that has not failed or been stopped, newest first.
    public var waitable: [BoardItem] {
        helpers.flatMap { h in h.jobs.map { BoardItem(helperId: h.id, helperName: h.name, job: $0) } }
            .filter { $0.job.state != .failed && $0.job.state != .stopped }
            .sorted { $0.job.id > $1.job.id }
    }

    /// A job row's model line, "Sonnet 4.5 · Laya: moderate"; nil when the job has neither.
    public func modelLine(_ job: HelperJob) -> String? {
        let parts = [job.model.map(shortName), job.modelReason].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

public struct ReportSource: Sendable, Equatable {
    public var title: String
    public var url: URL

    public init(title: String, url: URL) {
        self.title = title
        self.url = url
    }

    /// The address as a URL when it is http or https, else nil: nothing else is ever opened.
    public static func webURL(_ string: String) -> URL? {
        guard let url = URL(string: string), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              url.host?.isEmpty == false else { return nil }
        return url
    }
}

/// The `report` event: one job's report.
public struct HelperReport: Sendable, Equatable {
    public var id: Int
    public var title: String
    public var summary: String
    /// Plain text, paragraphs separated by blank lines.
    public var body: String
    public var sources: [ReportSource]

    public init(id: Int, title: String, summary: String, body: String, sources: [ReportSource]) {
        self.id = id
        self.title = title
        self.summary = summary
        self.body = body
        self.sources = sources
    }

    public var paragraphs: [String] {
        body.components(separatedBy: "\n\n").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }
}

/// What the ZENO window shows: the runtime's list, the chosen helper, and the report being read. Actions return
/// the command to send (or nil when there is nothing to send), so the window's logic is testable without a screen.
public struct HelpersState: Sendable, Equatable {
    public static let maxTaskLength = 1000

    public private(set) var list: HelpersList?
    public private(set) var selectedHelperId: String?
    /// The task whose thread is open (ADR-087), and that thread once the runtime sends it.
    public private(set) var openJobId: Int?
    public private(set) var thread: HelperThread?
    /// The open task as last seen, to notice when its thread needs asking for again.
    private var openJobSeen: HelperJob?
    /// A command the window should send after the last event (asking for the open thread again).
    private var pendingRefresh: IslandCommand?
    /// The chosen helper's soul is open for editing (Task 3.3).
    public private(set) var isSoulOpen = false
    /// The board of every worker's tasks is shown instead of one worker (ADR-087).
    public private(set) var showsBoard = false
    /// What the next task added in the window will wait for.
    public private(set) var draftBlockers: [Int] = []
    /// Why the runtime refused the window's last command, until the next `helpers` event.
    public private(set) var problem: String?
    /// A command from the window is waiting for its answer: a `settings` error now belongs to the window.
    public private(set) var isWaiting = false

    public init() {}

    /// This event is the runtime refusing the window's last command: it belongs to the window, not ZENO's status
    /// or the model page.
    public func claims(_ event: IslandEvent) -> Bool {
        guard isWaiting, case .error(let error) = event else { return false }
        return error.stage == "settings"
    }

    public var selectedHelper: Helper? { list?.helpers.first { $0.id == selectedHelperId } }
    /// The open task, whichever worker it belongs to.
    public var openItem: BoardItem? { openJobId.flatMap { list?.item($0) } }
    public var openJob: HelperJob? { openItem?.job }
    /// The open task's report, once its thread has come.
    public var report: HelperReport? { thread?.report }

    /// The command the window should send now, if any (the open thread changed). Taken once.
    public mutating func takeRefresh() -> IslandCommand? {
        defer { pendingRefresh = nil }
        return pendingRefresh
    }

    public mutating func apply(_ event: IslandEvent) {
        switch event {
        case .helpers(let newList):
            // ADR-088: the agent just created is chosen, and its form closes.
            if isCreatingAgent, isWaiting, let old = list, let added = newList.helpers.first(where: { new in !old.helpers.contains { $0.id == new.id } }) {
                isCreatingAgent = false
                selectedHelperId = added.id
            }
            list = newList
            isWaiting = false
            problem = nil
            if selectedHelper == nil {
                selectedHelperId = (newList.helpers.first(where: \.available) ?? newList.helpers.first)?.id
                isSoulOpen = false
            }
            draftBlockers = draftBlockers.filter { id in newList.waitable.contains { $0.id == id } }
            if let id = openJobId {
                guard let job = openJob else { closeReport(); break } // deleted
                // Its state, notes or blockers changed: ask for the thread again.
                if job != openJobSeen { pendingRefresh = .threadGet(id: id) }
                openJobSeen = job
            }
        case .thread(let newThread) where newThread.id == openJobId:
            thread = newThread
        case .error(let error) where claims(event):
            isWaiting = false
            problem = error.message
        default:
            break
        }
    }

    /// Any listed worker can be chosen, so a worker not ready for jobs can still have its soul shaped.
    public mutating func selectHelper(_ id: String) {
        isCreatingAgent = false
        guard list?.helpers.contains(where: { $0.id == id }) == true, id != selectedHelperId else { return }
        selectedHelperId = id
        showsBoard = false
        closeReport()
        isSoulOpen = false
        draftBlockers = []
        problem = nil
    }

    /// ADR-088: the "New agent" form is open.
    public private(set) var isCreatingAgent = false

    public mutating func openNewAgent() {
        closeReport()
        showsBoard = false
        isSoulOpen = false
        isCreatingAgent = true
        problem = nil
    }

    public mutating func closeNewAgent() {
        isCreatingAgent = false
        problem = nil
    }

    /// Nil with `problem` set for an obviously incomplete agent; the runtime checks the rest.
    public mutating func createAgent(role: String, kit: String, soul: HelperSoul) -> IslandCommand? {
        let clean = soul.trimmed
        let roleClean = role.trimmingCharacters(in: .whitespacesAndNewlines)
        if clean.name.isEmpty || roleClean.isEmpty || clean.personality.isEmpty {
            problem = "A new agent needs a name, a role and a personality."
            return nil
        }
        guard ["research", "folders", "think"].contains(kit) else { return nil }
        return waiting(.agentCreate(name: clean.name, role: roleClean, kit: kit, soul: clean))
    }

    /// Removes the chosen agent, if Keshab added it.
    public mutating func removeAgent() -> IslandCommand? {
        guard let helper = selectedHelper, helper.custom else { return nil }
        return waiting(.agentRemove(id: helper.id))
    }

    public mutating func selectBoard() {
        isCreatingAgent = false
        showsBoard = true
        closeReport()
        isSoulOpen = false
        problem = nil
    }

    /// Adds or removes a task the next new task will wait for.
    public mutating func toggleDraftBlocker(_ id: Int) {
        if let at = draftBlockers.firstIndex(of: id) { draftBlockers.remove(at: at) }
        else if list?.waitable.contains(where: { $0.id == id }) == true { draftBlockers.append(id) }
    }

    /// Adds Keshab's note to the open task. Nil for an empty or too long note, or no open task.
    public mutating func addComment(_ text: String) -> IslandCommand? {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let id = openJobId, !clean.isEmpty, clean.count <= 2000 else { return nil }
        return waiting(.commentAdd(id: id, text: clean))
    }

    /// Adds or removes a task the open, not yet started task waits for.
    public mutating func toggleBlocker(_ id: Int) -> IslandCommand? {
        guard let job = openJob, job.state == .queued, id != job.id else { return nil }
        let next = job.blockedBy.contains(id) ? job.blockedBy.filter { $0 != id } : job.blockedBy + [id]
        return waiting(.jobBlock(id: job.id, blockedBy: next))
    }

    public mutating func openSoul() {
        guard selectedHelper?.soul != nil else { return }
        closeReport()
        isSoulOpen = true
        problem = nil
    }

    public mutating func closeSoul() {
        isSoulOpen = false
        problem = nil
    }

    /// Saves the chosen worker's edited soul. Nil when unchanged, or with `problem` set when obviously invalid.
    public mutating func saveSoul(_ soul: HelperSoul) -> IslandCommand? {
        guard let helper = selectedHelper, let current = helper.soul else { return nil }
        let clean = soul.trimmed
        if let reason = clean.problem {
            problem = reason
            return nil
        }
        guard clean != current else { return nil }
        return waiting(.soulSet(helper: helper.id, soul: clean))
    }

    /// Makes a listed older version current again. Nil for the current version or one not listed.
    public mutating func restoreSoul(_ version: Int) -> IslandCommand? {
        guard let helper = selectedHelper, version != helper.soulVersion,
              helper.soulVersions.contains(where: { $0.version == version }) else { return nil }
        return waiting(.soulRestore(helper: helper.id, version: version))
    }

    /// `app` nil means none.
    public mutating func setApp(_ app: String?) -> IslandCommand? {
        guard let helper = selectedHelper, helper.available, helper.app != app else { return nil }
        return waiting(.helperSet(helper: helper.id, app: app ?? ""))
    }

    /// Pins the chosen helper to a model, or lets Laya choose again (`modelId` nil). Nil when there are no models
    /// (not the Claude plan), the model is not offered, or nothing changes.
    public mutating func pinModel(_ modelId: String?) -> IslandCommand? {
        guard let helper = selectedHelper, helper.available, let models = list?.models, !models.isEmpty,
              helper.pinnedModel != modelId else { return nil }
        if let modelId, !models.contains(where: { $0.id == modelId }) { return nil }
        return waiting(.helperPin(helper: helper.id, model: modelId ?? ""))
    }

    /// Task 3.14: the app the open task's report opens in, when it has a report and its worker has an app.
    public var openTaskApp: String? {
        guard let item = openItem, item.job.state == .done, report != nil else { return nil }
        return list?.helpers.first { $0.id == item.helperId }?.app
    }

    public mutating func openReportInApp() -> IslandCommand? {
        guard openTaskApp != nil, let id = openJobId else { return nil }
        return waiting(.jobOpen(id: id))
    }

    /// Task 3.13: rates the open task, if it has finished and is not one of Tinker's reviews.
    public mutating func rate(good: Bool, comment: String = "") -> IslandCommand? {
        guard let job = openJob, job.isFinished, job.reviews == nil else { return nil }
        let clean = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        return waiting(.jobRate(id: job.id, good: good, comment: clean.isEmpty ? nil : String(clean.prefix(2000))))
    }

    /// Tinker's proposals for the chosen worker: accept or reject a pending one; undo an accepted one.
    public mutating func answerProposal(_ id: Int, accept: Bool) -> IslandCommand? {
        guard selectedHelper?.proposals.first(where: { $0.id == id })?.state == "pending" else { return nil }
        return waiting(accept ? .proposalAccept(id: id) : .proposalReject(id: id))
    }

    public mutating func undoProposal(_ id: Int) -> IslandCommand? {
        guard selectedHelper?.proposals.first(where: { $0.id == id })?.state == "accepted" else { return nil }
        return waiting(.proposalUndo(id: id))
    }

    /// Task 3.12: adds or removes one of Keshab's skills for the chosen worker.
    public mutating func toggleSkill(_ name: String) -> IslandCommand? {
        guard let helper = selectedHelper, helper.available, list?.skills.contains(where: { $0.name == name }) == true else { return nil }
        let next = helper.skills.contains(name) ? helper.skills.filter { $0 != name } : (helper.skills + [name]).sorted()
        return waiting(.helperSkills(helper: helper.id, skills: next))
    }

    /// Task 3.11: grants the chosen worker a folder (the runtime checks which folders may be granted).
    public mutating func addGrant(_ path: String) -> IslandCommand? {
        guard let helper = selectedHelper, helper.worksInFolders, !path.isEmpty, !helper.grants.contains(path) else { return nil }
        return waiting(.grantAdd(helper: helper.id, path: path))
    }

    public mutating func removeGrant(_ path: String) -> IslandCommand? {
        guard let helper = selectedHelper, helper.grants.contains(path) else { return nil }
        return waiting(.grantRemove(helper: helper.id, path: path))
    }

    /// Task 3.9: removes one of the chosen worker's routines.
    public mutating func deleteRoutine(_ id: Int) -> IslandCommand? {
        guard selectedHelper?.routines.contains(where: { $0.id == id }) == true else { return nil }
        return waiting(.routineDelete(id: id))
    }

    /// ADR-090: MCP servers: add (checked by the runtime), remove, test, turn on or off, trust, choose workers.
    public mutating func addMcp(_ draft: McpServerDraft) -> IslandCommand? {
        let name = draft.name.trimmingCharacters(in: .whitespaces)
        if name.isEmpty || (draft.kind == "command" ? draft.command.trimmingCharacters(in: .whitespaces).isEmpty : draft.url.trimmingCharacters(in: .whitespaces).isEmpty) {
            problem = draft.kind == "command" ? "A server needs a name and a command." : "A server needs a name and an address."
            return nil
        }
        return waiting(.mcpAdd(draft))
    }

    public mutating func mcpCommand(_ command: IslandCommand) -> IslandCommand? { waiting(command) }

    public mutating func clearProblem() { problem = nil }

    /// ADR-090: tries a failed or stopped task again.
    public mutating func retry(_ id: Int) -> IslandCommand? {
        guard let state = list?.item(id)?.job.state, state == .failed || state == .stopped else { return nil }
        return waiting(.jobRetry(id: id))
    }

    /// ADR-090: the same answers from the Needs you inbox, for any task or worker (not only the open or chosen one).
    public mutating func answerPlan(_ id: Int, approve: Bool) -> IslandCommand? {
        guard list?.item(id)?.job.awaitsApproval == true else { return nil }
        return waiting(approve ? .planApprove(id: id) : .planReject(id: id))
    }

    public mutating func answerProposal(helper: String, id: Int, accept: Bool) -> IslandCommand? {
        guard list?.helpers.first(where: { $0.id == helper })?.proposals.first(where: { $0.id == id })?.state == "pending" else { return nil }
        return waiting(accept ? .proposalAccept(id: id) : .proposalReject(id: id))
    }

    /// Task 3.8: approve or reject the open task's waiting plan; nil when no plan waits.
    public mutating func approvePlan() -> IslandCommand? {
        guard let job = openJob, job.awaitsApproval else { return nil }
        return waiting(.planApprove(id: job.id))
    }

    public mutating func rejectPlan() -> IslandCommand? {
        guard let job = openJob, job.awaitsApproval else { return nil }
        return waiting(.planReject(id: job.id))
    }

    /// Whether the chosen worker's new tasks plan first. Nil when unchanged or the worker is not ready for jobs.
    public mutating func setPlanFirst(_ on: Bool) -> IslandCommand? {
        guard let helper = selectedHelper, helper.available, helper.planFirst != on else { return nil }
        return waiting(.helperPlanFirst(helper: helper.id, on: on))
    }

    /// Task 3.7: the chosen worker's daily cap (nil: none). Nil when unchanged or from an older runtime.
    public mutating func setBudget(_ cap: Double?) -> IslandCommand? {
        guard let helper = selectedHelper, let budget = helper.budget, budget.cap != cap else { return nil }
        return waiting(.helperBudget(helper: helper.id, cap: cap))
    }

    public mutating func setTeamBudget(_ cap: Double?) -> IslandCommand? {
        guard let team = list?.team, team.cap != cap else { return nil }
        return waiting(.helperBudget(helper: "team", cap: cap))
    }

    public mutating func setPlanLimit(_ percent: Int) -> IslandCommand? {
        guard let limit = list?.planLimit, limit != percent, (10...100).contains(percent) else { return nil }
        return waiting(.helpersPlanLimit(percent))
    }

    /// "Allow the large model for helpers". Nil without models (the switch means nothing then) or when unchanged.
    public mutating func setAllowLarge(_ allow: Bool) -> IslandCommand? {
        guard let list, !list.models.isEmpty, list.allowLarge != allow else { return nil }
        return waiting(.helpersSettings(allowLarge: allow))
    }

    /// Nil for an empty or too long task (the runtime would refuse it).
    public mutating func addJob(_ task: String) -> IslandCommand? {
        let clean = task.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let helper = selectedHelper, helper.available, !clean.isEmpty, clean.count <= Self.maxTaskLength else { return nil }
        defer { draftBlockers = [] }
        return waiting(.jobAdd(helper: helper.id, task: clean, blockedBy: draftBlockers))
    }

    public mutating func stopJob(_ id: Int) -> IslandCommand? {
        guard selectedHelper?.jobs.first(where: { $0.id == id })?.state.isActive == true else { return nil }
        return waiting(.jobStop(id: id))
    }

    /// Task 3.6: the open task forgets its session; nil while it runs or when it has none.
    public mutating func startFresh() -> IslandCommand? {
        guard let job = openJob, job.resumable, job.state != .running else { return nil }
        return waiting(.jobFresh(id: job.id))
    }

    public mutating func deleteJob(_ id: Int) -> IslandCommand? {
        guard selectedHelper?.jobs.contains(where: { $0.id == id }) == true else { return nil }
        if id == openJobId { closeReport() }
        return waiting(.jobDelete(id: id))
    }

    /// Opens any worker's task: its thread, with the report if it has one. Asks the runtime for it.
    public mutating func openThread(_ id: Int) -> IslandCommand? {
        guard let job = list?.item(id)?.job else { return nil }
        isSoulOpen = false
        openJobId = id
        openJobSeen = job
        thread = nil
        return waiting(.threadGet(id: id))
    }

    public mutating func closeReport() {
        openJobId = nil
        openJobSeen = nil
        thread = nil
    }

    private mutating func waiting(_ command: IslandCommand) -> IslandCommand {
        isWaiting = true
        problem = nil
        return command
    }
}

/// Task 3.7: a daily cap in dollars of API-equivalent use (what the work would cost on the API; the plan does not charge
/// it) and today's spend.
public struct HelperBudget: Sendable, Equatable {
    public var cap: Double?
    public var spent: Double

    public init(cap: Double?, spent: Double) {
        self.cap = cap
        self.spent = spent
    }

    /// The caps the window offers; nil is "No cap".
    public static let presets: [Double?] = [1, 2, 5, 10, 20, 50, nil]

    public var isOver: Bool { cap.map { spent >= $0 } ?? false }
    /// At 80 % of the cap, before it is used up.
    public var isNear: Bool { cap.map { !isOver && spent >= $0 * 0.8 } ?? false }

    public static func dollars(_ value: Double) -> String { String(format: "$%.2f", value) }
    public static func capTitle(_ cap: Double?) -> String { cap.map { String(format: "$%.0f a day", $0) } ?? "No cap" }

    /// "$1.20 of $5.00 today", or "$1.20 today" without a cap.
    public var line: String {
        cap.map { "\(Self.dollars(spent)) of \(Self.dollars($0)) today" } ?? "\(Self.dollars(spent)) today"
    }
}

/// Task 3.9: a schedule that makes a task for a worker, as the runtime describes it.
public struct HelperRoutine: Sendable, Equatable, Identifiable {
    public var id: Int
    public var task: String
    /// "Every day at 8:00 AM".
    public var when: String
    public var lastAt: Date?
    /// The last time it came due, its previous task was still going, so it made none.
    public var lastSkipped: Bool

    public init(id: Int, task: String, when: String, lastAt: Date? = nil, lastSkipped: Bool = false) {
        self.id = id
        self.task = task
        self.when = when
        self.lastAt = lastAt
        self.lastSkipped = lastSkipped
    }
}

/// Task 3.12: one of Keshab's skills.
public struct SkillInfo: Sendable, Equatable, Identifiable {
    public var name: String
    public var description: String
    public var id: String { name }

    public init(name: String, description: String) {
        self.name = name
        self.description = description
    }
}

/// Task 3.13: Tinker's proposed change to a worker's soul.
public struct SoulProposal: Sendable, Equatable, Identifiable {
    public var id: Int
    /// "personality", "howItWorks", "rules" or "lessons".
    public var field: String
    /// The whole new text of that field.
    public var text: String
    public var reason: String
    public var jobId: Int
    /// "pending", "accepted", "rejected" or "undone".
    public var state: String

    public init(id: Int, field: String, text: String, reason: String, jobId: Int, state: String) {
        self.id = id
        self.field = field
        self.text = text
        self.reason = reason
        self.jobId = jobId
        self.state = state
    }

    public var fieldTitle: String {
        switch field {
        case "personality": "Personality"
        case "howItWorks": "How it works"
        case "rules": "Rules"
        default: "Lessons learned"
        }
    }
}

/// Task 3.16: a task ZENO handed to an agent in Keshab's own Paperclip.
public struct PaperclipTask: Sendable, Equatable, Identifiable {
    public var id: String
    public var identifier: String?
    public var title: String
    public var agent: String
    public var status: String
    /// The newest comment once it is done.
    public var result: String?

    public init(id: String, identifier: String? = nil, title: String, agent: String, status: String, result: String? = nil) {
        self.id = id
        self.identifier = identifier
        self.title = title
        self.agent = agent
        self.status = status
        self.result = result
    }

    public var isDone: Bool { ["done", "cancelled", "canceled"].contains(status) }
}

/// ADR-090: one of Keshab's MCP servers, as the window sees it (never a secret value).
public struct McpServerItem: Sendable, Equatable, Identifiable {
    public var id: Int
    public var name: String
    /// "command" or "url".
    public var kind: String
    public var command: String?
    public var args: [String]
    public var url: String?
    public var transport: String
    public var envKeys: [String]
    public var headerKeys: [String]
    public var enabled: Bool
    public var trusted: Bool
    public var workers: [String]
    public var tools: [String]
    public var tested: Bool
    public var problem: String?

    public init(id: Int, name: String, kind: String, command: String? = nil, args: [String] = [], url: String? = nil, transport: String = "http",
                envKeys: [String] = [], headerKeys: [String] = [], enabled: Bool = false, trusted: Bool = false, workers: [String] = [],
                tools: [String] = [], tested: Bool = false, problem: String? = nil) {
        self.id = id
        self.name = name
        self.kind = kind
        self.command = command
        self.args = args
        self.url = url
        self.transport = transport
        self.envKeys = envKeys
        self.headerKeys = headerKeys
        self.enabled = enabled
        self.trusted = trusted
        self.workers = workers
        self.tools = tools
        self.tested = tested
        self.problem = problem
    }

    /// Ready to turn on: a test listed its tools.
    public var canTurnOn: Bool { tested && problem == nil }
}

/// ADR-090: the Add server form.
public struct McpServerDraft: Sendable, Equatable {
    public var name = ""
    /// "command" or "url".
    public var kind = "command"
    public var command = ""
    /// One per line.
    public var args = ""
    public var env = ""
    public var url = ""
    public var transport = "http"
    public var headers = ""

    public init() {}
}
