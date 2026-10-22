import Foundation

// Daily brief (upgrades.md C3): a few short lines about the user's day, made by ATOM once a day or when he asks. The runtime
// gathers the facts and writes the lines; this holds what the window shows and builds the commands. Pure: no views.

/// One brief.
public struct BriefEntry: Sendable, Equatable, Identifiable {
    public var id: Int
    /// The local day it is for, YYYY-MM-DD.
    public var day: String
    public var createdAt: Date?
    public var lines: [String]
    /// "model": written by the model. "template": the plain version (no input, a used preparation budget or a model failure).
    public var isPlain: Bool
    public var preparation: PreparedBriefWork?

    /// Why the plain version was made; nil for a brief the model wrote. Only a preparation run records empty input or a used budget,
    /// so any other plain brief is a model failure. An empty brief made without preparation is still shown as a model failure.
    public var plainReason: String? {
        guard isPlain else { return nil }
        switch preparation?.status {
        case "empty": return "no usable source excerpts"
        case "budget": return "today's preparation budget is used"
        default: return "the model was not available"
        }
    }

    public init(id: Int, day: String, createdAt: Date? = nil, lines: [String], isPlain: Bool = false, preparation: PreparedBriefWork? = nil) {
        self.id = id
        self.day = day
        self.createdAt = createdAt
        self.lines = lines
        self.isPlain = isPlain
        self.preparation = preparation
    }
}

public struct BriefSettings: Sendable, Equatable {
    public var enabled = false
    /// Minutes after local midnight; 480 is 08:00.
    public var minute = 480
    public var events = true
    public var reminders = true
    public var weather = true
    public var tasks = true
    public var needsYou = true
    public var notify = true
    public var telegram = false
    public var spoken = false
    public var preparation = false
    public var preparationDailyLimit = 2

    public init() {}

    /// "08:00".
    public var timeText: String { String(format: "%02d:%02d", minute / 60, minute % 60) }

    /// Today at the set time, for a time picker.
    public func time(on day: Date, calendar: Calendar = .current) -> Date {
        calendar.date(bySettingHour: minute / 60, minute: minute % 60, second: 0, of: day) ?? day
    }

    public static func minute(of date: Date, calendar: Calendar = .current) -> Int {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return (parts.hour ?? 8) * 60 + (parts.minute ?? 0)
    }
}

/// A change to some settings: only the fields that are set are sent.
public struct BriefSettingsChange: Sendable, Equatable {
    public var enabled: Bool?
    public var minute: Int?
    public var events: Bool?
    public var reminders: Bool?
    public var weather: Bool?
    public var tasks: Bool?
    public var needsYou: Bool?
    public var notify: Bool?
    public var telegram: Bool?
    public var spoken: Bool?
    public var preparation: Bool?
    public var preparationDailyLimit: Int?

    public init(enabled: Bool? = nil, minute: Int? = nil, events: Bool? = nil, reminders: Bool? = nil, weather: Bool? = nil, tasks: Bool? = nil,
                needsYou: Bool? = nil, notify: Bool? = nil, telegram: Bool? = nil, spoken: Bool? = nil, preparation: Bool? = nil, preparationDailyLimit: Int? = nil) {
        self.enabled = enabled
        self.minute = minute
        self.events = events
        self.reminders = reminders
        self.weather = weather
        self.tasks = tasks
        self.needsYou = needsYou
        self.notify = notify
        self.telegram = telegram
        self.spoken = spoken
        self.preparation = preparation
        self.preparationDailyLimit = preparationDailyLimit
    }

    /// The JSON object for the command.
    public var fields: [String: Any] {
        var out: [String: Any] = [:]
        if let enabled { out["enabled"] = enabled }
        if let minute { out["minute"] = minute }
        if let events { out["events"] = events }
        if let reminders { out["reminders"] = reminders }
        if let weather { out["weather"] = weather }
        if let tasks { out["tasks"] = tasks }
        if let needsYou { out["needsYou"] = needsYou }
        if let notify { out["notify"] = notify }
        if let telegram { out["telegram"] = telegram }
        if let spoken { out["spoken"] = spoken }
        if let preparation { out["preparation"] = preparation }
        if let preparationDailyLimit { out["preparationDailyLimit"] = preparationDailyLimit }
        return out
    }
}

/// The runtime's answer: the settings, the newest briefs (newest first) and whether one is being made.
public struct BriefList: Sendable, Equatable {
    public var settings: BriefSettings
    public var history: [BriefEntry]
    public var running: Bool
    public var preparationBudget: BriefPreparationBudget?
    public var preparationModel: String?
    public var notice: String?

    public init(settings: BriefSettings = BriefSettings(), history: [BriefEntry] = [], running: Bool = false,
                preparationBudget: BriefPreparationBudget? = nil, preparationModel: String? = nil, notice: String? = nil) {
        self.settings = settings
        self.history = history
        self.running = running
        self.preparationBudget = preparationBudget; self.preparationModel = preparationModel; self.notice = notice
    }
}

public struct DailyBriefState: Sendable, Equatable {
    public private(set) var settings = BriefSettings()
    public private(set) var history: [BriefEntry] = []
    public private(set) var running = false
    public private(set) var preparationBudget: BriefPreparationBudget?
    public private(set) var preparationModel: String?
    public private(set) var notice: String?
    /// The window asked once: a restarted runtime is asked again.
    public private(set) var asked = false
    /// Why the last change was refused.
    public private(set) var error: String?
    /// The newest brief the window has seen. The first list only learns what is already there; a later newer one is "fresh".
    private var seenId: Int?
    private var started = false
    private var fresh: BriefEntry?

    public init() {}

    public var latest: BriefEntry? { history.first }

    /// Ask once; the runtime then sends its changes.
    public mutating func open() -> IslandCommand? {
        guard !asked else { return nil }
        asked = true
        return .briefGet
    }

    public mutating func apply(_ list: BriefList) {
        settings = list.settings
        history = list.history
        running = list.running
        preparationBudget = list.preparationBudget; preparationModel = list.preparationModel; notice = list.notice
        error = nil
        let newest = list.history.first
        if started, let newest, newest.id != seenId { fresh = newest }
        seenId = newest?.id ?? seenId
        started = true
    }

    /// A brief that arrived after the first list, once: for the notification and the card.
    public mutating func takeFresh() -> BriefEntry? {
        defer { fresh = nil }
        return fresh
    }

    public mutating func fail(_ message: String) { error = message }

    /// "Brief me": nil while one is being made.
    public func runNow() -> IslandCommand? { running ? nil : .briefRun }

    public func set(_ change: BriefSettingsChange) -> IslandCommand { .briefSet(change: change) }
}
