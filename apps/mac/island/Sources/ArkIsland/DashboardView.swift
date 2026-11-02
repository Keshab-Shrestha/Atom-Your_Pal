import SwiftUI
import ArkIslandCore

/// ADR-091: the tokens ARK and the team used: today and the last 7 days, each day as a bar, by worker (ARK's own
/// chat apart) and by model, beside the Claude plan's use. On the plan, tokens count toward its limits, not money; the
/// dollars are what the same use would cost on the API.
struct DashboardPane: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let usage = model.helpers.list?.usage
        let attention = BoardAttention(list: model.helpers.list, approvalPending: model.approval.pending != nil)
        GeometryReader { viewport in
            let fitted = viewport.size.width >= 900 && viewport.size.height >= 620
            Group {
                if fitted {
                    overview(usage: usage, attention: attention, width: viewport.size.width, fitted: true)
                } else {
                    Scrollable { overview(usage: usage, attention: attention, width: viewport.size.width, fitted: false) }
                }
            }
        }.onAppear { if !snapshot { model.loadBrief() } }
    }

    private func overview(usage: TokenUsageSummary?, attention: BoardAttention, width: CGFloat, fitted: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            // 2026-11-02 (Keshab's reference): Home opens with a greeting, today's one fact and an Ask box.
            HStack(alignment: .top) {
                HomeHeader(model: model, attention: attention)
                Spacer(minLength: 8)
                updated
                QuietButton(title: "Open Board", symbol: "rectangle.3.group") { openBoard(.floor) }
            }
            HomeAskBox(model: model).padding(.top, 8).padding(.bottom, 8)
            ViewThatFits(in: .horizontal) {
                summaryStrip(usage: usage, attention: attention, columns: 6).frame(minWidth: 900)
                summaryStrip(usage: usage, attention: attention, columns: 3)
            }
            if let list = model.helpers.list, case let hints = TeamHygiene.suggestions(list), !hints.isEmpty {
                SuggestionsCard(hints: hints) { id in model.navigate { model.windowPage = .agents; model.helpers.selectHelper(id) } }
            }
            if let usage {
                DashboardOverviewGrid(model: model, usage: usage, width: width - 48, fitted: fitted)
                    .frame(maxHeight: fitted ? .infinity : nil, alignment: .top)
            } else {
                LoadingStateView(text: "Loading workspace…", retry: { model.send(.helpersList) })
            }
        }.padding(.horizontal, 24).padding(.top, 8).padding(.bottom, 16)
            .frame(maxWidth: .infinity, maxHeight: fitted ? .infinity : nil, alignment: .topLeading)
    }

    private func summaryStrip(usage: TokenUsageSummary?, attention: BoardAttention, columns: Int) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: columns), alignment: .leading, spacing: 12) {
            workLink(value: model.helpers.list == nil ? nil : attention.total, title: "Need review", symbol: "tray", attention: attention.total > 0) { openBoard(.needsYou) }
            workLink(value: model.helpers.list == nil ? nil : attention.running, title: "Running", symbol: "arrow.triangle.2.circlepath") { openBoard(.columns) }
            workLink(value: model.helpers.list?.helpers.count, title: "Agents", symbol: "person.2") { openBoard(.floor); model.showsAllAgents = true }
            summaryValue(usage.map { TokenTotals.short($0.today.io) } ?? "—", title: "Tokens today", symbol: "chart.xyaxis.line")
            summaryValue(usage.map { String(format: "$%.2f", $0.week.dollars) } ?? "—", title: "API-equivalent · week", symbol: "dollarsign.circle")
            summaryValue(usage?.week.cacheHitText ?? "—", title: "Cache hits · week", symbol: "arrow.triangle.2.circlepath")
        }
    }
    private func summaryValue(_ value: String, title: String, symbol: String) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(value).appFont(.system(size: 16, weight: .semibold)).monospacedDigit().foregroundStyle(theme.text.color)
                Text(title).appFont(.system(size: 10.5)).foregroundStyle(theme.text2.color)
            }
        }.padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading).statTile()
    }

    private func usageMetrics(_ usage: TokenUsageSummary, columns: Int) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 24), count: columns), alignment: .leading, spacing: 20) {
            DashboardMetric(value: TokenTotals.short(usage.today.io), title: "Tokens today", detail: "\(usage.today.runs) runs")
            DashboardMetric(value: TokenTotals.short(usage.week.io), title: "Tokens this week", detail: "\(usage.week.runs) runs")
            DashboardMetric(value: String(format: "$%.2f", usage.week.dollars), title: "API-equivalent this week", detail: String(format: "$%.2f today", usage.today.dollars))
            DashboardMetric(value: usage.week.cacheHitText, title: "Cache hits this week", detail: "\(usage.today.cacheHitText) today")
        }
    }

    private func openBoard(_ view: BoardView) {
        model.navigate { model.windowPage = .agents; model.helpers.selectBoard(); model.boardView = view }
    }

    private func workLink(value: Int?, title: String, symbol: String, attention: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                // Needs attention: a small dot, not a coloured icon (unslop: stat cards are numbers).
                if attention { StatusDot(color: theme.attention.color, size: 6) }
                VStack(alignment: .leading, spacing: 4) {
                    Text(value.map(String.init) ?? "—").appFont(.system(size: 16, weight: .semibold)).monospacedDigit().foregroundStyle(theme.text.color)
                    Text(title).appFont(.system(size: 10.5)).foregroundStyle(theme.text2.color)
                }
                Spacer(minLength: 0)
                Glyph(systemName: "chevron.right").appFont(.system(size: 9)).foregroundStyle(theme.text3.color)
            }.padding(.vertical, 8).contentShape(Rectangle()).statTile(attention: attention)
        }.buttonStyle(.pressable).disabled(model.helpers.list == nil).accessibilityLabel("\(value.map(String.init) ?? "Loading") \(title). Open Board.")
    }

    /// "Updated 12 sec ago": how old the numbers are. A snapshot cannot tick, so it says "just now".
    @ViewBuilder private var updated: some View {
        if let at = model.helpers.usageUpdatedAt {
            Group {
                if snapshot {
                    Text("Updated just now")
                } else {
                    (Text("Updated ") + Text(at, style: .relative) + Text(" ago"))
                }
            }
            .appFont(.system(size: 11)).foregroundStyle(theme.text3.color).lineLimit(1)
            .accessibilityLabel("Numbers updated \(at.formatted(.relative(presentation: .named)))")
        }
    }

    /// One line under the tiles: what the two cache counts mean.
    static let cacheHelp = "Cache written: the fixed prompt, stored once per pause. Cache read: the stored prompt used again, much cheaper."

    /// Matches COLD_CACHE_RUNS in services/helpers/src/usage.ts.
    static let coldRuns = 3

    private func section(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).appFont(.system(size: 17, weight: .semibold)).foregroundStyle(theme.text.color)
            Divider().overlay(theme.separator.color)
            VStack(alignment: .leading, spacing: 0) { content() }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func quiet(_ text: String) -> some View {
        Text(text).appFont(.system(size: 12.5)).foregroundStyle(theme.text3.color).padding(.horizontal, 16).padding(.vertical, 16)
    }
}

/// Complete accounting moved into the existing Usage tab; no records or categories are dropped.
struct DashboardAccountingDetails: View {
    let usage: TokenUsageSummary
    let plan: PlanUsage?
    @Environment(\.theme) private var theme
    var body: some View {
                    DisclosureGroup("Usage details and accounting") {
                        VStack(alignment: .leading, spacing: 16) {
                            Text("Tokens used by ARK's chat and the team. On the Claude plan they count toward its limits; dollars are list prices for the calls counted here: tokens, Claude Code's own calls, and web searches at one cent each.")
                                .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                            if let trend = usage.todayTrend?.text { Text(trend).appFont(.system(size: 12)).foregroundStyle(theme.text2.color) }
                            HStack(spacing: 24) {
                                DashboardMetric(value: TokenTotals.short(usage.week.cacheWrite), title: "Cache written, 7 days", detail: "\(TokenTotals.short(usage.today.cacheWrite)) today")
                                DashboardMetric(value: TokenTotals.short(usage.week.cacheRead), title: "Cache read, 7 days", detail: "\(TokenTotals.short(usage.today.cacheRead)) today")
                            }
                            Text(DashboardPane.cacheHelp).appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color)
                            if let plan, !plan.isEmpty { section("Claude plan") { PlanMeters(plan: plan) } }
                            section("By worker, 7 days") {
                                if usage.byWorker.isEmpty { quiet("No worker usage recorded yet.") }
                                ForEach(Array(usage.byWorker.enumerated()), id: \.offset) { index, worker in
                                    if index > 0 { RowDivider() }
                                    ShareRow(name: worker.name, totals: worker.totals, of: usage.week.total, identifier: false)
                                }
                            }
                            section("By model, 7 days") {
                                if usage.byModel.isEmpty { quiet("No model usage recorded yet.") }
                                ForEach(Array(usage.byModel.enumerated()), id: \.offset) { index, value in
                                    if index > 0 { RowDivider() }
                                    ShareRow(name: value.model, totals: value.totals, of: usage.week.total, identifier: true)
                                }
                            }
                        }.padding(.top, 16)
                    }.appFont(.system(size: 12, weight: .medium)).foregroundStyle(theme.text2.color)

    }
    private func section(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).appFont(.system(size: 17, weight: .semibold)).foregroundStyle(theme.text.color)
            Divider().overlay(theme.separator.color)
            VStack(alignment: .leading, spacing: 0) { content() }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func quiet(_ text: String) -> some View {
        Text(text).appFont(.system(size: 12.5)).foregroundStyle(theme.text3.color).padding(.horizontal, 16).padding(.vertical, 16)
    }
}

private struct DashboardMetric: View {
    let value: String
    let title: String
    let detail: String
    @Environment(\.theme) private var theme
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
            Text(value).appFont(.system(size: 24, weight: .semibold)).monospacedDigit().foregroundStyle(theme.text.color)
            Text(detail).appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct TokenTile: View {
    let value: String
    let label: String
    let detail: String
    /// The cache tiles are the smallest, the week's tiles are medium.
    var small = false
    var medium = false
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).appFont(theme.appIdentifierFont(.system(size: small ? 15 : medium ? 18 : 24, weight: .semibold), size: small ? 14 : medium ? 17 : 22)).foregroundStyle(small ? theme.text2.color : theme.text.color)
            Text(label).appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(1).minimumScaleFactor(0.8)
            Text(detail).appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(1).minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }
}

/// Columns of the Recent turns table: the same widths in the header and in every row, so the numbers line up.
private enum RecentColumns {
    static let kind: CGFloat = 70
    static let number: CGFloat = 64
}

private struct RecentHeader: View {
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 8) {
            Text("Model").frame(maxWidth: .infinity, alignment: .leading)
            Text("Kind").frame(width: RecentColumns.kind, alignment: .leading)
            Text("Tokens").frame(width: RecentColumns.number, alignment: .trailing)
            Text("Cache w").frame(width: RecentColumns.number, alignment: .trailing)
            Text("Cache r").frame(width: RecentColumns.number, alignment: .trailing)
        }
        .appFont(.system(size: 10, weight: .medium)).foregroundStyle(theme.text3.color)
        .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 8)
        .accessibilityHidden(true)
    }
}

/// Token cost, job 4: one recent call: on which model, what kind, then the split of its tokens in columns.
private struct RecentRow: View {
    let run: RecentTokens
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 8) {
            Text(run.model).appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text2)).lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(run.kindTitle).appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(1)
                .frame(width: RecentColumns.kind, alignment: .leading)
            number(run.io, strong: true)
            number(run.cacheWrite)
            number(run.cacheRead)
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(run.kindTitle) on \(run.model): \(TokenTotals.short(run.io)) tokens, cache written \(TokenTotals.short(run.cacheWrite)), cache read \(TokenTotals.short(run.cacheRead))")
    }

    private func number(_ n: Int, strong: Bool = false) -> some View {
        Text(TokenTotals.short(n)).appFont(theme.appIdentifierFont(.system(size: 12, weight: strong ? .medium : .regular), size: 11.5))
            .foregroundStyle(strong ? theme.text.color : theme.text2.color)
            .frame(width: RecentColumns.number, alignment: .trailing)
    }
}

/// The lead of the page: today's input + output in large type, what it cost, and how it compares with a usual day.
private struct HeroTile: View {
    let value: String
    let label: String
    let detail: String
    let trend: String?
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(value).appFont(theme.appIdentifierFont(.system(size: 40, weight: .semibold), size: 36)).foregroundStyle(theme.text.color)
            VStack(alignment: .leading, spacing: 4) {
                Text(label).appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color)
                Text(detail).appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color)
                if let trend { Text(trend).appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color) }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20).padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
        .accessibilityElement(children: .combine)
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
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(name).appFont(identifier ? theme.appIdentifierFont(.system(size: 12.5, weight: .medium), size: 12) : .system(size: 12.5, weight: .medium))
                    .foregroundStyle(identifier ? theme.idColor(theme.text) : theme.text.color).lineLimit(1)
                Spacer()
                Text("\(TokenTotals.short(totals.io)) in + out · cache \(TokenTotals.short(totals.cacheWrite + totals.cacheRead)) · \(totals.runs) run\(totals.runs == 1 ? "" : "s")")
                    .appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text2.color)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.fill2.color)
                    Capsule().fill(theme.text2.color).frame(width: max(3, proxy.size.width * share))
                }
            }
            .frame(height: 4)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }
}

/// The Claude plan's five-hour and seven-day use.
struct PlanMeters: View {
    let plan: PlanUsage
    /// The page's own card pads it; the Dashboard's Usage view sits inside a panel that already does.
    var padded = true
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let five = plan.fiveHour { meter("Five hours", five) }
            if let week = plan.sevenDay { meter("Seven days", week) }
        }
        .padding(padded ? 16 : 0)
    }

    private func meter(_ label: String, _ used: Double) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).appFont(.system(size: 12.5)).foregroundStyle(theme.text.color)
                Spacer()
                Text("\(Int((used * 100).rounded()))%").appFont(theme.appIdentifierFont(.system(size: 11.5), size: 11))
                    .foregroundStyle(used >= NoticeWatcher.warnAt ? theme.attention.color : theme.text2.color)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.fill2.color)
                    Capsule().fill(used >= NoticeWatcher.warnAt ? theme.attention.color : theme.text2.color).frame(width: proxy.size.width * min(1, used))
                }
            }
            .frame(height: 5)
        }
    }
}

/// ADR-091: each `ark/task-<id>` branch in the repositories Keshab granted: its task, commits and files, whether it is
/// on the remote, its changes on request, and Push, which asks him to confirm first. Workers never push.
struct GitSection: View {
    let model: IslandModel
    let compact: Bool
    let fitted: Bool
    let displayAll: Bool
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let confirming = State<GitBranch?>(initialValue: nil)
    private let showsAll = State(initialValue: false)
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    init(model: IslandModel, compact: Bool = false, fitted: Bool = false, displayAll: Bool = false) {
        self.model = model; self.compact = compact; self.fitted = fitted; self.displayAll = displayAll
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Local branches · refresh after tasks finish").appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
                Spacer()
                QuietButton(title: "Refresh", symbol: "arrow.clockwise") { model.sendHelpers(model.helpers.gitCommand(.gitList)) }
            }
            if let branches = model.helpers.git {
                if branches.isEmpty {
                    Text("No task branches yet. Branches from active repository projects and granted repositories appear here. Subfolder projects use their own Git workspace.")
                        .appFont(.system(size: 12.5)).foregroundStyle(theme.text3.color).padding(.horizontal, 4)
                }
                if fitted {
                    Scrollable { branchRows(branches) }.frame(maxHeight: .infinity)
                } else { branchRows(branches) }
            } else {
                Text("Looking for branches…").appFont(.system(size: 12.5)).foregroundStyle(theme.text3.color).padding(.horizontal, 4)
            }
        }
        .onAppear { if !snapshot { model.sendHelpers(model.helpers.gitCommand(.gitList)) } }
        .alert("Push \(confirming.wrappedValue?.branch ?? "")?", isPresented: Binding(get: { confirming.wrappedValue != nil }, set: { if !$0 { confirming.wrappedValue = nil } }), presenting: confirming.wrappedValue) { branch in
            Button("Push") { model.sendHelpers(model.helpers.gitCommand(.gitPush(repo: branch.repo, branch: branch.branch))) }
            Button("Cancel", role: .cancel) {}
        } message: { branch in
            Text("Sends its \(branch.commits.count) commit\(branch.commits.count == 1 ? "" : "s") to origin (\(branch.remote ?? "")). Never forced. Workers never push; only you can, from here.")
        }
    }
    private func branchRows(_ branches: [GitBranch]) -> some View {
        VStack(alignment: .leading, spacing: 16) {
                if !compact { GitCommitActivity(branches: branches) }
                let visible = compact && !displayAll && !showsAll.wrappedValue ? Array(branches.prefix(4)) : branches
                ForEach(visible) { branch in
                    if compact {
                        DisclosureGroup {
                            GitBranchCard(model: model, branch: branch, embedded: true) { confirming.wrappedValue = branch }.padding(.top, 12)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Label(branch.repoName, systemImage: "arrow.triangle.branch").appFont(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text.color)
                                Text(branch.branch).appFont(.system(size: 10.5, design: .monospaced)).foregroundStyle(theme.text2.color).lineLimit(1).truncationMode(.middle).help(branch.branch)
                                Text(branch.uncommitted ? "Uncommitted work" : branch.pushed == .yes ? "Pushed" : branch.pushed == .changed ? "Changed since push" : "Not pushed")
                                    .appFont(.system(size: 10.5)).foregroundStyle(theme.text2.color)
                            }
                        }.foregroundStyle(theme.text2.color)
                        Divider().overlay(theme.separator.color)
                    } else {
                        GitBranchCard(model: model, branch: branch) { confirming.wrappedValue = branch }
                    }
                }
                if compact && !displayAll && branches.count > 4 {
                    Button(showsAll.wrappedValue ? "Show fewer branches" : "View all \(branches.count) branches") { showsAll.wrappedValue.toggle() }
                        .buttonStyle(SnapshotBorderlessButtonStyle()).appFont(.system(size: 11.5))
                }

        }
    }

}

struct GitBranchCard: View {
    let model: IslandModel
    let branch: GitBranch
    var embedded = false
    let push: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        let diff = model.helpers.gitDiff.flatMap { $0.repo == branch.repo && $0.branch == branch.branch ? $0 : nil }
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                Glyph(systemName: "arrow.triangle.branch").appFont(.system(size: 18)).foregroundStyle(theme.text2.color).padding(.top, 4)
                VStack(alignment: .leading, spacing: 4) {
                    Text(branch.repoName).appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color)
                    Text(branch.branch).appFont(.system(size: 12, design: .monospaced)).foregroundStyle(theme.text2.color)
                        .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Label(status, systemImage: branch.pushed == .yes && !branch.uncommitted ? "checkmark.circle" : "circle.dashed")
                    .appFont(.system(size: 11, weight: .medium)).foregroundStyle(branch.pushed == .yes && !branch.uncommitted ? theme.success.color : theme.text2.color)
            }
            if let title = branch.title {
                Text("Task \(branch.task) · \(title)").appFont(.system(size: 13)).foregroundStyle(theme.text.color).fixedSize(horizontal: false, vertical: true)
            }
            if branch.uncommitted {
                Label("Uncommitted work · review and commit explicitly before pushing.", systemImage: "info.circle")
                    .appFont(.system(size: 11.5)).foregroundStyle(theme.attention.color).fixedSize(horizontal: false, vertical: true)
            }
            if let warning = branch.baseWarning {
                Text(warning).appFont(.system(size: 11.5)).foregroundStyle(theme.attention.color).fixedSize(horizontal: false, vertical: true)
            } else {
                HStack(spacing: 8) {
                    Glyph(systemName: "point.topleft.down.to.point.bottomright.curvepath").foregroundStyle(theme.text3.color)
                    Text("\(branch.baseSource == "saved" ? "Saved start" : "Estimated base"): \(branch.base)\(branch.baseSHA.map { " · " + String($0.prefix(8)) } ?? "")")
                        .textSelection(.enabled)
                }.appFont(.system(size: 11, design: .monospaced)).foregroundStyle(theme.text2.color)
                if let behind = branch.behind, behind > 0 {
                    Text("\(behind) behind \(branch.base) · local refs").appFont(.system(size: 11)).foregroundStyle(theme.attention.color)
                }
            }
            if !branch.commits.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(branch.commits.prefix(4).enumerated()), id: \.offset) { index, commit in
                        HStack(alignment: .top, spacing: 12) {
                            VStack(spacing: 0) {
                                Circle().stroke(theme.live.color, lineWidth: 1.5).frame(width: 8, height: 8).padding(.top, 4)
                                Rectangle().fill(theme.separator.color).frame(width: 1).frame(maxHeight: .infinity)
                            }.frame(width: 16)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(commit.subject).appFont(.system(size: 12)).foregroundStyle(theme.text.color).fixedSize(horizontal: false, vertical: true)
                                HStack(spacing: 8) {
                                    Text(String(commit.sha.prefix(8))).appFont(.system(size: 10.5, design: .monospaced))
                                    if let at = commit.at { Text(at.formatted(date: .abbreviated, time: .shortened)).appFont(.system(size: 10.5)) }
                                }.foregroundStyle(theme.text3.color)
                            }.padding(.bottom, index == min(3, branch.commits.count - 1) ? 0 : 14)
                        }.fixedSize(horizontal: false, vertical: true)
                    }
                    if branch.commits.count > 4 {
                        Text("\(branch.commits.count - 4) more recorded commits").appFont(.system(size: 11)).foregroundStyle(theme.text2.color).padding(.leading, 24).padding(.top, 12)
                    }
                }
            }
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 8) {
                    if let tree = branch.worktree {
                        Text("Working copy: \(tree)").appFont(.system(size: 11, design: .monospaced)).foregroundStyle(theme.text2.color).textSelection(.enabled)
                    }
                    if branch.uncommitted {
                        Text("This review does not apply the task copy to the original project. New untracked file contents are not included in the diff until staged.")
                            .appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color)
                    }
                    ForEach(Array(branch.files.enumerated()), id: \.offset) { _, file in
                        HStack(spacing: 8) {
                            Glyph(systemName: "doc").foregroundStyle(theme.text3.color)
                            Text(file.path).lineLimit(1).truncationMode(.middle).help(file.path)
                            Spacer(minLength: 4)
                            if let a = file.added, let r = file.removed {
                                Text("+\(a)").foregroundStyle(theme.success.color)
                                Text("−\(r)").foregroundStyle(theme.problem.color)
                            } else { Text("binary").foregroundStyle(theme.text3.color) }
                        }.appFont(.system(size: 11, design: .monospaced)).foregroundStyle(theme.text2.color)
                    }
                }.padding(.top, 12)
            } label: {
                HStack(spacing: 8) {
                    Text("\(branch.files.count >= 200 ? "200+" : String(branch.files.count)) changed files")
                    if branch.baseSource != "unavailable" {
                        Text("+\(branch.added)").foregroundStyle(theme.success.color)
                        Text("−\(branch.removed)").foregroundStyle(theme.problem.color)
                    }
                }.appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color)
            }
            Divider().overlay(theme.separator.color)
            HStack(spacing: 8) {
                QuietButton(title: diff == nil ? "Show changes" : "Hide changes", symbol: "chevron.left.forwardslash.chevron.right") {
                    if diff == nil { model.sendHelpers(model.helpers.gitCommand(.gitDiff(repo: branch.repo, branch: branch.branch))) } else { model.helpers.gitDiff = nil }
                }.disabled(branch.baseSource == "unavailable")
                QuietButton(title: "Push…", symbol: "arrow.up.circle", action: push)
                    .disabled(!branch.canPush).opacity(branch.canPush ? 1 : 0.5)
                    .help(!branch.pushAllowed ? "Push is unavailable for this project's current access." : branch.remote == nil ? "This repository has no remote named origin." : branch.pushed == .yes ? "Already on the remote." : "Push this branch to origin")
                Spacer(minLength: 0)
            }
            if let remote = branch.remote {
                Text(remote).appFont(.system(size: 10.5, design: .monospaced)).foregroundStyle(theme.text3.color)
                    .lineLimit(1).truncationMode(.middle).help(remote)
            }
            if let diff { DiffText(diff: diff) }
        }.padding(embedded ? 0 : 16).frame(maxWidth: .infinity, alignment: .leading)
            .background { if !embedded { RoundedRectangle(cornerRadius: theme.radiusCard).strokeBorder(theme.separator.color, lineWidth: 1) } }
    }

    private var status: String {
        branch.uncommitted ? "Uncommitted" : branch.pushed == .yes ? "Pushed" : branch.pushed == .changed ? "Changed since push" : "Not pushed"
    }
}

/// A patch, its added lines green and removed ones red; the first 400 lines.
private struct DiffText: View {
    let diff: GitDiff
    @Environment(\.theme) private var theme

    var body: some View {
        let lines = diff.text.split(separator: "\n", omittingEmptySubsequences: false).prefix(400)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line.isEmpty ? " " : String(line))
                    .appFont(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(line.hasPrefix("+") && !line.hasPrefix("+++") ? theme.success.color
                        : line.hasPrefix("-") && !line.hasPrefix("---") ? theme.problem.color
                        : line.hasPrefix("@@") ? theme.live.color : theme.text2.color)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if diff.truncated || diff.text.split(separator: "\n").count > 400 {
                Text("The rest is cut off here.").appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color).padding(.top, 4)
            }
        }
        .padding(12)
        .textSelection(.enabled)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous).fill(theme.fill1.color))
    }
}

/// Small, true facts about the team that usually need a minute (TeamHygiene, 2026-11-02). A row about an agent opens its page.
struct SuggestionsCard: View {
    let hints: [TeamHygiene.Suggestion]
    let open: (String) -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Suggestions").appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color)
            ForEach(hints) { hint in
                Button { if let id = hint.helperId { open(id) } } label: {
                    HStack(spacing: 8) {
                        Glyph(systemName: "info.circle").foregroundStyle(theme.text3.color)
                        Text(hint.text).foregroundStyle(theme.text2.color).frame(maxWidth: .infinity, alignment: .leading)
                        if hint.helperId != nil { Glyph(systemName: "chevron.right").foregroundStyle(theme.text3.color) }
                    }
                    .appFont(.system(size: 13))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(hint.helperId == nil)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(theme.fill1.color))
    }
}
