import SwiftUI
import AtomIslandCore

/// The owner's reference: trends at left, composition/work in the middle, briefs at right.
struct DashboardOverviewGrid: View {
    let model: IslandModel
    let usage: TokenUsageSummary
    let width: CGFloat
    @Environment(\.theme) private var theme

    var body: some View {
        if width >= 1140 {
            HStack(alignment: .top, spacing: 14) {
                trends.frame(maxWidth: .infinity)
                development.frame(maxWidth: .infinity)
                briefs.frame(width: 280)
            }
        } else if width >= 760 {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 14) {
                    trends.frame(maxWidth: .infinity)
                    development.frame(maxWidth: .infinity)
                }
                briefs
            }
        } else {
            VStack(alignment: .leading, spacing: 14) { trends; development; briefs }
        }
    }

    private var trends: some View {
        VStack(spacing: 14) {
            DashboardPanel("Tokens", detail: "Input + output · 7 days") {
                DashboardTrend(days: usage.days, metric: .tokens, color: theme.live.color)
            }
            DashboardPanel("Cache reuse", detail: "Cached input · 7 days") {
                DashboardTrend(days: usage.days, metric: .cache, color: theme.success.color)
            }
            DashboardPanel("Runs", detail: "Recorded calls · 7 days") {
                DashboardTrend(days: usage.days, metric: .runs, color: theme.live.color)
            }
        }
    }

    private var development: some View {
        VStack(spacing: 14) {
            DashboardPanel("Git activity") {
                if let branches = model.helpers.git {
                    if branches.contains(where: { $0.commits.contains(where: { $0.at != nil }) }) {
                        GitCommitActivity(branches: branches)
                    } else {
                        Text("No dated task commits recorded yet.").appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                    }
                } else {
                    Text("Loading local branch activity…").appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
            }
            DashboardPanel("Token mix", detail: "Last 7 days · includes cache") {
                DashboardTokenMix(usage: usage)
            }
            DashboardPanel("Team branches") {
                if let problem = model.helpers.problem { ProblemLine(text: problem) }
                GitSection(model: model, compact: true)
            }
        }
    }

    private var briefs: some View {
        VStack(spacing: 14) {
            DashboardPanel("Your day") { DashboardBriefSummary(model: model) }
            DashboardPanel("Brief archive") {
                if model.dailyBrief.history.count > 1 {
                    BriefHistory(model: model, initiallyExpanded: true, compact: true)
                } else {
                    Text("Earlier briefs will appear here.").appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
            }
            if model.dailyBrief.latest?.preparation != nil {
                DashboardPanel("Prepared for review") {
                    DisclosureGroup("View prepared work") { PreparedBriefCards(model: model) }
                        .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
            }
        }
    }
}

struct DashboardPanel<Content: View>: View {
    let title: String
    let detail: String?
    let content: Content
    @Environment(\.theme) private var theme
    init(_ title: String, detail: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title; self.detail = detail; self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color)
                if let detail { Text(detail).appFont(.system(size: 10.5)).foregroundStyle(theme.text2.color) }
            }
            content
        }.padding(12).frame(maxWidth: .infinity, alignment: .topLeading)
            .background(theme.isDark ? theme.fill2.color : Color.white, in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct DashboardBriefSummary: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let entry = model.dailyBrief.latest {
                if let at = entry.createdAt {
                    Text(at.formatted(date: .abbreviated, time: .shortened)).appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                }
                ForEach(Array(entry.lines.prefix(3).enumerated()), id: \.offset) { _, line in
                    Text(line).appFont(.system(size: 12)).foregroundStyle(theme.text.color).fixedSize(horizontal: false, vertical: true)
                }
                if entry.lines.count > 3 {
                    DisclosureGroup("Read the full brief") {
                        Text(entry.lines.dropFirst(3).joined(separator: "\n")).appFont(.system(size: 12)).textSelection(.enabled)
                    }.appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color)
                }
                if let reason = entry.plainReason {
                    Text("Plain version: " + reason).appFont(.system(size: 10.5)).foregroundStyle(theme.text2.color)
                }
            } else {
                Text("A brief brings the day's selected sources together.").appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
            }
            if model.dailyBrief.running {
                HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Preparing brief…").appFont(.system(size: 11.5)) }
            } else {
                QuietButton(title: "Brief me", symbol: "arrow.clockwise") { model.briefMe() }
            }
        }
    }
}

private struct DashboardTrend: View {
    enum Metric { case tokens, cache, runs }
    let days: [DayTokens]
    let metric: Metric
    let color: Color
    @Environment(\.theme) private var theme
    private func value(_ day: DayTokens) -> Int {
        switch metric { case .tokens: day.totals.io; case .cache: day.totals.cacheRead; case .runs: day.totals.runs }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(TokenTotals.short(days.reduce(0) { $0 + value($1) })).appFont(.system(size: 18, weight: .semibold)).monospacedDigit().foregroundStyle(theme.text.color)
                Spacer()
                Text("7-day total").appFont(.system(size: 10.5)).foregroundStyle(theme.text2.color)
            }
            if days.isEmpty {
                Text("No daily usage recorded yet.").appFont(.system(size: 12)).foregroundStyle(theme.text2.color).frame(height: 100)
            } else {
                GeometryReader { proxy in
                    let values = days.map { CGFloat(value($0)) }
                    let maximum = max(1, values.max() ?? 1)
                    let chartHeight = max(1, proxy.size.height - 8)
                    let points = values.enumerated().map { index, n in
                        CGPoint(x: values.count == 1 ? proxy.size.width / 2 : CGFloat(index) / CGFloat(values.count - 1) * proxy.size.width,
                                y: chartHeight - n / maximum * chartHeight + 4)
                    }
                    Path { path in
                        path.move(to: CGPoint(x: 0, y: proxy.size.height))
                        for point in points { path.addLine(to: point) }
                        path.addLine(to: CGPoint(x: proxy.size.width, y: proxy.size.height)); path.closeSubpath()
                    }.fill(color.opacity(0.1))
                    Path { path in
                        if let first = points.first { path.move(to: first) }
                        for point in points.dropFirst() { path.addLine(to: point) }
                    }.stroke(color, style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))
                    ForEach(Array(points.enumerated()), id: \.offset) { index, point in
                        Circle().fill(color).frame(width: 4, height: 4).position(point)
                            .help("\(days[index].day): \(value(days[index]))")
                    }
                }.frame(height: 78)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(days.map { "\($0.day): \(value($0))" }.joined(separator: ", "))
                HStack {
                    Text(days.first?.day ?? "")
                    Spacer()
                    Text(days.last?.day ?? "")
                }.appFont(.system(size: 10)).foregroundStyle(theme.text2.color)
            }
        }
    }
}
