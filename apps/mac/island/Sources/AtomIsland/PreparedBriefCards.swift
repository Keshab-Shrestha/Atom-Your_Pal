import SwiftUI
import AtomIslandCore

private struct PreparedReview: Identifiable {
    let id = UUID()
    let card: PreparedBriefWork.Card
}

struct PreparedBriefCards: View {
    let model: IslandModel
    @State private var review: PreparedReview?
    @Environment(\.theme) private var theme

    var body: some View {
        let latest = model.dailyBrief.history.first(where: { $0.preparation != nil })
        let entry = model.dailyBrief.history.first(where: { $0.preparation?.cards.isEmpty == false }) ?? latest
        if let entry, let work = entry.preparation {
            VStack(alignment: .leading, spacing: 10) {
                Text("Prepared for review").appFont(.system(size: 13, weight: .semibold))
                Text(latest?.preparation?.statusText ?? work.statusText).appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                if entry.id != model.dailyBrief.latest?.id {
                    Text("Showing earlier saved cards; these excerpts have not been refreshed.").foregroundStyle(theme.text3.color)
                }
                if !model.dailyBrief.settings.preparation {
                    Text("Preparation is paused. Previously saved cards remain available.").foregroundStyle(theme.text3.color)
                }
                if let notice = model.dailyBrief.notice { Text(notice).foregroundStyle(theme.text2.color) }
                if let at = entry.createdAt {
                    Text(at.formatted(date: .abbreviated, time: .shortened)).foregroundStyle(theme.text3.color)
                }
                if let provider = work.provider, let selected = work.model {
                    Text("\(provider) / \(selected)").foregroundStyle(theme.text3.color)
                }
                ForEach(Array(work.cards.enumerated()), id: \.offset) { _, card in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(card.title).appFont(.system(size: 12.5, weight: .medium))
                        Text(card.body).appFont(.system(size: 12)).lineLimit(4)
                        Text("Sources: " + card.sources.map(\.label).joined(separator: ", ")).foregroundStyle(theme.text3.color)
                        Button("Review and edit") { review = PreparedReview(card: card) }
                    }
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.fill1.color, in: RoundedRectangle(cornerRadius: 10))
                }
            }
            .appFont(.system(size: 11)).foregroundStyle(theme.text.color)
            .sheet(item: $review) { value in PreparedBriefEditor(card: value.card) }
        }
    }
}

private struct PreparedBriefEditor: View {
    let card: PreparedBriefWork.Card
    @State private var title: String
    @State private var bodyText: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.theme) private var theme

    init(card: PreparedBriefWork.Card) {
        self.card = card
        _title = State(initialValue: card.title); _bodyText = State(initialValue: card.body)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Review prepared work").appFont(.headline)
                Spacer()
                Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Text("Edit and copy manually. Closing discards these edits; the saved generated card stays unchanged. Nothing here sends, executes or changes permissions.")
                .foregroundStyle(theme.text2.color)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    SoulField(label: "Title", text: $title, lines: 2)
                    SoulField(label: "Draft or checklist", text: $bodyText, lines: 8)
                    Text("Captured source excerpts").fontWeight(.medium)
                    Text("Excerpts may be shortened and are snapshots, not live facts. Check the original source before acting.")
                        .foregroundStyle(theme.text3.color)
                    ForEach(Array(card.sources.enumerated()), id: \.offset) { _, source in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(source.label) · \(source.id)").fontWeight(.medium)
                            Text(source.collectedAt).foregroundStyle(theme.text3.color)
                            Text(source.text).textSelection(.enabled)
                        }.padding(10).frame(maxWidth: .infinity, alignment: .leading).background(theme.fill1.color, in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
            HStack {
                Button("Restore generated text") { title = card.title; bodyText = card.body }
                Spacer()
                ChatCopyControl(title: "Copy edited text") { MarkdownCopy.Content(text: title + "\n\n" + bodyText) }
            }
        }
        .appFont(.system(size: 12)).padding(20).frame(width: 620, height: 620)
        .background(theme.surfaceSolid.color).foregroundStyle(theme.text.color)
    }
}
