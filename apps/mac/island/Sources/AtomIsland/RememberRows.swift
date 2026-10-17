import SwiftUI
import AtomIslandCore

// Remembering by itself (upgrades.md C2): quiet rows above the chat box. The conversation notes noticed a lasting fact; it
// is kept only when the user presses Remember. Nothing is spoken and nothing pops up.

struct RememberRows: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let state = model.suggestions
        VStack(spacing: 6) {
            ForEach(state.items) { item in
                RememberRow(model: model, item: item, editing: state.editingId == item.id)
            }
            if let error = state.error, !state.items.isEmpty {
                Text(error).font(.system(size: 11)).foregroundStyle(theme.problem.color)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14)
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
            Image(systemName: "brain.head.profile").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
            if editing {
                TextField("Fact", text: Binding(get: { model.suggestions.draft }, set: { model.suggestions.draft = String($0.prefix(Suggestions.maxFactCharacters)) }))
                    .textFieldStyle(.plain).font(.system(size: 12.5)).foregroundStyle(theme.text.color)
                    .onSubmit { model.acceptSuggestionEdit() }
                    .onExitCommand { model.suggestions.stopEditing() }
                    .accessibilityLabel("Edit the fact to remember")
                QuietButton(title: "Cancel") { model.suggestions.stopEditing() }
                QuietButton(title: "Remember", symbol: "checkmark") { model.acceptSuggestionEdit() }
            } else {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Remember?").font(.system(size: 10.5, weight: .medium)).foregroundStyle(theme.text3.color)
                    Text(item.text).font(.system(size: 12.5)).foregroundStyle(theme.text.color).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                QuietButton(title: "Not this", symbol: "xmark") { model.denySuggestion(item.id) }
                    .help("Never suggest this again")
                QuietButton(title: "Edit", symbol: "pencil") { model.suggestions.startEditing(item.id) }
                QuietButton(title: "Remember", symbol: "checkmark") { model.acceptSuggestion(item.id) }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 7)
        .background(shape.fill(theme.fill1.color))
        .overlay(shape.strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
        .accessibilityElement(children: .contain)
    }
}
