import SwiftUI
import AtomIslandCore

/// ADR-090: progress at a glance: the board's counts, who is at work on what, the goals and how far they are, the
/// plan's use, and what came in. Every row opens its task.
struct OverviewPane: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let list = model.helpers.list
        let overview = list.map { TeamOverview(list: $0) }
        Scrollable {
            VStack(alignment: .leading, spacing: 22) {
                Text("What the team is doing, how far it has got, and what came in.").font(.system(size: 12)).foregroundStyle(theme.text2.color)
                if let overview {
                    HStack(spacing: 10) {
                        StatTile(value: overview.running, label: "Running", dot: theme.live.color)
                        StatTile(value: overview.needsYou, label: "Needs you", dot: overview.needsYou > 0 ? theme.attention.color : nil)
                        StatTile(value: overview.toDo, label: "To do", dot: nil)
                        StatTile(value: overview.doneToday, label: "Ended today", dot: theme.success.color)
                    }
                    section("At work") {
                        if overview.atWork.isEmpty { quiet("Nobody is working right now.") }
                        ForEach(overview.atWork) { item in AtWorkRow(model: model, item: item) }
                    }
                    if !overview.goals.isEmpty {
                        section("Goals") { ForEach(overview.goals) { GoalRow(goal: $0) } }
                    }
                    section("Today") { TodayMeters(model: model) }
                    section("Just in") {
                        if overview.recent.isEmpty { quiet("No results yet.") }
                        ForEach(overview.recent) { item in RecentRow(model: model, item: item) }
                    }
                } else {
                    LoadingStateView(text: "Loading the overview…", retry: { model.send(.helpersList) })
                }
            }
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.panel)
            .padding(.top, 28)
            .padding(.bottom, Spacing.panel)
        }
    }

    private func section(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color).padding(.leading, 4)
            VStack(alignment: .leading, spacing: 0) { content() }
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
                    .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
        }
    }

    private func quiet(_ text: String) -> some View {
        Text(text).font(.system(size: 12.5)).foregroundStyle(theme.text3.color).padding(.horizontal, 16).padding(.vertical, 14)
    }
}

private struct StatTile: View {
    let value: Int
    let label: String
    let dot: Color?
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(value)").font(theme.idFont(.system(size: 24, weight: .semibold), size: 22)).foregroundStyle(theme.text.color)
            HStack(spacing: 6) {
                if let dot { StatusDot(color: dot, size: 6) }
                Text(label).font(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(1).minimumScaleFactor(0.8)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }
}

/// A pal at work: its character playing "working", the task, its step and how long it has run.
private struct AtWorkRow: View {
    let model: IslandModel
    let item: BoardItem
    @Environment(\.theme) private var theme

    var body: some View {
        Button { model.navigate { model.windowPage = .agents; model.sendHelpers(model.helpers.openThread(item.id)) } } label: {
            HStack(spacing: 12) {
                if let character = PalLibrary.character(for: item.helperId) {
                    TimelineView(.animation(minimumInterval: 1.0 / 20)) { context in
                        PalPortrait(character: character, animation: "working", time: context.date.timeIntervalSinceReferenceDate, size: 44, glow: theme.usesGlow)
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.job.shortTitle).font(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(1)
                    HStack(spacing: 6) {
                        Text(item.helperName).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text2))
                        if let step = item.job.step { Text(step).font(.system(size: 11)).foregroundStyle(theme.text2.color).lineLimit(1) }
                    }
                }
                Spacer(minLength: 8)
                if let started = item.job.createdAt {
                    Text(started, style: .relative).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct GoalRow: View {
    let goal: TeamOverview.Goal
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(goal.text).font(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(1)
                Spacer(minLength: 8)
                Text(goal.ended ? "Done" : "\(goal.done) of \(goal.total)").font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text2.color)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.fill2.color)
                    Capsule().fill(goal.failed > 0 ? theme.attention.color : theme.live.color).frame(width: max(4, proxy.size.width * goal.fraction))
                }
            }
            .frame(height: 4)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }
}

/// The plan's five-hour window.
private struct TodayMeters: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let five = model.planUsage?.fiveHour {
                meter("Claude plan, 5 hours", value: min(1, five), text: "\(Int((five * 100).rounded()))% used", warn: five >= NoticeWatcher.warnAt)
            }
            if model.planUsage?.fiveHour == nil {
                Text("No plan use reported yet.").font(.system(size: 12.5)).foregroundStyle(theme.text3.color)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
    }

    private func meter(_ title: String, value: Double?, text: String, warn: Bool) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(title).font(.system(size: 12.5)).foregroundStyle(theme.text.color)
                Spacer()
                Text(text).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(warn ? theme.attention.color : theme.text2.color)
            }
            if let value {
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(theme.fill2.color)
                        Capsule().fill(warn ? theme.attention.color : theme.success.color).frame(width: max(4, proxy.size.width * value))
                    }
                }
                .frame(height: 4)
            }
        }
    }
}

private struct RecentRow: View {
    let model: IslandModel
    let item: BoardItem
    @Environment(\.theme) private var theme

    var body: some View {
        Button { model.navigate { model.windowPage = .agents; model.sendHelpers(model.helpers.openThread(item.id)) } } label: {
            HStack(spacing: 10) {
                JobDot(job: item.job)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.job.shortTitle).font(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(1)
                    if let summary = item.job.summary { Text(summary).font(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(1) }
                }
                Spacer(minLength: 8)
                Text(item.helperName).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text3))
            }
            .padding(.horizontal, 14).padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
