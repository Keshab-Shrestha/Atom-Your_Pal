import SwiftUI
import ZenoIslandCore

// ADR-084 (Lantern, Task 4.4): the top of Settings answers "how is ZENO right now?" with everything the Status tab
// used to show: the provider and model (with "Change model"), the plan meters, the microphone, the voice, the last
// turn (tap for every stage) and the last problem. The facts come from `NowFacts`.

struct NowCard: View {
    let model: IslandModel
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let showsTimings: State<Bool>
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// `timingsOpen` starts with "Last turn" open (the gallery).
    init(model: IslandModel, timingsOpen: Bool = false) {
        self.model = model
        showsTimings = State(initialValue: timingsOpen)
    }

    var body: some View {
        let facts = NowFacts(status: model.status, info: model.modelInfo, usage: model.planUsage)
        VStack(alignment: .leading, spacing: 14) {
            header(facts)
            if let usage = facts.usage { meters(usage) }
            devices(facts)
            lastTurn(facts)
            if let problem = facts.problem { problemLine(problem) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).fill(theme.fill1.color))
        .overlay(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).strokeBorder(theme.separator.color.opacity(0.6), lineWidth: 0.5))
    }

    private func header(_ facts: NowFacts) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                Text(facts.provider.isEmpty ? "AI model" : facts.provider)
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(theme.text.color)
                Text("Replies from \(facts.model)")
                    .font(.system(size: 11.5))
                    .foregroundStyle(theme.text2.color)
            }
            .lineLimit(1)
            .accessibilityElement(children: .combine)
            Spacer(minLength: 6)
            LinkButton(title: "Change model") {
                withAnimation(Motion.settle(reduceMotion)) { model.settingsPage = SettingsHome.changeModel }
            }
        }
    }

    private func meters(_ usage: PlanUsage) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let five = usage.fiveHour { PlanMeter(title: "5-hour", fraction: five, inset: 0, height: 26) }
            if let week = usage.sevenDay { PlanMeter(title: "Weekly", fraction: week, inset: 0, height: 26) }
            if usage.overage == true {
                Text("Extra usage is on: Claude would charge for more, so ZENO stops.")
                    .font(.system(size: 10.5))
                    .foregroundStyle(theme.text3.color)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func devices(_ facts: NowFacts) -> some View {
        HStack(spacing: 14) {
            fact(symbol: "mic", text: facts.microphone, label: "Microphone")
            fact(symbol: "waveform", text: facts.voice, label: "Voice", dimmed: !facts.voiceLoaded)
            Spacer(minLength: 0)
        }
    }

    private func fact(symbol: String, text: String, label: String, dimmed: Bool = false) -> some View {
        HStack(spacing: 5) {
            Image(systemName: symbol).font(.system(size: 11)).foregroundStyle(theme.text3.color)
            Text(text)
                .font(.system(size: 11.5))
                .foregroundStyle(dimmed ? theme.text3.color : theme.text2.color)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(text)")
    }

    /// "Last turn" and its time; a tap opens every stage below it.
    @ViewBuilder private func lastTurn(_ facts: NowFacts) -> some View {
        if let summary = facts.lastTurn {
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    withAnimation(Motion.settle(reduceMotion)) { showsTimings.wrappedValue.toggle() }
                } label: {
                    HStack(spacing: 6) {
                        Text("Last turn").font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                        Spacer(minLength: 6)
                        Text(summary).font(.system(size: 11.5).monospacedDigit()).foregroundStyle(theme.text2.color)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 9.5, weight: .bold))
                            .foregroundStyle(theme.text3.color)
                            .rotationEffect(.degrees(showsTimings.wrappedValue ? 90 : 0))
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Last turn, \(summary)")
                .accessibilityHint(showsTimings.wrappedValue ? "Hides each stage" : "Shows each stage")
                if showsTimings.wrappedValue, let timings = model.status.lastTimings {
                    TimingDetail(timings: timings, rows: facts.timings)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
        } else {
            HStack {
                Text("Last turn").font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                Spacer()
                Text("No turn yet").font(.system(size: 11.5)).foregroundStyle(theme.text3.color)
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func problemLine(_ problem: IslandStatus.Problem) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Label(problem.title, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.problem.color)
            Text(problem.message)
                .font(.system(size: 11))
                .foregroundStyle(theme.text2.color)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Every stage of the last turn: the stacked bar, then a line per stage.
private struct TimingDetail: View {
    let timings: TurnTimings
    let rows: [NowFacts.Timing]
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            TimingBar(timings: timings)
            HStack(spacing: 10) {
                legend("Transcribing", theme.live.color.opacity(0.5))
                legend("AI reply", theme.accentEnd.color)
            }
            .padding(.bottom, 2)
            ForEach(rows, id: \.title) { row in
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.title).font(.system(size: 11.5)).foregroundStyle(theme.text2.color)
                        if let detail = row.detail {
                            Text(detail).font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                        }
                    }
                    Spacer()
                    Text(row.value).font(.system(size: 11.5).monospacedDigit()).foregroundStyle(theme.text.color)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func legend(_ title: String, _ color: Color) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(title).font(.system(size: 10)).foregroundStyle(theme.text2.color)
        }
    }
}

/// Where the last turn's time went, as one stacked bar: transcribing, then the AI.
private struct TimingBar: View {
    let timings: TurnTimings
    @Environment(\.theme) private var theme

    var body: some View {
        let parts: [(Double, Color)] = [
            (Double(timings.transcriptionMs), theme.live.color.opacity(0.5)),
            (Double(timings.modelMs), theme.accentEnd.color),
        ]
        let total = max(1, parts.map(\.0).reduce(0, +))
        GeometryReader { proxy in
            HStack(spacing: 2) {
                ForEach(Array(parts.enumerated()), id: \.offset) { _, part in
                    Capsule().fill(part.1).frame(width: max(4, (proxy.size.width - 2) * part.0 / total))
                }
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

/// A text link in Wisp's light, e.g. "Change model".
struct LinkButton: View {
    let title: String
    let action: () -> Void
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.accent.color.opacity(hovering.wrappedValue ? 1 : 0.9))
                .underline(hovering.wrappedValue)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
    }
}
