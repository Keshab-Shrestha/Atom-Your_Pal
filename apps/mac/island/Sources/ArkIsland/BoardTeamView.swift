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
    /// The agent whose management panel is open (2026-11-05: manage the team from the board).
    @State private var selected: String?
    /// The panel open at first (the fixture gallery); nil normally.
    var initiallySelected: String?
    @Environment(\.theme) private var theme

    static let node = CGSize(width: 240, height: 112)
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
                ports(org: org, points: points, helpers: helpers).allowsHitTesting(false).zIndex(2)
            }
        }
        .overlay(alignment: .top) {
            // The hint and the counts share one line, so they never overlap; the hint gives way on a narrow window.
            HStack(spacing: 12) {
                Text("Click an agent to manage it. Drag it onto a manager to move it to that team, or onto ARK to report to ARK.")
                    .foregroundStyle(theme.text3.color).lineLimit(1).truncationMode(.tail)
                Spacer(minLength: 8)
                if selected == nil {
                    let running = helpers.filter { $0.jobs.contains { $0.state == .running } }.count
                    let managers = org.agents.filter { org.level(of: $0) == .lead }.count
                    Group {
                        Text(helpers.count == 1 ? "1 agent" : "\(helpers.count) agents").foregroundStyle(theme.text3.color)
                        if running > 0 { Text("\(running) running").foregroundStyle(theme.live.color) }
                        Text(managers == 1 ? "1 manager" : "\(managers) managers").foregroundStyle(theme.text3.color)
                    }
                    .fixedSize()
                }
            }
            .appFont(.system(size: 11.5, weight: .medium)).monospacedDigit().padding(.horizontal, 16).padding(.top, 8)
        }
        .overlay(alignment: .topTrailing) {
            if let id = selected, let helper = helpers.first(where: { $0.id == id }) {
                TeamMemberPanel(model: model, helper: helper, org: org, helpers: helpers, select: { selected = $0 }, close: { selected = nil })
                    .frame(width: 340).padding(12)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.18), value: selected)
        .onExitCommand { selected = nil }
        .onAppear { if selected == nil { selected = initiallySelected } }
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

    /// Ports where a line meets a card (after affectUI's Agent Tree look), drawn above the cards so each dot shows whole.
    private func ports(org: OrgChart, points: [String: CGPoint], helpers: [Helper]) -> some View {
        let working = Set(helpers.filter { $0.jobs.contains { $0.state == .running } }.map(\.id))
        let half = Self.node.height / 2
        let lit = theme.accent.color, quiet = theme.text3.color.opacity(0.6), fill = theme.surfaceSolid.color
        let busy = model.status.isBusy, hidden = dragging
        return Canvas { context, _ in
            for id in [OrgChart.ark] + org.agents where id != hidden {
                guard let parent = org.parent(of: id), let from = points[parent], let to = points[id] else { continue }
                let on = working.contains(id) || (id == OrgChart.ark && busy)
                for point in [CGPoint(x: from.x, y: from.y + half), CGPoint(x: to.x, y: to.y - half)] {
                    let dot = Path(ellipseIn: CGRect(x: point.x - 3.5, y: point.y - 3.5, width: 7, height: 7))
                    context.fill(dot, with: .color(fill))
                    context.stroke(dot, with: .color(on ? lit : quiet), lineWidth: 1.2)
                }
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
                    AgentOrgCard(helper: helper, level: level, reports: org.children(of: id).count, selected: selected == id)
                        .onTapGesture { selected = selected == id ? nil : id }
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

/// One agent (after affectUI's Agent Tree look): who it is and its level, a status pill, what it does now, and its record.
private struct AgentOrgCard: View {
    let helper: Helper
    let level: OrgChart.Level
    let reports: Int
    var selected = false
    @Environment(\.theme) private var theme

    var body: some View {
        let running = helper.jobs.first { $0.state == .running }
        let waiting = helper.jobs.filter { $0.state == .queued }.count
        let record = AgentStats(jobs: helper.jobs).line
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                HelperBadge(helper: helper, size: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text(helper.name).appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(1)
                    Text(helper.roleTitle).appFont(.system(size: 11)).foregroundStyle(theme.text3.color).lineLimit(1)
                }
                Spacer(minLength: 4)
                statusPill(running: running != nil)
            }
            // What it does now, or that it is free: the reference's task line.
            Text(task(running: running, waiting: waiting))
                .appFont(.system(size: 11.5)).foregroundStyle(running == nil ? theme.text3.color : theme.text2.color).lineLimit(1)
            Spacer(minLength: 0)
            Text([level.rawValue, reports > 0 ? "manages \(reports)" : nil, record].compactMap { $0 }.joined(separator: " · "))
                .appFont(.system(size: 10.5)).monospacedDigit().foregroundStyle(theme.text3.color).lineLimit(1)
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(theme.fill1.color))
        .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(theme.surfaceSolid.color)) // solid over the grid
        .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
            .strokeBorder(selected ? theme.accent.color : running != nil ? theme.live.color.opacity(0.6) : theme.separator.color, lineWidth: selected ? 2 : 1))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(helper.name), \(level.rawValue), \(running != nil ? "running" : helper.paused ? "paused" : "idle"): \(task(running: running, waiting: waiting))\(reports > 0 ? ", manages \(reports)" : "")")
        .accessibilityAddTraits(.isButton)
    }

    private func task(running: HelperJob?, waiting: Int) -> String {
        running.map { $0.title ?? $0.task } ?? (waiting > 0 ? "\(waiting) waiting" : "Ready for a task")
    }

    /// Running (with a spinner), Paused or Idle.
    @ViewBuilder
    private func statusPill(running: Bool) -> some View {
        let (text, color): (String, Color) = running ? ("Running", theme.live.color) : helper.paused ? ("Paused", theme.attention.color) : ("Idle", theme.text3.color)
        HStack(spacing: 4) {
            if running { RaySpinner(size: 9, color: color) }
            Text(text).appFont(.system(size: 10.5, weight: .medium))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 7).padding(.vertical, 2.5)
        .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(color.opacity(0.12)))
    }
}

/// Manage one agent from the Team board: availability, manager, its people, and the agent's own pages. Every change goes through the
/// runtime's existing commands (agent.pause, helper.reportsTo, agent.create, agent.remove); removing asks first and moves the folder to
/// agents-removed, never deletes it.
private struct TeamMemberPanel: View {
    let model: IslandModel
    let helper: Helper
    let org: OrgChart
    let helpers: [Helper]
    let select: (String?) -> Void
    let close: () -> Void
    @State private var removing = false
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    private func leadName(_ lead: String?) -> String { lead.flatMap { id in helpers.first { $0.id == id }?.name } ?? "ARK (CEO)" }

    var body: some View {
        let level = org.level(of: helper.id)
        let lead = org.leadOf[helper.id]
        let people = org.children(of: helper.id)
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                HelperBadge(helper: helper, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(helper.name).appFont(.system(size: 15, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(1)
                    Text(helper.roleTitle).appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color).lineLimit(1)
                }
                Spacer(minLength: 4)
                LevelChip(level: level)
                IconButton(symbol: "xmark", label: "Close") { close() }
            }
            row("Availability") { AgentAvailabilityMenu(model: model, helper: helper) }
            row("Reports to") {
                // A snapshot cannot draw a Menu (it renders as a placeholder): the gallery shows its label alone.
                if snapshot { Text(leadName(lead)).appFont(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color) } else {
                Menu {
                    Button { model.send(.helperReportsTo(helper: helper.id, lead: nil)) } label: {
                        Label("ARK (CEO)", systemImage: lead == nil ? "checkmark" : "building.2")
                    }
                    Divider()
                    ForEach(helpers.filter { $0.id != helper.id && org.canReport(helper.id, to: $0.id) }) { other in
                        Button { model.send(.helperReportsTo(helper: helper.id, lead: other.id)) } label: {
                            Label(other.name, systemImage: lead == other.id ? "checkmark" : "person")
                        }
                    }
                } label: {
                    Text(leadName(lead))
                        .appFont(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                }
                .menuStyle(.borderlessButton).fixedSize()
                .accessibilityLabel("\(helper.name) reports to")
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(people.isEmpty ? "Team" : "Team · \(people.count)").appFont(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
                if people.isEmpty {
                    Text("Nobody reports to \(helper.name) yet. Add an agent, or drag one onto this card.")
                        .appFont(.system(size: 12)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
                }
                ForEach(people, id: \.self) { id in
                    if let person = helpers.first(where: { $0.id == id }) {
                        HStack(spacing: 8) {
                            HelperBadge(helper: person, size: 22)
                            Button(person.name) { select(id) }.buttonStyle(.plain)
                                .appFont(.system(size: 12.5)).foregroundStyle(theme.text.color)
                            Spacer()
                            // Off this team: up to this manager's own manager (or ARK).
                            Button("Move up") { model.send(.helperReportsTo(helper: id, lead: lead)) }.buttonStyle(.plain)
                                .appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color)
                                .disabled(!org.canReport(id, to: lead))
                                .help("Report to \(lead.flatMap { l in helpers.first { $0.id == l }?.name } ?? "ARK") instead")
                        }
                    }
                }
                QuietButton(title: "Add agent to this team", symbol: "person.badge.plus") {
                    model.navigate { model.windowPage = .agents; model.helpers.openNewAgent(lead: helper.id) }
                }
                .disabled(org.depth(of: helper.id) >= OrgChart.maxDepth)
            }
            Divider()
            HStack(spacing: 8) {
                QuietButton(title: "Edit soul", symbol: "pencil") {
                    model.navigate { model.windowPage = .agents; model.helpers.selectHelper(helper.id); model.helpers.openSoul() }
                }
                QuietButton(title: "Open", symbol: "arrow.up.right") {
                    model.navigate { model.windowPage = .agents; model.helpers.selectHelper(helper.id) }
                }
                Spacer()
                if helper.custom {
                    Button("Remove", role: .destructive) { removing = true }.buttonStyle(.plain)
                        .appFont(.system(size: 12)).foregroundStyle(theme.problem.color)
                        .confirmationDialog("Remove \(helper.name) from the team?", isPresented: $removing) {
                            Button("Remove \(helper.name)", role: .destructive) {
                                model.send(.agentRemove(id: helper.id))
                                close()
                            }
                        } message: {
                            Text("Its folder moves to agents-removed; nothing is deleted. Its people move up to \(lead.flatMap { l in helpers.first { $0.id == l }?.name } ?? "ARK").")
                        }
                }
            }
        }
        .padding(16)
        .floatingSurface(RoundedRectangle(cornerRadius: theme.radiusCard + 6, style: .continuous))
    }

    private func row(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        HStack {
            Text(title).appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
            Spacer()
            content()
        }
    }
}
