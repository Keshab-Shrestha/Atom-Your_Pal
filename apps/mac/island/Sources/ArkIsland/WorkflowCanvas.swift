import SwiftUI
import ArkIslandCore

/// One workflow on the endless board (2026-11-05, n8n's editor as the reference — its look, not its code): the trigger, then each
/// step as a node, joined left to right by curved links with ports. Drag a node to move it; ARK saves where it is (`layout`, node
/// centres in canvas points). Click a step to edit the workflow, "+" after the last step adds one, Test run sits at the bottom.
struct WorkflowCanvas: View {
    let model: IslandModel
    let flow: Workflow
    let close: () -> Void
    let edit: (Workflow) -> Void
    @State private var moving: String?
    @State private var moveAt: CGPoint = .zero
    /// The places just saved, shown until the runtime's `workflows` event carries them (no snap back for one round trip).
    @State private var pending: [String: Workflow.Point]?
    @Environment(\.theme) private var theme

    static let node = CGSize(width: 240, height: 92)
    static let step: CGFloat = 320

    var body: some View {
        let keys = ["trigger"] + flow.steps.indices.map(String.init)
        let points = Dictionary(uniqueKeysWithValues: keys.enumerated().map { index, key in (key, place(key, index: index)) })
        let shown = points.merging(moving.map { [$0: moveAt] } ?? [:]) { _, new in new }
        let bounds = Self.bounds(Array(points.values))
        VStack(spacing: 0) {
            header
            InfiniteCanvas(bounds: bounds) {
                ZStack(alignment: .topLeading) {
                    links(keys: keys, points: shown).allowsHitTesting(false)
                    ForEach(Array(keys.enumerated()), id: \.element) { index, key in
                        node(key, index: index)
                            .frame(width: Self.node.width, height: Self.node.height)
                            .position(shown[key] ?? .zero)
                            .zIndex(key == moving ? 1 : 0)
                            .gesture(drag(key, from: points[key] ?? .zero, all: points))
                    }
                    if flow.steps.count < Workflow.maxSteps, let last = shown[keys.last ?? "trigger"] {
                        addButton.position(x: last.x + Self.node.width / 2 + 56, y: last.y)
                    }
                }
            }
            .onChange(of: flow.layout) { _, _ in pending = nil }
            .overlay(alignment: .bottom) {
                Button { model.send(.workflowRun(id: flow.id)) } label: {
                    Label("Test run", systemImage: "play.fill").appFont(.system(size: 13, weight: .semibold))
                        .padding(.horizontal, 16).padding(.vertical, 9)
                }
                .buttonStyle(.borderedProminent).tint(theme.accent.color).foregroundStyle(theme.onAccent.color)
                .clipShape(Capsule()).padding(.bottom, 16)
            }
        }
    }

    // MARK: - Places

    /// A node's centre: where Keshab left it, else in a row.
    private func place(_ key: String, index: Int) -> CGPoint {
        let saved = pending ?? flow.layout
        if let p = saved?[key] { return CGPoint(x: p.x, y: p.y) }
        // A step added after nodes were moved: right of the rightmost saved node, so it does not land on one.
        if let saved, let right = saved.values.max(by: { $0.x < $1.x }) { return CGPoint(x: right.x + Self.step, y: right.y) }
        return CGPoint(x: 80 + Self.node.width / 2 + CGFloat(index) * Self.step, y: 80 + Self.node.height / 2)
    }

    static func bounds(_ points: [CGPoint]) -> CGRect {
        let pad: CGFloat = 80
        let maxX = (points.map(\.x).max() ?? 0) + node.width / 2 + pad + 56
        let maxY = (points.map(\.y).max() ?? 0) + node.height / 2 + pad
        let minX = min(0, (points.map(\.x).min() ?? 0) - node.width / 2 - pad)
        let minY = min(0, (points.map(\.y).min() ?? 0) - node.height / 2 - pad)
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }

    private func drag(_ key: String, from start: CGPoint, all points: [String: CGPoint]) -> some Gesture {
        DragGesture(minimumDistance: 4, coordinateSpace: .named(InfiniteCanvasSpace.name))
            .onChanged { value in
                moving = key
                moveAt = CGPoint(x: start.x + value.translation.width, y: start.y + value.translation.height)
            }
            .onEnded { _ in
                // Save every node's place, so a row laid out by default stays where it was drawn.
                var saved = flow
                var layout = points.mapValues { Workflow.Point(x: $0.x.rounded(), y: $0.y.rounded()) }
                layout[key] = Workflow.Point(x: moveAt.x.rounded(), y: moveAt.y.rounded())
                saved.layout = layout
                pending = layout
                moving = nil
                model.send(.workflowSave(saved))
            }
    }

    // MARK: - Drawing

    private var header: some View {
        HStack(spacing: 10) {
            Button(action: close) { Glyph(systemName: "chevron.left").appFont(.system(size: 13, weight: .semibold)) }
                .buttonStyle(.plain).help("Back to workflows").accessibilityLabel("Back to workflows")
            Text(flow.name).appFont(.system(size: 15, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(1)
            Text(flow.enabled ? "Live" : "Draft").appFont(.system(size: 11, weight: .medium))
                .foregroundStyle(flow.enabled ? theme.success.color : theme.text3.color)
                .padding(.horizontal, 8).padding(.vertical, 2).background(Capsule().fill(theme.fill2.color))
            Spacer()
            QuietButton(title: "Edit", symbol: "pencil") { edit(flow) }
            QuietButton(title: flow.enabled ? "Unpublish" : "Publish", symbol: flow.enabled ? "pause" : "paperplane") {
                var changed = flow; changed.enabled.toggle(); model.send(.workflowSave(changed))
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
    }

    /// Curved links from each node's right port to the next one's left port, with an arrow head.
    private func links(keys: [String], points: [String: CGPoint]) -> some View {
        let half = Self.node.width / 2
        let color = theme.text3.color.opacity(0.7)
        return Canvas { context, _ in
            for (a, b) in zip(keys, keys.dropFirst()) {
                guard let from = points[a], let to = points[b] else { continue }
                let start = CGPoint(x: from.x + half, y: from.y)
                let end = CGPoint(x: to.x - half, y: to.y)
                let pull = max(40, abs(end.x - start.x) / 2)
                var path = Path()
                path.move(to: start)
                path.addCurve(to: end, control1: CGPoint(x: start.x + pull, y: start.y), control2: CGPoint(x: end.x - pull, y: end.y))
                context.stroke(path, with: .color(color), lineWidth: 1.5)
                var head = Path()
                head.move(to: end)
                head.addLine(to: CGPoint(x: end.x - 8, y: end.y - 5))
                head.addLine(to: CGPoint(x: end.x - 8, y: end.y + 5))
                head.closeSubpath()
                context.fill(head, with: .color(color))
            }
        }
    }

    @ViewBuilder
    private func node(_ key: String, index: Int) -> some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        Group {
            if key == "trigger" {
                HStack(spacing: 10) {
                    Glyph(systemName: "bolt.fill").appFont(.system(size: 18)).foregroundStyle(theme.onAccent.color)
                        .frame(width: 40, height: 40).background(Circle().fill(theme.accent.color))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Trigger").appFont(.system(size: 10.5, weight: .medium)).foregroundStyle(theme.text3.color)
                        Text(flow.triggerTitle).appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                }
            } else if flow.steps.indices.contains(index - 1) {
                let step = flow.steps[index - 1]
                let helper = model.helpers.list?.helpers.first { $0.id == step.helper }
                HStack(alignment: .top, spacing: 10) {
                    if let helper { HelperBadge(helper: helper, size: 36) } else {
                        Glyph(systemName: "person.crop.circle.badge.questionmark").appFont(.system(size: 22)).foregroundStyle(theme.problem.color)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Step \(index) · \(helper?.name ?? step.helper)").appFont(.system(size: 10.5, weight: .medium)).foregroundStyle(theme.text3.color)
                        Text(step.task).appFont(.system(size: 12.5)).foregroundStyle(theme.text.color).lineLimit(3)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
                .onTapGesture { edit(flow) }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(shape.fill(theme.fill1.color))
        .background(shape.fill(theme.surfaceSolid.color)) // solid over the grid, as n8n's nodes
        .overlay(shape.strokeBorder(key == moving ? theme.accent.color : theme.separator.color, lineWidth: key == moving ? 2 : 1))
        // Ports, as n8n draws them: in on the left (not on the trigger), out on the right.
        .overlay(alignment: .leading) { if key != "trigger" { port.offset(x: -5) } }
        .overlay(alignment: .trailing) { port.offset(x: 5) }
        .accessibilityElement(children: .combine)
    }

    private var port: some View {
        Circle().fill(theme.fill1.color).frame(width: 10, height: 10).overlay(Circle().strokeBorder(theme.text3.color, lineWidth: 1.2))
    }

    private var addButton: some View {
        Button {
            var draft = flow
            draft.steps.append(Workflow.Step(helper: draft.steps.last?.helper ?? "", task: ""))
            edit(draft)
        } label: {
            Glyph(systemName: "plus").appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text2.color)
                .frame(width: 32, height: 32)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(theme.fill2.color))
        }
        .buttonStyle(.plain).help("Add a step").accessibilityLabel("Add a step")
    }
}
