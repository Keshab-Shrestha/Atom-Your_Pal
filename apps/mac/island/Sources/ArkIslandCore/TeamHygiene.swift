import Foundation

/// Hygiene suggestions for the Dashboard (2026-11-02, after a Claude-manager reference Keshab chose): small, true facts about the team that
/// usually mean something needs a minute of attention. Plain checks over the team list; no model is asked. At most `limit`, most useful first.
public enum TeamHygiene {
    public struct Suggestion: Sendable, Equatable, Identifiable {
        public let id: String
        public let text: String
        /// The agent to open, when the suggestion is about one.
        public let helperId: String?
    }

    public static func suggestions(_ list: HelpersList, now: Date = Date(), limit: Int = 4) -> [Suggestion] {
        var out: [Suggestion] = []
        let weekAgo = now.addingTimeInterval(-7 * 86_400)
        for h in list.helpers where h.paused {
            let waiting = h.jobs.filter { $0.state == .queued }.count
            if waiting > 0 { out.append(.init(id: "paused-\(h.id)", text: "\(h.name) is paused with \(count(waiting, "task")) waiting.", helperId: h.id)) }
        }
        for h in list.helpers {
            let failed = h.jobs.filter { $0.state == .failed && ($0.endedAt ?? $0.createdAt ?? .distantPast) >= weekAgo }.count
            if failed >= 2 { out.append(.init(id: "failed-\(h.id)", text: "\(h.name) failed \(count(failed, "task")) this week. Its page says why.", helperId: h.id)) }
        }
        for s in list.mcp where s.enabled && s.workers.isEmpty {
            out.append(.init(id: "mcp-\(s.id)", text: "The \(s.name) server is on, but no agent may use it.", helperId: nil))
        }
        if !list.skills.isEmpty {
            let bare = list.helpers.filter { $0.skills.isEmpty && $0.kit != "think" && $0.role != "improver" }.map(\.name)
            if !bare.isEmpty { out.append(.init(id: "no-skills", text: "\(names(bare)) \(bare.count == 1 ? "has" : "have") no skills.", helperId: nil)) }
        }
        let given = Set(list.helpers.flatMap(\.skills))
        let unused = list.skills.filter { $0.source == "yours" && !given.contains($0.name) }.map(\.name)
        if !unused.isEmpty {
            out.append(.init(id: "unused-skills", text: "\(count(unused.count, "of your skills", plural: "of your skills")) \(unused.count == 1 ? "is" : "are") not given to any agent: \(names(Array(unused.prefix(3))))\(unused.count > 3 ? " and more" : "").", helperId: nil))
        }
        return Array(out.prefix(limit))
    }

    private static func count(_ n: Int, _ one: String, plural: String? = nil) -> String { "\(n) \(n == 1 ? one : plural ?? one + "s")" }
    private static func names(_ list: [String]) -> String {
        list.count <= 1 ? (list.first ?? "") : list.dropLast().joined(separator: ", ") + " and " + list.last!
    }
}
