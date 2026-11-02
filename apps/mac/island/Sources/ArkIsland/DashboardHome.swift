import SwiftUI
import ArkIslandCore

/// Home's top (2026-11-02, the "Editorial greeting" of Keshab's reference): a greeting and today's one fact, in a serif in the
/// editorial themes, the date, and an Ask box that starts a new chat. The tiles, the team and the trends follow it (DashboardPane).
struct HomeHeader: View {
    let model: IslandModel
    let attention: BoardAttention
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        // Snapshots use a fixed evening and name, so reference images do not change with the clock or the Mac's user.
        let hour = snapshot ? 19 : Calendar.current.component(.hour, from: Date())
        let greeting = HomeBrief.greeting(hour: hour, name: snapshot ? "Keshab" : NSFullUserName())
        let fact = HomeBrief.fact(needsYou: attention.total, working: attention.running, tokensToday: model.helpers.list?.usage?.today.io ?? 0) // the same input + output as the "Tokens today" tile
        VStack(alignment: .leading, spacing: 6) {
            if theme.serifTitles {
                (Text(greeting + " ").foregroundColor(theme.text.color) + Text(fact).italic().foregroundColor(theme.text3.color))
                    .appFont(.system(size: 34, design: .serif)).lineSpacing(2).fixedSize(horizontal: false, vertical: true)
            } else {
                Text(greeting).appFont(.system(size: 28, weight: .semibold)).foregroundStyle(theme.text.color)
                Text(fact).appFont(.system(size: 15)).foregroundStyle(theme.text2.color)
            }
            Text(Date().formatted(.dateTime.weekday(.wide).day().month(.wide).year())).appFont(.system(size: 12)).foregroundStyle(theme.text3.color)
        }
        .frame(maxWidth: 760, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// "Ask ARK…": the text starts a new chat (Settings → Defaults decides where) and is sent there. Try chips fill it.
struct HomeAskBox: View {
    let model: IslandModel
    @State private var text = ""
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    static let tries = ["What's on my calendar today?", "Chart my tokens this week", "Make a logo for my project", "What needs me right now?"]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .bottom, spacing: 10) {
                Group {
                    if snapshot {
                        Text("Ask ARK anything…").foregroundStyle(theme.text3.color).frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        TextField("Ask ARK anything…", text: $text, axis: .vertical).textFieldStyle(.plain).lineLimit(1...5).onSubmit(send)
                    }
                }
                .appFont(.system(size: 15))
                Button(action: send) {
                    Glyph(systemName: "arrow.up").appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.onAccent.color)
                        .frame(width: 30, height: 30).background(Circle().fill(text.isEmpty ? theme.text3.color : theme.accent.color))
                }
                .buttonStyle(.plain).disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityLabel("Ask ARK")
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: theme.radiusSurface, style: .continuous).fill(theme.fill1.color))
            .overlay(RoundedRectangle(cornerRadius: theme.radiusSurface, style: .continuous).strokeBorder(theme.border.color, lineWidth: 1))
            FlowLayout(spacing: 6) {
                Text("Try").appFont(.system(size: 12)).foregroundStyle(theme.text3.color).padding(.vertical, 5)
                ForEach(Self.tries, id: \.self) { item in
                    Button(item) { text = item }
                        .buttonStyle(.plain).appFont(.system(size: 12)).foregroundStyle(theme.text2.color).lineLimit(1).fixedSize()
                        .padding(.horizontal, 10).padding(.vertical, 5).background(Capsule().fill(theme.fill2.color))
                }
            }
        }
        .frame(maxWidth: 760, alignment: .leading)
    }

    private func send() {
        let ask = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !ask.isEmpty else { return }
        text = ""
        model.askFromHome(ask)
    }
}
