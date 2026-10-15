import SwiftUI
import AtomIslandCore

/// ADR-091: the tokens ATOM and the team used: today and the last 7 days, each day as a bar, by worker (ATOM's own
/// chat apart) and by model, beside the Claude plan's use. On the plan, tokens count toward its limits, not money; the
/// dollars are what the same use would cost on the API.
struct DashboardPane: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let usage = model.helpers.list?.usage
        Scrollable {
            VStack(alignment: .leading, spacing: 22) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Dashboard").font(.system(size: 18, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                        Text("Tokens used by ATOM's chat and the team. On the Claude plan they count toward its limits; dollars are what the API would charge.")
                            .font(.system(size: 12)).foregroundStyle(theme.text2.color)
                    }
                    Spacer(minLength: 12)
                    updated
                }
                if let usage {
                    // One lead number (today's input + output, with how it compares to a usual day), three smaller ones for
                    // the week, and the cache counts smallest. Equal cards say nothing is more important than anything else.
                    HeroTile(value: TokenTotals.short(usage.today.io), label: "Input + output today",
                             detail: "\(usage.today.runs) run\(usage.today.runs == 1 ? "" : "s") · " + String(format: "$%.2f API-equivalent", usage.today.dollars),
                             trend: usage.todayTrend?.text)
                    HStack(spacing: 12) {
                        TokenTile(value: TokenTotals.short(usage.week.io), label: "Input + output, 7 days", detail: "\(usage.week.runs) runs", medium: true)
                        TokenTile(value: String(format: "$%.2f", usage.week.dollars), label: "API-equivalent, 7 days", detail: String(format: "$%.2f today", usage.today.dollars), medium: true)
                        // ADR-098 item 9: how much of the prompt came back from the cache.
                        TokenTile(value: usage.week.cacheHitText, label: "Cache hits, 7 days", detail: "\(usage.today.cacheHitText) today", medium: true)
                    }
                    HStack(spacing: 12) {
                        TokenTile(value: TokenTotals.short(usage.week.cacheWrite), label: "Cache written, 7 days", detail: "\(TokenTotals.short(usage.today.cacheWrite)) today", small: true)
                        TokenTile(value: TokenTotals.short(usage.week.cacheRead), label: "Cache read, 7 days", detail: "\(TokenTotals.short(usage.today.cacheRead)) today", small: true)
                    }
                    Text(Self.cacheHelp).font(.system(size: 11)).foregroundStyle(theme.text3.color).padding(.leading, 4)
                    if usage.chatCacheCold {
                        Text("Cache went cold: ATOM's last \(Self.coldRuns) chat answers read nothing from the cache, so each one sent its whole prompt again.")
                            .font(.system(size: 11.5)).foregroundStyle(theme.text2.color).padding(.leading, 4)
                    }
                    if !usage.recent.isEmpty {
                        section("Recent turns") {
                            RecentHeader()
                            ForEach(Array(usage.recent.enumerated()), id: \.offset) { index, run in
                                RowDivider()
                                RecentRow(run: run)
                            }
                        }
                    }
                    section("Each day") { DayBars(days: usage.days, today: usage.days.last?.day) }
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
                    Text("Cache reads are context read back from Claude's cache; they cost a tenth as much. To use fewer: lower a worker's model on its page, or turn off the large model in the sidebar.")
                        .font(.system(size: 11)).foregroundStyle(theme.text3.color)
                } else {
                    quiet("Waiting for ATOM…")
                }
                // ADR-091: the branches workers made, like pull requests; Keshab pushes one.
                VStack(alignment: .leading, spacing: 8) {
                    Text("Git: the team's branches").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color).padding(.leading, 4)
                    if let problem = model.helpers.problem { ProblemLine(text: problem) }
                    GitSection(model: model)
                }
            }
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.panel)
            .padding(.top, 20)
            .padding(.bottom, Spacing.panel)
        }
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
            .font(.system(size: 11)).foregroundStyle(theme.text3.color).lineLimit(1)
            .accessibilityLabel("Numbers updated \(at.formatted(.relative(presentation: .named)))")
        }
    }

    /// One line under the tiles: what the two cache counts mean.
    static let cacheHelp = "Cache written: the fixed prompt, stored once per pause. Cache read: the stored prompt used again, much cheaper."

    /// Matches COLD_CACHE_RUNS in services/helpers/src/usage.ts.
    static let coldRuns = 3

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
    /// The cache tiles are the smallest, the week's tiles are medium.
    var small = false
    var medium = false
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).font(theme.idFont(.system(size: small ? 15 : medium ? 18 : 24, weight: .semibold), size: small ? 14 : medium ? 17 : 22)).foregroundStyle(small ? theme.text2.color : theme.text.color)
            Text(label).font(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(1).minimumScaleFactor(0.8)
            Text(detail).font(.system(size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(1).minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }
}

/// Seven bars: input + output solid, cache written and cache read fainter above them; input + output over each.
private struct DayBars: View {
    let days: [DayTokens]
    /// The newest day: the only bar in colour. The rule is one accent for the thing that matters (today).
    var today: String? = nil
    @Environment(\.theme) private var theme

    var body: some View {
        let most = max(1, days.map(\.totals.total).max() ?? 1)
        HStack(alignment: .bottom, spacing: 10) {
            ForEach(days, id: \.day) { day in
                VStack(spacing: 6) {
                    Text(day.totals.total == 0 ? "–" : TokenTotals.short(day.totals.io))
                        .font(theme.idFont(.system(size: 10), size: 9.5)).foregroundStyle(theme.text3.color)
                    let tint = day.day == today ? theme.live.color : theme.text2.color
                    VStack(spacing: 0) {
                        Rectangle().fill(tint.opacity(0.28)).frame(height: bar(day.totals.cacheRead, most))
                        Rectangle().fill(tint.opacity(0.6)).frame(height: bar(day.totals.cacheWrite, most))
                        Rectangle().fill(tint).frame(height: bar(day.totals.io, most))
                    }
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
                    Text(Self.weekday(day.day)).font(.system(size: 10.5)).foregroundStyle(theme.text2.color)
                    // ADR-098 item 9: the day's cache hit rate.
                    Text(day.totals.cacheHitText).font(theme.idFont(.system(size: 9.5), size: 9)).foregroundStyle(theme.text3.color)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .frame(height: 166, alignment: .bottom)
        .padding(16)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(days.map { "\(Self.weekday($0.day)): \(TokenTotals.short($0.totals.io)) input and output tokens, \($0.totals.cacheHitText) from the cache" }.joined(separator: ", "))
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
        .font(.system(size: 10, weight: .medium)).foregroundStyle(theme.text3.color)
        .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 6)
        .accessibilityHidden(true)
    }
}

/// Token cost, job 4: one recent call: on which model, what kind, then the split of its tokens in columns.
private struct RecentRow: View {
    let run: RecentTokens
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 8) {
            Text(run.model).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text2)).lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(run.kindTitle).font(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(1)
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
        Text(TokenTotals.short(n)).font(theme.idFont(.system(size: 12, weight: strong ? .medium : .regular), size: 11.5))
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
        HStack(alignment: .firstTextBaseline, spacing: 18) {
            Text(value).font(theme.idFont(.system(size: 40, weight: .semibold), size: 36)).foregroundStyle(theme.text.color)
            VStack(alignment: .leading, spacing: 3) {
                Text(label).font(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color)
                Text(detail).font(.system(size: 11.5)).foregroundStyle(theme.text2.color)
                if let trend { Text(trend).font(.system(size: 11.5)).foregroundStyle(theme.text2.color) }
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
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(name).font(identifier ? theme.idFont(.system(size: 12.5, weight: .medium), size: 12) : .system(size: 12.5, weight: .medium))
                    .foregroundStyle(identifier ? theme.idColor(theme.text) : theme.text.color).lineLimit(1)
                Spacer()
                Text("\(TokenTotals.short(totals.io)) in + out · cache \(TokenTotals.short(totals.cacheWrite + totals.cacheRead)) · \(totals.runs) run\(totals.runs == 1 ? "" : "s")")
                    .font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text2.color)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.fill2.color)
                    Capsule().fill(theme.text2.color).frame(width: max(3, proxy.size.width * share))
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
                    Capsule().fill(used >= NoticeWatcher.warnAt ? theme.attention.color : theme.text2.color).frame(width: proxy.size.width * min(1, used))
                }
            }
            .frame(height: 5)
        }
    }
}

/// ADR-091: each `zeno/task-<id>` branch in the repositories Keshab granted: its task, commits and files, whether it is
/// on the remote, its changes on request, and Push, which asks him to confirm first. Workers never push.
private struct GitSection: View {
    let model: IslandModel
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let confirming = State<GitBranch?>(initialValue: nil)
    @Environment(\.theme) private var theme

    init(model: IslandModel) { self.model = model }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let branches = model.helpers.git {
                if branches.isEmpty {
                    Text("No branches yet. When Kame, Puff or Quill work in a git repository you granted, each task's branch shows here.")
                        .font(.system(size: 12.5)).foregroundStyle(theme.text3.color).padding(.horizontal, 4)
                }
                ForEach(branches) { branch in
                    GitBranchCard(model: model, branch: branch) { confirming.wrappedValue = branch }
                }
            } else {
                Text("Looking for branches…").font(.system(size: 12.5)).foregroundStyle(theme.text3.color).padding(.horizontal, 4)
            }
        }
        .onAppear { model.sendHelpers(model.helpers.gitCommand(.gitList)) }
        .alert("Push \(confirming.wrappedValue?.branch ?? "")?", isPresented: Binding(get: { confirming.wrappedValue != nil }, set: { if !$0 { confirming.wrappedValue = nil } }), presenting: confirming.wrappedValue) { branch in
            Button("Push") { model.sendHelpers(model.helpers.gitCommand(.gitPush(repo: branch.repo, branch: branch.branch))) }
            Button("Cancel", role: .cancel) {}
        } message: { branch in
            Text("Sends its \(branch.commits.count) commit\(branch.commits.count == 1 ? "" : "s") to origin (\(branch.remote ?? "")). Never forced. Workers never push; only you can, from here.")
        }
    }
}

private struct GitBranchCard: View {
    let model: IslandModel
    let branch: GitBranch
    let push: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        let diff = model.helpers.gitDiff.flatMap { $0.repo == branch.repo && $0.branch == branch.branch ? $0 : nil }
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                StatusDot(color: branch.pushed == .yes ? theme.success.color : branch.pushed == .changed ? theme.attention.color : theme.text3.color, size: 6)
                Text(branch.repoName).font(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color)
                Text(branch.branch).font(theme.idFont(.system(size: 11.5), size: 11)).foregroundStyle(theme.idColor(theme.text2))
                Spacer(minLength: 8)
                Text(branch.pushed == .yes ? "Pushed" : branch.pushed == .changed ? "Changed since push" : "Not pushed")
                    .font(.system(size: 11)).foregroundStyle(theme.text3.color)
            }
            if let title = branch.title { Text("Task \(branch.task): \(title)").font(.system(size: 12.5)).foregroundStyle(theme.text2.color).lineLimit(1) }
            HStack(spacing: 6) {
                Text("\(branch.commits.count) commit\(branch.commits.count == 1 ? "" : "s") on \(branch.base) · \(branch.files.count) file\(branch.files.count == 1 ? "" : "s")")
                Text("+\(branch.added)").foregroundStyle(theme.success.color)
                Text("−\(branch.removed)").foregroundStyle(theme.problem.color)
            }
            .font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color)
            VStack(alignment: .leading, spacing: 3) {
                ForEach(Array(branch.commits.prefix(4).enumerated()), id: \.offset) { _, commit in
                    HStack(spacing: 8) {
                        Text(commit.sha).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text3))
                        Text(commit.subject).font(.system(size: 12)).foregroundStyle(theme.text.color).lineLimit(1)
                    }
                }
                if branch.commits.count > 4 { Text("and \(branch.commits.count - 4) more").font(.system(size: 11)).foregroundStyle(theme.text3.color) }
                ForEach(Array(branch.files.prefix(6).enumerated()), id: \.offset) { _, file in
                    HStack(spacing: 8) {
                        Image(systemName: "doc").font(.system(size: 10)).foregroundStyle(theme.text3.color)
                        Text(file.path).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text2.color).lineLimit(1).truncationMode(.middle)
                        Spacer(minLength: 4)
                        if let a = file.added, let r = file.removed {
                            Text("+\(a)").foregroundStyle(theme.success.color)
                            Text("−\(r)").foregroundStyle(theme.problem.color)
                        } else {
                            Text("binary").foregroundStyle(theme.text3.color)
                        }
                    }
                    .font(theme.idFont(.system(size: 10.5), size: 10))
                }
                if branch.files.count > 6 { Text("and \(branch.files.count - 6) more files").font(.system(size: 11)).foregroundStyle(theme.text3.color) }
            }
            .padding(.top, 2)
            HStack(spacing: 8) {
                QuietButton(title: diff == nil ? "Show changes" : "Hide changes", symbol: "chevron.left.forwardslash.chevron.right") {
                    if diff == nil { model.sendHelpers(model.helpers.gitCommand(.gitDiff(repo: branch.repo, branch: branch.branch))) } else { model.helpers.gitDiff = nil }
                }
                QuietButton(title: "Push…", symbol: "arrow.up.circle") { push() }
                    .disabled(!branch.canPush)
                    .opacity(branch.canPush ? 1 : 0.5)
                    .help(branch.remote == nil ? "This repository has no remote named origin." : branch.pushed == .yes ? "Already on the remote." : "Push this branch to origin")
                Spacer()
                if let remote = branch.remote { Text(remote).font(theme.idFont(.system(size: 10.5), size: 10)).foregroundStyle(theme.text3.color).lineLimit(1).truncationMode(.middle) }
            }
            if let diff { DiffText(diff: diff) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
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
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(line.hasPrefix("+") && !line.hasPrefix("+++") ? theme.success.color
                        : line.hasPrefix("-") && !line.hasPrefix("---") ? theme.problem.color
                        : line.hasPrefix("@@") ? theme.live.color : theme.text2.color)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if diff.truncated || diff.text.split(separator: "\n").count > 400 {
                Text("The rest is cut off here.").font(.system(size: 10.5)).foregroundStyle(theme.text3.color).padding(.top, 4)
            }
        }
        .padding(10)
        .textSelection(.enabled)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous).fill(theme.fill1.color))
    }
}
