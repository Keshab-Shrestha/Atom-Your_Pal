import SwiftUI
import ArkIslandCore

/// ARK notices on Home (2026-11-05): up to three notes about what goes wrong in ARK, found by counting its own log. Each shows the numbers,
/// a reason and a suggested change. "Talk it through" starts a chat with the note in the box; "Dismiss" hides it for 30 days. ARK changes nothing here.
struct HomeNotices: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        if let state = model.improvements, state.enabled, !state.shown.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("ARK noticed").appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text2.color).accessibilityAddTraits(.isHeader)
                    Spacer()
                    QuietButton(title: state.running ? "Looking…" : "Look again", symbol: "arrow.clockwise") { model.lookForImprovements() }.disabled(state.running)
                }
                ForEach(state.shown) { note in NoticeRow(model: model, note: note) }
            }
        }
    }
}

private struct NoticeRow: View {
    let model: IslandModel
    let note: ImprovementNote
    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
        let color = note.severity >= 3 ? theme.problem.color : note.severity == 2 ? theme.attention.color : theme.text3.color
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                StatusDot(color: color, size: 7)
                Text(note.title).appFont(.system(size: 13.5, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(2)
            }
            Text(note.evidence).appFont(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
            if !note.change.isEmpty { Text("Suggested: \(note.change)").appFont(.system(size: 12)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true) }
            HStack(spacing: 8) {
                QuietButton(title: "Talk it through", symbol: "bubble.left") { model.talkThrough(note) }
                QuietButton(title: "Dismiss", symbol: "xmark") { model.dismissImprovement(note.id) }.help("Hide this for 30 days")
                Spacer()
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(shape.fill(theme.fill1.color))
        .overlay(shape.strokeBorder(theme.border.color, lineWidth: 1))
        .accessibilityElement(children: .contain)
    }
}
