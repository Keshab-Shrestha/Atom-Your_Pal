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

    // MARK: ADR-095: Managers

    /// A Manager as its Board chip and floor desk show it: its Agents, how many tasks run (its Agents' and its own runs),
    /// and whether one of them needs Keshab (a plan to approve, a proposal, a held task; not an Agent's failure), or its
    /// own newest run failed.
    public struct ManagerStatus: Sendable, Equatable, Identifiable {
        public var manager: HelperManager
        public var agents: [Helper]
        public var atWork: Int
        public var needsYou: Bool
        /// Its own newest run failed (also counted in `needsYou`).
        public var failed: Bool = false
        public var id: String { manager.id }
        /// The chip's second line: "2 at work", or its mode when nobody works.
        public var line: String { atWork > 0 ? "\(atWork) at work" : "\(agents.count) agent\(agents.count == 1 ? "" : "s") · \(manager.modeTitle)" }
        public var startedAt: Date {
            let running = (agents.flatMap(\.jobs) + manager.jobs).filter { $0.state == .running }
            guard !running.contains(where: { $0.createdAt == nil }) else { return .distantPast }
            return running.compactMap(\.createdAt).min() ?? .distantPast
        }
        public var lastActive: Date? { (agents.flatMap(\.jobs) + manager.jobs).compactMap { $0.endedAt ?? $0.createdAt }.max() }
    }

    /// Every Manager, in the runtime's order (by folder name), with its status. Empty when there are none.
    public static func managers(in list: HelpersList) -> [ManagerStatus] {
        let waiting = Set(NeedsYouItem.all(in: list).filter { $0.kind != .failed }.map(\.helperId))
        return list.managers.map { m in
            let agents = list.agents(of: m)
            let running = agents.flatMap(\.jobs).filter { $0.state == .running }.count + m.jobs.filter { $0.state == .running }.count
            let held = m.jobs.contains { $0.held != nil }
            let failed = m.jobs.max { $0.id < $1.id }?.state == .failed
            return ManagerStatus(manager: m, agents: agents, atWork: running, needsYou: held || failed || agents.contains { waiting.contains($0.id) }, failed: failed)
        }
    }

    /// The Board's Manager chips: every Manager (there are at most twelve, as many as `chipLimit`).
    public static func managerChips(in list: HelpersList) -> [ManagerStatus] {
        Array(managers(in: list).prefix(chipLimit))
    }

    /// "All agents" grouped by Manager (by name, A to Z), Agents under none last as "No manager". Without Managers, one
    /// untitled group. Groups with nobody in `found` are left out.
    public static func grouped(_ found: [Helper], in list: HelpersList) -> [(title: String, helpers: [Helper])] {
        guard !list.managers.isEmpty else { return found.isEmpty ? [] : [("", found)] }
        let ids = Set(list.managers.map(\.id))
        let byName = list.managers.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        var groups = byName.map { m in (title: m.name, helpers: found.filter { $0.manager == m.id }) }.filter { !$0.helpers.isEmpty }
        let loose = found.filter { !ids.contains($0.manager ?? "") }
        if !loose.isEmpty { groups.append((title: "No manager", helpers: loose)) }
        return groups
    }

    /// When its longest-running task started (the distant past when unknown, so it counts as longest at work).
    public static func startedAt(_ h: Helper) -> Date {
        let running = h.jobs.filter { $0.state == .running }
        guard !running.contains(where: { $0.createdAt == nil }) else { return .distantPast }
        return running.compactMap(\.createdAt).min() ?? .distantPast
    }

    /// The last time one of its tasks started or ended; nil with no dated task.
    public static func lastActive(_ h: Helper) -> Date? {
        h.jobs.compactMap { $0.endedAt ?? $0.createdAt }.max()
    }
}
