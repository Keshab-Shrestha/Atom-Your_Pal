// Helpers (ADR-081, Task 3.1): Sid, Kame and Puff, their jobs and reports, as the runtime reports them, and the
// Helpers window's state. Task text and reports are the user's own; never logged.
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

    public init(id: Int, task: String, state: JobState, createdAt: Date? = nil, endedAt: Date? = nil, step: String? = nil,
                partial: Bool = false, title: String? = nil, summary: String? = nil, error: String? = nil) {
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
    }

    public var hasReport: Bool { title != nil }

    /// The state badge's word: a done job that hit a limit says so.
    public var badge: String { state == .done && partial ? "Partial" : state.title }
}

public struct Helper: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    /// False for a helper not built yet: shown as "coming soon".
    public var available: Bool
    public var app: String?
    /// Newest first.
    public var jobs: [HelperJob]

    public init(id: String, name: String, available: Bool, app: String?, jobs: [HelperJob]) {
        self.id = id
        self.name = name
        self.available = available
        self.app = app
        self.jobs = jobs
    }

    /// The card's second line: the running job's step, or Idle.
    public var activity: String {
        guard let running = jobs.first(where: { $0.state == .running }) else { return "Idle" }
        return running.step ?? "Working…"
    }
}

/// The `helpers` event.
public struct HelpersList: Sendable, Equatable {
    public var helpers: [Helper]
    /// Installed app names, for the app picker.
    public var apps: [String]

    public init(helpers: [Helper], apps: [String]) {
        self.helpers = helpers
        self.apps = apps
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
            if selectedHelper?.available != true {
                selectedHelperId = newList.helpers.first(where: \.available)?.id
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

    /// Only an available helper can be chosen.
    public mutating func selectHelper(_ id: String) {
        guard list?.helpers.first(where: { $0.id == id })?.available == true, id != selectedHelperId else { return }
        selectedHelperId = id
        closeReport()
        problem = nil
    }

    /// `app` nil means none.
    public mutating func setApp(_ app: String?) -> IslandCommand? {
        guard let helper = selectedHelper, helper.available, helper.app != app else { return nil }
        return waiting(.helperSet(helper: helper.id, app: app ?? ""))
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
