// Helpers (ADR-081, Task 3.1; the team and souls, ADR-082, Task 3.3): the workers, their souls, jobs and reports, as
// the runtime reports them, and the ATOM window's state. Task text and reports are the user's own; never logged.
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

/// ADR-095: a sub-agent a task's run started, as its thread lists it: name, state, what it was asked and its result.
public struct HelperSubAgent: Sendable, Equatable {
    public enum State: String, Sendable, Equatable { case started, done, failed }

    public var name: String
    public var state: State
    public var description: String
    public var result: String?

    public init(name: String, state: State, description: String = "", result: String? = nil) {
        self.name = name
        self.state = state
        self.description = description
        self.result = result
    }

    /// The state in the thread's words.
    public var stateTitle: String {
        switch state {
        case .started: "Working"
        case .done: "Done"
        case .failed: "Failed"
        }
    }

    /// The line under its name: the result once it has one, else what it was asked.
    public var detail: String? {
        if let result, !result.isEmpty { return result }
        return description.isEmpty ? nil : description
    }
}

/// B3.4: one file a task's run edited or created, and whether its edit can be undone.
public struct HelperCheckpoint: Sendable, Equatable {
    public enum Kind: String, Sendable, Equatable { case modified, created }
    public enum State: String, Sendable, Equatable { case ready, changed, undone, skipped }

    /// Relative to the folder grant.
    public var path: String
    public var kind: Kind
    public var state: State
    public var reason: String?

    public init(path: String, kind: Kind, state: State, reason: String? = nil) {
        self.path = path
        self.kind = kind
        self.state = state
        self.reason = reason
    }
}

/// B3.1: one tool call of a task's runs, as its thread lists it (oldest first).
public struct HelperToolCall: Sendable, Equatable {
    public enum State: String, Sendable, Equatable { case started, ok, error }

    public var id: String
    public var agent: String?
    public var tool: String
    public var input: String
    public var state: State
    public var result: String?
    public var at: Date
    public var durationMs: Int?

    public init(id: String, agent: String? = nil, tool: String, input: String, state: State, result: String? = nil,
                at: Date, durationMs: Int? = nil) {
        self.id = id
        self.agent = agent
        self.tool = tool
        self.input = input
        self.state = state
        self.result = result
        self.at = at
        self.durationMs = durationMs
    }

    /// "850 ms", "2.3s", "1m 5s"; nil while it has no duration.
    public var durationText: String? {
        guard let ms = durationMs, ms >= 0 else { return nil }
        if ms < 1000 { return "\(ms) ms" }
        if ms < 60_000 { return String(format: "%.1fs", Double(ms) / 1000) }
        return "\(ms / 60_000)m \(ms / 1000 % 60)s"
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
    /// Why a runnable task waits for Keshab (a plan to approve, an interrupted run).
    public var held: String?
    /// ADR-098 item 3: Keshab interrupted its run; it waits for his next message.
    public var interrupted: Bool
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
    /// ADR-095: the sub-agents its runs started (the newest).
    public var subAgents: [HelperSubAgent]
    /// ADR-098: its labels, sorted.
    public var labels: [String]
    public var isFinished: Bool { state == .done || state == .failed }
    /// ADR-094: a done task (not one of Tinker's) can become a skill.
    public var canBecomeSkill: Bool { state == .done && reviews == nil }

    public init(id: Int, task: String, state: JobState, createdAt: Date? = nil, endedAt: Date? = nil, step: String? = nil,
                partial: Bool = false, title: String? = nil, summary: String? = nil, error: String? = nil,
                model: String? = nil, modelReason: String? = nil, blockedBy: [Int] = [], waitingFor: [Int] = [],
                comments: Int = 0, goal: String? = nil, parentId: Int? = nil, goalId: Int? = nil, goalEnded: Bool = false,
                resumable: Bool = false, held: String? = nil, interrupted: Bool = false, planFirst: Bool = false, planStatus: String? = nil,
                planSummary: String? = nil, rating: String? = nil, reviews: Int? = nil, autoRetries: Int = 0,
                subAgents: [HelperSubAgent] = [], labels: [String] = []) {
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
        self.interrupted = interrupted
        self.planFirst = planFirst
        self.planStatus = planStatus
        self.planSummary = planSummary
        self.rating = rating
        self.reviews = reviews
        self.autoRetries = autoRetries
        self.subAgents = subAgents
        self.labels = labels
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

    /// How far a running job is, from its step's "n of m" ("Reading 3 of 8 pages" is 3/8), for the ATOM window's
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
    /// Task 3.8: its new tasks plan first.
    public var planFirst: Bool
    /// ADR-098: its runs get ATOM's browser (false from an older runtime).
    public var browser: Bool
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
    /// ADR-094: its wake-ups; nil when off (the default) or from an older runtime.
    public var wakeUp: HelperWakeUp?
    /// ADR-095: its Manager's id; nil when it has none (Tinker) or from an older runtime.
    public var manager: String?
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
                planFirst: Bool = false, routines: [HelperRoutine] = [], grants: [String] = [], skills: [String] = [], proposals: [SoulProposal] = [], kit: String? = nil, custom: Bool = false,
                wakeUp: HelperWakeUp? = nil, manager: String? = nil, browser: Bool = false) {
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
        self.planFirst = planFirst
        self.browser = browser
        self.routines = routines
        self.grants = grants
        self.skills = skills
        self.proposals = proposals
        self.kit = kit
        self.custom = custom
        self.wakeUp = wakeUp
        self.manager = manager
    }

    /// ADR-094: may it take tasks (and so wake up for team tasks)? Tinker reviews only.
    public var takesTasks: Bool { available && role != "improver" }

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

    /// The card's second line: the newest running job's step, or Idle. ADR-095: with several running, "N at work · step".
    public var activity: String {
        let running = jobs.filter { $0.state == .running }
        guard let newest = running.first else { return "Idle" }
        let step = newest.step ?? "Working…"
        return running.count > 1 ? "\(running.count) at work · \(step)" : step
    }
}

/// ADR-095: a Manager: a domain (Research, Coding…) with Agents under it. "plan": it plans and reviews (short no-tools
/// runs, its own tasks in `jobs`); "group": a department only, no model calls.
public struct HelperManager: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var mode: String
    public var soul: HelperSoul?
    public var soulVersion: Int
    /// Its Agents' ids.
    public var agents: [String]
    /// Its own runs (plan mode), newest first.
    public var jobs: [HelperJob]

    public init(id: String, name: String, mode: String = "group", soul: HelperSoul? = nil, soulVersion: Int = 1,
                agents: [String] = [], jobs: [HelperJob] = []) {
        self.id = id
        self.name = name
        self.mode = mode
        self.soul = soul
        self.soulVersion = soulVersion
        self.agents = agents
        self.jobs = jobs
    }

    public var plansAndReviews: Bool { mode == "plan" }
    /// The mode in words, as the window says it.
    public var modeTitle: String { plansAndReviews ? "Plans and reviews" : "Group only" }
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

    /// Failed tasks need you, and held tasks (a plan to approve, an interrupted run); stopped ones are done with.
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
    /// ADR-098 item 3: a message to the running task: "live" (it took it) or "after" (it runs once more after the run).
    public var delivery: String?

    public init(id: Int, text: String, createdAt: Date?, delivery: String? = nil) {
        self.id = id
        self.text = text
        self.createdAt = createdAt
        self.delivery = delivery
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
        case "split": "Split the work across its agents" // ADR-095: a Manager's run
        case "revised": "Asked for a revision"
        case "interrupted": "Interrupted"
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
    /// ADR-098 item 8: the ATOM-made skills a done task's runs used (each can take the task as a test case).
    public var testSkills: [String]
    /// B3.1: the tool calls of its runs, oldest first; none from an older runtime.
    public var toolCalls: [HelperToolCall]
    /// B3.4: the file edits of its runs that can be undone; none from an older runtime.
    public var checkpoints: [HelperCheckpoint]
    /// B3.4: a command ran, so files may have changed that ATOM did not track.
    public var bashRan: Bool

    public init(id: Int, comments: [TaskComment], activity: [TaskActivity], report: HelperReport? = nil, goal: HelperGoal? = nil,
                plan: JobPlan? = nil, handOffs: [Int] = [], testSkills: [String] = [], toolCalls: [HelperToolCall] = [],
                checkpoints: [HelperCheckpoint] = [], bashRan: Bool = false) {
        self.checkpoints = checkpoints
        self.bashRan = bashRan
        self.toolCalls = toolCalls
        self.testSkills = testSkills
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

/// ADR-093: an agent folder whose soul.md could not be loaded: its folder name and why, shown on the Board.
public struct AgentProblem: Sendable, Equatable {
    public var id: String
    public var problem: String

    public init(id: String, problem: String) {
        self.id = id
        self.problem = problem
    }

    /// "bad: soul.md needs front matter …", as the Board lists it.
    public var line: String { "\(id): \(problem)" }
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
    /// Task 3.12: the skills to choose from (Keshab's in ~/.claude/skills and, ADR-094, ATOM's own).
    public var skills: [SkillInfo]
    /// ADR-094: Tinker's skill drafts and edits: every pending one and the newest few others.
    public var skillDrafts: [SkillDraftItem]
    public var skillEdits: [SkillEditItem]
    /// B3.5: the skills hub; empty from an older runtime.
    public var skillHub: HubState
    /// Task 3.16: the tasks handed to Keshab's Paperclip; nil when the connection is off.
    public var paperclip: [PaperclipTask]?
    /// ADR-090: Keshab's MCP servers.
    public var mcp: [McpServerItem]
    /// ADR-091: tokens used today and in the last 7 days; nil from an older runtime.
    public var usage: TokenUsageSummary?
    /// ADR-093: agent folders that could not be loaded; empty when every one loaded.
    public var agentProblems: [AgentProblem]
    /// ADR-094: the team tasks waiting to be taken, oldest first.
    public var teamTasks: [TeamTask]
    /// ADR-095: the Managers; empty when there are none (or from an older runtime): then the Board and floor show workers.
    public var managers: [HelperManager]
    /// ADR-098 item 8: every saved test case, newest first.
    public var testCases: [TestCaseItem]
    /// ADR-098 item 7: "Use Codex when the Claude plan limit is reached" (default off), and whether Codex is found and
    /// signed in (the switch shows only then). False from an older runtime.
    public var codexFallback: Bool
    public var codexReady: Bool
    /// ADR-111: the newest work plans, newest first; empty when there are none (or from an older runtime).
    public var plans: [WorkPlanItem]

    public init(helpers: [Helper], apps: [String], allowLarge: Bool = true, models: [HelperModel] = [],
                paperclip: [PaperclipTask]? = nil, mcp: [McpServerItem] = [], usage: TokenUsageSummary? = nil, skills: [SkillInfo] = [],
                skillDrafts: [SkillDraftItem] = [], skillEdits: [SkillEditItem] = [], skillHub: HubState = .empty, agentProblems: [AgentProblem] = [], teamTasks: [TeamTask] = [],
                managers: [HelperManager] = [], codexFallback: Bool = false, codexReady: Bool = false, testCases: [TestCaseItem] = [], plans: [WorkPlanItem] = []) {
        self.plans = plans
        self.testCases = testCases
        self.helpers = helpers
        self.apps = apps
        self.allowLarge = allowLarge
        self.models = models
        self.paperclip = paperclip
        self.mcp = mcp
        self.usage = usage
        self.skills = skills
        self.skillDrafts = skillDrafts
        self.skillEdits = skillEdits
        self.skillHub = skillHub
        self.agentProblems = agentProblems
        self.teamTasks = teamTasks
        self.managers = managers
        self.codexFallback = codexFallback
        self.codexReady = codexReady
    }

    /// ADR-095: a Manager's Agents, in the team's order.
    public func agents(of manager: HelperManager) -> [Helper] {
        helpers.filter { $0.manager == manager.id }
    }

    /// ADR-095: a Manager's page's tasks: its Agents' and its own runs, newest first.
    public func tasks(of manager: HelperManager) -> [BoardItem] {
        (agents(of: manager).flatMap { h in h.jobs.map { BoardItem(helperId: h.id, helperName: h.name, job: $0) } }
            + manager.jobs.map { BoardItem(helperId: manager.id, helperName: manager.name, job: $0) })
            .sorted { $0.job.id > $1.job.id }
    }

    /// ADR-094: the roles a team task can be posted for: those of workers that take tasks, sorted, each once.
    public var teamRoles: [String] {
        Array(Set(helpers.filter(\.takesTasks).map(\.role).filter { !$0.isEmpty })).sorted()
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

    /// Any worker's task by id, with its worker. ADR-095: or a Manager's own run.
    public func item(_ id: Int) -> BoardItem? {
        for h in helpers { if let job = h.jobs.first(where: { $0.id == id }) { return BoardItem(helperId: h.id, helperName: h.name, job: job) } }
        for m in managers { if let job = m.jobs.first(where: { $0.id == id }) { return BoardItem(helperId: m.id, helperName: m.name, job: job) } }
        return nil
    }

    /// ADR-095: every task: the workers' and the Managers' own runs (for Overview, Needs you and Issues).
    public var everyTask: [BoardItem] {
        helpers.flatMap { h in h.jobs.map { BoardItem(helperId: h.id, helperName: h.name, job: $0) } }
            + managers.flatMap { m in m.jobs.map { BoardItem(helperId: m.id, helperName: m.name, job: $0) } }
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

/// What the ATOM window shows: the runtime's list, the chosen helper, and the report being read. Actions return
/// the command to send (or nil when there is nothing to send), so the window's logic is testable without a screen.
public struct HelpersState: Sendable, Equatable {
    public static let maxTaskLength = 1000

    public private(set) var list: HelpersList?
    /// When the usage numbers last arrived (the Dashboard says "Updated … ago"). Nil until they do.
    public private(set) var usageUpdatedAt: Date?
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
    /// ADR-091: ATOM's task branches (nil until asked), and the one whose changes are shown.
    public private(set) var git: [GitBranch]?
    public var gitDiff: GitDiff?

    /// ADR-091: a git command from the window; its refusal shows as the window's problem.
    public mutating func gitCommand(_ command: IslandCommand) -> IslandCommand { waiting(command) }

    public init() {}

    /// This event is the runtime refusing the window's last command: it belongs to the window, not ATOM's status
    /// or the model page.
    public func claims(_ event: IslandEvent) -> Bool {
        guard isWaiting, case .error(let error) = event else { return false }
        return error.stage == "settings"
    }

    public var selectedHelper: Helper? { list?.helpers.first { $0.id == selectedHelperId } }
    /// ADR-095: the Manager whose page is open (over the chosen helper's), if any.
    public private(set) var selectedManagerId: String?
    public var selectedManager: HelperManager? { list?.managers.first { $0.id == selectedManagerId } }
    /// ADR-095: the "New manager" form is open.
    public private(set) var isCreatingManager = false
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
            if newList.usage != nil { usageUpdatedAt = Date() }
            // ADR-088: the agent just created is chosen, and its form closes.
            if isCreatingAgent, isWaiting, let old = list, let added = newList.helpers.first(where: { new in !old.helpers.contains { $0.id == new.id } }) {
                isCreatingAgent = false
                selectedHelperId = added.id
            }
            // ADR-095: so is a Manager just created; a removed one's page closes.
            if isCreatingManager, isWaiting, let old = list, let added = newList.managers.first(where: { new in !old.managers.contains { $0.id == new.id } }) {
                isCreatingManager = false
                selectedManagerId = added.id
            }
            if let id = selectedManagerId, !newList.managers.contains(where: { $0.id == id }) { selectedManagerId = nil }
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
        case .git(let branches):
            // ADR-091: the branches came (again, after a push): whatever the window asked is done.
            git = branches
            isWaiting = false
        case .gitDiff(let diff):
            gitDiff = diff
            isWaiting = false // the diff was the answer to the command that set isWaiting; only helpers, git, thread and error cleared it before
        case .thread(let newThread) where newThread.id == openJobId:
            thread = newThread
            // Opening a task set `isWaiting`, and only `helpers`, `git` and `error` cleared it: until one of them came, the next Settings error was
            // swallowed here and never reached its page (code review, 2026-10-16).
            isWaiting = false
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
        isCreatingManager = false
        selectedManagerId = nil
        guard list?.helpers.contains(where: { $0.id == id }) == true else { return }
        if id == selectedHelperId {
            // The agent is already the selected one but may be hidden behind the Board: opening it must leave the Board (code review, 2026-10-16).
            // Anything else (a soul being edited, a task open) stays as it is.
            if showsBoard {
                showsBoard = false
                closeReport()
                isSoulOpen = false
            }
            return
        }
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
        selectedManagerId = nil
        isCreatingManager = false
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
        isCreatingManager = false
        selectedManagerId = nil
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

    /// ADR-098 item 3: Keshab's message to the open task while it runs or waits after an interrupt. Nil for an empty or
    /// too long message, or no open task.
    public mutating func steer(_ text: String) -> IslandCommand? {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let id = openJobId, !clean.isEmpty, clean.count <= 2000 else { return nil }
        return waiting(.jobSteer(id: id, text: clean))
    }

    /// ADR-098 item 3: stops a running task's current step; it then waits for Keshab's message.
    public mutating func interruptJob(_ id: Int) -> IslandCommand? {
        guard list?.item(id)?.job.state == .running else { return nil }
        return waiting(.jobInterrupt(id: id))
    }

    /// ADR-098: adds a label to the open task (the runtime checks it and refuses with words); removes one.
    public mutating func addLabel(_ text: String) -> IslandCommand? {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let id = openJobId, !clean.isEmpty, clean.count <= TaskLabels.maxLength * 2 else { return nil }
        return waiting(.jobLabelAdd(id: id, label: clean))
    }

    public mutating func removeLabel(_ label: String) -> IslandCommand? {
        guard let id = openJobId else { return nil }
        return waiting(.jobLabelRemove(id: id, label: label))
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

    /// ADR-091: renames the open worker: a new soul version with the new name (checked like any soul).
    public mutating func rename(_ name: String) -> IslandCommand? {
        guard var soul = selectedHelper?.soul else { return nil }
        soul.name = name
        return saveSoul(soul)
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

    /// ADR-094: asks Tinker for a skill from the open task, if it is done, not one of Tinker's own and has no draft yet.
    public mutating func makeSkill() -> IslandCommand? {
        guard let job = openJob, job.canBecomeSkill, list?.skillDrafts.contains(where: { $0.jobId == job.id }) != true else { return nil }
        return waiting(.skillMake(id: job.id))
    }

    /// ADR-094: approve or reject a pending skill draft; accept, reject or undo a skill edit.
    public mutating func answerSkillDraft(_ id: Int, approve: Bool) -> IslandCommand? {
        guard list?.skillDrafts.first(where: { $0.id == id })?.state == "pending" else { return nil }
        return waiting(approve ? .skillApprove(id: id) : .skillReject(id: id))
    }

    public mutating func answerSkillEdit(_ id: Int, accept: Bool) -> IslandCommand? {
        guard list?.skillEdits.first(where: { $0.id == id })?.state == "pending" else { return nil }
        return waiting(accept ? .skillEditAccept(id: id) : .skillEditReject(id: id))
    }

    public mutating func undoSkillEdit(_ id: Int) -> IslandCommand? {
        guard list?.skillEdits.first(where: { $0.id == id })?.state == "accepted" else { return nil }
        return waiting(.skillEditUndo(id: id))
    }

    /// B3.5: the skills hub. Search needs some text; approve and reject need a fetched skill; update needs an installed one.
    public mutating func hubSearch(_ query: String) -> IslandCommand? {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        return waiting(.skillHubSearch(query: String(text.prefix(60))))
    }

    public mutating func hubPreview(_ result: HubSkillResult) -> IslandCommand? {
        waiting(.skillHubPreview(source: result.source, path: result.path))
    }

    public mutating func answerHub(_ id: Int, approve: Bool) -> IslandCommand? {
        guard list?.skillHub.pending.contains(where: { $0.id == id }) == true else { return nil }
        return waiting(approve ? .skillHubApprove(id: id) : .skillHubReject(id: id))
    }

    public mutating func hubUninstall(_ name: String) -> IslandCommand? {
        guard list?.skillHub.installed.contains(where: { $0.name == name }) == true else { return nil }
        return waiting(.skillHubUninstall(name: name))
    }

    public mutating func hubUpdate(_ name: String) -> IslandCommand? {
        guard list?.skillHub.installed.contains(where: { $0.name == name }) == true else { return nil }
        return waiting(.skillHubUpdate(name: name))
    }

    /// ADR-098 item 8: saves the open done task as a test case for its agent ("soul") or a ATOM-made skill it used ("skill").
    public mutating func saveTestCase(kind: String, target: String) -> IslandCommand? {
        guard let job = openJob, job.state == .done, job.reviews == nil,
              list?.testCases.contains(where: { $0.jobId == job.id && $0.kind == kind && $0.target == target }) != true else { return nil }
        return waiting(.testcaseSave(jobId: job.id, kind: kind, target: target))
    }

    public mutating func deleteTestCase(_ id: Int) -> IslandCommand? {
        guard list?.testCases.contains(where: { $0.id == id }) == true else { return nil }
        return waiting(.testcaseDelete(id: id))
    }

    /// ADR-098 item 8: runs a pending soul proposal's ("soul") or skill edit's ("skill") test cases again.
    public mutating func runTests(kind: String, id: Int) -> IslandCommand? {
        waiting(.testcaseRun(kind: kind, id: id))
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

    /// ADR-094, the Scheduled page: any worker's routine, paused or resumed, or deleted.
    public mutating func pauseRoutine(_ id: Int, paused: Bool) -> IslandCommand? {
        guard let routine = routine(id), routine.paused != paused else { return nil }
        return waiting(.routinePause(id: id, paused: paused))
    }

    /// ADR-097: Keshab's own schedule, new (`id` nil) or changed. Nil, with a problem, without a task or a worker that
    /// takes tasks.
    public mutating func saveRoutine(_ id: Int?, _ draft: RoutineDraft) -> IslandCommand? {
        var clean = draft
        clean.task = draft.task.trimmingCharacters(in: .whitespacesAndNewlines)
        if clean.task.isEmpty { problem = "A schedule needs a task."; return nil }
        guard list?.helpers.contains(where: { $0.id == clean.helper && $0.takesTasks }) == true else {
            problem = "Choose an agent that takes tasks."
            return nil
        }
        if let id { return waiting(.routineUpdate(id: id, clean)) }
        return waiting(.routineAdd(clean))
    }

    public mutating func deleteAnyRoutine(_ id: Int) -> IslandCommand? {
        guard routine(id) != nil else { return nil }
        return waiting(.routineDelete(id: id))
    }

    private func routine(_ id: Int) -> HelperRoutine? {
        list?.helpers.lazy.compactMap { $0.routines.first { $0.id == id } }.first
    }

    /// ADR-094: a worker's wake-ups: "off", "15m", "1h", "4h" or "1d". Nil when unchanged or the worker takes no tasks.
    public mutating func setWakeUp(_ helperId: String, every: String) -> IslandCommand? {
        guard let helper = list?.helpers.first(where: { $0.id == helperId }), helper.takesTasks,
              HelperWakeUp.choices.contains(where: { $0.every == every }) || every == "off",
              (helper.wakeUp?.every ?? "off") != every else { return nil }
        return waiting(.helperWakeUp(helper: helperId, every: every))
    }

    public mutating func pauseWakeUp(_ helperId: String, paused: Bool) -> IslandCommand? {
        guard let wake = list?.helpers.first(where: { $0.id == helperId })?.wakeUp, wake.paused != paused else { return nil }
        return waiting(.helperWakeUpPause(helper: helperId, paused: paused))
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

    /// ADR-098: whether the chosen worker's runs get the browser. Nil when unchanged or the worker is not ready for jobs.
    public mutating func setBrowser(_ on: Bool) -> IslandCommand? {
        guard let helper = selectedHelper, helper.available, helper.browser != on else { return nil }
        return waiting(.helperBrowser(helper: helper.id, on: on))
    }

    // MARK: ADR-095: Managers

    /// Opens a Manager's page: its Agents, mode and their tasks.
    public mutating func selectManager(_ id: String) {
        guard list?.managers.contains(where: { $0.id == id }) == true else { return }
        selectedManagerId = id
        isCreatingAgent = false
        isCreatingManager = false
        showsBoard = false
        isSoulOpen = false
        closeReport()
        problem = nil
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
        // Any open task, a Manager's run included (it opens from Needs you without a chosen worker).
        guard list?.item(id)?.job.state.isActive == true else { return nil }
        return waiting(.jobStop(id: id))
    }

    /// Task 3.6: the open task forgets its session; nil while it runs or when it has none.
    public mutating func startFresh() -> IslandCommand? {
        guard let job = openJob, job.resumable, job.state != .running else { return nil }
        return waiting(.jobFresh(id: job.id))
    }

    /// B3.4: puts back the open task's file edits (one `path`, or all); the answer is the next thread event.
    public mutating func undoCheckpoints(jobId: Int, path: String? = nil, force: Bool = false) -> IslandCommand? {
        guard jobId == openJobId, thread?.checkpoints.isEmpty == false else { return nil }
        return waiting(.jobUndo(id: jobId, path: path, force: force))
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

    /// ADR-096: puts the team page back as it was at `location` (Back). Gone agents and Managers are not chosen again.
    /// Returns the thread to ask for when a task was open.
    public mutating func show(_ location: WindowLocation) -> IslandCommand? {
        if let id = location.helperId, id != selectedHelperId, list?.helpers.contains(where: { $0.id == id }) == true {
            selectedHelperId = id
            draftBlockers = []
        }
        selectedManagerId = location.managerId.flatMap { id in list?.managers.contains { $0.id == id } == true ? id : nil }
        showsBoard = location.showsBoard
        isCreatingAgent = location.creatingAgent
        isCreatingManager = location.creatingManager
        problem = nil
        if let id = location.jobId, list?.item(id) != nil { return openThread(id) }
        closeReport()
        isSoulOpen = location.soulOpen && selectedHelper?.soul != nil
        return nil
    }

    public mutating func closeReport() {
        openJobId = nil
        openJobSeen = nil
        thread = nil
    }

    /// The runtime stopped or restarted: nothing it was asked will be answered, so nothing is waited for.
    public mutating func runtimeStopped() {
        // A command that was waiting for an answer is lost with the runtime. Saying so keeps a form (a schedule, a task) open with its text instead of
        // closing it as if it had been saved (code check, 2026-10-16).
        if isWaiting && problem == nil { problem = "ATOM was not running, so that was not done. Try again." }
        isWaiting = false
    }

    private mutating func waiting(_ command: IslandCommand) -> IslandCommand {
        isWaiting = true
        problem = nil
        return command
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
    /// ADR-094: paused (it makes nothing), and when it next comes due (nil while paused or from an older runtime).
    public var paused: Bool
    public var nextAt: Date?
    /// ADR-097: the schedule as numbers, for the Edit form (nil from an older runtime).
    public var schedule: RoutineSchedule?
    /// ADR-098: each result goes to Telegram.
    public var notifyTelegram: Bool
    /// ADR-098 item 5: the local API's webhook may start it.
    public var webhook: Bool

    public init(id: Int, task: String, when: String, lastAt: Date? = nil, lastSkipped: Bool = false, paused: Bool = false, nextAt: Date? = nil, schedule: RoutineSchedule? = nil, notifyTelegram: Bool = false, webhook: Bool = false) {
        self.id = id
        self.notifyTelegram = notifyTelegram
        self.webhook = webhook
        self.schedule = schedule
        self.task = task
        self.when = when
        self.lastAt = lastAt
        self.lastSkipped = lastSkipped
        self.paused = paused
        self.nextAt = nextAt
    }
}

/// Task 3.12: one of the skills a worker can be given: Keshab's ("yours") or, ADR-094, made by ATOM ("zeno").
/// One skill's whole SKILL.md (front matter and steps) for the editor in Plugins → Skills.
public struct SkillFileData: Sendable, Equatable {
    public var name: String
    /// "yours" (~/.claude/skills) or "zeno" (ATOM's own folder).
    public var source: String
    public var text: String

    public init(name: String, source: String = "yours", text: String) {
        self.name = name
        self.source = source
        self.text = text
    }
}

public struct SkillInfo: Sendable, Equatable, Identifiable {
    public var name: String
    public var description: String
    public var source: String
    public var id: String { name }

    public init(name: String, description: String, source: String = "yours") {
        self.name = name
        self.description = description
        self.source = source
    }

    public var sourceTitle: String { source == "zeno" ? "made by ATOM" : "yours" }
}

/// ADR-094: Tinker's draft of a new skill from a task, waiting for Keshab's OK (or answered).
public struct SkillDraftItem: Sendable, Equatable, Identifiable {
    public var id: Int
    public var jobId: Int
    public var helper: String
    public var name: String
    public var description: String
    /// The start of its steps.
    public var preview: String
    /// "pending", "approved" or "rejected".
    public var state: String

    public init(id: Int, jobId: Int, helper: String, name: String, description: String, preview: String, state: String) {
        self.id = id
        self.jobId = jobId
        self.helper = helper
        self.name = name
        self.description = description
        self.preview = preview
        self.state = state
    }
}

/// ADR-094: Tinker's edit to one of ATOM's skills: why, and a compact before and after.
public struct SkillEditItem: Sendable, Equatable, Identifiable {
    public var id: Int
    public var skill: String
    public var jobId: Int
    public var reason: String
    public var before: String
    public var after: String
    /// "pending", "accepted", "rejected" or "undone".
    public var state: String
    /// ADR-098 item 8: its test run, when the skill has test cases.
    public var tests: TestRunSummary?

    public init(id: Int, skill: String, jobId: Int, reason: String, before: String, after: String, state: String, tests: TestRunSummary? = nil) {
        self.tests = tests
        self.id = id
        self.skill = skill
        self.jobId = jobId
        self.reason = reason
        self.before = before
        self.after = after
        self.state = state
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
    /// ADR-098 item 8: its test run, when the agent has test cases.
    public var tests: TestRunSummary?

    public init(id: Int, field: String, text: String, reason: String, jobId: Int, state: String, tests: TestRunSummary? = nil) {
        self.tests = tests
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

/// Task 3.16: a task ATOM handed to an agent in Keshab's own Paperclip.
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

/// ADR-091: tokens one or more runs used, and their API-equivalent dollars (the plan does not charge them).
public struct TokenTotals: Sendable, Equatable {
    public var input: Int, output: Int, cacheRead: Int, cacheWrite: Int
    public var dollars: Double
    public var runs: Int

    public init(input: Int = 0, output: Int = 0, cacheRead: Int = 0, cacheWrite: Int = 0, dollars: Double = 0, runs: Int = 0) {
        self.input = input
        self.output = output
        self.cacheRead = cacheRead
        self.cacheWrite = cacheWrite
        self.dollars = dollars
        self.runs = runs
    }

    public var total: Int { input + output + cacheRead + cacheWrite }
    /// Token cost, job 4: what you typed and what ATOM answered. The Dashboard's main number; the cache counts are shown apart.
    public var io: Int { input + output }
    /// Everything but what was read back from the cache (which counts far less toward the plan's limits).
    public var fresh: Int { input + output + cacheWrite }
    /// ADR-098 item 9: the share of the prompt read back from the cache (cache reads ÷ all prompt tokens); nil without any.
    public var cacheHitRate: Double? {
        let prompt = input + cacheRead + cacheWrite
        return prompt > 0 ? Double(cacheRead) / Double(prompt) : nil
    }
    /// "73%", or "–" without any prompt tokens.
    public var cacheHitText: String { cacheHitRate.map { String(format: "%.0f%%", $0 * 100) } ?? "–" }

    /// 850, 12.4K, 3.1M.
    public static func short(_ n: Int) -> String {
        switch n {
        case ..<1000: "\(n)"
        case ..<1_000_000: String(format: n < 10000 ? "%.1fK" : "%.0fK", Double(n) / 1000)
        default: String(format: "%.1fM", Double(n) / 1_000_000)
        }
    }
}

public struct DayTokens: Sendable, Equatable {
    /// YYYY-MM-DD, local.
    public var day: String
    public var totals: TokenTotals
}

public struct WorkerTokens: Sendable, Equatable {
    /// Nil: ATOM's own chat.
    public var helper: String?
    public var name: String
    public var totals: TokenTotals
}

public struct ModelTokens: Sendable, Equatable {
    public var model: String
    public var totals: TokenTotals
}

/// Token cost, job 4: one recent call, for the Dashboard's list of turns.
public struct RecentTokens: Sendable, Equatable {
    public enum Kind: String, Sendable { case turn, note, job, other }
    public var at: Date?
    public var kind: Kind
    public var model: String
    public var input: Int, output: Int, cacheRead: Int, cacheWrite: Int
    /// Milliseconds since the last call of the same chat and model; nil for the first.
    public var gapMs: Int?

    public init(at: Date? = nil, kind: Kind, model: String, input: Int, output: Int, cacheRead: Int, cacheWrite: Int, gapMs: Int? = nil) {
        self.at = at
        self.kind = kind
        self.model = model
        self.input = input
        self.output = output
        self.cacheRead = cacheRead
        self.cacheWrite = cacheWrite
        self.gapMs = gapMs
    }

    public var io: Int { input + output }

    /// The row's first column: "This turn", "Note", "Job" or "Other" (calls Claude Code made itself).
    public var kindTitle: String {
        switch kind { case .turn: "This turn"; case .note: "Note"; case .job: "Job"; case .other: "Other" }
    }

    /// "This turn: 18 tokens · cache written: 6.1k · cache read: 0".
    public var splitLine: String {
        let who = switch kind { case .turn: "This turn"; case .note: "Note"; case .job: "Job"; case .other: "Other" }
        return "\(who): \(TokenTotals.short(io)) tokens · cache written: \(TokenTotals.short(cacheWrite)) · cache read: \(TokenTotals.short(cacheRead))"
    }
}

/// ADR-091: the Dashboard's tokens: today, the week, each of the last 7 days, each worker and each model.
public struct TokenUsageSummary: Sendable, Equatable {
    public var today: TokenTotals
    public var week: TokenTotals
    public var days: [DayTokens]
    public var byWorker: [WorkerTokens]
    public var byModel: [ModelTokens]
    /// ADR-098 item 9: ATOM's last chat answers read nothing from the cache.
    public var chatCacheCold: Bool
    /// Token cost, job 4: the newest calls, newest first; empty from an older runtime.
    public var recent: [RecentTokens]

    public init(today: TokenTotals, week: TokenTotals, days: [DayTokens] = [], byWorker: [WorkerTokens] = [], byModel: [ModelTokens] = [], chatCacheCold: Bool = false, recent: [RecentTokens] = []) {
        self.recent = recent
        self.today = today
        self.week = week
        self.days = days
        self.byWorker = byWorker
        self.byModel = byModel
        self.chatCacheCold = chatCacheCold
    }
}

/// How today's input + output compares with a usual day (2026-10-15): the Dashboard's lead number says more with it.
public enum UsageTrend: Sendable, Equatable {
    case above(percent: Int)
    case below(percent: Int)
    case usual

    /// "12% above a usual day so far", "about a usual day so far".
    public var text: String {
        switch self {
        case .above(let percent): "\(percent)% above a usual day so far"
        case .below(let percent): "\(percent)% below a usual day so far"
        case .usual: "about a usual day so far"
        }
    }
}

extension TokenUsageSummary {
    /// Today against the mean of the other days that had any use. Nil when no other day had use. Within 5% is "usual".
    /// Today is the last day in `days`; it is a partial day, which the words say ("so far").
    public var todayTrend: UsageTrend? {
        let others = days.dropLast().map(\.totals.io).filter { $0 > 0 }
        guard !others.isEmpty else { return nil }
        let mean = Double(others.reduce(0, +)) / Double(others.count)
        let change = (Double(today.io) - mean) / mean * 100
        let percent = Int(abs(change).rounded())
        if percent < 5 { return .usual }
        return change > 0 ? .above(percent: percent) : .below(percent: percent)
    }
}

/// ADR-091: one of ATOM's task branches, like a pull request.
public struct GitBranch: Sendable, Equatable, Identifiable {
    public enum Pushed: String, Sendable { case no, yes, changed }

    public var id: String { "\(repo)#\(branch)" }
    public var repo: String
    public var repoName: String
    public var branch: String
    public var task: Int
    public var title: String?
    public var base: String
    public var commits: [GitCommit]
    public var files: [GitFile]
    /// `origin`'s address, without credentials; nil when there is none (then it cannot be pushed).
    public var remote: String?
    public var pushed: Pushed

    public init(repo: String, repoName: String, branch: String, task: Int, title: String? = nil, base: String = "", commits: [GitCommit] = [],
                files: [GitFile] = [], remote: String? = nil, pushed: Pushed = .no) {
        self.repo = repo
        self.repoName = repoName
        self.branch = branch
        self.task = task
        self.title = title
        self.base = base
        self.commits = commits
        self.files = files
        self.remote = remote
        self.pushed = pushed
    }

    /// It can be pushed: it has a remote and something the remote does not have.
    public var canPush: Bool { remote != nil && pushed != .yes && !commits.isEmpty }
    public var added: Int { files.compactMap(\.added).reduce(0, +) }
    public var removed: Int { files.compactMap(\.removed).reduce(0, +) }
}

public struct GitCommit: Sendable, Equatable {
    public var sha: String
    public var subject: String
    public var at: Date?

    public init(sha: String, subject: String, at: Date? = nil) {
        self.sha = sha
        self.subject = subject
        self.at = at
    }
}

public struct GitFile: Sendable, Equatable {
    public var path: String
    /// Nil for a binary file.
    public var added: Int?
    public var removed: Int?

    public init(path: String, added: Int?, removed: Int?) {
        self.path = path
        self.added = added
        self.removed = removed
    }
}

/// ADR-091: a branch's changes since its base, as a patch (cut when long).
public struct GitDiff: Sendable, Equatable {
    public var repo: String
    public var branch: String
    public var text: String
    public var truncated: Bool

    public init(repo: String, branch: String, text: String, truncated: Bool) {
        self.repo = repo
        self.branch = branch
        self.text = text
        self.truncated = truncated
    }
}
