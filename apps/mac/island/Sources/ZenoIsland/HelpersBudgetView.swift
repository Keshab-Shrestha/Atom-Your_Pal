import AppKit
import SwiftUI
import ZenoIslandCore

// Task 3.7: budgets in the Helpers window. Spend is API-equivalent dollars (what the work would cost on the API; the
// Claude plan does not charge it).

/// A worker's daily cap and today's spend, with a warning at 80 % and a note when it is used up.
struct BudgetPicker: View {
    let model: IslandModel
    let helper: Helper
    let budget: HelperBudget
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 10) {
            CapMenu(label: "Budget", cap: budget.cap, help: "\(helper.name)'s daily budget") { model.sendHelpers(model.helpers.setBudget($0)) }
            BudgetLine(budget: budget, over: "\(helper.name) waits until tomorrow or a higher cap.")
        }
    }
}

/// The team's cap and the plan limit, at the top of the board: they hold every worker.
struct TeamBudgets: View {
    let model: IslandModel
    let team: HelperBudget
    let planLimit: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                CapMenu(label: "Team budget", cap: team.cap, help: "The whole team's daily budget") { model.sendHelpers(model.helpers.setTeamBudget($0)) }
                BudgetLine(budget: team, over: "Every worker waits until tomorrow or a higher cap.")
            }
            Menu {
                ForEach([50, 60, 70, 80, 90, 100], id: \.self) { percent in
                    Button { model.sendHelpers(model.helpers.setPlanLimit(percent)) } label: {
                        let title = percent == 100 ? "Never wait" : "Wait above \(percent)%"
                        if percent == planLimit { Label(title, systemImage: "checkmark") } else { Text(title) }
                    }
                }
            } label: {
                PillMenuLabel(label: "Plan limit", value: planLimit >= 100 ? "Never wait" : "\(planLimit)% of 5 hours", identifier: false)
            }
            .menuStyle(.button).buttonStyle(.plain).fixedSize()
            .help("New runs wait while your Claude plan's five-hour window is used above this")
        }
    }
}

/// A pop-up of the offered caps.
private struct CapMenu: View {
    let label: String
    let cap: Double?
    let help: String
    let set: (Double?) -> Void

    var body: some View {
        Menu {
            ForEach(HelperBudget.presets, id: \.self) { option in
                Button { set(option) } label: {
                    let title = HelperBudget.capTitle(option)
                    if option == cap { Label(title, systemImage: "checkmark") } else { Text(title) }
                }
            }
        } label: {
            PillMenuLabel(label: label, value: HelperBudget.capTitle(cap), dimmed: cap == nil, identifier: false)
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .help("\(help), in API-equivalent dollars: what the work would cost on the API. Your plan does not charge it.")
    }
}

/// "$1.20 of $5.00 today", amber near the cap, and why work waits once it is used up.
private struct BudgetLine: View {
    let budget: HelperBudget
    let over: String
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(budget.line).font(theme.idFont(.system(size: 11.5), size: 11))
                .foregroundStyle(budget.isOver || budget.isNear ? theme.attention.color : theme.text2.color)
            if budget.isOver { Text(over).font(.system(size: 10.5)).foregroundStyle(theme.text3.color) }
            else if budget.isNear { Text("80% used").font(.system(size: 10.5)).foregroundStyle(theme.text3.color) }
        }
    }
}

/// Why a runnable task waits (a budget, the plan's limit), on the board and in its thread.
struct HeldLine: View {
    let reason: String
    @Environment(\.theme) private var theme

    var body: some View {
        if theme.statusDots {
            // Void (ADR-086): the colour is only the dot; the words stay quiet.
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                StatusDot(color: theme.attention.color, size: 6)
                Text(reason).font(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(2)
            }
        } else {
            Label(reason, systemImage: "pause.circle").font(.system(size: 11.5)).foregroundStyle(theme.attention.color).lineLimit(2)
        }
    }
}

/// Task 3.8: a worker's new tasks plan first: the first run writes a plan and waits for Keshab's OK.
struct PlanFirstRow: View {
    let model: IslandModel
    let helper: Helper
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Plan first").font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                Text("New tasks start with a plan for your OK.").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            }
            Spacer(minLength: 4)
            ThemedSwitch(isOn: helper.planFirst, set: { model.sendHelpers(model.helpers.setPlanFirst($0)) }, label: "Plan first")
        }
        .frame(maxWidth: 320, alignment: .leading)
    }
}

/// Task 3.9: the worker's routines: when, what, and how the last one went; each can be removed.
struct RoutinesSection: View {
    let model: IslandModel
    let routines: [HelperRoutine]
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Routines").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            ForEach(routines) { routine in
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(routine.task).font(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(2)
                        Text(Self.detail(routine)).font(.system(size: 11)).foregroundStyle(theme.text2.color)
                    }
                    Spacer(minLength: 8)
                    QuietButton(title: "Remove") { model.sendHelpers(model.helpers.deleteRoutine(routine.id)) }
                }
            }
        }
    }

    static func detail(_ routine: HelperRoutine) -> String {
        guard let at = routine.lastAt else { return routine.when }
        let when = at.formatted(date: .abbreviated, time: .shortened)
        return "\(routine.when) · \(routine.lastSkipped ? "skipped \(when): the last one was still going" : "last \(when)")"
    }
}

/// Task 3.11: the folders a coder, designer or documenter may work in. The runtime refuses the home folder itself,
/// ~/Library, hidden folders and system folders; in a git repository the work goes on the task's own branch.
struct FoldersSection: View {
    let model: IslandModel
    let helper: Helper
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Folders").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
                Spacer()
                QuietButton(title: "Add folder…", symbol: "folder.badge.plus") { choose() }
            }
            if helper.grants.isEmpty {
                Text(helper.role == "documenter" ? "None: \(helper.name) writes up from the web." : "None yet: \(helper.name) needs a folder to work in.")
                    .font(.system(size: 12)).foregroundStyle(theme.text2.color)
            }
            ForEach(helper.grants, id: \.self) { path in
                HStack(spacing: 8) {
                    Image(systemName: "folder").font(.system(size: 11)).foregroundStyle(theme.text3.color)
                    Text(Self.short(path)).font(theme.idFont(.system(size: 12), size: 11.5)).foregroundStyle(theme.text.color).lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 8)
                    QuietButton(title: "Remove") { model.sendHelpers(model.helpers.removeGrant(path)) }
                }
            }
            Text("In a git repository, \(helper.name) works on its own branch. Nothing is ever pushed.")
                .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
        }
    }

    /// "~/Developer/zeno" for a folder in the home folder.
    static func short(_ path: String) -> String {
        let home = NSHomeDirectory()
        return path.hasPrefix(home + "/") ? "~" + path.dropFirst(home.count) : path
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Grant"
        panel.message = "Choose a folder \(helper.name) may work in."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        model.sendHelpers(model.helpers.addGrant(url.path))
    }
}

/// Task 3.12: which of Keshab's skills (from ~/.claude/skills) this worker may use. Only these load for its runs.
struct SkillsPicker: View {
    let model: IslandModel
    let helper: Helper
    let skills: [SkillInfo]

    var body: some View {
        Menu {
            if skills.isEmpty { Text("No skills in ~/.claude/skills") }
            ForEach(skills) { skill in
                Button { model.sendHelpers(model.helpers.toggleSkill(skill.name)) } label: {
                    if helper.skills.contains(skill.name) { Label(skill.name, systemImage: "checkmark") } else { Text(skill.name) }
                }
                .help(skill.description)
            }
        } label: {
            PillMenuLabel(label: "Skills", value: helper.skills.isEmpty ? "None" : helper.skills.count == 1 ? helper.skills[0] : "\(helper.skills.count) chosen",
                          dimmed: helper.skills.isEmpty, identifier: helper.skills.count == 1)
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .help("Skills \(helper.name) may use. Only these are loaded for its tasks.")
    }
}
