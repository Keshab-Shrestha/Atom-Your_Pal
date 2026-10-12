import SwiftUI
import ZenoIslandCore

/// B3.4: the files a task's runs edited or created, each with an undo. Collapsed until opened.
struct CheckpointSection: View {
    let model: IslandModel
    let jobId: Int
    let checkpoints: [HelperCheckpoint]
    let bashRan: Bool
    @State private var isOpen = false
    @State private var confirmingAll = false
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var readyCount: Int { checkpoints.filter { $0.state == .ready }.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { withAnimation(Motion.snap(reduceMotion)) { isOpen.toggle() } } label: {
                HStack(spacing: 6) {
                    Image(systemName: isOpen ? "chevron.down" : "chevron.right").font(.system(size: 9, weight: .semibold))
                    Text("File changes (\(checkpoints.count))").font(.system(size: 11.5, weight: .medium))
                }
                .foregroundStyle(theme.text3.color)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("File changes, \(checkpoints.count)")
            .accessibilityValue(isOpen ? "Open" : "Closed")
            if isOpen { content }
        }
    }

    @ViewBuilder private var content: some View {
        if checkpoints.isEmpty {
            Text("No file edits recorded.").font(.system(size: 12)).foregroundStyle(theme.text2.color)
        }
        if readyCount > 0 { undoAll }
        ForEach(checkpoints, id: \.path) { CheckpointRow(model: model, jobId: jobId, checkpoint: $0) }
        if bashRan {
            Text("Commands can change files ZENO does not track.").font(.system(size: 12)).foregroundStyle(theme.text2.color)
        }
    }

    @ViewBuilder private var undoAll: some View {
        if confirmingAll {
            HStack(spacing: 8) {
                Text("Undo all changes this task made?").font(.system(size: 12)).foregroundStyle(theme.text.color)
                QuietButton(title: "Undo") {
                    confirmingAll = false
                    model.sendHelpers(model.helpers.undoCheckpoints(jobId: jobId))
                }
                .accessibilityHint("Puts back every file this task changed")
                QuietButton(title: "Cancel") { confirmingAll = false }
            }
        } else {
            QuietButton(title: "Undo all (\(readyCount) \(readyCount == 1 ? "file" : "files"))") { confirmingAll = true }
                .accessibilityHint("Asks you to confirm first")
        }
    }
}

private struct CheckpointRow: View {
    let model: IslandModel
    let jobId: Int
    let checkpoint: HelperCheckpoint
    @State private var confirmingForce = false
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(checkpoint.path).font(theme.idFont(.system(size: 12.5), size: 11.5)).foregroundStyle(theme.idColor(theme.text))
                    .lineLimit(1).truncationMode(.middle)
                Text(checkpoint.kind == .created ? "created" : "edited").font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(theme.text3.color)
                Spacer(minLength: 4)
                trailing
            }
            if confirmingForce {
                HStack(spacing: 8) {
                    Text("Replace the newer version of this file?").font(.system(size: 12)).foregroundStyle(theme.text.color)
                    QuietButton(title: "Restore") {
                        confirmingForce = false
                        model.sendHelpers(model.helpers.undoCheckpoints(jobId: jobId, path: checkpoint.path, force: true))
                    }
                    QuietButton(title: "Cancel") { confirmingForce = false }
                }
            }
        }
        .opacity(checkpoint.state == .undone ? 0.55 : 1)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var trailing: some View {
        switch checkpoint.state {
        case .ready:
            QuietButton(title: "Undo") { model.sendHelpers(model.helpers.undoCheckpoints(jobId: jobId, path: checkpoint.path)) }
                .accessibilityLabel("Undo \(checkpoint.path)")
                .accessibilityHint("Puts back this file")
        case .changed:
            Text("Changed since this task").font(.system(size: 11.5)).foregroundStyle(theme.text2.color)
            QuietButton(title: "Restore anyway") { confirmingForce = true }
                .accessibilityLabel("Restore \(checkpoint.path) anyway")
                .accessibilityHint("Asks you to confirm first")
        case .undone:
            Text("Undone").font(.system(size: 11.5)).foregroundStyle(theme.text3.color)
        case .skipped:
            Text(checkpoint.reason ?? "").font(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(1)
            Text("Not undoable").font(.system(size: 11.5)).foregroundStyle(theme.text3.color)
        }
    }
}
