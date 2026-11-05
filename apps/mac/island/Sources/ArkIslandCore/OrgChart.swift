import CoreGraphics
import Foundation

/// The Board's Team as an org chart (2026-11-05, Keshab: "the level of our agents like an office: CEO, managers, workers").
/// Keshab owns ARK; ARK is the CEO; an agent reports to ARK or to another agent, its lead. An agent with reports is a lead
/// (manager level), one without is a worker. The runtime keeps who reports to whom and checks every change; this mirrors its
/// rules so the window can refuse a drop before it sends it, and lays the tree out on the canvas. Pure.
public struct OrgChart: Sendable, Equatable {
    public enum Level: String, Sendable { case owner = "Owner", ceo = "CEO", lead = "Lead", worker = "Worker" }

    /// The two fixed nodes above the agents.
    public static let owner = "@you"
    public static let ark = "@ark"
    /// The deepest an agent may sit below ARK (the runtime's limit).
    public static let maxDepth = 4

    /// Agent ids in the team's order.
    public private(set) var agents: [String]
    /// Each agent's lead; absent: ARK.
    public private(set) var leadOf: [String: String]

    public init(helpers: [Helper]) {
        let team = helpers.filter { $0.role != "improver" }
        agents = team.map(\.id)
        let known = Set(agents)
        var leads: [String: String] = [:]
        for helper in team {
            guard let lead = helper.reportsTo, lead != helper.id, known.contains(lead) else { continue }
            leads[helper.id] = lead
        }
        // A cycle cannot come from the runtime; if one did, its members report to ARK rather than vanish.
        for id in agents where Self.chain(id, leads).count > agents.count { leads[id] = nil }
        leadOf = leads
    }

    /// The node's parent: an agent's lead or ARK; ARK's is the owner.
    public func parent(of id: String) -> String? {
        if id == Self.owner { return nil }
        if id == Self.ark { return Self.owner }
        return leadOf[id] ?? Self.ark
    }

    public func children(of id: String) -> [String] {
        if id == Self.owner { return [Self.ark] }
        return agents.filter { parent(of: $0) == id }
    }

    public func level(of id: String) -> Level {
        if id == Self.owner { return .owner }
        if id == Self.ark { return .ceo }
        return children(of: id).isEmpty ? .worker : .lead
    }

    /// How far below ARK: 1 for ARK's direct reports.
    public func depth(of id: String) -> Int { Self.chain(id, leadOf).count }

    /// Whether `id` sits anywhere under `ancestor`.
    public func isUnder(_ id: String, _ ancestor: String) -> Bool {
        var current = leadOf[id]
        var steps = 0
        while let lead = current, steps <= agents.count {
            if lead == ancestor { return true }
            current = leadOf[lead]
            steps += 1
        }
        return false
    }

    /// Whether `agent` may report to `lead` (ARK when nil or `ark`): not itself, not one of its own people, and the whole branch
    /// stays within `maxDepth`.
    public func canReport(_ agent: String, to lead: String?) -> Bool {
        guard agents.contains(agent) else { return false }
        guard let lead, lead != Self.ark else { return true }
        guard lead != agent, agents.contains(lead), !isUnder(lead, agent) else { return false }
        return depth(of: lead) + 1 + height(below: agent) <= Self.maxDepth
    }

    /// How many levels hang under an agent (0 for a worker).
    func height(below id: String) -> Int {
        children(of: id).map { 1 + height(below: $0) }.max() ?? 0
    }

    private static func chain(_ id: String, _ leads: [String: String]) -> [String] {
        var out = [id]
        var current = leads[id]
        while let lead = current, out.count <= leads.count + 1 {
            out.append(lead)
            current = leads[lead]
        }
        return out
    }

    // MARK: - Layout

    /// Every node's centre on the canvas: a tidy top-down tree, each parent centred over its children, siblings `gap` apart.
    public func layout(node: CGSize, gap: CGFloat = 32, levelGap: CGFloat = 72) -> [String: CGPoint] {
        var widths: [String: CGFloat] = [:]
        func width(_ id: String) -> CGFloat {
            let kids = children(of: id)
            let w = kids.isEmpty ? node.width : max(node.width, kids.map(width).reduce(0, +) + gap * CGFloat(kids.count - 1))
            widths[id] = w
            return w
        }
        _ = width(Self.owner)
        var points: [String: CGPoint] = [:]
        func place(_ id: String, left: CGFloat, row: Int) {
            let kids = children(of: id)
            let w = widths[id] ?? node.width
            points[id] = CGPoint(x: left + w / 2, y: CGFloat(row) * (node.height + levelGap) + node.height / 2)
            let span = kids.map { widths[$0] ?? node.width }.reduce(0, +) + gap * CGFloat(max(0, kids.count - 1))
            var x = left + (w - span) / 2
            for kid in kids {
                place(kid, left: x, row: row + 1)
                x += (widths[kid] ?? node.width) + gap
            }
        }
        place(Self.owner, left: 0, row: 0)
        return points
    }
}
