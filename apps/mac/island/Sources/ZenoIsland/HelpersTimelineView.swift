import SwiftUI
import ZenoIslandCore

/// B3.1: every tool call of the task's runs, oldest first. Collapsed until opened; a row opens to show its result.
struct ToolTimelineSection: View {
    let calls: [HelperToolCall]
    @State private var isOpen = false
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { withAnimation(Motion.snap(reduceMotion)) { isOpen.toggle() } } label: {
                HStack(spacing: 6) {
                    Image(systemName: isOpen ? "chevron.down" : "chevron.right").font(.system(size: 9, weight: .semibold))
                    Text("Tool calls (\(calls.count))").font(.system(size: 11.5, weight: .medium))
                }
                .foregroundStyle(theme.text3.color)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Tool calls, \(calls.count)")
            .accessibilityValue(isOpen ? "Open" : "Closed")
            if isOpen {
                if calls.isEmpty {
                    Text("Nothing recorded for this task.").font(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
                ForEach(calls, id: \.id) { ToolCallRow(call: $0) }
            }
        }
    }
}

private struct ToolCallRow: View {
    let call: HelperToolCall
    @State private var isOpen = false
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var hasResult: Bool { !(call.result ?? "").isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Button { if hasResult { withAnimation(Motion.snap(reduceMotion)) { isOpen.toggle() } } } label: { line }
                .buttonStyle(.plain)
                .accessibilityLabel(label)
                .accessibilityHint(hasResult ? (isOpen ? "Hides the result" : "Shows the result") : "")
            if isOpen, let result = call.result {
                Text(result).font(.system(size: 12)).foregroundStyle(theme.text2.color)
                    .fixedSize(horizontal: false, vertical: true).padding(.leading, 15)
            }
        }
        .padding(.leading, call.agent == nil ? 0 : 15)
    }

    private var line: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(call.tool).font(theme.idFont(.system(size: 12.5), size: 11.5)).foregroundStyle(theme.idColor(theme.text))
            Text(call.input).font(.system(size: 12)).foregroundStyle(theme.text2.color).lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 4)
            if let ms = call.durationText { Text(ms).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color) }
            Text(call.at.formatted(date: .omitted, time: .shortened)).font(theme.idFont(.system(size: 11), size: 10.5))
                .foregroundStyle(theme.text3.color)
        }
        .contentShape(Rectangle())
    }

    private var color: Color {
        switch call.state {
        case .started: theme.live.color
        case .ok: theme.statusDots ? theme.success.color : theme.text2.color
        case .error: theme.problem.color
        }
    }

    private var label: String {
        let state = call.state == .started ? "running" : call.state == .ok ? "done" : "failed"
        return [call.agent.map { "\($0):" }, call.tool, call.input, state, call.durationText].compactMap { $0 }.joined(separator: " ")
    }
}
