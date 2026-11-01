import SwiftUI
import ArkIslandCore

/// The owner's reference: trends at left, composition/work in the middle, briefs at right.
struct DashboardOverviewGrid: View {
    let model: IslandModel
    let usage: TokenUsageSummary
    let width: CGFloat
    @Environment(\.theme) private var theme

    var fitted = false

    var body: some View {
        if width >= 852 {
            HStack(alignment: .top, spacing: 12) {
                trends.frame(width: max(0, (width - 24) * 1.1 / 3.1))
                development.frame(maxWidth: .infinity)
                briefs.frame(maxWidth: .infinity)
            }.frame(maxHeight: fitted ? .infinity : nil, alignment: .top)
        } else {
            VStack(alignment: .leading, spacing: 12) { trends; development; briefs }
        }
    }

    private var trends: some View {
        VStack(spacing: 12) {
            DashboardTrendsPanel(usage: usage)
            DashboardRecentTurns(usage: usage, plan: model.planUsage, fitted: fitted)
        }.frame(maxHeight: fitted ? .infinity : nil, alignment: .top)
    }

    private var development: some View {
        VStack(spacing: 12) {
            DashboardPanel("Git activity") {
                if let branches = model.helpers.git {
                    if branches.contains(where: { $0.commits.contains(where: { $0.at != nil }) }) {
                        GitCommitActivity(branches: branches)
                    } else {
                        PanelNote(text: "No dated task commits recorded yet.")
                    }
                } else {
                    PanelNote(text: "Loading local branch activity…")
                }
            }
            DashboardPanel("Team branches", detail: model.helpers.git.map { "\($0.count) branches · scroll for all" }, fillsHeight: fitted) {
                if let problem = model.helpers.problem { ProblemLine(text: problem) }
                GitSection(model: model, compact: true, fitted: fitted, displayAll: true)
                    .frame(maxHeight: fitted ? .infinity : nil, alignment: .top)
            }
        }.frame(maxHeight: fitted ? .infinity : nil, alignment: .top)
    }

    private var briefs: some View {
        VStack(spacing: 12) {
            DashboardPanel("Your day") { DashboardBriefSummary(model: model) }
            DashboardPanel("Token mix", detail: "Last 7 days · includes cache") { DashboardTokenMix(usage: usage) }
            DashboardPanel("Brief archive", fillsHeight: fitted) {
                if model.dailyBrief.history.count > 1 {
                    if fitted {
                        Scrollable { BriefHistory(model: model, initiallyExpanded: true, compact: true) }
                            .frame(maxHeight: .infinity)
                    } else { BriefHistory(model: model, initiallyExpanded: true, compact: true) }
                } else {
                    PanelNote(text: "Earlier briefs will appear here.")
                }
            }
            if model.dailyBrief.latest?.preparation != nil {
                DashboardPanel("Prepared for review") {
                    DisclosureGroup("View prepared work") { PreparedBriefCards(model: model) }
                        .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
            }
        }.frame(maxHeight: fitted ? .infinity : nil, alignment: .top)
    }
}

struct DashboardPanel<Content: View>: View {
    let title: String
    let detail: String?
    let content: Content
    let fillsHeight: Bool
    let accessory: AnyView?
    @Environment(\.theme) private var theme
    init(_ title: String, detail: String? = nil, fillsHeight: Bool = false, accessory: AnyView? = nil, @ViewBuilder content: () -> Content) {
        self.title = title; self.detail = detail; self.fillsHeight = fillsHeight; self.accessory = accessory; self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let accessory {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 12) { labels; accessory }
                        .fixedSize(horizontal: true, vertical: false).frame(maxWidth: .infinity, alignment: .leading)
                    VStack(alignment: .leading, spacing: 8) { labels; accessory }
                }
            } else { labels }
            content
        }.padding(.horizontal, 16).padding(.vertical, 12)
            .frame(maxWidth: .infinity, maxHeight: fillsHeight ? .infinity : nil, alignment: .topLeading)
            .background(theme.isDark ? theme.fill2.color : Color.white, in: RoundedRectangle(cornerRadius: 12))
            .hoverLift(radius: 12)
    }
    private var labels: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).appFont(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color)
                if let detail { Text(detail).appFont(.system(size: 10.5)).foregroundStyle(theme.text2.color) }
            }
        }
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

struct DashboardTrend: View {
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
                PanelNote(text: "No daily usage recorded yet.").frame(height: 100, alignment: .center)
            } else {
                TrendChart(values: days.map(value), labels: days.map(\.day), color: color)
                HStack {
                    Text(days.first?.day ?? "")
                    Spacer()
                    Text(days.last?.day ?? "")
                }.appFont(.system(size: 10)).foregroundStyle(theme.text2.color)
            }
        }
    }
}

/// One chart at a time, chosen by tabs (from the HTML preview), in place of three stacked ones.
private struct DashboardTrendsPanel: View {
    let usage: TokenUsageSummary
    @State private var kind = DashboardTrendKind.tokens
    @Environment(\.theme) private var theme

    var body: some View {
        DashboardPanel("Trends", detail: kind.detail, accessory: AnyView(
            DashboardTabStrip(titles: DashboardTrendKind.allCases.map(\.title), selected: kind.rawValue) { kind = DashboardTrendKind(rawValue: $0) ?? .tokens })) {
            VStack(alignment: .leading, spacing: 10) {
                DashboardTrend(days: usage.days, metric: metric, color: kind == .cacheReuse ? theme.success.color : theme.live.color)
            }
        }
    }

    private var metric: DashboardTrend.Metric {
        switch kind { case .tokens: .tokens; case .cacheReuse: .cache; case .runs: .runs }
    }
}

/// Two or three tabs in a rounded strip (from the HTML preview).
struct DashboardTabStrip: View {
    let titles: [String]
    let selected: Int
    let select: (Int) -> Void
    @Namespace private var pill
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(titles.enumerated()), id: \.offset) { index, title in
                Button { withAnimation(Motion.settle(reduceMotion)) { select(index) } } label: {
                    Text(title).appFont(.system(size: 11.5, weight: selected == index ? .medium : .regular))
                        .foregroundStyle(selected == index ? theme.text.color : theme.text2.color)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background {
                            // The selected pill slides to the new tab (Kobra's stretching focus ring), not a jump.
                            if selected == index {
                                RoundedRectangle(cornerRadius: 6).fill(theme.isDark ? theme.fill1.color : Color.white)
                                    .shadow(color: .black.opacity(theme.isFlat ? 0 : 0.12), radius: 2, y: 1)
                                    .matchedGeometryEffect(id: "pill", in: pill)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.pressable)
                .accessibilityLabel(title)
                .accessibilityAddTraits(selected == index ? .isSelected : [])
            }
        }
        .padding(2).background(theme.fill3.color, in: RoundedRectangle(cornerRadius: 8))
    }
}

/// The last turns as bars (Turns), or the week's accounting (Usage): the HTML preview's two views of one panel. The full
/// complete accounting remains inside the Usage tab.
struct DashboardRecentTurns: View {
    enum Mode: Int, CaseIterable {
        case turns, usage
        var title: String { self == .turns ? "Turns" : "Usage" }
    }
    let usage: TokenUsageSummary
    let plan: PlanUsage?
    @State private var mode: Mode
    let fitted: Bool
    @Environment(\.theme) private var theme

    /// `mode` is the tab shown first; the gallery uses it to capture the Usage view.
    init(usage: TokenUsageSummary, plan: PlanUsage?, mode: Mode = .turns, fitted: Bool = false) {
        self.usage = usage; self.plan = plan; self.fitted = fitted; _mode = State(initialValue: mode)
    }

    var body: some View {
        let bars = RecentTurnBar.bars(usage.recent)
        DashboardPanel(mode == .turns ? "Recent turns" : "Usage details",
                       detail: mode == .turns ? "Last \(bars.count) · input and output tokens" : "Last 7 days · accounting", fillsHeight: fitted,
                       accessory: AnyView(DashboardTabStrip(titles: Mode.allCases.map(\.title), selected: mode.rawValue) { mode = Mode(rawValue: $0) ?? .turns })) {
            VStack(alignment: .leading, spacing: 10) {
                if fitted {
                    Scrollable { selectedBody(bars) }.frame(maxHeight: .infinity)
                } else { selectedBody(bars) }
            }.frame(maxHeight: fitted ? .infinity : nil, alignment: .top)
        }
    }

    @ViewBuilder private func selectedBody(_ bars: [RecentTurnBar]) -> some View {
        if mode == .turns { turns(bars) } else {
            details
            DashboardAccountingDetails(usage: usage, plan: plan).padding(.top, 12)
        }
    }

    @ViewBuilder private func turns(_ bars: [RecentTurnBar]) -> some View {
        if bars.isEmpty {
            PanelNote(text: "No recent turns recorded yet.")
        } else {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(bars.enumerated()), id: \.offset) { _, bar in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(bar.model).appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text2)).lineLimit(1)
                            Spacer(minLength: 4)
                            Text(bar.tokensText).appFont(.system(size: 12, weight: .semibold)).monospacedDigit().foregroundStyle(theme.text.color)
                            Text(bar.cachedText).appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(1)
                        }
                        GeometryReader { proxy in
                            ZStack(alignment: .leading) {
                                Capsule().fill(theme.fill3.color)
                                HStack(spacing: 0) {
                                    Rectangle().fill(theme.live.color).frame(width: proxy.size.width * bar.inputShare)
                                    Rectangle().fill(theme.accent.color).frame(width: proxy.size.width * bar.outputShare)
                                }.clipShape(Capsule())
                            }
                        }.frame(height: 6).accessibilityHidden(true)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(bar.kindTitle) on \(bar.model): \(bar.tokensText) tokens, \(bar.cachedText)")
                }
                HStack(spacing: 12) {
                    legend("Input", theme.live.color)
                    legend("Output", theme.accent.color)
                }.padding(.top, 2)
            }
        }
    }

    private var details: some View {
        let facts = UsageDetailsFacts(summary: usage)
        return VStack(alignment: .leading, spacing: 12) {
            if usage.chatCacheCold {
                Label("Recent chat turns did not reuse cached input. Details show the recorded counts.", systemImage: "info.circle")
                    .appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
            }
            Text("Dollars are an API-equivalent at list prices, not a charge.").appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                .fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .top, spacing: 16) {
                figure(facts.apiEquivalentText, "API-equivalent")
                figure(facts.cacheWrittenText, "Cache written")
                figure(facts.cacheReadText, "Cache read")
            }
            if let plan, !plan.isEmpty {
                heading("Claude plan")
                PlanMeters(plan: plan, padded: false)
            }
            shares("By model · 7 days", facts.models, more: facts.moreModels, identifier: true, color: theme.live.color)
            shares("By worker · 7 days", facts.workers, more: facts.moreWorkers, identifier: false, color: theme.accent.color)
            if facts.moreModels + facts.moreWorkers > 0 {
                Text("Open Usage details and accounting for the full list.").appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            }
        }
    }

    private func figure(_ value: String, _ title: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).appFont(.system(size: 15, weight: .semibold)).monospacedDigit().foregroundStyle(theme.text.color)
            Text(title).appFont(.system(size: 10.5)).foregroundStyle(theme.text2.color)
        }.frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
    }

    private func heading(_ title: String) -> some View {
        Text(title).appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color).accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder private func shares(_ title: String, _ rows: [UsageDetailsFacts.Row], more: Int, identifier: Bool, color: Color) -> some View {
        heading(title)
        if rows.isEmpty {
            Text("Nothing recorded yet.").appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color)
        }
        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(row.name).appFont(identifier ? theme.appIdentifierFont(.system(size: 11), size: 10.5) : .system(size: 11.5))
                        .foregroundStyle(identifier ? theme.idColor(theme.text2) : theme.text.color).lineLimit(1)
                    Spacer(minLength: 4)
                    Text(row.tokensText).appFont(.system(size: 12, weight: .semibold)).monospacedDigit().foregroundStyle(theme.text.color)
                    Text(row.percentText).appFont(.system(size: 10.5)).monospacedDigit().foregroundStyle(theme.text3.color).frame(minWidth: 34, alignment: .trailing)
                }
                ShareBar(fraction: row.share, color: color)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(row.name): \(row.tokensText) tokens, \(row.percentText) of the week")
        }
        if more > 0 { Text("+\(more) more").appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color) }
    }

    private func legend(_ title: String, _ color: Color) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(title).appFont(.system(size: 10.5)).foregroundStyle(theme.text2.color)
        }.accessibilityHidden(true)
    }
}

/// A panel with nothing to show yet: a quiet line in a soft well, not loose text (2026-10-31).
struct PanelNote: View {
    let text: String
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "circle.dashed").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color).accessibilityHidden(true)
            Text(text).appFont(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.fill3.color.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

