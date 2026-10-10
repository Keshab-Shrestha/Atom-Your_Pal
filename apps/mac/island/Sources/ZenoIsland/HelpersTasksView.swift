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
            Image(systemName: "square.grid.2x2").font(.system(size: 13, weight: .medium)).foregroundStyle(theme.text2.color)
                .frame(width: 32, height: 32)
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
        .padding(.vertical, 8)
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
        Scrollable {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Board").font(.system(size: 18, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                    Text("Every worker's tasks. A task that waits for another starts when that one is done.")
                        .font(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
                if board.isEmpty {
                    Text("No tasks yet. Choose a worker and give it one.").font(.system(size: 12.5)).foregroundStyle(theme.text3.color)
                }
                ForEach(board, id: \.column) { group in
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
}

private struct BoardWell: View {
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
                }
                if job.state == .running, let step = job.step {
                    Text(step).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text2.color).lineLimit(1)
                }
                if job.isWaiting, let list = model.helpers.list { WaitingLine(job: job, list: list) }
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
                    WaitsForSection(model: model, job: item.job)
                    if let report = model.helpers.report {
                        ReportSection(report: report)
                    } else if item.job.hasReport {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text("Loading report…").font(.system(size: 12)).foregroundStyle(theme.text2.color)
                        }
                    }
                    NotesSection(model: model, comments: model.helpers.thread?.comments ?? [])
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
                if job.state.isActive { QuietButton(title: "Stop") { model.sendHelpers(model.helpers.stopJob(job.id)) } }
            }
            if let goal = job.goal { Text("Goal: \(goal)").font(.system(size: 12)).foregroundStyle(theme.text2.color) }
            if job.state == .failed, let error = job.error { ProblemLine(text: error) }
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

/// Keshab's notes, oldest first, and a field to add one. A note added before the task runs goes to its worker.
private struct NotesSection: View {
    let model: IslandModel
    let comments: [TaskComment]
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let draft = State(initialValue: "")
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    init(model: IslandModel, comments: [TaskComment]) {
        self.model = model
        self.comments = comments
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
                    Text("Add a note for the worker").font(.system(size: 12.5)).foregroundStyle(theme.text3.color).frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    TextField("Add a note for the worker", text: draft.projectedValue)
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
