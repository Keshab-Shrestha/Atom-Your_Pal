// Helpers (ADR-081, Task 3.1; the team and souls, ADR-082, Task 3.3): the workers, their souls, jobs and reports, as
// the runtime reports them, and the Helpers window's state. Task text and reports are the user's own; never logged.
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

    public init(id: Int, task: String, state: JobState, createdAt: Date? = nil, endedAt: Date? = nil, step: String? = nil,
                partial: Bool = false, title: String? = nil, summary: String? = nil, error: String? = nil,
                model: String? = nil, modelReason: String? = nil) {
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
    }

    public var hasReport: Bool { title != nil }

    /// The state badge's word: a done job that hit a limit says so.
    public var badge: String { state == .done && partial ? "Partial" : state.title }

    /// How far a running job is, from its step's "n of m" ("Reading 3 of 8 pages" is 3/8), for the Helpers window's
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

    public init(id: String, name: String, available: Bool, app: String?, jobs: [HelperJob], pinnedModel: String? = nil,
                role: String = "", soul: HelperSoul? = nil, soulVersion: Int = 1, soulVersions: [SoulVersion] = []) {
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

/// The `helpers` event.
public struct HelpersList: Sendable, Equatable {
    public var helpers: [Helper]
    /// Installed app names, for the app picker.
    public var apps: [String]
    /// False caps every job at the medium tier (ADR-083). An older runtime sends none: allowed.
    public var allowLarge: Bool
    /// The plan's offered models; empty when the provider is not the Claude plan (or the runtime is older).
    public var models: [HelperModel]

    public init(helpers: [Helper], apps: [String], allowLarge: Bool = true, models: [HelperModel] = []) {
        self.helpers = helpers
        self.apps = apps
        self.allowLarge = allowLarge
        self.models = models
    }

    /// A model's short name ("Sonnet 4.5" for "Claude Sonnet 4.5"); the id itself when it is not in `models`.
    public func shortName(_ modelId: String) -> String {
        guard let name = models.first(where: { $0.id == modelId })?.name else { return modelId }
        return name.hasPrefix("Claude ") ? String(name.dropFirst("Claude ".count)) : name
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

/// What the Helpers window shows: the runtime's list, the chosen helper, and the report being read. Actions return
/// the command to send (or nil when there is nothing to send), so the window's logic is testable without a screen.
public struct HelpersState: Sendable, Equatable {
    public static let maxTaskLength = 1000

    public private(set) var list: HelpersList?
    public private(set) var selectedHelperId: String?
    /// The job whose report is open.
    public private(set) var openJobId: Int?
    /// The chosen helper's soul is open for editing (Task 3.3).
    public private(set) var isSoulOpen = false
    public private(set) var report: HelperReport?
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
    public var openJob: HelperJob? { selectedHelper?.jobs.first { $0.id == openJobId } }

    public mutating func apply(_ event: IslandEvent) {
        switch event {
        case .helpers(let newList):
            list = newList
            isWaiting = false
            problem = nil
            if selectedHelper == nil {
                selectedHelperId = (newList.helpers.first(where: \.available) ?? newList.helpers.first)?.id
                isSoulOpen = false
            }
            if openJobId != nil, openJob?.hasReport != true { closeReport() } // deleted, or its report is gone
        case .report(let newReport) where newReport.id == openJobId:
            report = newReport
        case .error(let error) where claims(event):
            isWaiting = false
            problem = error.message
        default:
            break
        }
    }

    /// Any listed worker can be chosen, so a worker not ready for jobs can still have its soul shaped.
    public mutating func selectHelper(_ id: String) {
        guard list?.helpers.contains(where: { $0.id == id }) == true, id != selectedHelperId else { return }
        selectedHelperId = id
        closeReport()
        isSoulOpen = false
        problem = nil
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

    /// "Allow the large model for helpers". Nil without models (the switch means nothing then) or when unchanged.
    public mutating func setAllowLarge(_ allow: Bool) -> IslandCommand? {
        guard let list, !list.models.isEmpty, list.allowLarge != allow else { return nil }
        return waiting(.helpersSettings(allowLarge: allow))
    }

    /// Nil for an empty or too long task (the runtime would refuse it).
    public mutating func addJob(_ task: String) -> IslandCommand? {
        let clean = task.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let helper = selectedHelper, helper.available, !clean.isEmpty, clean.count <= Self.maxTaskLength else { return nil }
        return waiting(.jobAdd(helper: helper.id, task: clean))
    }

    public mutating func stopJob(_ id: Int) -> IslandCommand? {
        guard selectedHelper?.jobs.first(where: { $0.id == id })?.state.isActive == true else { return nil }
        return waiting(.jobStop(id: id))
    }

    public mutating func deleteJob(_ id: Int) -> IslandCommand? {
        guard selectedHelper?.jobs.contains(where: { $0.id == id }) == true else { return nil }
        if id == openJobId { closeReport() }
        return waiting(.jobDelete(id: id))
    }

    /// Opens a job's report: asks the runtime for it. Nil for a job without one.
    public mutating func openReport(_ id: Int) -> IslandCommand? {
        guard selectedHelper?.jobs.first(where: { $0.id == id })?.hasReport == true else { return nil }
        isSoulOpen = false
        openJobId = id
        report = nil
        return waiting(.reportGet(id: id))
    }

    public mutating func closeReport() {
        openJobId = nil
        report = nil
    }

    private mutating func waiting(_ command: IslandCommand) -> IslandCommand {
        isWaiting = true
        problem = nil
        return command
    }
}
