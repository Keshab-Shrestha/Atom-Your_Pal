import SwiftUI
import ArkIslandCore

/// ADR-090: everything waiting on Keshab in one list, each with its own buttons: Pal's approval card, plans to
/// approve, Tinker's proposals, interrupted tasks, and failed tasks.
struct NeedsYouPane: View {
    let model: IslandModel
    /// Inside the Board (the Board's header already names the page): no big title and less room above.
    var embedded = false
    @Environment(\.theme) private var theme
    /// Chooses what shows. It never answers anything or changes what waits (the HTML preview's chips).
    @State private var filter = NeedsYouFilter.all

    var body: some View {
        // Failed tasks have their own section below ("Failed"); listing them here too showed each one twice.
        let waiting = (model.helpers.list.map(NeedsYouItem.all(in:)) ?? []).filter { $0.kind != .failed }
        let items = waiting.filter { filter.matches($0.kind) }
        // Failed tasks wait for Keshab too (ADR-116): they sit under the things to answer.
        let everyFailed = model.helpers.list.map(TeamIssues.all(in:)) ?? []
        let failed = filter.showsFailed ? everyFailed : []
        let nothingWaits = waiting.isEmpty && everyFailed.isEmpty && model.approval.pending == nil
        let counts = NeedsYouFilter.counts(items: waiting, failed: everyFailed.count, hasApproval: model.approval.pending != nil)
        Scrollable {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    if !embedded { Text("Needs you").appFont(.system(size: 18, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color) }
                    Text("What waits for your answer, and tasks that failed. Nothing here is done without you.").appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
                if let problem = model.helpers.problem { ProblemLine(text: problem) }
                if !nothingWaits {
                    FlowLayout(spacing: 8) {
                        ForEach(NeedsYouFilter.allCases, id: \.self) { option in
                            NeedsYouChip(title: option.title, count: counts[option] ?? 0, selected: filter == option) { filter = option }
                        }
                    }
                }
                if filter.showsApproval, let request = model.approval.pending {
                    if let review = request.fileReview {
                        FileEditReviewCard(model: model, request: request, review: review)
                            .id(request.id)
                    } else {
                        let detail = request.rememberFile
                            ? request.reason + "\n\nThis file only. Chat access lasts across tasks and restarts until you revoke it."
                            : request.reason
                        card(kind: "ARK asks", who: "", title: request.summary, detail: detail) {
                            PillButton(title: request.rememberFile ? "Allow for task" : "Allow", symbol: "checkmark", prominent: true) { model.answerApproval(true) }
                            if request.rememberFile {
                                QuietButton(title: "Allow for chat", symbol: "checkmark.bubble") { model.answerApproval(true, rememberFile: true) }
                                    .help("Allow future edits to this file in this chat. Say ‘Forget file permissions for this chat’ to revoke.")
                            }
                            QuietButton(title: "Decline", symbol: "xmark") { model.answerApproval(false) }
                        }
                    }
                }
                if model.helpers.list == nil && model.approval.pending == nil {
                    // Not heard from ARK yet: that is not the same as "nothing waits".
                    LoadingStateView(text: "Loading what waits for you…", retry: { model.send(.helpersList) })
                } else if nothingWaits {
                    EmptyStateView(title: "Nothing waits for you",
                                   detail: "When an agent needs a plan approved, a command allowed or a skill accepted, or a task fails, it shows here. Nothing is done without you.")
                } else if items.isEmpty && failed.isEmpty && !(filter.showsApproval && model.approval.pending != nil) {
                    Text("Nothing under \(filter.title). Choose All to see everything that waits.")
                        .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
                ForEach(items) { item in row(item) }
                if !failed.isEmpty {
                    Text("Failed · \(failed.count)").appFont(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color).padding(.top, items.isEmpty ? 0 : 6)
                    Text("Open a task to review what happened before trying it again. Interrupted work may already have changed files.")
                        .appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
                    ForEach(failed) { item in FailedTaskCard(model: model, item: item) }
                }
            }
            // A readable measure, as on the Settings pages.
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.panel)
            .padding(.top, embedded ? 4 : 28)
            .padding(.bottom, Spacing.panel)
        }
    }

    @ViewBuilder private func row(_ item: NeedsYouItem) -> some View {
        switch item.kind {
        case .plan:
            card(kind: "Plan", who: item.helperName, title: item.title, detail: item.detail) {
                PillButton(title: "Approve", symbol: "checkmark", prominent: true) { model.sendHelpers(model.helpers.answerPlan(item.jobId!, approve: true)) }
                QuietButton(title: "Reject", symbol: "xmark") { model.sendHelpers(model.helpers.answerPlan(item.jobId!, approve: false)) }
                open(item)
            }
        case .proposal:
            let proposal = model.helpers.list?.helpers.first { $0.id == item.helperId }?.proposals.first { $0.id == item.proposalId }
            card(kind: "Tinker suggests", who: item.helperName, title: item.title, detail: item.detail,
                 tests: proposal.map { TestRunView(model: model, kind: "soul", id: $0.id, tests: $0.tests, hasCases: hasCases("soul", item.helperId), pending: true) }) {
                PillButton(title: "Accept", symbol: "checkmark", prominent: true) { model.sendHelpers(model.helpers.answerProposal(helper: item.helperId, id: item.proposalId!, accept: true)) }
                QuietButton(title: "Reject", symbol: "xmark") { model.sendHelpers(model.helpers.answerProposal(helper: item.helperId, id: item.proposalId!, accept: false)) }
            }
        case .skillDraft:
            card(kind: "Tinker drafted a skill", who: item.helperName, title: item.title, detail: item.detail) {
                PillButton(title: "Approve", symbol: "checkmark", prominent: true) { model.sendHelpers(model.helpers.answerSkillDraft(item.skillItemId!, approve: true)) }
                QuietButton(title: "Reject", symbol: "xmark") { model.sendHelpers(model.helpers.answerSkillDraft(item.skillItemId!, approve: false)) }
                QuietButton(title: "Plugins") { model.navigate { model.windowPage = .plugins } }
            }
        case .skillEdit:
            let edit = model.helpers.list?.skillEdits.first { $0.id == item.skillItemId }
            card(kind: "Skill edit suggested", who: item.helperName, title: item.title, detail: item.detail,
                 tests: edit.map { TestRunView(model: model, kind: "skill", id: $0.id, tests: $0.tests, hasCases: hasCases("skill", $0.skill), pending: true) }) {
                PillButton(title: "Accept", symbol: "checkmark", prominent: true) { model.sendHelpers(model.helpers.answerSkillEdit(item.skillItemId!, accept: true)) }
                QuietButton(title: "Reject", symbol: "xmark") { model.sendHelpers(model.helpers.answerSkillEdit(item.skillItemId!, accept: false)) }
                QuietButton(title: "Plugins") { model.navigate { model.windowPage = .plugins } }
            }
        case .skillHub:
            card(kind: "Skills hub", who: item.helperName, title: item.title, detail: item.detail) {
                QuietButton(title: "Read it in Plugins", symbol: "doc.text") { model.navigate { model.windowPage = .plugins } }
            }
        case .held:
            card(kind: "Held", who: item.helperName, title: item.title, detail: item.detail) {
                open(item)
            }
        case .failed:
            card(kind: "Failed", who: item.helperName, title: item.title, detail: item.detail) {
                QuietButton(title: "Retry", symbol: "arrow.clockwise") { model.sendHelpers(model.helpers.retry(item.jobId!)) }
                open(item)
            }
        }
    }

    private func open(_ item: NeedsYouItem) -> some View {
        QuietButton(title: "Open") { model.navigate { model.windowPage = .agents; model.sendHelpers(model.helpers.openThread(item.jobId!)) } }
    }

    /// ADR-098 item 8: whether an agent ("soul") or a skill has saved test cases.
    private func hasCases(_ kind: String, _ target: String) -> Bool {
        !(model.helpers.list?.testCases(kind: kind, target: target).isEmpty ?? true)
    }

    private func card(kind: String, who: String, title: String, detail: String, tests: TestRunView? = nil, @ViewBuilder actions: () -> some View) -> some View {
        let look = NeedsYouLook(kind: kind, theme: theme)
        return HStack(alignment: .top, spacing: 16) {
            NeedsYouTile(symbol: look.symbol, tint: look.tint)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    NeedsYouBadge(text: kind, tint: look.tint)
                    if !who.isEmpty { Text(who).appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text2)) }
                }
                Text(title).appFont(.system(size: 13.5, weight: .medium)).foregroundStyle(theme.text.color).fixedSize(horizontal: false, vertical: true).lineLimit(3)
                Text(detail).appFont(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true).lineLimit(8) // 8: an approval can carry a whole soul (create_agent)
                if let tests { tests.padding(.top, 2) }
                HStack(spacing: 8) { actions() }.padding(.top, 8)
            }
        }
        .needsYouCard()
    }
}

/// ADR-090: one failed task: why, how often it was tried, and Retry and Open. The Needs you tab lists these under "Failed"
/// (ADR-116: they wait for Keshab too).
struct FailedTaskCard: View {
    let model: IslandModel
    let item: BoardItem
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
        NeedsYouTile(symbol: item.job.recoveryNeeded ? "exclamationmark.arrow.circlepath" : "exclamationmark.triangle", tint: theme.problem.color)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                JobDot(job: item.job)
                Text(item.helperName).appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text2))
                Text("#\(item.id)").appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color)
                if item.job.autoRetries > 0 { Text("tried again once").appFont(.system(size: 11)).foregroundStyle(theme.text3.color) }
                Spacer(minLength: 0)
                if let ended = item.job.endedAt { Text(ended, style: .relative).appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color) }
            }
            Text(item.job.shortTitle).appFont(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(2)
            if item.job.recoveryNeeded { Text("Interrupted · outcome unconfirmed").appFont(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color) }
            if let error = item.job.error { ProblemLine(text: error, dot: false) }
            if item.job.recoveryNeeded, let step = item.job.step { Text("Last recorded step: \(step)").appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color) }
            HStack(spacing: 8) {
                if !item.job.recoveryNeeded { QuietButton(title: "Retry", symbol: "arrow.clockwise") { model.sendHelpers(model.helpers.retry(item.id)) } }
                QuietButton(title: item.job.recoveryNeeded ? "Review attempt" : "Open") { model.navigate { model.windowPage = .agents; model.sendHelpers(model.helpers.openThread(item.id)) } }
            }
            .padding(.top, 8)
        }
        }
        .needsYouCard()
    }
}

/// How a kind of waiting item looks: its glyph and the colour of its tile and badge.
private struct NeedsYouLook {
    let symbol: String
    let tint: Color

    init(kind: String, theme: ThemePalette) {
        switch kind {
        case "Plan": (symbol, tint) = ("list.bullet.clipboard", theme.accent.color)
        case "ARK asks": (symbol, tint) = ("questionmark.bubble", theme.attention.color)
        case "Held": (symbol, tint) = ("hand.raised", theme.attention.color)
        case "Failed": (symbol, tint) = ("exclamationmark.triangle", theme.problem.color)
        case "Tinker suggests": (symbol, tint) = ("wand.and.stars", theme.idColor(theme.accent))
        default: (symbol, tint) = ("puzzlepiece.extension", theme.idColor(theme.accent)) // skills: drafts, edits, the hub
        }
    }
}

/// The kind's glyph in a tinted rounded tile, at the card's leading edge.
private struct NeedsYouTile: View {
    let symbol: String
    let tint: Color
    @Environment(\.theme) private var theme
    var body: some View {
        // The glyph in the text colour on a neutral step; the kind's colour lives only in its badge (unslop).
        Glyph(systemName: symbol).appFont(.system(size: 13, weight: .medium)).foregroundStyle(theme.text2.color)
            .frame(width: 36, height: 36)
            .background(theme.fill3.color, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// The kind as a small tinted badge ("Plan", "Held").
private struct NeedsYouBadge: View {
    let text: String
    let tint: Color
    var body: some View {
        Text(text).appFont(.system(size: 10.5, weight: .semibold)).foregroundStyle(tint)
            .padding(.horizontal, 8).frame(height: 18)
            .background(Capsule().fill(tint.opacity(0.12)))
    }
}

extension View {
    /// A Needs you card: padding, the card fill, a hairline and hover depth.
    fileprivate func needsYouCard() -> some View { modifier(NeedsYouCardModifier()) }
}

private struct NeedsYouCardModifier: ViewModifier {
    @Environment(\.theme) private var theme
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.fill1.a > 0 ? theme.fill1.color : theme.fill2.color.opacity(0.5), in: shape)
            .overlay(shape.strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
            .hoverLift(radius: 14)
    }
}

/// One filter chip of the Needs you page: its name and how many things are in it.
private struct NeedsYouChip: View {
    let title: String
    let count: Int
    let selected: Bool
    let action: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(title).appFont(.system(size: 12, weight: selected ? .semibold : .medium))
                    .foregroundStyle(selected ? theme.text.color : theme.text2.color)
                Text("\(count)").appFont(.system(size: 10, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(count > 0 ? theme.text2.color : theme.text3.color)
                    .padding(.horizontal, 4).frame(minWidth: 18, minHeight: 16)
                    .background(Capsule().fill(theme.fill3.color))
            }
            .padding(.leading, 12).padding(.trailing, 4).frame(height: 28)
            .background(Capsule().fill(selected ? theme.fill3.color : theme.fill1.a > 0 ? theme.fill1.color : theme.fill2.color.opacity(0.5)))
            .overlay(Capsule().strokeBorder(selected ? theme.hairline(true) : theme.separator.color, lineWidth: 0.6))
            .contentShape(Capsule())
        }
        .buttonStyle(.pressable)
        .accessibilityLabel("\(title), \(count)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
