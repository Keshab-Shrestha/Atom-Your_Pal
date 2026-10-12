import SwiftUI
import AtomIslandCore

// ADR-095: Managers in the ZENO window: a chip each on the Board, a page each (its Agents, its mode, its budget and the
// Agents' tasks), a "New manager" form, and the "Manager" picker on an Agent's page. The logic lives in `HelpersState`
// and `TeamRoster`; these views only draw it.

/// A Manager's chip on the Board: its pal, name and "N at work" (or its Agents and mode); "!" when one needs you.
struct ManagerChip: View {
    let model: IslandModel
    let status: TeamRoster.ManagerStatus
    @Environment(\.theme) private var theme

    var body: some View {
        Button { model.navigate { model.helpers.selectManager(status.id) } } label: {
            HStack(spacing: 8) {
                ManagerBadge(manager: status.manager, working: status.atWork > 0, size: 26)
                VStack(alignment: .leading, spacing: 0) {
                    Text(status.manager.name).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(1)
                    Text(status.line).font(.system(size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(1)
                }
                Spacer(minLength: 0)
                if status.needsYou {
                    Text("!").font(.system(size: 11, weight: .bold)).foregroundStyle(theme.attention.color)
                        .accessibilityLabel("Needs you")
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: theme.radiusControl + 4, style: .continuous)
                .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("\(status.manager.name)'s page: its agents and their tasks")
    }
}

/// A Manager's disc: its pal (from its id, like a worker's), working while any of its Agents works.
struct ManagerBadge: View {
    let manager: HelperManager
    let working: Bool
    let size: CGFloat

    var body: some View {
        // A Manager drawn as a worker would be: same disc, its own colours, running jobs make it work.
        HelperBadge(helper: Helper(id: manager.id, name: manager.name, available: true, app: nil,
                                   jobs: working ? [HelperJob(id: 0, task: "", state: .running)] : []), size: size)
    }
}

/// A Manager's page: who it is, its mode (switchable), budget, its Agents (each opens its page), and their tasks.
struct ManagerPane: View {
    let model: IslandModel
    let manager: HelperManager
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let renaming = State(initialValue: false)
    private let name = State(initialValue: "")
    private let asking = State(initialValue: false)
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    init(model: IslandModel, manager: HelperManager) {
        self.model = model
        self.manager = manager
    }

    var body: some View {
        let list = model.helpers.list
        let agents = list?.agents(of: manager) ?? []
        let status = list.flatMap { TeamRoster.managers(in: $0).first { $0.id == manager.id } }
        let tasks = list?.tasks(of: manager) ?? []
        let renamed = renaming.wrappedValue && name.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines) != manager.name
        Scrollable {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 14) {
                    ManagerBadge(manager: manager, working: (status?.atWork ?? 0) > 0, size: 42)
                    VStack(alignment: .leading, spacing: 2) {
                        if renaming.wrappedValue && !snapshot {
                            TextField("Name", text: name.projectedValue)
                                .textFieldStyle(.plain).font(.system(size: 18, weight: .semibold, design: theme.titleDesign))
                                .onSubmit(rename)
                                .onExitCommand { renaming.wrappedValue = false }
                        } else {
                            HStack(spacing: 8) {
                                Text(manager.name).font(.system(size: 18, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                                if model.savedField == "manager-name" && model.helpers.problem == nil { SavedMark() }
                            }
                        }
                        Text("Manager · \(agents.count) agent\(agents.count == 1 ? "" : "s")\(status.map { $0.atWork > 0 ? " · \($0.atWork) at work" : "" } ?? "")")
                            .font(.system(size: 12)).foregroundStyle(theme.text2.color).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    if renaming.wrappedValue {
                        QuietButton(title: "Cancel") { renaming.wrappedValue = false }
                        SaveButton(enabled: renamed, label: "Save name", action: rename)
                    } else {
                        QuietButton(title: "Rename", symbol: "pencil") {
                            name.wrappedValue = manager.name
                            renaming.wrappedValue = true
                        }
                    }
                    QuietButton(title: "Remove") { asking.wrappedValue = true }
                        .help(agents.isEmpty ? "Take \(manager.name) out of the team" : "Move its agents to another manager first")
                        .confirmationDialog("Remove \(manager.name)?", isPresented: asking.projectedValue) {
                            Button("Remove \(manager.name)", role: .destructive) { model.sendHelpers(model.helpers.deleteManager()) }
                        } message: {
                            Text("Its soul.md moves to data/agents-removed/ and is not deleted. A manager with agents cannot be removed.")
                        }
                }
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        ViewChoice(title: "Plans and reviews", symbol: "list.bullet.clipboard", selected: manager.plansAndReviews) {
                            model.sendHelpers(model.helpers.setManagerMode(plansAndReviews: true))
                        }
                        ViewChoice(title: "Group only", symbol: "person.3", selected: !manager.plansAndReviews) {
                            model.sendHelpers(model.helpers.setManagerMode(plansAndReviews: false))
                        }
                    }
                    Text(manager.plansAndReviews
                        ? "ATOM hands \(manager.name) a part of your goal. A short run with no tools splits it across its agents, then reviews their reports before ATOM sees them (one revision at most)."
                        : "No model calls: ATOM gives tasks to its agents directly. \(manager.name) is a department on the Board and the floor.")
                        .font(.system(size: 11.5)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
                }
                if let budget = manager.budget { ManagerBudgetPicker(model: model, manager: manager, budget: budget) }
                if let problem = model.helpers.problem { ProblemLine(text: problem) }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Agents · \(agents.count)").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
                    if agents.isEmpty {
                        Text("No agents yet. Open an agent's page and choose \(manager.name) as its manager.")
                            .font(.system(size: 12)).foregroundStyle(theme.text3.color)
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
                        ForEach(agents) { helper in AgentChip(model: model, helper: helper) }
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Tasks · \(tasks.count)").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
                    if tasks.isEmpty {
                        Text("No tasks yet.").font(.system(size: 12)).foregroundStyle(theme.text3.color)
                    } else {
                        BoardWell(model: model, items: tasks)
                    }
                }
            }
            .padding(.horizontal, Spacing.panel)
            .padding(.top, 28)
            .padding(.bottom, Spacing.panel)
        }
        .tracksEdits(model, "manager-name", renamed)
    }

    /// Return or Save; an unchanged name just closes the field.
    private func rename() {
        renaming.wrappedValue = false
        guard let command = model.helpers.renameManager(name.wrappedValue) else { return }
        model.send(command)
        model.showSaved("manager-name")
    }
}

/// One Agent on its Manager's page: opens the Agent's page, as a Board chip does.
private struct AgentChip: View {
    let model: IslandModel
    let helper: Helper
    @Environment(\.theme) private var theme

    var body: some View {
        Button { model.navigate { model.helpers.selectHelper(helper.id) } } label: {
            HStack(spacing: 8) {
                HelperBadge(helper: helper, size: 26)
                VStack(alignment: .leading, spacing: 0) {
                    Text(helper.name).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(1)
                    Text(TeamRoster.isWorking(helper) ? helper.activity : helper.roleTitle)
                        .font(.system(size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: theme.radiusControl + 4, style: .continuous)
                .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("\(helper.name)'s page")
    }
}

/// "New manager": a name and a mode. ZENO writes it as data/agents/<name>/soul.md (`kind: manager`).
struct NewManagerPane: View {
    let model: IslandModel
    private let name = State(initialValue: "")
    private let plans = State(initialValue: false)
    @Environment(\.theme) private var theme

    init(model: IslandModel) { self.model = model }

    var body: some View {
        let typed = !name.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                QuietButton(title: "Cancel", symbol: "chevron.left") { model.navigate { model.helpers.closeNewManager() } }
                Spacer(minLength: 8)
                SaveButton(title: "Create", enabled: typed, commandS: true, label: "Create manager", action: create)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("New manager").font(theme.isFlat ? .system(size: 24, weight: .regular, design: .serif) : .system(size: 20, weight: .semibold, design: .rounded))
                    .foregroundStyle(theme.isFlat ? Color.white : theme.text.color)
                Text("A manager runs one domain, such as Research or Coding, with agents under it. It never uses tools. Saved as data/agents/<name>/soul.md.")
                    .font(.system(size: 11.5)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
            }
            if let problem = model.helpers.problem { ProblemLine(text: problem) }
            SoulField(label: "Name", text: name.projectedValue, limit: HelperSoul.limits.name, lines: 1, submit: create)
            HStack(spacing: 6) {
                ViewChoice(title: "Plans and reviews", symbol: "list.bullet.clipboard", selected: plans.wrappedValue) { plans.wrappedValue = true }
                ViewChoice(title: "Group only", symbol: "person.3", selected: !plans.wrappedValue) { plans.wrappedValue = false }
            }
        }
        .frame(maxWidth: 560, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Spacing.panel + 4)
        .padding(.top, 30)
        .padding(.bottom, Spacing.panel)
        .tracksEdits(model, "new-manager", typed)
    }

    private func create() {
        model.sendHelpers(model.helpers.createManager(name: name.wrappedValue, plansAndReviews: plans.wrappedValue))
    }
}

/// The "Manager" pill on an Agent's page: which Manager it works under; choosing another moves it.
struct ManagerPicker: View {
    let model: IslandModel
    let helper: Helper
    let managers: [HelperManager]

    var body: some View {
        let current = managers.first { $0.id == helper.manager }
        Menu {
            ForEach(managers) { manager in
                Button { model.sendHelpers(model.helpers.moveAgent(to: manager.id)) } label: {
                    if manager.id == helper.manager { Label(manager.name, systemImage: "checkmark") } else { Text(manager.name) }
                }
            }
        } label: {
            PillMenuLabel(label: "Manager", value: current?.name ?? "None", dimmed: current == nil, identifier: false)
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .help("The manager \(helper.name) works under")
    }
}
