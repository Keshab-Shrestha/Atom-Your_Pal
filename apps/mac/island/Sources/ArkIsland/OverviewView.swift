import SwiftUI
import ArkIslandCore

/// ADR-090's Activity, on Home since 2026-11-06 (Keshab: "one more trim"; it was a Board tab whose counts repeated Home's tiles):
/// who is at work on what, the goals and how far they are, and what came in. Every row opens its task. Nothing shows when the team
/// is quiet and nothing came in yet.
struct HomeActivity: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        if let list = model.helpers.list {
            let overview = TeamOverview(list: list)
            if !overview.atWork.isEmpty || !overview.goals.isEmpty || !overview.recent.isEmpty {
                VStack(alignment: .leading, spacing: 16) {
                    if !overview.atWork.isEmpty {
                        section("At work") { ForEach(overview.atWork) { item in AtWorkRow(model: model, item: item) } }
                    }
                    if !overview.goals.isEmpty {
                        section("Goals") { ForEach(overview.goals) { GoalRow(goal: $0) } }
                    }
                    if !overview.recent.isEmpty {
                        section("Just in") { ForEach(overview.recent) { item in RecentRow(model: model, item: item) } }
                    }
                }
                .padding(.top, 8)
            }
        }
    }

    private func section(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).appFont(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color).padding(.leading, 4)
            VStack(alignment: .leading, spacing: 0) { content() }
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
                    .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
        }
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
                    Text(item.job.shortTitle).appFont(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(1)
                    HStack(spacing: 8) {
                        Text(item.helperName).appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text2))
                        if let step = item.job.step { Text(step).appFont(.system(size: 11)).foregroundStyle(theme.text2.color).lineLimit(1) }
                    }
                }
                Spacer(minLength: 8)
                if let started = item.job.createdAt {
                    Text(started, style: .relative).appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct GoalRow: View {
    let goal: TeamOverview.Goal
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(goal.text).appFont(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(1)
                Spacer(minLength: 8)
                Text(goal.ended ? "Done" : "\(goal.done) of \(goal.total)").appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text2.color)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.fill2.color)
                    Capsule().fill(goal.failed > 0 ? theme.attention.color : theme.live.color).frame(width: max(4, proxy.size.width * goal.fraction))
                }
            }
            .frame(height: 4)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }
}


private struct RecentRow: View {
    let model: IslandModel
    let item: BoardItem
    @Environment(\.theme) private var theme

    var body: some View {
        Button { model.navigate { model.windowPage = .agents; model.sendHelpers(model.helpers.openThread(item.id)) } } label: {
            HStack(spacing: 12) {
                JobDot(job: item.job)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.job.shortTitle).appFont(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(1)
                    if let summary = item.job.summary { Text(summary).appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(1) }
                }
                Spacer(minLength: 8)
                Text(item.helperName).appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text3))
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
