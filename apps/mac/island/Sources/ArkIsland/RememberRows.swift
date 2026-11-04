import SwiftUI
import ArkIslandCore

// Remembering by itself (upgrades.md C2): quiet rows above the chat box. The conversation notes noticed a lasting fact; it
// is kept at once (2026-11-04) and shows as a "Remembered" row with Undo; one that failed a check waits as a "Remember?" row.
// Nothing is spoken and nothing pops up.

struct RememberRows: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let state = model.suggestions
        VStack(spacing: 8) {
            ForEach(state.kept) { item in RememberedRow(model: model, item: item) }
            ForEach(state.items) { item in
                RememberRow(model: model, item: item, editing: state.editingId == item.id)
            }
            if let error = state.error, !state.items.isEmpty {
                Text(error).appFont(.system(size: 11)).foregroundStyle(theme.problem.color)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16)
            }
        }
        .onAppear { if !snapshot { model.loadSuggestions() } }
    }
}

private struct RememberRow: View {
    let model: IslandModel
    let item: FactSuggestion
    let editing: Bool
    @Environment(\.theme) private var theme

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: theme.radiusControl + 4, style: .continuous) }

    var body: some View {
        HStack(spacing: 8) {
            Glyph(systemName: "brain.head.profile").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
            if editing {
                TextField("Fact", text: Binding(get: { model.suggestions.draft }, set: { model.suggestions.draft = $0 }))
                    .textFieldStyle(.plain).appFont(.system(size: 12.5)).foregroundStyle(theme.text.color)
                    .onSubmit { model.acceptSuggestionEdit() }
                    .onExitCommand { model.suggestions.stopEditing() }
                    .accessibilityLabel("Edit the fact to remember")
                QuietButton(title: "Cancel") { model.suggestions.stopEditing() }
                QuietButton(title: "Remember", symbol: "checkmark") { model.acceptSuggestionEdit() }
            } else {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Remember?").appFont(.system(size: 10.5, weight: .medium)).foregroundStyle(theme.text3.color)
                    Text(item.text).appFont(.system(size: 12.5)).foregroundStyle(theme.text.color).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                QuietButton(title: "Not this", symbol: "xmark") { model.denySuggestion(item.id) }
                    .help("Never suggest this again")
                QuietButton(title: "Edit", symbol: "pencil") { model.suggestions.startEditing(item.id) }
                QuietButton(title: "Remember", symbol: "checkmark") { model.acceptSuggestion(item.id) }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(shape.fill(theme.fill1.color))
        .overlay(shape.strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
        .accessibilityElement(children: .contain)
    }
}

/// A fact ARK kept by itself: a receipt for ten minutes, with Undo. Undo forgets it and ARK never keeps it again.
private struct RememberedRow: View {
    let model: IslandModel
    let item: FactSuggestion
    @Environment(\.theme) private var theme

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: theme.radiusControl + 4, style: .continuous) }

    var body: some View {
        HStack(spacing: 8) {
            Glyph(systemName: "checkmark.circle").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
            VStack(alignment: .leading, spacing: 1) {
                Text("Remembered").appFont(.system(size: 10.5, weight: .medium)).foregroundStyle(theme.text3.color)
                Text(item.text).appFont(.system(size: 12.5)).foregroundStyle(theme.text.color).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            QuietButton(title: "Undo", symbol: "arrow.uturn.backward") { model.undoRemembered(item.id) }
                .help("Forget this and never keep it by itself again")
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(shape.fill(theme.fill1.color))
        .overlay(shape.strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
        .accessibilityElement(children: .contain)
    }
}
