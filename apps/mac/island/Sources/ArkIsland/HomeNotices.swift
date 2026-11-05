import SwiftUI
import ArkIslandCore

/// ARK notices on Home (2026-11-05): up to three notes about what goes wrong in ARK, found by counting its own log. Each shows the numbers,
/// a reason and a suggested change. "Talk it through" starts a chat with the note in the box; "Dismiss" hides it for 30 days. ARK changes nothing here.
struct HomeNotices: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        if let state = model.improvements, state.enabled, !state.shown.isEmpty || !state.recentlyResolved.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("ARK noticed").appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text2.color).accessibilityAddTraits(.isHeader)
                    Spacer()
                    QuietButton(title: state.running ? "Looking…" : "Look again", symbol: "arrow.clockwise") { model.lookForImprovements() }.disabled(state.running)
                }
                ForEach(state.shown) { note in NoticeRow(model: model, note: note) }
                ForEach(state.recentlyResolved) { done in
                    HStack(spacing: 6) {
                        Glyph(systemName: "checkmark.circle.fill").appFont(.system(size: 11)).foregroundStyle(theme.success.color)
                        Text(done.line).appFont(.system(size: 12)).foregroundStyle(theme.text3.color).lineLimit(1)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

private struct NoticeRow: View {
    let model: IslandModel
    let note: ImprovementNote
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
        let color = note.severity >= 3 ? theme.problem.color : note.severity == 2 ? theme.attention.color : theme.text3.color
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                StatusDot(color: color, size: 7)
                Text(note.title).appFont(.system(size: 13.5, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(2)
                if note.cameBack { Text("came back").appFont(.system(size: 10.5, weight: .medium)).foregroundStyle(theme.problem.color).padding(.horizontal, 6).background(Capsule().fill(theme.problem.color.opacity(0.12))) }
                if note.fixing { Text("fix in progress").appFont(.system(size: 10.5, weight: .medium)).foregroundStyle(theme.text2.color).padding(.horizontal, 6).background(Capsule().fill(theme.fill3.color)) }
            }
            Text(note.evidence).appFont(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
            if !note.change.isEmpty { Text("Suggested: \(note.change)").appFont(.system(size: 12)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true) }
            HStack(spacing: 8) {
                QuietButton(title: "Talk it through", symbol: "bubble.left") { model.talkThrough(note) }
                if (snapshot || model.canFixItself) && !note.fixing { // snapshots do not depend on where the app sits
                    QuietButton(title: "Fix it", symbol: "wrench.and.screwdriver") { model.fixThis(note) }
                        .help("Opens a chat in ARK's own source. A coding agent works on its own branch; you review and push it.")
                }
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
