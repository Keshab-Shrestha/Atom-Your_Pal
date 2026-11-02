import SwiftUI
import ArkIslandCore

/// The inspector beside the Tasks list on a wide window (2026-11-02, after the Linear reference Keshab chose): the chosen task's properties
/// and result, and a way into its full thread. It only reads.
struct TaskInspector: View {
    let model: IslandModel
    let item: BoardItem
    @Environment(\.theme) private var theme

    var body: some View {
        let job = item.job
        let list = model.helpers.list
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    JobDot(job: job)
                    Text(job.state.title).appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text2.color)
                    Text("#\(job.id)").appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
                }
                Text(job.title ?? job.task).appFont(.system(size: 15, weight: .semibold)).foregroundStyle(theme.text.color)
                    .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
            }
            VStack(alignment: .leading, spacing: 8) {
                row("Agent", item.helperName)
                if let start = job.createdAt { row("Started", start.formatted(.relative(presentation: .named))) }
                if let end = job.endedAt { row("Ended", end.formatted(.relative(presentation: .named))) }
                if let model = job.model { row("Model", model) }
                if !job.waitingFor.isEmpty, let list {
                    row("Waits for", job.waitingFor.map { id in list.item(id).map { "\($0.job.shortTitle) (\($0.helperName))" } ?? "#\(id)" }.joined(separator: ", "))
                }
                if let parent = job.parentId { row("Part of", "#\(parent)") }
                if let change = model.helpers.git?.first(where: { $0.task == job.id })?.changeLine { row("Changes", change) }
                if job.comments > 0 { row("Comments", "\(job.comments)") }
            }
            if let result = result(job) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(result.title).appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                    Text(result.text).appFont(.system(size: 13)).foregroundStyle(job.state == .failed ? theme.problem.color : theme.text2.color)
                        .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                }
            }
            if job.task != (job.title ?? job.task) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Task").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                    Text(job.task).appFont(.system(size: 13)).foregroundStyle(theme.text2.color).lineLimit(8).textSelection(.enabled)
                }
            }
            QuietButton(title: "Open full thread", symbol: "arrow.up.right") { model.navigate { model.sendHelpers(model.helpers.openThread(job.id)) } }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(theme.fill1.color))
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label).foregroundStyle(theme.text3.color).frame(width: 84, alignment: .leading)
            Text(value).foregroundStyle(theme.text.color).lineLimit(2).textSelection(.enabled)
        }
        .appFont(.system(size: 13))
    }

    private func result(_ job: HelperJob) -> (title: String, text: String)? {
        switch job.state {
        case .running: job.step.map { ("Now", $0) }
        case .done: job.summary.map { ("Report", $0) }
        case .failed: ("Why it failed", job.error ?? "No reason was recorded.")
        default: nil
        }
    }
}
