import SwiftUI
import ZenoIslandCore

// ADR-094: the Scheduled page (everything that runs by itself), the Board's Team group, a worker's wake-ups, and where
// the task field posts to. The logic lives in `ScheduledPage` and `HelpersState`; these views only draw it.

/// The sidebar row's second line.
enum ScheduledRow {
    static func detail(_ list: HelpersList) -> String? {
        let page = ScheduledPage(list: list)
        let running = page.entries.filter { !$0.paused }.count
        if page.isEmpty { return "Nothing scheduled" }
        let parts = [running > 0 ? "\(running) on" : nil, page.teamTasks.isEmpty ? nil : "\(page.teamTasks.count) team task\(page.teamTasks.count == 1 ? "" : "s")"]
        return parts.compactMap { $0 }.joined(separator: ", ").nilIfEmpty ?? "All paused"
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

/// Every worker's routines and wake-ups, with their next time, last run, Pause/Resume and Delete; then the team
/// tasks waiting to be taken.
struct ScheduledPane: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let page = model.helpers.list.map(ScheduledPage.init(list:))
        Scrollable {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Scheduled").font(.system(size: 18, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                    Text("What runs by itself: routines, and workers that wake up to take team tasks. Budgets and the plan's limit apply as to any task.")
                        .font(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
                }
                if let problem = model.helpers.problem { ProblemLine(text: problem) }
                if page?.isEmpty ?? true {
                    Text("Nothing is scheduled. Give a worker a routine (\"Sid, every morning at 8, …\") or turn on its wake-ups on its page.")
                        .font(.system(size: 12.5)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true).padding(.top, 6)
                }
                if let page {
                    ForEach(page.entries) { entry in ScheduledCard(model: model, entry: entry) }
                    if !page.teamTasks.isEmpty {
                        Text("Team tasks waiting · \(page.teamTasks.count)").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
                            .padding(.leading, 4).padding(.top, 6)
                        ForEach(page.teamTasks) { task in TeamTaskCard(model: model, task: task) }
                    }
                }
            }
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.panel)
            .padding(.top, 28)
            .padding(.bottom, Spacing.panel)
        }
    }
}

/// The card style of the Issues page: a hairline outline, the worker and what it does, the times, the buttons.
private struct ScheduledCard: View {
    let model: IslandModel
    let entry: ScheduledPage.Entry
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: entry.kind == .wakeUp ? "alarm" : "repeat").font(.system(size: 10.5, weight: .semibold)).foregroundStyle(theme.text3.color)
                Text(entry.helperName).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text2))
                Text(entry.schedule).font(.system(size: 11)).foregroundStyle(theme.text3.color)
                Spacer(minLength: 0)
                Text(ScheduledPage.nextText(entry)).font(theme.idFont(.system(size: 11), size: 10.5))
                    .foregroundStyle(entry.paused ? theme.attention.color : theme.text2.color)
            }
            Text(entry.title).font(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(2)
            Text(ScheduledPage.lastText(entry)).font(.system(size: 11)).foregroundStyle(theme.text3.color)
            HStack(spacing: 8) {
                QuietButton(title: entry.paused ? "Resume" : "Pause", symbol: entry.paused ? "play.fill" : "pause.fill") { pause(!entry.paused) }
                QuietButton(title: entry.kind == .wakeUp ? "Turn off" : "Delete") { delete() }
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }

    private func pause(_ paused: Bool) {
        switch entry.kind {
        case .routine(let id): model.sendHelpers(model.helpers.pauseRoutine(id, paused: paused))
        case .wakeUp: model.sendHelpers(model.helpers.pauseWakeUp(entry.helperId, paused: paused))
        }
    }

    private func delete() {
        switch entry.kind {
        case .routine(let id): model.sendHelpers(model.helpers.deleteAnyRoutine(id))
        case .wakeUp: model.sendHelpers(model.helpers.setWakeUp(entry.helperId, every: "off"))
        }
    }
}

private struct TeamTaskCard: View {
    let model: IslandModel
    let task: TeamTask
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(task.task).font(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(2)
                Text("\(task.roleTitle) · \(ScheduledPage.ageText(task))").font(.system(size: 11)).foregroundStyle(theme.text3.color)
            }
            Spacer(minLength: 8)
            QuietButton(title: "Delete") { model.sendHelpers(model.helpers.deleteTeamTask(task.id)) }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }
}

/// The Board's "Team" group: compact, one line a task; the Scheduled page has the rest.
struct TeamTasksSection: View {
    let model: IslandModel
    let tasks: [TeamTask]
    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
        VStack(alignment: .leading, spacing: 8) {
            Text("Team · \(tasks.count) waiting to be taken").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color).padding(.leading, 4)
            VStack(spacing: 0) {
                ForEach(Array(tasks.enumerated()), id: \.element.id) { index, task in
                    if index > 0 { Rectangle().fill(theme.separator.color).frame(height: theme.isFlat ? 1 : 0.5) }
                    HStack(spacing: 8) {
                        Text(task.task).font(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(1)
                        Spacer(minLength: 8)
                        Text("\(task.roleTitle) · \(ScheduledPage.ageText(task))").font(.system(size: 11)).foregroundStyle(theme.text3.color).lineLimit(1)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 8)
                }
            }
            .background(shape.fill(theme.fill1.color))
            .overlay(shape.strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
            .onTapGesture { model.windowPage = .scheduled }
        }
    }
}

/// A worker's wake-ups: off by default; when on, it takes the oldest team task its role may do each time it wakes.
struct WakeUpRow: View {
    let model: IslandModel
    let helper: Helper
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Menu {
                Button { model.sendHelpers(model.helpers.setWakeUp(helper.id, every: "off")) } label: {
                    if helper.wakeUp == nil { Label("Off", systemImage: "checkmark") } else { Text("Off") }
                }
                Divider()
                ForEach(HelperWakeUp.choices, id: \.every) { choice in
                    Button { model.sendHelpers(model.helpers.setWakeUp(helper.id, every: choice.every)) } label: {
                        if helper.wakeUp?.every == choice.every { Label(choice.title, systemImage: "checkmark") } else { Text(choice.title) }
                    }
                }
            } label: {
                PillMenuLabel(label: "Wakes up", value: helper.wakeUp?.when ?? "Off", dimmed: helper.wakeUp == nil, identifier: false)
            }
            .menuStyle(.button).buttonStyle(.plain).fixedSize()
            .help("On waking, if idle and within budget, \(helper.name) takes the oldest team task its role may do")
            .accessibilityLabel("\(helper.name)'s wake-ups")
            Text(helper.wakeUp == nil ? "Takes team tasks when on." : helper.wakeUp!.paused ? "Paused." : "Takes one team task each time, if idle.")
                .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
        }
    }
}

/// Where the task field posts: the chosen worker, or the team (anyone, or one role).
struct PostToMenu: View {
    let model: IslandModel
    let helper: Helper

    var body: some View {
        let target = model.helpers.postTo
        Menu {
            Button { model.helpers.setPostTo(nil) } label: {
                if target == nil { Label(helper.name, systemImage: "checkmark") } else { Text(helper.name) }
            }
            Divider()
            Button { model.helpers.setPostTo("") } label: {
                if target == "" { Label("Team: anyone", systemImage: "checkmark") } else { Text("Team: anyone") }
            }
            ForEach(model.helpers.list?.teamRoles ?? [], id: \.self) { role in
                Button { model.helpers.setPostTo(role) } label: {
                    if target == role { Label("Team: \(role)", systemImage: "checkmark") } else { Text("Team: \(role)") }
                }
            }
        } label: {
            PillMenuLabel(label: "For", value: target == nil ? helper.name : target == "" ? "Team: anyone" : "Team: \(target!)", identifier: false)
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .help("Give the task to \(helper.name), or post it to the team for whoever wakes up first")
        .accessibilityLabel("Who the next task is for")
    }
}
