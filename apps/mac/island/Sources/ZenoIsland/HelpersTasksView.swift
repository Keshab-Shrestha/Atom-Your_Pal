import AppKit
import SwiftUI
import ZenoIslandCore

// ADR-087, Task 3.4: the board of every worker's tasks, and one task's thread (notes, what it waits for, report,
// activity). The logic lives in `HelpersState`; these views only draw it.

/// "Board" at the top of the sidebar: every worker's tasks in one place, with how many need you.
struct BoardRow: View {
    let model: IslandModel
    let selected: Bool
    @Environment(\.theme) private var theme

    var body: some View {
        let needsYou = model.helpers.list?.board.first { $0.column == .needsYou }?.items.count ?? 0
        let running = model.helpers.list?.board.first { $0.column == .running }?.items.count ?? 0
        HStack(spacing: 11) {
            Image(systemName: "square.grid.2x2").font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text2.color)
                .frame(width: 26, height: 26)
                .overlay { if theme.isFlat { Circle().strokeBorder(theme.border.color, lineWidth: 1) } }
            VStack(alignment: .leading, spacing: 1) {
                Text("Board").font(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color)
                Text(needsYou > 0 ? "\(needsYou) need\(needsYou == 1 ? "s" : "") you" : running > 0 ? "\(running) running" : "Every task")
                    .font(.system(size: 11)).foregroundStyle(needsYou > 0 ? theme.text.color : theme.text3.color)
            }
            Spacer(minLength: 0)
            if needsYou > 0 { StatusDot(color: theme.problem.color, size: 6) }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background {
            if theme.isFlat {
                RoundedRectangle(cornerRadius: theme.radiusControl + 4, style: .continuous).strokeBorder(selected ? theme.border.color : .clear, lineWidth: 1)
            } else {
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(selected ? (theme.isDark ? theme.fill2.color : Color.white.opacity(0.85)) : Color.clear)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Every worker's tasks in four groups: Needs you, Running, To do, Done.
struct BoardPane: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let board = model.helpers.list?.board ?? []
        GeometryReader { viewport in
        Scrollable {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Board").font(.system(size: 18, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                    Text("Every worker's tasks. A task that waits for another starts when that one is done.")
                        .font(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
                // ADR-091: the team lives here now (the sidebar lists chats): each opens its page.
                TeamChips(model: model)
                // ADR-093: an agent whose soul.md is broken is missing from the team; say which and why.
                if let problems = model.helpers.list?.agentProblems, !problems.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Not loaded (data/agents/<folder>/soul.md)").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
                        ForEach(problems, id: \.line) { ProblemLine(text: $0.line) }
                    }
                }
                if let list = model.helpers.list, let team = list.team, let limit = list.planLimit {
                    TeamBudgets(model: model, team: team, planLimit: limit)
                }
                // ADR-090: the office floor, or the columns.
                HStack(spacing: 6) {
                    ViewChoice(title: "Floor", symbol: "person.3", selected: model.boardFloor) { model.boardFloor = true }
                    ViewChoice(title: "Columns", symbol: "rectangle.split.3x1", selected: !model.boardFloor) { model.boardFloor = false }
                }
                // ADR-091: the floor keeps its shape and fits the Board's width and the window's height.
                if model.boardFloor {
                    OfficeFloor(model: model).frame(maxHeight: max(220, viewport.size.height - 48)).frame(maxWidth: .infinity)
                }
                if board.isEmpty {
                    Text("No tasks yet. Choose a worker and give it one.").font(.system(size: 12.5)).foregroundStyle(theme.text3.color)
                }
                // ADR-094: tasks posted to the team, waiting for a worker to wake up and take them.
                if let tasks = model.helpers.list?.teamTasks, !tasks.isEmpty { TeamTasksSection(model: model, tasks: tasks) }
                if let tasks = model.helpers.list?.paperclip { PaperclipSection(tasks: tasks) }
                ForEach(model.boardFloor ? [] : board, id: \.column) { group in
                    VStack(alignment: .leading, spacing: 8) {
                        Text("\(group.column.title) · \(group.items.count)")
                            .font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color).padding(.leading, 4)
                        BoardWell(model: model, items: group.items)
                    }
                }
            }
            .padding(.horizontal, Spacing.panel)
            .padding(.top, 28)
            .padding(.bottom, Spacing.panel)
        }
        }
        // ADR-094: "All agents", over the Board, from its chip or a "+N" sign on the floor.
        .overlay(alignment: .top) {
            if model.showsAllAgents {
                ZStack(alignment: .top) {
                    Color.black.opacity(0.18).contentShape(Rectangle()).onTapGesture { model.showsAllAgents = false }
                    AllAgentsList(model: model).padding(.top, 64)
                }
            }
        }
        .onDisappear { model.showsAllAgents = false }
    }
}

struct BoardWell: View {
    let model: IslandModel
    let items: [BoardItem]
    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                if index > 0 { Rectangle().fill(theme.separator.color).frame(height: theme.isFlat ? 1 : 0.5) }
                Button { model.sendHelpers(model.helpers.openThread(item.id)) } label: { BoardCard(model: model, item: item) }
                    .buttonStyle(.plain)
            }
        }
        .background(shape.fill(theme.fill1.color))
        .overlay(shape.strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
    }
}

private struct BoardCard: View {
    let model: IslandModel
    let item: BoardItem
    @Environment(\.theme) private var theme

    var body: some View {
        let job = item.job
        HStack(alignment: .top, spacing: 12) {
            JobDot(job: job).padding(.top, 5)
            VStack(alignment: .leading, spacing: 3) {
                Text(job.title ?? job.task).font(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(2)
                    .multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    Text(item.helperName).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text2))
                    Text("#\(job.id)").font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color)
                    if job.comments > 0 {
                        Label("\(job.comments)", systemImage: "text.bubble").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                    }
                    if let parent = job.parentId { Text("for #\(parent)").font(.system(size: 10.5)).foregroundStyle(theme.text3.color) }
                }
                if job.state == .running, let step = job.step {
                    Text(step).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text2.color).lineLimit(1)
                }
                if job.isWaiting, let list = model.helpers.list { WaitingLine(job: job, list: list) }
                if let held = job.held { HeldLine(reason: held) }
                if job.state == .failed, let error = job.error { Text(error).font(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(2) }
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(theme.text3.color).padding(.top, 4)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

/// "Waits for: Networking basics (Sid)" under a task that cannot start yet.
struct WaitingLine: View {
    let job: HelperJob
    let list: HelpersList
    @Environment(\.theme) private var theme

    var body: some View {
        let names = job.waitingFor.map { id in list.item(id).map { "\($0.job.shortTitle) (\($0.helperName))" } ?? "#\(id)" }
        Label("Waits for \(names.joined(separator: ", "))", systemImage: "hourglass")
            .font(.system(size: 11)).foregroundStyle(theme.text2.color).lineLimit(2)
    }
}

/// "Waits for" beside the task field: which tasks the next task waits for (none by default).
struct WaitsForMenu: View {
    let model: IslandModel

    var body: some View {
        let chosen = model.helpers.draftBlockers
        let waitable = model.helpers.list?.waitable ?? []
        Menu {
            if waitable.isEmpty { Text("No tasks to wait for") }
            ForEach(waitable) { item in
                Button { model.helpers.toggleDraftBlocker(item.id) } label: {
                    let title = "\(item.job.shortTitle) (\(item.helperName))"
                    if chosen.contains(item.id) { Label(title, systemImage: "checkmark") } else { Text(title) }
                }
            }
        } label: {
            PillMenuLabel(label: "Waits for", value: chosen.isEmpty ? "Nothing" : chosen.count == 1 ? "1 task" : "\(chosen.count) tasks",
                          dimmed: chosen.isEmpty, identifier: false)
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .help("Start the next task only after these are done; it gets their reports")
        .accessibilityLabel("Tasks the next task waits for")
    }
}

// MARK: - One task's thread

struct ThreadPane: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        Scrollable {
            VStack(alignment: .leading, spacing: 16) {
                QuietButton(title: model.helpers.showsBoard ? "Board" : "Jobs", symbol: "chevron.left") { model.helpers.closeReport() }
                if let item = model.helpers.openItem {
                    header(item)
                    if let problem = model.helpers.problem { ProblemLine(text: problem) }
                    if let plan = model.helpers.thread?.plan { PlanSection(model: model, job: item.job, plan: plan) }
                    WaitsForSection(model: model, job: item.job)
                    if let handOffs = model.helpers.thread?.handOffs, !handOffs.isEmpty { SubTasksSection(model: model, ids: handOffs) }
                    if let report = model.helpers.report {
                        if let app = model.helpers.openTaskApp {
                            QuietButton(title: "Open in \(app)", symbol: "arrow.up.forward.app") { model.sendHelpers(model.helpers.openReportInApp()) }
                        }
                        ReportSection(report: report)
                    } else if item.job.hasReport {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text("Loading report…").font(.system(size: 12)).foregroundStyle(theme.text2.color)
                        }
                    }
                    if let goal = model.helpers.thread?.goal, goal.tasks.count > 1 { GoalSection(goal: goal, list: model.helpers.list) }
                    if item.job.isFinished && item.job.reviews == nil { RateSection(model: model, job: item.job) }
                    NotesSection(model: model, comments: model.helpers.thread?.comments ?? [], prompt: notePrompt(item))
                    if let activity = model.helpers.thread?.activity, !activity.isEmpty { ActivitySection(activity: activity) }
                }
            }
            .textSelection(.enabled)
            .frame(maxWidth: 560, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.panel + 4)
            .padding(.top, 30)
            .padding(.bottom, Spacing.panel)
        }
    }

    /// Task 3.6: a note wakes the task, so the field says what it will do.
    private func notePrompt(_ item: BoardItem) -> String {
        switch item.job.state {
        case .queued: "Add a note for \(item.helperName)"
        case .running: "Add a note: \(item.helperName) runs once more after this"
        default: "Ask \(item.helperName) again"
        }
    }

    private func header(_ item: BoardItem) -> some View {
        let job = item.job
        return VStack(alignment: .leading, spacing: 6) {
            Text(job.task).font(.system(size: 16, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                JobDot(job: job)
                Text(job.isWaiting ? "Waiting" : job.badge).font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                Text(item.helperName).font(theme.idFont(.system(size: 12), size: 11)).foregroundStyle(theme.idColor(theme.text2))
                Text("#\(job.id)").font(theme.idFont(.system(size: 12), size: 11)).foregroundStyle(theme.text3.color)
                Spacer(minLength: 0)
                if job.resumable && job.state != .running { QuietButton(title: "Start fresh") { model.sendHelpers(model.helpers.startFresh()) } }
                if job.state.isActive { QuietButton(title: "Stop") { model.sendHelpers(model.helpers.stopJob(job.id)) } }
            }
            if let goal = job.goal, goal != job.task { Text("Goal: \(goal)").font(.system(size: 12)).foregroundStyle(theme.text2.color) }
            if job.state == .failed, let error = job.error { ProblemLine(text: error) }
            if let held = job.held { HeldLine(reason: held) }
        }
    }
}

/// Task 3.8: the plan a plan-first run wrote; while it waits, Approve starts the work and Reject ends the task.
private struct PlanSection: View {
    let model: IslandModel
    let job: HelperJob
    let plan: JobPlan
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(job.awaitsApproval ? "The plan, waiting for your OK" : job.planStatus == "approved" ? "The plan you approved" : "The plan")
                .font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            Text(plan.summary).font(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color).fixedSize(horizontal: false, vertical: true)
            ForEach(Array(plan.lines.enumerated()), id: \.offset) { _, line in
                Text(line).font(.system(size: 12.5)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
            }
            if job.awaitsApproval {
                HStack(spacing: 8) {
                    QuietButton(title: "Approve", symbol: "checkmark") { model.sendHelpers(model.helpers.approvePlan()) }
                    QuietButton(title: "Reject", symbol: "xmark") { model.sendHelpers(model.helpers.rejectPlan()) }
                }
                .padding(.top, 2)
            }
        }
    }
}

/// Task 3.10: the sub-tasks this task handed to other workers, each opening its own thread.
private struct SubTasksSection: View {
    let model: IslandModel
    let ids: [Int]
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Handed off").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            ForEach(ids, id: \.self) { id in
                HStack(spacing: 8) {
                    if let item = model.helpers.list?.item(id) {
                        JobDot(job: item.job)
                        Button { model.sendHelpers(model.helpers.openThread(id)) } label: {
                            Text(item.job.shortTitle).font(.system(size: 12.5)).foregroundStyle(theme.text.color)
                        }
                        .buttonStyle(.plain)
                        Text(item.helperName).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text3))
                    } else {
                        Text("Task #\(id)").font(.system(size: 12.5)).foregroundStyle(theme.text2.color)
                    }
                }
            }
        }
    }
}

/// What the task waits for: each task with its state; while it has not started, a menu changes the list.
private struct WaitsForSection: View {
    let model: IslandModel
    let job: HelperJob
    @Environment(\.theme) private var theme

    var body: some View {
        let list = model.helpers.list
        let others = (list?.waitable ?? []).filter { $0.id != job.id }
        if !job.blockedBy.isEmpty || (job.state == .queued && !others.isEmpty) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Waits for").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
                    Spacer()
                    if job.state == .queued {
                        Menu {
                            ForEach(others) { item in
                                Button { model.sendHelpers(model.helpers.toggleBlocker(item.id)) } label: {
                                    let title = "\(item.job.shortTitle) (\(item.helperName))"
                                    if job.blockedBy.contains(item.id) { Label(title, systemImage: "checkmark") } else { Text(title) }
                                }
                            }
                        } label: {
                            Text("Change").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text2.color)
                        }
                        .menuStyle(.button).buttonStyle(.plain).fixedSize()
                    }
                }
                if job.blockedBy.isEmpty {
                    Text("Nothing: it starts when its worker is free.").font(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
                ForEach(job.blockedBy, id: \.self) { id in
                    HStack(spacing: 8) {
                        if let other = list?.item(id) {
                            JobDot(job: other.job)
                            Button { model.sendHelpers(model.helpers.openThread(id)) } label: {
                                Text(other.job.shortTitle).font(.system(size: 12.5)).foregroundStyle(theme.text.color)
                            }
                            .buttonStyle(.plain)
                            Text(other.helperName).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text3))
                        } else {
                            Text("Task #\(id)").font(.system(size: 12.5)).foregroundStyle(theme.text2.color)
                        }
                    }
                }
            }
        }
    }
}

private struct ReportSection: View {
    let report: HelperReport
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                // Void: the report's title is the window's one display line, in New York.
                Text(report.title).font(theme.isFlat ? .system(size: 24, weight: .regular, design: .serif) : .system(size: 19, weight: .semibold, design: .rounded))
                    .foregroundStyle(theme.isFlat ? Color.white : theme.text.color)
                Text(report.summary).font(.system(size: 13)).foregroundStyle(theme.text2.color)
            }
            ForEach(Array(report.paragraphs.enumerated()), id: \.offset) { _, paragraph in
                Text(paragraph).font(.system(size: 13)).foregroundStyle(theme.text.color).lineSpacing(3.5)
            }
            if !report.sources.isEmpty { SourceList(sources: report.sources).padding(.top, 4) }
        }
    }
}

/// Task 3.5: the goal Pal made this task part of, how far its tasks are, and the combined report once they have ended.
private struct GoalSection: View {
    let goal: HelperGoal
    let list: HelpersList?
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("The whole goal").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            Text(goal.progress(in: list)).font(.system(size: 12.5)).foregroundStyle(theme.text2.color)
            if let report = goal.report { ReportSection(report: report) }
        }
        .padding(.top, 6)
    }
}

/// Keshab's notes, oldest first, and a field to add one. A note added before the task runs goes to its worker.
private struct NotesSection: View {
    let model: IslandModel
    let comments: [TaskComment]
    let prompt: String
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let draft = State(initialValue: "")
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    init(model: IslandModel, comments: [TaskComment], prompt: String) {
        self.model = model
        self.comments = comments
        self.prompt = prompt
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Notes").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            ForEach(comments) { comment in
                VStack(alignment: .leading, spacing: 2) {
                    Text(comment.text).font(.system(size: 12.5)).foregroundStyle(theme.text.color).fixedSize(horizontal: false, vertical: true)
                    if let at = comment.createdAt {
                        Text(at.formatted(date: .abbreviated, time: .shortened)).font(theme.idFont(.system(size: 10.5), size: 10)).foregroundStyle(theme.text3.color)
                    }
                }
            }
            HStack(spacing: 8) {
                if snapshot {
                    Text(prompt).font(.system(size: 12.5)).foregroundStyle(theme.text3.color).frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    TextField(prompt, text: draft.projectedValue)
                        .textFieldStyle(.plain).font(.system(size: 12.5)).foregroundStyle(theme.text.color)
                        .onSubmit(add)
                        .accessibilityLabel("Note")
                }
                QuietButton(title: "Add") { add() }
            }
            .padding(.leading, 14).padding(.trailing, 6)
            .frame(height: 38)
            .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
        }
    }

    private func add() {
        guard let command = model.helpers.addComment(draft.wrappedValue) else { return }
        model.send(command)
        draft.wrappedValue = ""
    }
}

private struct ActivitySection: View {
    let activity: [TaskActivity]
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Activity").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            ForEach(Array(activity.enumerated()), id: \.offset) { _, line in
                HStack(spacing: 10) {
                    Text(line.at.map { $0.formatted(date: .omitted, time: .shortened) } ?? "").font(theme.idFont(.system(size: 11), size: 10.5))
                        .foregroundStyle(theme.text3.color).frame(width: 64, alignment: .leading)
                    Text(line.title).font(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
            }
        }
    }
}

struct SourceList: View {
    let sources: [ReportSource]
    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
        VStack(alignment: .leading, spacing: 8) {
            Text("Sources").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color).padding(.leading, 4)
            VStack(spacing: 0) {
                ForEach(Array(sources.enumerated()), id: \.offset) { index, source in
                    if index > 0 { Rectangle().fill(theme.separator.color).frame(height: 0.5).padding(.leading, 40) }
                    SourceRow(source: source)
                }
            }
            .background(shape.fill(theme.fill1.color))
            .overlay(shape.strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
        }
    }
}

struct SourceRow: View {
    let source: ReportSource
    @Environment(\.theme) private var theme

    var body: some View {
        Button {
            // The decoder keeps http(s) sources only; checked again here, right before opening.
            if let url = ReportSource.webURL(source.url.absoluteString) { NSWorkspace.shared.open(url) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "link").font(.system(size: 11, weight: .semibold)).foregroundStyle(theme.statusDots ? theme.text2.color : theme.accent.color)
                    .frame(width: 16)
                VStack(alignment: .leading, spacing: 1) {
                    Text(source.title).font(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color)
                    // The host is an identifier: SF Mono in Void's violet.
                    Text(source.url.host ?? source.url.absoluteString).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text3))
                }
                .lineLimit(1)
                Spacer(minLength: 6)
                Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(theme.text3.color)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(source.url.absoluteString)
    }
}

/// ADR-091: every worker as a chip (its pal, name and what it is doing), and New agent. ADR-094: only who matters now
/// (`TeamRoster.chips`, at most twelve); "All agents (N)" opens the rest.
private struct TeamChips: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let everyone = model.helpers.list?.helpers ?? []
        // ADR-095: with Managers, the chips are the Managers; every agent is in "All agents", grouped by manager.
        let managers = model.helpers.list.map { TeamRoster.managerChips(in: $0) } ?? []
        let chips = managers.isEmpty ? (model.helpers.list.map { TeamRoster.chips(in: $0) } ?? []) : []
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
            ForEach(managers) { status in ManagerChip(model: model, status: status) }
            ForEach(chips) { helper in
                Button { model.helpers.selectHelper(helper.id) } label: {
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
            if chips.count < everyone.count {
                quiet("All agents (\(everyone.count))", symbol: "magnifyingglass", help: "Every agent, by name or role") { model.showsAllAgents = true }
            }
            if model.helpers.list != nil {
                quiet("New agent", symbol: "plus", help: "Add an agent with its own role and soul") { model.helpers.openNewAgent() }
            }
            if !managers.isEmpty {
                quiet("New manager", symbol: "person.3", help: "Add a manager for a domain, such as Research") { model.helpers.openNewManager() }
            }
        }
    }

    private func quiet(_ title: String, symbol: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol).font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text2.color)
                .padding(.horizontal, 10).padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(help)
    }
}

/// ADR-094: every agent, A to Z, searchable by name or role; one opens its page, as a chip does. Escape closes it.
private struct AllAgentsList: View {
    let model: IslandModel
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let query = State(initialValue: "")
    /// Focus the search field on open so typing works without a click.
    private let searchFocused = FocusState<Bool>()
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    private static let rowHeight: CGFloat = 42
    private static let headerHeight: CGFloat = 22

    init(model: IslandModel) { self.model = model }

    var body: some View {
        let everyone = model.helpers.list?.helpers ?? []
        let found = TeamRoster.search(everyone, query.wrappedValue)
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("All agents · \(everyone.count)").font(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color)
                Spacer(minLength: 0)
                Button { model.showsAllAgents = false } label: {
                    Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundStyle(theme.text3.color)
                        .frame(width: 22, height: 22).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.cancelAction)
                .help("Close")
                .accessibilityLabel("Close")
            }
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                if snapshot { // ImageRenderer cannot draw a text field
                    Text("Search by name or role").font(.system(size: 12.5)).foregroundStyle(theme.text3.color)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    TextField("Search by name or role", text: query.projectedValue)
                        .textFieldStyle(.plain).font(.system(size: 12.5)).foregroundStyle(theme.text.color)
                        .focused(searchFocused.projectedValue)
                        .onAppear { searchFocused.wrappedValue = true }
                        .onSubmit { if found.count == 1 { open(found[0]) } }
                        .accessibilityLabel("Search agents by name or role")
                }
            }
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background(RoundedRectangle(cornerRadius: theme.radiusControl + 4, style: .continuous)
                .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
            if found.isEmpty {
                Text("No agent's name or role has “\(query.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines))”.")
                    .font(.system(size: 12)).foregroundStyle(theme.text3.color).padding(.vertical, 6)
            } else {
                // ADR-095: grouped by manager (one untitled group without Managers).
                let groups = model.helpers.list.map { TeamRoster.grouped(found, in: $0) } ?? [("", found)]
                Scrollable {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(groups, id: \.title) { group in
                            if !group.title.isEmpty {
                                Text(group.title).font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                                    .frame(height: Self.headerHeight, alignment: .bottom).padding(.leading, 4)
                            }
                            ForEach(group.helpers) { row($0) }
                        }
                    }
                }
                .frame(height: min(330, CGFloat(found.count) * Self.rowHeight + CGFloat(groups.filter { !$0.title.isEmpty }.count) * Self.headerHeight))
            }
        }
        .padding(14)
        .frame(width: 380)
        .background(shape.fill(theme.surfaceSolid.color))
        .overlay(shape.strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
        .shadow(color: .black.opacity(0.25), radius: 18, y: 6)
    }

    private func row(_ helper: Helper) -> some View {
        Button { open(helper) } label: {
            HStack(spacing: 9) {
                HelperBadge(helper: helper, size: 24)
                VStack(alignment: .leading, spacing: 0) {
                    Text(helper.name).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.text.color)
                    Text(TeamRoster.isWorking(helper) ? "\(helper.roleTitle) · \(helper.activity)" : helper.roleTitle)
                        .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                }
                .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 4)
            .frame(height: Self.rowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("\(helper.name)'s page")
    }

    private func open(_ helper: Helper) {
        model.showsAllAgents = false
        model.helpers.selectHelper(helper.id)
    }
}
