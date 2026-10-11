import Foundation

/// ADR-094: room for many agents. Which workers the Board's chips show (who matters now, at most twelve), and the
/// "All agents" list searched by name or role. The floor's seating, which uses the same "last active", is in
/// `OfficePlan`. Pure.
public enum TeamRoster {
    /// At most this many chips; a team this size or smaller shows everyone, as before.
    public static let chipLimit = 12
    /// "Used in the last day".
    public static let recent: TimeInterval = 24 * 60 * 60

    /// The chips: everyone in a team of twelve or fewer; else who is working (longest at work first), then who waits
    /// for Keshab, then who was used in the last day (most recent first), at most twelve. Ties keep the team's order.
    public static func chips(in list: HelpersList, now: Date = Date()) -> [Helper] {
        guard list.helpers.count > chipLimit else { return list.helpers }
        let waiting = Set(NeedsYouItem.all(in: list).map(\.helperId))
        func rank(_ h: Helper) -> Int? {
            if isWorking(h) { return 0 }
            if waiting.contains(h.id) { return 1 }
            if let at = lastActive(h), now.timeIntervalSince(at) < recent { return 2 }
            return nil
        }
        let ranked = list.helpers.enumerated().compactMap { i, h in rank(h).map { (rank: $0, index: i, helper: h) } }
        return ranked.sorted { a, b in
            if a.rank != b.rank { return a.rank < b.rank }
            let (x, y) = a.rank == 0 ? (startedAt(a.helper), startedAt(b.helper))
                : (lastActive(b.helper) ?? .distantPast, lastActive(a.helper) ?? .distantPast)
            return x != y ? x < y : a.index < b.index
        }.prefix(chipLimit).map(\.helper)
    }

    /// "All agents": by name, A to Z; a query keeps those whose name or role contains it, in any case.
    public static func search(_ helpers: [Helper], _ query: String) -> [Helper] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let sorted = helpers.sorted { a, b in
            let order = a.name.localizedStandardCompare(b.name)
            return order == .orderedSame ? a.id < b.id : order == .orderedAscending
        }
        guard !q.isEmpty else { return sorted }
        return sorted.filter { $0.name.localizedCaseInsensitiveContains(q) || $0.roleTitle.localizedCaseInsensitiveContains(q) || $0.role.localizedCaseInsensitiveContains(q) }
    }

    public static func isWorking(_ h: Helper) -> Bool { h.jobs.contains { $0.state == .running } }

    /// When its running task started (the distant past when unknown, so it counts as longest at work).
    public static func startedAt(_ h: Helper) -> Date {
        h.jobs.first { $0.state == .running }.flatMap(\.createdAt) ?? .distantPast
    }

    /// The last time one of its tasks started or ended; nil with no dated task.
    public static func lastActive(_ h: Helper) -> Date? {
        h.jobs.compactMap { $0.endedAt ?? $0.createdAt }.max()
    }
}
