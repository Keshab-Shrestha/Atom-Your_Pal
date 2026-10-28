import Foundation

/// ADR-094: the Scheduled page: everything that runs by itself (each worker's routines). Pure.
public struct ScheduledPage: Sendable, Equatable {
    public struct Entry: Sendable, Equatable, Identifiable {
        public enum Kind: Sendable, Equatable {
            case routine(id: Int)
        }

        public var id: String
        public var kind: Kind
        public var helperId: String
        public var helperName: String
        /// The routine's task.
        public var title: String
        /// "Every day at 8:00 AM", "Every hour".
        public var schedule: String
        public var nextAt: Date?
        public var lastAt: Date?
        public var paused: Bool
    }

    /// Running ones by their next time, soonest first; the paused after them.
    public var entries: [Entry]
    public var isEmpty: Bool { entries.isEmpty }

    public init(list: HelpersList) {
        var entries: [Entry] = []
        for h in list.helpers {
            for r in h.routines {
                entries.append(Entry(id: "routine-\(r.id)", kind: .routine(id: r.id), helperId: h.id, helperName: h.name, title: r.task,
                                     schedule: r.when, nextAt: r.paused ? nil : r.nextAt, lastAt: r.lastAt, paused: r.paused))
            }
        }
        self.entries = entries.sorted { a, b in
            if a.paused != b.paused { return !a.paused }
            return (a.nextAt ?? .distantFuture, a.id) < (b.nextAt ?? .distantFuture, b.id)
        }
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
