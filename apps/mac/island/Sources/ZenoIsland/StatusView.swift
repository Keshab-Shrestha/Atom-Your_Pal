import SwiftUI
import ZenoIslandCore

struct StatusTab: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        Scrollable {
            VStack(alignment: .leading, spacing: 14) {
                Card("ZENO") {
                    Row(title: "AI model") { value(model.modelInfo?.currentModelName ?? model.status.modelName) }
                    RowDivider()
                    Row(title: "Provider") { value(model.modelInfo?.currentProvider?.name ?? model.status.provider.capitalized) }
                    RowDivider()
                    Row(title: "Microphone") { value(model.status.microphone.isEmpty ? "—" : model.status.microphone) }
                    RowDivider()
                    Row(title: "Voice") { value(model.status.voiceLoaded ? "Loaded" : "Not loaded") }
                }

                PlanMetersCard(usage: model.planUsage)

                Card("Last turn") {
                    if let t = model.status.lastTimings {
                        VStack(alignment: .leading, spacing: 5) {
                            TimingBar(timings: t)
                            HStack(spacing: 10) {
                                legend("Transcribing", theme.live.color)
                                legend("AI reply", theme.accentEnd.color)
                            }
                        }
                        .padding(.horizontal, 11)
                        .padding(.top, 10)
                        .padding(.bottom, 4)
                        Row(title: "You spoke") { value(Self.seconds(t.speechMs)) }
                        RowDivider()
                        Row(title: "Transcribing") { value(Self.seconds(t.transcriptionMs)) }
                        RowDivider()
                        Row(title: "AI reply") { value(Self.seconds(t.modelMs)) }
                        if let first = t.firstSoundMs {
                            RowDivider()
                            Row(title: "First sound", detail: "From letting go to hearing ZENO") { value(Self.seconds(first)) }
                        }
                    } else {
                        Row(title: "No turn yet") { EmptyView() }
                    }
                }

                if let problem = model.status.lastProblem {
                    Card("Last problem") {
                        VStack(alignment: .leading, spacing: 4) {
                            Label(problem.title, systemImage: "exclamationmark.triangle.fill")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(theme.problem.color)
                            Text(problem.message)
                                .font(.system(size: 11))
                                .foregroundStyle(theme.text2.color)
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                        }
                        .padding(11)
                    }
                }
            }
            .padding(12)
        }
    }

    private func value(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11.5))
            .foregroundStyle(theme.text2.color)
            .lineLimit(1)
            .truncationMode(.middle)
    }

    private func legend(_ title: String, _ color: Color) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(title).font(.system(size: 10)).foregroundStyle(theme.text2.color)
        }
    }

    static func seconds(_ ms: Int) -> String { String(format: "%.1f s", Double(ms) / 1000) }

    static func timingSummary(_ t: TurnTimings) -> String {
        var parts = ["heard \(seconds(t.transcriptionMs))", "AI \(seconds(t.modelMs))"]
        if let first = t.firstSoundMs { parts.append("first sound \(seconds(first))") }
        return parts.joined(separator: " · ")
    }
}

/// Where the last turn's time went, as one stacked bar: transcribing, then the AI.
private struct TimingBar: View {
    let timings: TurnTimings
    @Environment(\.theme) private var theme

    var body: some View {
        let parts: [(Double, Color)] = [
            (Double(timings.transcriptionMs), theme.live.color),
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
