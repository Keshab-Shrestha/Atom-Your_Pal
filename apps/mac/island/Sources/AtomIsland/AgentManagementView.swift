import SwiftUI
import AtomIslandCore

/// Availability is permission to receive new work, separate from a task's observed state.
struct AgentAvailabilityMenu: View {
    let model: IslandModel
    let helper: Helper
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        Group {
            if snapshot { label } else {
                Menu {
                    Button { model.send(.agentPause(id: helper.id, paused: false)) } label: {
                        Label("Ready for new work", systemImage: helper.paused ? "circle" : "checkmark")
                    }
                    Button { model.send(.agentPause(id: helper.id, paused: true)) } label: {
                        Label("Pause new work", systemImage: helper.paused ? "checkmark" : "pause.circle")
                    }
                    Divider()
                    Text("Running tasks continue. Use Stop on a task to cancel it.")
                } label: { label }
                .menuStyle(.borderlessButton).menuIndicator(.hidden)
            }
        }
        .fixedSize()
        .disabled(!helper.available && !helper.paused)
        .accessibilityLabel("Availability for \(helper.name): \(title)")
        .help("Pause prevents new task starts; running tasks remain under their existing controls.")
    }
    private var title: String { helper.paused ? "Paused" : helper.available ? "Ready" : "Not ready" }
    private var label: some View {
        HStack(spacing: 5) {
            Image(systemName: helper.paused ? "pause.circle" : "circle.fill").appFont(.system(size: helper.paused ? 11 : 6))
                .foregroundStyle(helper.paused ? theme.text3.color : helper.available ? theme.success.color : theme.text3.color)
            Text(title).appFont(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text2.color)
            Image(systemName: "chevron.down").appFont(.system(size: 8)).foregroundStyle(theme.text3.color)
        }.padding(.horizontal, 8).frame(height: 28)
            .background(theme.fill2.color, in: RoundedRectangle(cornerRadius: 7))
    }
}

struct AgentManagementRow: View {
    let model: IslandModel
    let helper: Helper
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 10) {
            Button { open(edit: false) } label: {
                HStack(spacing: 10) {
                    HelperBadge(helper: helper, size: 30)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(helper.name).appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(1)
                        let running = helper.jobs.filter { $0.state == .running }.count
                        Text(running > 0 ? "\(running) task\(running == 1 ? "" : "s") running" : helper.roleTitle)
                            .appFont(.system(size: 11)).foregroundStyle(running > 0 ? theme.live.color : theme.text3.color).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }.contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel("Configure \(helper.name)")
            AgentAvailabilityMenu(model: model, helper: helper)
            Button("Edit") { open(edit: true) }
                .buttonStyle(SnapshotBorderlessButtonStyle()).appFont(.system(size: 12)).disabled(helper.soul == nil)
                .accessibilityLabel("Edit \(helper.name)")
        }.padding(.vertical, 10).frame(minHeight: 54)
    }
    private func open(edit: Bool) {
        model.navigate {
            model.showsAllAgents = false
            model.helpers.selectHelper(helper.id)
            if edit { model.helpers.openSoul() }
        }
    }
}

struct AgentManagementPanel: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    private var everyone: [Helper] { (model.helpers.list?.helpers ?? []).sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending } }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Agents").appFont(.system(size: 17, weight: .semibold)).foregroundStyle(theme.text.color)
                Spacer()
                Text("\(everyone.count)").appFont(.system(size: 12)).foregroundStyle(theme.text3.color)
            }.padding(.bottom, 10)
            if model.helpers.list == nil {
                LoadingStateView(text: "Loading agents…", retry: { model.send(.helpersList) })
            } else if everyone.isEmpty {
                Text("Add an agent to build your team.").appFont(.system(size: 12)).foregroundStyle(theme.text2.color).padding(.vertical, 16)
            }
            ForEach(Array(everyone.prefix(5).enumerated()), id: \.element.id) { index, helper in
                if index > 0 { Divider().overlay(theme.separator.color) }
                AgentManagementRow(model: model, helper: helper)
            }
            if !everyone.isEmpty {
                Button("View all \(everyone.count) agents") { model.showsAllAgents = true }
                    .buttonStyle(SnapshotBorderlessButtonStyle()).appFont(.system(size: 12)).padding(.top, 12)
            }
            Text("Ready agents can receive work. Pause keeps current tasks running.")
                .appFont(.system(size: 11)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true).padding(.top, 12)
        }.frame(maxWidth: .infinity, alignment: .topLeading)
    }
}
