import SwiftUI
import ZenoIslandCore

/// ADR-091: the tokens ZENO and the team used: today and the last 7 days, each day as a bar, by worker (ZENO's own
/// chat apart) and by model, beside the Claude plan's use. On the plan, tokens count toward its limits, not money; the
/// dollars are what the same use would cost on the API.
struct DashboardPane: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let usage = model.helpers.list?.usage
        Scrollable {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Dashboard").font(.system(size: 18, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                    Text("Tokens used by ZENO's chat and the team. On the Claude plan they count toward its limits; dollars are what the API would charge.")
                        .font(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
                if let usage {
                    HStack(spacing: 10) {
                        TokenTile(value: TokenTotals.short(usage.today.total), label: "Tokens today", detail: "\(TokenTotals.short(usage.today.fresh)) new · \(TokenTotals.short(usage.today.cacheRead)) cached")
                        TokenTile(value: TokenTotals.short(usage.week.total), label: "Last 7 days", detail: "\(usage.week.runs) runs")
                        TokenTile(value: String(format: "$%.2f", usage.week.dollars), label: "API-equivalent, 7 days", detail: String(format: "$%.2f today", usage.today.dollars))
                    }
                    section("Each day") { DayBars(days: usage.days) }
                    if let plan = model.planUsage, !plan.isEmpty { section("Claude plan") { PlanMeters(plan: plan) } }
                    section("By worker, 7 days") {
                        if usage.byWorker.isEmpty { quiet("Nothing used yet.") }
                        ForEach(Array(usage.byWorker.enumerated()), id: \.offset) { index, worker in
                            if index > 0 { RowDivider() }
                            ShareRow(name: worker.name, totals: worker.totals, of: usage.week.total, identifier: false)
                        }
                    }
                    section("By model, 7 days") {
                        if usage.byModel.isEmpty { quiet("Nothing used yet.") }
                        ForEach(Array(usage.byModel.enumerated()), id: \.offset) { index, m in
                            if index > 0 { RowDivider() }
                            ShareRow(name: m.model, totals: m.totals, of: usage.week.total, identifier: true)
                        }
                    }
                    Text("Cached tokens are context read back from Claude's cache; they cost a tenth as much. To use fewer: lower a worker's model or budget on its page, or turn off the large model in the sidebar.")
                        .font(.system(size: 11)).foregroundStyle(theme.text3.color)
                } else {
                    quiet("Waiting for ZENO…")
                }
            }
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.panel)
            .padding(.top, 20)
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

private struct TokenTile: View {
    let value: String
    let label: String
    let detail: String
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).font(theme.idFont(.system(size: 24, weight: .semibold), size: 22)).foregroundStyle(theme.text.color)
            Text(label).font(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(1).minimumScaleFactor(0.8)
            Text(detail).font(.system(size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(1).minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }
}

/// Seven bars, new tokens solid and cached ones faint above them, the day's total over each.
private struct DayBars: View {
    let days: [DayTokens]
    @Environment(\.theme) private var theme

    var body: some View {
        let most = max(1, days.map(\.totals.total).max() ?? 1)
        HStack(alignment: .bottom, spacing: 10) {
            ForEach(days, id: \.day) { day in
                VStack(spacing: 6) {
                    Text(day.totals.total == 0 ? "–" : TokenTotals.short(day.totals.total))
                        .font(theme.idFont(.system(size: 10), size: 9.5)).foregroundStyle(theme.text3.color)
                    VStack(spacing: 0) {
                        Rectangle().fill(theme.live.color.opacity(0.28)).frame(height: bar(day.totals.cacheRead, most))
                        Rectangle().fill(theme.live.color).frame(height: bar(day.totals.fresh, most))
                    }
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
                    Text(Self.weekday(day.day)).font(.system(size: 10.5)).foregroundStyle(theme.text2.color)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .frame(height: 150, alignment: .bottom)
        .padding(16)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(days.map { "\(Self.weekday($0.day)): \(TokenTotals.short($0.totals.total)) tokens" }.joined(separator: ", "))
    }

    private func bar(_ n: Int, _ most: Int) -> CGFloat { n == 0 ? 0 : max(2, CGFloat(n) / CGFloat(most) * 96) }

    static func weekday(_ day: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        guard let date = f.date(from: day) else { return day }
        f.dateFormat = "EEE"
        return f.string(from: date)
    }
}

/// A worker's or model's share of the week: its name, a bar, its tokens and runs.
private struct ShareRow: View {
    let name: String
    let totals: TokenTotals
    let of: Int
    let identifier: Bool
    @Environment(\.theme) private var theme

    var body: some View {
        let share = of == 0 ? 0 : Double(totals.total) / Double(of)
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(name).font(identifier ? theme.idFont(.system(size: 12.5, weight: .medium), size: 12) : .system(size: 12.5, weight: .medium))
                    .foregroundStyle(identifier ? theme.idColor(theme.text) : theme.text.color).lineLimit(1)
                Spacer()
                Text("\(TokenTotals.short(totals.total)) · \(totals.runs) run\(totals.runs == 1 ? "" : "s")")
                    .font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text2.color)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.fill2.color)
                    Capsule().fill(theme.live.color).frame(width: max(3, proxy.size.width * share))
                }
            }
            .frame(height: 4)
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
    }
}

/// The Claude plan's five-hour and seven-day use.
private struct PlanMeters: View {
    let plan: PlanUsage
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let five = plan.fiveHour { meter("Five hours", five) }
            if let week = plan.sevenDay { meter("Seven days", week) }
        }
        .padding(16)
    }

    private func meter(_ label: String, _ used: Double) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(label).font(.system(size: 12.5)).foregroundStyle(theme.text.color)
                Spacer()
                Text("\(Int((used * 100).rounded()))%").font(theme.idFont(.system(size: 11.5), size: 11))
                    .foregroundStyle(used >= NoticeWatcher.warnAt ? theme.attention.color : theme.text2.color)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.fill2.color)
                    Capsule().fill(used >= NoticeWatcher.warnAt ? theme.attention.color : theme.live.color).frame(width: proxy.size.width * min(1, used))
                }
            }
            .frame(height: 5)
        }
    }
}
