import SwiftUI
import AtomIslandCore

/// ADR-090: everything waiting on Keshab in one list, each with its own buttons: Pal's approval card, plans to
/// approve, Tinker's proposals, interrupted tasks, and failed tasks.
struct NeedsYouPane: View {
    let model: IslandModel
    /// Inside the Board (the Board's header already names the page): no big title and less room above.
    var embedded = false
    @Environment(\.theme) private var theme

    var body: some View {
        // Failed tasks have their own section below ("Failed"); listing them here too showed each one twice.
        let items = (model.helpers.list.map(NeedsYouItem.all(in:)) ?? []).filter { $0.kind != .failed }
        // Failed tasks wait for Keshab too (ADR-116): they sit under the things to answer.
        let failed = model.helpers.list.map(TeamIssues.all(in:)) ?? []
        Scrollable {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    if !embedded { Text("Needs you").font(.system(size: 18, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color) }
                    Text("What waits for your answer, and tasks that failed. Nothing here is done without you.").font(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
                if let problem = model.helpers.problem { ProblemLine(text: problem) }
                if let request = model.approval.pending {
                    card(kind: "ATOM asks", who: "", title: request.summary, detail: request.reason) {
                        QuietButton(title: "Allow", symbol: "checkmark") { model.answerApproval(true) }
                        QuietButton(title: "Decline", symbol: "xmark") { model.answerApproval(false) }
                    }
                }
                if model.helpers.list == nil && model.approval.pending == nil {
                    // Not heard from ATOM yet: that is not the same as "nothing waits".
                    LoadingStateView(text: "Loading what waits for you…", retry: { model.send(.helpersList) })
                } else if items.isEmpty && failed.isEmpty && model.approval.pending == nil {
                    EmptyStateView(title: "Nothing waits for you",
                                   detail: "When an agent needs a plan approved, a command allowed or a skill accepted, or a task fails, it shows here. Nothing is done without you.")
                }
                ForEach(items) { item in row(item) }
                if !failed.isEmpty {
                    Text("Failed · \(failed.count)").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color).padding(.top, items.isEmpty ? 0 : 6)
                    Text("A failure that a second try may fix is retried once by itself. The rest wait for you.")
                        .font(.system(size: 11.5)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
                    ForEach(failed) { item in FailedTaskCard(model: model, item: item) }
                }
            }
            .frame(maxWidth: 680, alignment: .leading)
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
                QuietButton(title: "Approve", symbol: "checkmark") { model.sendHelpers(model.helpers.answerPlan(item.jobId!, approve: true)) }
                QuietButton(title: "Reject", symbol: "xmark") { model.sendHelpers(model.helpers.answerPlan(item.jobId!, approve: false)) }
                open(item)
            }
        case .proposal:
            let proposal = model.helpers.list?.helpers.first { $0.id == item.helperId }?.proposals.first { $0.id == item.proposalId }
            card(kind: "Tinker suggests", who: item.helperName, title: item.title, detail: item.detail,
                 tests: proposal.map { TestRunView(model: model, kind: "soul", id: $0.id, tests: $0.tests, hasCases: hasCases("soul", item.helperId), pending: true) }) {
                QuietButton(title: "Accept", symbol: "checkmark") { model.sendHelpers(model.helpers.answerProposal(helper: item.helperId, id: item.proposalId!, accept: true)) }
                QuietButton(title: "Reject", symbol: "xmark") { model.sendHelpers(model.helpers.answerProposal(helper: item.helperId, id: item.proposalId!, accept: false)) }
            }
        case .skillDraft:
            card(kind: "Tinker drafted a skill", who: item.helperName, title: item.title, detail: item.detail) {
                QuietButton(title: "Approve", symbol: "checkmark") { model.sendHelpers(model.helpers.answerSkillDraft(item.skillItemId!, approve: true)) }
                QuietButton(title: "Reject", symbol: "xmark") { model.sendHelpers(model.helpers.answerSkillDraft(item.skillItemId!, approve: false)) }
                QuietButton(title: "Plugins") { model.navigate { model.windowPage = .plugins } }
            }
        case .skillEdit:
            let edit = model.helpers.list?.skillEdits.first { $0.id == item.skillItemId }
            card(kind: "Tinker suggests a skill edit", who: item.helperName, title: item.title, detail: item.detail,
                 tests: edit.map { TestRunView(model: model, kind: "skill", id: $0.id, tests: $0.tests, hasCases: hasCases("skill", $0.skill), pending: true) }) {
                QuietButton(title: "Accept", symbol: "checkmark") { model.sendHelpers(model.helpers.answerSkillEdit(item.skillItemId!, accept: true)) }
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
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(kind).font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                if !who.isEmpty { Text(who).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text2)) }
            }
            Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color).fixedSize(horizontal: false, vertical: true).lineLimit(3)
            Text(detail).font(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true).lineLimit(8) // 8: an approval can carry a whole soul (create_agent)
            if let tests { tests.padding(.top, 2) }
            HStack(spacing: 8) { actions() }.padding(.top, 4)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }
}

/// ADR-090: one failed task: why, how often it was tried, and Retry and Open. The Needs you tab lists these under "Failed"
/// (ADR-116: they wait for Keshab too).
struct FailedTaskCard: View {
    let model: IslandModel
    let item: BoardItem
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                JobDot(job: item.job)
                Text(item.helperName).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text2))
                Text("#\(item.id)").font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color)
                if item.job.autoRetries > 0 { Text("tried again once").font(.system(size: 11)).foregroundStyle(theme.text3.color) }
                Spacer(minLength: 0)
                if let ended = item.job.endedAt { Text(ended, style: .relative).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color) }
            }
            Text(item.job.shortTitle).font(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(2)
            if let error = item.job.error { ProblemLine(text: error, dot: false) }
            HStack(spacing: 8) {
                QuietButton(title: "Retry", symbol: "arrow.clockwise") { model.sendHelpers(model.helpers.retry(item.id)) }
                QuietButton(title: "Open") { model.navigate { model.windowPage = .agents; model.sendHelpers(model.helpers.openThread(item.id)) } }
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }
}
