import SwiftUI
import ArkIslandCore

/// The Board's Team view: the org chart on an endless board (2026-11-05, Keshab: "an infinite board where we can see the level of our
/// agents like an office: CEO, managers, workers"). Keshab owns ARK; ARK is the CEO; each agent reports to ARK or to a lead. Drag an
/// agent onto another agent to put it under that lead, or onto ARK to report to ARK; the runtime checks and keeps it, and ARK routes
/// work in a lead's area through the lead. A card's line lights while that agent works; a click opens the agent.
struct BoardTeamView: View {
    let model: IslandModel
    @State private var dragging: String?
    @State private var dragAt: CGPoint = .zero
    @State private var pointerAt: CGPoint = .zero
    @Environment(\.theme) private var theme

    static let node = CGSize(width: 220, height: 96)
    static let margin: CGFloat = 48

    var body: some View {
        let helpers = (model.helpers.list?.helpers ?? []).filter { $0.role != "improver" }
        let org = OrgChart(helpers: helpers)
        let raw = org.layout(node: Self.node, gap: 28, levelGap: 64)
        let points = raw.mapValues { CGPoint(x: $0.x + Self.margin, y: $0.y + Self.margin) }
        let bounds = CGRect(x: 0, y: 0, width: (points.values.map(\.x).max() ?? 0) + Self.node.width / 2 + Self.margin,
                            height: (points.values.map(\.y).max() ?? 0) + Self.node.height / 2 + Self.margin)
        let target = dragging.flatMap { dropTarget(at: pointerAt, points: points, excluding: $0) }
        InfiniteCanvas(bounds: bounds) {
            ZStack(alignment: .topLeading) {
                edges(org: org, points: points, helpers: helpers).allowsHitTesting(false)
                ForEach([OrgChart.owner, OrgChart.ark] + org.agents, id: \.self) { id in
                    let point = id == dragging ? dragAt : (points[id] ?? .zero)
                    card(id, org: org, helpers: helpers, target: target)
                        .frame(width: Self.node.width, height: Self.node.height)
                        .position(point)
                        .zIndex(id == dragging ? 1 : 0)
                        .gesture(org.agents.contains(id) ? drag(id, from: points[id] ?? .zero, org: org, points: points) : nil)
                }
            }
        }
        .overlay(alignment: .topLeading) {
            Text("Drag an agent onto a lead to put it on that team. Drop it on ARK to report to ARK.")
                .appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color).padding(.horizontal, 16).padding(.top, 8)
        }
    }

    // MARK: - Drag to reassign

    private func drag(_ id: String, from start: CGPoint, org: OrgChart, points: [String: CGPoint]) -> some Gesture {
        DragGesture(minimumDistance: 4, coordinateSpace: .named(InfiniteCanvasSpace.name))
            .onChanged { value in
                dragging = id
                pointerAt = value.location
                // The card keeps the point where it was grabbed; the drop target is still the node under the pointer.
                dragAt = CGPoint(x: start.x + value.translation.width, y: start.y + value.translation.height)
            }
            .onEnded { value in
                defer { dragging = nil }
                guard let lead = dropTarget(at: value.location, points: points, excluding: id) else { return }
                let newLead: String? = lead == OrgChart.ark || lead == OrgChart.owner ? nil : lead
                guard newLead != org.leadOf[id], org.canReport(id, to: newLead) else { return }
                model.send(.helperReportsTo(helper: id, lead: newLead))
            }
    }

    /// The node under the pointer, if any (not the one being dragged).
    private func dropTarget(at point: CGPoint, points: [String: CGPoint], excluding id: String) -> String? {
        points.first { key, center in
            key != id && CGRect(x: center.x - Self.node.width / 2, y: center.y - Self.node.height / 2,
                                width: Self.node.width, height: Self.node.height).contains(point)
        }?.key
    }

    // MARK: - Drawing

    /// Elbow lines from each parent's bottom to its children's tops; a line lights while the agent below works.
    private func edges(org: OrgChart, points: [String: CGPoint], helpers: [Helper]) -> some View {
        let working = Set(helpers.filter { $0.jobs.contains { $0.state == .running } }.map(\.id))
        let half = Self.node.height / 2
        let busy = model.status.isBusy
        let lit = theme.accent.color
        let quiet = theme.text3.color.opacity(0.45)
        let hidden = dragging
        return Canvas { context, _ in
            for id in [OrgChart.ark] + org.agents where id != hidden {
                guard let parent = org.parent(of: id), let from = points[parent], let to = points[id] else { continue }
                var path = Path()
                let start = CGPoint(x: from.x, y: from.y + half)
                let end = CGPoint(x: to.x, y: to.y - half)
                let mid = (start.y + end.y) / 2
                path.move(to: start)
                path.addLine(to: CGPoint(x: start.x, y: mid))
                path.addLine(to: CGPoint(x: end.x, y: mid))
                path.addLine(to: end)
                let on = working.contains(id) || (id == OrgChart.ark && busy)
                context.stroke(path, with: .color(on ? lit : quiet), lineWidth: on ? 2 : 1.2)
            }
        }
    }

    @ViewBuilder
    private func card(_ id: String, org: OrgChart, helpers: [Helper], target: String?) -> some View {
        let level = org.level(of: id)
        let isTarget = id == target
        let valid = dragging.map { org.canReport($0, to: id == OrgChart.ark || id == OrgChart.owner ? nil : id) } ?? false
        Group {
            switch id {
            case OrgChart.owner:
                FixedNode(title: "You", detail: "Owner", level: level, lit: false)
            case OrgChart.ark:
                FixedNode(title: "ARK", detail: model.status.isBusy ? model.status.title : "Ready", level: level, lit: model.status.isBusy)
            default:
                if let helper = helpers.first(where: { $0.id == id }) {
                    AgentOrgCard(helper: helper, level: level, reports: org.children(of: id).count)
                        .onTapGesture { model.navigate { model.windowPage = .agents; model.helpers.selectHelper(helper.id) } }
                }
            }
        }
        .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
            .strokeBorder(isTarget ? (valid ? theme.accent.color : theme.problem.color) : .clear, lineWidth: 2))
        .opacity(id == dragging ? 0.85 : 1)
    }
}

/// A level chip: Owner, CEO, Lead, Worker.
private struct LevelChip: View {
    let level: OrgChart.Level
    @Environment(\.theme) private var theme

    var body: some View {
        let strong = level == .ceo || level == .lead
        Text(level.rawValue.uppercased()).appFont(.system(size: 9, weight: .semibold)).tracking(0.6)
            .foregroundStyle(strong ? theme.onAccent.color : theme.text2.color)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Capsule().fill(strong ? theme.accent.color : theme.fill2.color))
    }
}

/// You and ARK: fixed at the top.
private struct FixedNode: View {
    let title: String
    let detail: String
    let level: OrgChart.Level
    let lit: Bool
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(spacing: 6) {
            LevelChip(level: level)
            Text(title).appFont(.system(size: 15, weight: .semibold)).foregroundStyle(theme.text.color)
            Text(detail).appFont(.system(size: 11)).foregroundStyle(lit ? theme.live.color : theme.text3.color).lineLimit(1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(theme.fill1.color))
        .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(theme.surfaceSolid.color)) // solid over the grid
        .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(theme.separator.color, lineWidth: 1))
    }
}

/// One agent: its level, who it is, what it does now, and its record.
private struct AgentOrgCard: View {
    let helper: Helper
    let level: OrgChart.Level
    let reports: Int
    @Environment(\.theme) private var theme

    var body: some View {
        let running = helper.jobs.first { $0.state == .running }
        let waiting = helper.jobs.filter { $0.state == .queued }.count
        let record = AgentStats(jobs: helper.jobs).line
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                HelperBadge(helper: helper, size: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text(helper.name).appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(1)
                    Text(helper.roleTitle).appFont(.system(size: 11)).foregroundStyle(theme.text3.color).lineLimit(1)
                }
                Spacer(minLength: 4)
                LevelChip(level: level)
            }
            if let running {
                Text(running.step ?? "Working").appFont(.system(size: 11)).foregroundStyle(theme.live.color).lineLimit(1)
            } else {
                Text(helper.paused ? "Paused" : waiting > 0 ? "\(waiting) waiting" : "Idle").appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
            }
            Text(reports > 0 ? "Leads \(reports)" + (record.map { " · " + $0 } ?? "") : record ?? " ")
                .appFont(.system(size: 10.5)).monospacedDigit().foregroundStyle(theme.text3.color).lineLimit(1)
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(theme.fill1.color))
        .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(theme.surfaceSolid.color)) // solid over the grid
        .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
            .strokeBorder(running != nil ? theme.live.color.opacity(0.6) : theme.separator.color, lineWidth: 1))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(helper.name), \(level.rawValue), \(running?.step ?? (helper.paused ? "paused" : "idle"))")
        .accessibilityAddTraits(.isButton)
    }
}
