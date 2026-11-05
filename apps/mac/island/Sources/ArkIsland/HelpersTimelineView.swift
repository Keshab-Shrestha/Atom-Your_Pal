import SwiftUI
import ArkIslandCore

/// B3.1: every tool call of the task's runs. Collapsed until opened. 2026-11-05 (after the look of affectUI's Trace Waterfall): the
/// calls as a waterfall on one time axis, grouped by sub-agent, with the totals above and the slowest call marked. A row opens to show
/// its input and result.
struct ToolTimelineSection: View {
    let calls: [HelperToolCall]
    @State private var isOpen = false
    /// The row opened to show its input and result; kept here so it survives the live refresh ending (code review, 2026-11-05).
    @State private var opened: String?
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { withAnimation(Motion.snap(reduceMotion)) { isOpen.toggle() } } label: {
                HStack(spacing: 8) {
                    Glyph(systemName: isOpen ? "chevron.down" : "chevron.right").appFont(.system(size: 9, weight: .semibold))
                    Text("Trace · \(calls.count) tool calls").appFont(.system(size: 11.5, weight: .medium))
                }
                .foregroundStyle(theme.text3.color)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Trace, \(calls.count) tool calls")
            .accessibilityValue(isOpen ? "Open" : "Closed")
            if isOpen || snapshot {
                if calls.isEmpty {
                    Text("Nothing recorded for this task.").appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                } else if calls.contains(where: { $0.state == .started }), !snapshot {
                    TimelineView(.periodic(from: .now, by: 1)) { context in TraceWaterfallView(trace: TraceWaterfall(calls: calls, now: context.date), opened: $opened) }
                } else {
                    TraceWaterfallView(trace: TraceWaterfall(calls: calls), opened: $opened)
                }
            }
        }
    }
}

/// The waterfall: totals, an axis, then a row per sub-agent and per call — its name on the left, its bar on the right.
struct TraceWaterfallView: View {
    let trace: TraceWaterfall
    @Binding var opened: String?
    @Environment(\.theme) private var theme

    private static let labelWidth: CGFloat = 230
    private static let rowHeight: CGFloat = 26
    /// Room right of the longest bar for its time and the "Slowest" tag.
    private static let trail: CGFloat = 110

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
        let span = max(trace.duration, 1)
        let ticks = TraceWaterfall.ticks(duration: span)
        VStack(alignment: .leading, spacing: 0) {
            totals
            Rectangle().fill(theme.separator.color).frame(height: 0.6)
            HStack(spacing: 0) {
                Text("STEP").appFont(.system(size: 9.5, weight: .semibold)).tracking(0.6).foregroundStyle(theme.text3.color)
                    .frame(width: Self.labelWidth, alignment: .leading).padding(.leading, 12)
                GeometryReader { proxy in
                    ForEach(ticks, id: \.self) { tick in
                        Text(ChatWorkText.duration(ms: tick * 1000)).appFont(.system(size: 9.5)).monospacedDigit().foregroundStyle(theme.text3.color)
                            .fixedSize()
                            .position(x: x(tick, span: span, width: proxy.size.width) + 8, y: proxy.size.height / 2)
                    }
                }
            }
            .frame(height: 24)
            Rectangle().fill(theme.separator.color).frame(height: 0.6)
            VStack(spacing: 0) {
                ForEach(trace.rows) { row in
                    rowView(row, span: span)
                    if case .call(let call) = row.kind, opened == row.id { detail(call) }
                }
            }
            .padding(.vertical, 4)
        }
        .background(shape.fill(theme.fill1.color))
        .overlay(shape.strokeBorder(theme.separator.color, lineWidth: 0.6))
    }

    /// A time's x inside the bar column.
    private func x(_ seconds: Double, span: Double, width: CGFloat) -> CGFloat {
        CGFloat(seconds / span) * max(1, width - Self.trail - 12) + 12
    }

    /// Duration, tool calls, errors and sub-agents, as the reference's header row; "Live" while a call runs.
    private var totals: some View {
        HStack(spacing: 0) {
            stat("Duration", ChatWorkText.duration(ms: trace.duration * 1000))
            stat("Tool calls", "\(trace.calls)")
            stat("Errors", "\(trace.errors)", warn: trace.errors > 0)
            stat("Sub-agents", "\(trace.subAgents)")
            Spacer()
            if trace.running {
                Label("Live", systemImage: "circle.fill").labelStyle(.titleAndIcon).appFont(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(theme.live.color).padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Capsule().fill(theme.live.color.opacity(0.12))).padding(.trailing, 12)
            }
        }
        .padding(.vertical, 10)
    }

    private func stat(_ title: String, _ value: String, warn: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title.uppercased()).appFont(.system(size: 9.5, weight: .semibold)).tracking(0.6).foregroundStyle(theme.text3.color)
            Text(value).appFont(.system(size: 14, weight: .medium)).monospacedDigit().foregroundStyle(warn ? theme.problem.color : theme.text.color)
        }
        .padding(.horizontal, 12).frame(minWidth: 96, alignment: .leading)
    }

    @ViewBuilder
    private func rowView(_ row: TraceWaterfall.Row, span: Double) -> some View {
        let isGroup: Bool = { if case .group = row.kind { return true } else { return false } }()
        HStack(spacing: 0) {
            HStack(spacing: 6) {
                switch row.kind {
                case .group(let agent):
                    Glyph(systemName: "person.2").appFont(.system(size: 10)).foregroundStyle(theme.text3.color)
                    Text(agent).appFont(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(1)
                case .call(let call):
                    Glyph(systemName: ChatWorkText.symbol(tool: call.tool)).appFont(.system(size: 10)).foregroundStyle(row.failed ? theme.problem.color : theme.text3.color)
                    Text(call.tool).appFont(theme.appIdentifierFont(.system(size: 12), size: 11)).foregroundStyle(theme.idColor(theme.text)).lineLimit(1)
                    Text(call.input).appFont(.system(size: 11)).foregroundStyle(theme.text3.color).lineLimit(1).truncationMode(.tail)
                    if row.running { RaySpinner(size: 9, color: theme.live.color) }
                }
            }
            .padding(.leading, row.indented ? 28 : 12)
            .frame(width: Self.labelWidth, alignment: .leading)
            GeometryReader { proxy in
                let start = x(row.start, span: span, width: proxy.size.width)
                let w = max(3, x(row.start + row.length, span: span, width: proxy.size.width) - start)
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(barColor(row, group: isGroup))
                        .frame(width: w, height: isGroup ? 8 : 10)
                    Text(Self.time(row.length)).appFont(.system(size: 10)).monospacedDigit().foregroundStyle(theme.text3.color).fixedSize()
                    if row.id == trace.slowest {
                        Text("SLOWEST").appFont(.system(size: 8.5, weight: .bold)).tracking(0.5).foregroundStyle(theme.attention.color)
                            .padding(.horizontal, 5).padding(.vertical, 1.5).background(RoundedRectangle(cornerRadius: 3).fill(theme.attention.color.opacity(0.14)))
                            .fixedSize()
                    }
                }
                .offset(x: start).frame(height: proxy.size.height)
            }
        }
        .frame(height: Self.rowHeight)
        .contentShape(Rectangle())
        .onTapGesture { if case .call = row.kind { opened = opened == row.id ? nil : row.id } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibility(row))
        .accessibilityValue(isGroup ? "" : (opened == row.id ? "Open" : "Closed"))
        .accessibilityAddTraits(isGroup ? [] : .isButton)
    }

    /// Whole seconds as everywhere, but milliseconds under one second ("850 ms"), so a quick call does not read "0s".
    static func time(_ seconds: Double) -> String {
        seconds < 1 ? "\(Int((seconds * 1000).rounded())) ms" : ChatWorkText.duration(ms: seconds * 1000)
    }

    private func barColor(_ row: TraceWaterfall.Row, group: Bool) -> Color {
        if row.failed && !group { return theme.problem.color.opacity(0.75) }
        if row.running { return theme.live.color.opacity(0.7) }
        return group ? theme.text3.color.opacity(0.35) : theme.live.color.opacity(0.45)
    }

    private func detail(_ call: HelperToolCall) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(call.input).appFont(theme.appIdentifierFont(.system(size: 11.5), size: 11)).foregroundStyle(theme.text2.color).textSelection(.enabled)
            if let result = call.result, !result.isEmpty {
                Text(result).appFont(.system(size: 12)).foregroundStyle(theme.text2.color).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
            Text(call.at.formatted(date: .omitted, time: .standard)).appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
        }
        .padding(.leading, 40).padding(.trailing, 12).padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.fill2.color.opacity(0.6))
    }

    private func accessibility(_ row: TraceWaterfall.Row) -> String {
        let time = Self.time(row.length)
        switch row.kind {
        case .group(let agent): return "Sub-agent \(agent), \(time)"
        case .call(let call):
            let state = row.running ? "running" : row.failed ? "failed" : "done"
            let who = call.agent.map { "\($0): " } ?? ""
            return "\(who)\(call.tool) \(call.input), \(state), \(time)\(row.id == trace.slowest ? ", slowest" : "")"
        }
    }
}
