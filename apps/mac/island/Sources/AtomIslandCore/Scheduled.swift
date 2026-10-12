import Foundation

/// ADR-094: a worker's wake-ups, as the runtime describes them.
public struct HelperWakeUp: Sendable, Equatable {
    /// "15m", "1h", "4h" or "1d".
    public var every: String
    /// "Every hour".
    public var when: String
    public var paused: Bool
    public var lastAt: Date?
    public var nextAt: Date

    public init(every: String, when: String, paused: Bool = false, lastAt: Date? = nil, nextAt: Date) {
        self.every = every
        self.when = when
        self.paused = paused
        self.lastAt = lastAt
        self.nextAt = nextAt
    }

    /// The choices the window offers, in order (off is not one: no wake-ups).
    public static let choices: [(every: String, title: String)] = [
        ("15m", "Every 15 minutes"), ("1h", "Every hour"), ("4h", "Every 4 hours"), ("1d", "Every day"),
    ]
}

/// ADR-094: a task posted to the team, waiting for a worker (of `role`, or anyone) to wake up and take it.
public struct TeamTask: Sendable, Equatable, Identifiable {
    public var id: Int
    public var task: String
    /// Nil: anyone may take it.
    public var role: String?
    public var createdAt: Date?

    public init(id: Int, task: String, role: String? = nil, createdAt: Date? = nil) {
        self.id = id
        self.task = task
        self.role = role
        self.createdAt = createdAt
    }

    /// "Researcher", or "Anyone".
    public var roleTitle: String { role.map { $0.prefix(1).uppercased() + $0.dropFirst() } ?? "Anyone" }
}

/// ADR-094: the Scheduled page: everything that runs by itself (each worker's routines and wake-ups) and the team
/// tasks waiting to be taken. Pure.
public struct ScheduledPage: Sendable, Equatable {
    public struct Entry: Sendable, Equatable, Identifiable {
        public enum Kind: Sendable, Equatable {
            case routine(id: Int)
            case wakeUp
        }

        public var id: String
        public var kind: Kind
        public var helperId: String
        public var helperName: String
        /// The routine's task, or what a wake-up does.
        public var title: String
        /// "Every day at 8:00 AM", "Every hour".
        public var schedule: String
        public var nextAt: Date?
        public var lastAt: Date?
        public var paused: Bool
    }

    /// Running ones by their next time, soonest first; the paused after them.
    public var entries: [Entry]
    /// Oldest first.
    public var teamTasks: [TeamTask]

    public var isEmpty: Bool { entries.isEmpty && teamTasks.isEmpty }

    public init(list: HelpersList) {
        var entries: [Entry] = []
        for h in list.helpers {
            for r in h.routines {
                entries.append(Entry(id: "routine-\(r.id)", kind: .routine(id: r.id), helperId: h.id, helperName: h.name, title: r.task,
                                     schedule: r.when, nextAt: r.paused ? nil : r.nextAt, lastAt: r.lastAt, paused: r.paused))
            }
            if let w = h.wakeUp {
                entries.append(Entry(id: "wake-\(h.id)", kind: .wakeUp, helperId: h.id, helperName: h.name, title: "Wakes up to take a team task",
                                     schedule: w.when, nextAt: w.paused ? nil : w.nextAt, lastAt: w.lastAt, paused: w.paused))
            }
        }
        self.entries = entries.sorted { a, b in
            if a.paused != b.paused { return !a.paused }
            return (a.nextAt ?? .distantFuture, a.id) < (b.nextAt ?? .distantFuture, b.id)
        }
        teamTasks = list.teamTasks.sorted { $0.id < $1.id }
    }

    /// "Next in 12 min", "Next in 3 h", "Next in 2 days", "Due now"; "Paused" while paused.
    public static func nextText(_ entry: Entry, now: Date = Date()) -> String {
        if entry.paused { return "Paused" }
        guard let next = entry.nextAt else { return "Next time not known" }
        let seconds = next.timeIntervalSince(now)
        return seconds < 60 ? "Due now" : "Next in \(span(seconds))"
    }

    /// "Last ran 5 min ago", or "Not run yet".
    public static func lastText(_ entry: Entry, now: Date = Date()) -> String {
        guard let last = entry.lastAt else { return "Not run yet" }
        let seconds = now.timeIntervalSince(last)
        return seconds < 60 ? "Last ran just now" : "Last ran \(span(seconds)) ago"
    }

    /// "Waiting 5 min", "Waiting 2 days".
    public static func ageText(_ task: TeamTask, now: Date = Date()) -> String {
        guard let created = task.createdAt else { return "Waiting" }
        let seconds = now.timeIntervalSince(created)
        return seconds < 60 ? "Waiting under a minute" : "Waiting \(span(seconds))"
    }

    /// 90 s → "1 min", 3 h 20 → "3 h", 50 h → "2 days".
    static func span(_ seconds: TimeInterval) -> String {
        let minutes = Int(seconds / 60)
        if minutes < 60 { return "\(minutes) min" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours) h" }
        let days = hours / 24
        return days == 1 ? "1 day" : "\(days) days"
    }
}

/// ADR-097: a routine's schedule as numbers: one of the store's three kinds (daily or weekly at a time, or every few
/// hours).
public struct RoutineSchedule: Sendable, Equatable {
    public enum Kind: String, Sendable, CaseIterable {
        case daily, weekly, hours

        public var title: String {
            switch self {
            case .daily: "Every day"
            case .weekly: "Every week"
            case .hours: "Every few hours"
            }
        }
    }

    public var kind: Kind
    /// Minutes after local midnight (daily, weekly).
    public var minute: Int
    /// 0 (Sunday) to 6 (weekly).
    public var weekday: Int
    /// 1 to 168 hours (hours).
    public var every: Int

    public init(kind: Kind = .daily, minute: Int = 8 * 60, weekday: Int = 1, every: Int = 4) {
        self.kind = kind
        self.minute = minute
        self.weekday = weekday
        self.every = every
    }

    public static let weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    public static let maxEveryHours = 168
}

/// ADR-097: the New schedule and Edit form: the worker, the task, the schedule and, for an hourly one, its first time.
public struct RoutineDraft: Sendable, Equatable {
    public var helper: String
    public var task: String
    public var schedule: RoutineSchedule
    public var startAt: Date
    /// ADR-098: send each result to Telegram.
    public var notifyTelegram: Bool
    /// ADR-098 item 5: the local API's webhook may start it.
    public var webhook: Bool

    public init(helper: String, task: String = "", schedule: RoutineSchedule = RoutineSchedule(), startAt: Date, notifyTelegram: Bool = false, webhook: Bool = false) {
        self.helper = helper
        self.notifyTelegram = notifyTelegram
        self.webhook = webhook
        self.task = task
        self.schedule = schedule
        self.startAt = startAt
    }

    /// The form for an existing routine: its numbers, and its next time as the first time.
    public init(routine: HelperRoutine, helper: String, now: Date = Date()) {
        self.init(helper: helper, task: routine.task, schedule: routine.schedule ?? RoutineSchedule(), startAt: routine.nextAt ?? now, notifyTelegram: routine.notifyTelegram, webhook: routine.webhook)
    }
}
