import Foundation

/// ADR-091: a macOS notification ZENO posts: something needs Keshab, a task is done or failed, or a budget or the
/// plan is nearly used. Titles and short reasons only: never a report's text.
public struct AppNotice: Sendable, Equatable {
    public enum Kind: String, Sendable, CaseIterable {
        case needsYou, done, failed, budget

        public var title: String {
            switch self {
            case .needsYou: "Something needs you"
            case .done: "A task is done"
            case .failed: "A task failed"
            case .budget: "Budget and plan use"
            }
        }
    }

    public var kind: Kind
    public var title: String
    public var body: String
    /// The task to open when the notification is clicked.
    public var taskId: Int?
    /// Unique per thing notified, so the system shows each once.
    public var key: String

    public init(kind: Kind, title: String, body: String, taskId: Int? = nil, key: String) {
        self.kind = kind
        self.title = title
        self.body = body
        self.taskId = taskId
        self.key = key
    }
}

/// ADR-091: what is new in the team since the last list, as notices. The first list only learns what is already so
/// (nothing old is announced). A condition that stops and starts again (a budget on a new day) is announced again.
public struct NoticeWatcher: Sendable {
    /// Share of a budget or of the plan's five hours that earns a warning.
    public static let warnAt = 0.8

    private var known: Set<String> = []
    private var started = false

    public init() {}

    public mutating func notices(for list: HelpersList, plan: PlanUsage? = nil) -> [AppNotice] {
        let now = Self.current(list, plan: plan)
        defer {
            known = Set(now.map(\.key))
            started = true
        }
        guard started else { return [] }
        return now.filter { !known.contains($0.key) }
    }

    /// Everything that is so right now, each with its key.
    static func current(_ list: HelpersList, plan: PlanUsage?) -> [AppNotice] {
        var out: [AppNotice] = []
        for h in list.helpers {
            for job in h.jobs {
                switch job.state {
                case .done:
                    out.append(AppNotice(kind: .done, title: "\(h.name) finished", body: short(job.title ?? "The task is done."), taskId: job.id, key: "done-\(job.id)"))
                case .failed:
                    out.append(AppNotice(kind: .failed, title: "\(h.name)'s task failed", body: short(job.error ?? "It ended with a problem."), taskId: job.id, key: "failed-\(job.id)"))
                case .queued where job.awaitsApproval:
                    out.append(AppNotice(kind: .needsYou, title: "\(h.name) has a plan for your OK", body: short(job.planSummary ?? "Open it to approve or change it."), taskId: job.id, key: "plan-\(job.id)"))
                case .queued where job.held != nil:
                    out.append(AppNotice(kind: .needsYou, title: "\(h.name)'s task is waiting", body: short(job.held ?? ""), taskId: job.id, key: "held-\(job.id)"))
                default:
                    break
                }
            }
            for p in h.proposals where p.state == "pending" {
                out.append(AppNotice(kind: .needsYou, title: "A change to \(h.name)'s soul is proposed", body: "Open \(h.name)'s page to accept or reject it.", key: "proposal-\(h.id)-\(p.id)"))
            }
            if let budget = h.budget { out += budgetNotices(budget, who: "\(h.name)'s", key: h.id) }
        }
        // ADR-094: a new skill draft or skill edit: its name only, never its steps.
        for d in list.skillDrafts where d.state == "pending" {
            out.append(AppNotice(kind: .needsYou, title: "Tinker drafted a skill: \(d.name)", body: "Open Plugins to approve or reject it.", key: "skill-draft-\(d.id)"))
        }
        for e in list.skillEdits where e.state == "pending" {
            out.append(AppNotice(kind: .needsYou, title: "Tinker suggests an edit to \(e.skill)", body: "Open Plugins to accept or reject it.", key: "skill-edit-\(e.id)"))
        }
        for p in list.skillHub.pending {
            out.append(AppNotice(kind: .needsYou, title: "Install \(p.name) from the skills hub?", body: "Open Plugins to read it and answer.", key: "skill-hub-\(p.id)"))
        }
        if let team = list.team { out += budgetNotices(team, who: "The team's", key: "team") }
        if let used = plan?.fiveHour, used >= warnAt {
            let percent = Int((used * 100).rounded())
            let holds = list.planLimit.map { " New tasks wait above \($0)%." } ?? ""
            out.append(AppNotice(kind: .budget, title: "The Claude plan is at \(percent)%", body: "Of its five-hour limit.\(holds)", key: "plan-\(used >= 1 ? "full" : "warn")"))
        }
        return out
    }

    static func budgetNotices(_ budget: HelperBudget, who: String, key: String) -> [AppNotice] {
        guard let cap = budget.cap, cap > 0 else { return [] }
        let share = budget.spent / cap
        let money = String(format: "$%.2f of $%.2f today", budget.spent, cap)
        if share >= 1 {
            return [AppNotice(kind: .budget, title: "\(who) budget is used up", body: "\(money). New tasks wait until tomorrow.", key: "budget-\(key)-full")]
        }
        if share >= warnAt {
            return [AppNotice(kind: .budget, title: "\(who) budget is \(Int((share * 100).rounded()))% used", body: money, key: "budget-\(key)-warn")]
        }
        return []
    }

    public static func short(_ text: String) -> String {
        let line = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        return line.count > 140 ? String(line.prefix(139)) + "…" : line
    }
}
