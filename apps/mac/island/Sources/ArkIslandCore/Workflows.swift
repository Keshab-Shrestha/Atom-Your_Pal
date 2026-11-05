import Foundation

/// A workflow (2026-11-02, Keshab's reference's Workflows page; the runtime's workflows.ts): a trigger, then 1 to 8 steps, each an
/// agent's task, run in order. Off (`enabled` false) is a draft: it runs only by hand.
public struct Workflow: Codable, Sendable, Equatable, Identifiable {
    public struct Step: Codable, Sendable, Equatable {
        public var helper: String
        public var task: String
        public init(helper: String, task: String) { self.helper = helper; self.task = task }
    }
    /// The routines' schedule: daily or weekly at a minute of the day, or every N hours.
    public struct Schedule: Codable, Sendable, Equatable {
        public var kind: String
        public var minute: Int?
        public var weekday: Int?
        public var every: Int?
        public init(kind: String, minute: Int? = nil, weekday: Int? = nil, every: Int? = nil) {
            self.kind = kind; self.minute = minute; self.weekday = weekday; self.every = every
        }
    }
    public struct Trigger: Codable, Sendable, Equatable {
        /// "manual", "schedule" or "event".
        public var kind: String
        public var schedule: Schedule?
        /// "task.failed" or "task.done".
        public var event: String?
        public init(kind: String, schedule: Schedule? = nil, event: String? = nil) { self.kind = kind; self.schedule = schedule; self.event = event }
    }

    public var id: String
    public var name: String
    public var enabled: Bool
    public var trigger: Trigger
    public var steps: [Step]
    public var createdAt: String?
    public var lastRunAt: String?
    /// A node's place on the canvas (2026-11-05, n8n-style editor): "trigger" or a step's index ("0"…"7"). Absent: laid out in a row.
    public struct Point: Codable, Sendable, Equatable {
        public var x: Double
        public var y: Double
        public init(x: Double, y: Double) { self.x = x; self.y = y }
    }
    public var layout: [String: Point]?
    /// When a published schedule workflow runs next (from the runtime; not saved back). The Mac wakes for it (ADR-246).
    public var nextAt: Date?

    private enum CodingKeys: String, CodingKey { case id, name, enabled, trigger, steps, createdAt, lastRunAt, layout }

    public init(id: String = "", name: String, enabled: Bool = false, trigger: Trigger = Trigger(kind: "manual"), steps: [Step], createdAt: String? = nil, lastRunAt: String? = nil, nextAt: Date? = nil) {
        self.id = id; self.name = name; self.enabled = enabled; self.trigger = trigger; self.steps = steps; self.createdAt = createdAt; self.lastRunAt = lastRunAt; self.nextAt = nextAt
    }

    public static let maxSteps = 8

    /// The trigger in words: "By hand", "Every day at 8:00", "When a task fails".
    public var triggerTitle: String {
        switch trigger.kind {
        case "schedule":
            guard let s = trigger.schedule else { return "On a schedule" }
            let time = { (m: Int) in String(format: "%d:%02d", m / 60, m % 60) }
            switch s.kind {
            case "daily": return "Every day at \(time(s.minute ?? 0))"
            case "weekly": return "Every \(Calendar.current.weekdaySymbols[(s.weekday ?? 0) % 7]) at \(time(s.minute ?? 0))"
            default: return s.every == 1 ? "Every hour" : "Every \(s.every ?? 1) hours"
            }
        case "event": return trigger.event == "task.failed" ? "When a Board task fails" : "When a Board task finishes"
        default: return "By hand"
        }
    }

    /// The JSON object the runtime's `workflow.save` takes; a new workflow leaves out its empty id.
    public var jsonObject: [String: Any] {
        guard let data = try? JSONEncoder().encode(self), var object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
        if id.isEmpty { object.removeValue(forKey: "id") }
        return object
    }

    public static func list(from value: Any?) -> [Workflow] {
        guard let value, let data = try? JSONSerialization.data(withJSONObject: value) else { return [] }
        var list = (try? JSONDecoder().decode([Workflow].self, from: data)) ?? []
        let raw = value as? [[String: Any]] ?? []
        let fractional = ISO8601DateFormatter(); fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        if raw.count == list.count {
            for index in list.indices {
                if let text = raw[index]["nextAt"] as? String { list[index].nextAt = fractional.date(from: text) ?? plain.date(from: text) }
            }
        }
        return list
    }
}

public struct WorkflowList: Sendable, Equatable {
    public var workflows: [Workflow]
    public var problem: String?
    public init(workflows: [Workflow], problem: String? = nil) { self.workflows = workflows; self.problem = problem }
}
