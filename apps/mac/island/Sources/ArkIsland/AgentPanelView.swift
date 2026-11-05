import SwiftUI
import ArkIslandCore

/// ⌘J, "Ask an agent" (2026-11-02, after Keshab's reference): a panel at the window's right edge, on any page. Pick an agent, see
/// its latest tasks (a click opens the full thread) and give it a new one; the task joins the Board like any other.
struct AgentPanelView: View {
    let model: IslandModel
    @State private var text = ""
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let helpers = (model.helpers.list?.helpers ?? []).filter { $0.role != "improver" && $0.available }
        let helper = helpers.first { $0.id == model.agentPanel } ?? helpers.first
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text("Ask an agent").appFont(theme.pageTitleFont(15)).foregroundStyle(theme.text.color)
                Spacer()
                Text("⌘J").appFont(.system(size: 11, design: .monospaced)).foregroundStyle(theme.text3.color)
                Button { model.agentPanel = nil } label: { Glyph(systemName: "xmark").foregroundStyle(theme.text2.color) }
                    .buttonStyle(.plain).keyboardShortcut(.cancelAction).accessibilityLabel("Close the agent panel")
            }
            .padding(16)
            if let helper {
                Group {
                    if snapshot { picked(helper) } // snapshots draw no menus
                    else {
                        Menu {
                            ForEach(helpers) { item in Button(item.name + " · " + item.roleTitle) { model.agentPanel = item.id } }
                        } label: { picked(helper) }
                        .menuStyle(.borderlessButton).menuIndicator(.hidden)
                    }
                }
                .padding(.horizontal, 16)
                Divider().padding(.vertical, 12)
                tasks(helper)
                Spacer(minLength: 0)
                field(helper)
            } else {
                Text("No available agent. Add one on the Board.").appFont(.system(size: 13)).foregroundStyle(theme.text3.color).padding(16)
                Spacer()
            }
        }
        .frame(width: 360)
        .frame(maxHeight: .infinity)
        .floatingSurface()
        .overlay(alignment: .leading) { Rectangle().fill(theme.separator.color).frame(width: 1) }
        .shadow(color: .black.opacity(0.18), radius: 24, x: -6)
    }

    /// The chosen agent: its mark, name, role and state.
    private func picked(_ helper: Helper) -> some View {
                    HStack(spacing: 10) {
                        HelperBadge(helper: helper, size: 30)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(helper.name).appFont(.system(size: 14, weight: .semibold)).foregroundStyle(theme.text.color)
                            Text("\(helper.roleTitle) · \(AgentPresence(helper).title)").appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color)
                        }
                        Spacer()
                        Glyph(systemName: "chevron.up.chevron.down").appFont(.system(size: 10)).foregroundStyle(theme.text3.color)
                    }
    }

    private func tasks(_ helper: Helper) -> some View {
        let recent = helper.jobs.sorted { ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast) }.prefix(6)
        return VStack(alignment: .leading, spacing: 6) {
            Text(recent.isEmpty ? "No tasks yet" : "Latest tasks").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
            ForEach(Array(recent)) { job in
                Button { model.navigate { model.sendHelpers(model.helpers.openThread(job.id)) } } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(job.title ?? job.task).appFont(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(1)
                            Spacer()
                            Text(job.state.rawValue.capitalized).appFont(.system(size: 11)).foregroundStyle(job.state == .running ? theme.success.color : job.state == .failed ? theme.problem.color : theme.text3.color)
                        }
                        if let line = job.step ?? job.summary ?? job.error {
                            Text(line).appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(2)
                        }
                    }
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: theme.radiusCard).fill(theme.fill1.color))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain).help("Open the full thread")
            }
        }
        .padding(.horizontal, 16)
    }

    private func field(_ helper: Helper) -> some View {
        HStack(alignment: .bottom, spacing: 8) {
            Group {
                if snapshot { Text("Give \(helper.name) a task…").foregroundStyle(theme.text3.color).frame(maxWidth: .infinity, alignment: .leading) }
                else { TextField("Give \(helper.name) a task…", text: $text, axis: .vertical).textFieldStyle(.plain).lineLimit(1...5).onSubmit { give(helper) } }
            }
            .appFont(.system(size: 13))
            Button { give(helper) } label: {
                Glyph(systemName: "arrow.up").appFont(.system(size: 12, weight: .semibold)).foregroundStyle(theme.onAccent.color)
                    .frame(width: 26, height: 26).background(Circle().fill(text.isEmpty ? theme.text3.color : theme.accent.color))
            }
            .buttonStyle(.plain).disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityLabel("Give the task to \(helper.name)")
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: theme.radiusSurface, style: .continuous).fill(theme.fill1.color))
        .padding(16)
    }

    private func give(_ helper: Helper) {
        let task = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !task.isEmpty else { return }
        text = ""
        model.send(.jobAdd(helper: helper.id, task: task))
    }
}
