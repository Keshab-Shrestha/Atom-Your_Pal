import SwiftUI
import ZenoIslandCore

/// ADR-090: everything waiting on Keshab in one list, each with its own buttons: Pal's approval card, plans to
/// approve, Tinker's proposals, tasks held by a budget or the plan's limit, and failed tasks.
struct NeedsYouPane: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let items = model.helpers.list.map(NeedsYouItem.all(in:)) ?? []
        Scrollable {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Needs you").font(.system(size: 18, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                    Text("What waits for your answer. Nothing here is done without you.").font(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
                if let problem = model.helpers.problem { ProblemLine(text: problem) }
                if let request = model.approval.pending {
                    card(kind: "Pal asks", who: "ZENO", title: request.summary, detail: request.reason) {
                        QuietButton(title: "Allow", symbol: "checkmark") { model.answerApproval(true) }
                        QuietButton(title: "Decline", symbol: "xmark") { model.answerApproval(false) }
                    }
                }
                if items.isEmpty && model.approval.pending == nil {
                    Text("Nothing waits for you.").font(.system(size: 12.5)).foregroundStyle(theme.text3.color).padding(.top, 6)
                }
                ForEach(items) { item in row(item) }
            }
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.panel)
            .padding(.top, 28)
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
            card(kind: "Tinker suggests", who: item.helperName, title: item.title, detail: item.detail) {
                QuietButton(title: "Accept", symbol: "checkmark") { model.sendHelpers(model.helpers.answerProposal(helper: item.helperId, id: item.proposalId!, accept: true)) }
                QuietButton(title: "Reject", symbol: "xmark") { model.sendHelpers(model.helpers.answerProposal(helper: item.helperId, id: item.proposalId!, accept: false)) }
            }
        case .held:
            card(kind: "Held", who: item.helperName, title: item.title, detail: item.detail) {
                QuietButton(title: "Budgets") { model.windowPage = .agents; model.helpers.selectBoard() }
                open(item)
            }
        case .failed:
            card(kind: "Failed", who: item.helperName, title: item.title, detail: item.detail) { open(item) }
        }
    }

    private func open(_ item: NeedsYouItem) -> some View {
        QuietButton(title: "Open") { model.windowPage = .agents; model.sendHelpers(model.helpers.openThread(item.jobId!)) }
    }

    private func card(kind: String, who: String, title: String, detail: String, @ViewBuilder actions: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(kind).font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                Text(who).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text2))
            }
            Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color).fixedSize(horizontal: false, vertical: true).lineLimit(3)
            Text(detail).font(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true).lineLimit(4)
            HStack(spacing: 8) { actions() }.padding(.top, 4)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }
}
