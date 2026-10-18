import SwiftUI
import AtomIslandCore

struct ChatFindBar: View {
    let model: IslandModel
    let results: ChatFind.Results
    @FocusState private var focused: Bool
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(theme.text3.color)
                TextField("Find in loaded messages", text: Binding(get: { model.chatFindQuery }, set: model.setChatFindQuery))
                    .textFieldStyle(.plain).focused($focused)
                    .onSubmit { if !FieldEditor.composing { model.moveChatFind(1) } }
                    .onKeyPress(.escape) {
                        guard !FieldEditor.composing else { return .ignored }
                        model.chatFindShown = false; return .handled
                    }
                    .onKeyPress(.return, phases: .down) { press in
                        guard !FieldEditor.composing, press.modifiers.contains(.shift) else { return .ignored }
                        model.moveChatFind(-1); return .handled
                    }
                    .accessibilityLabel("Find in this chat's loaded messages")
                Text(count).foregroundStyle(theme.text3.color).monospacedDigit()
                Button { model.moveChatFind(-1) } label: { Image(systemName: "chevron.up") }
                    .accessibilityLabel("Previous match").disabled(results.matches.isEmpty)
                Button { model.moveChatFind(1) } label: { Image(systemName: "chevron.down") }
                    .accessibilityLabel("Next match").disabled(results.matches.isEmpty)
                Button { model.chatFindShown = false } label: { Image(systemName: "xmark") }
                    .accessibilityLabel("Close Find in chat")
            }
            if let match = results.selected(model.chatFindSelection) {
                (Text(match.user ? "You: " : "ATOM: ") + Text(match.before)
                 + Text(match.found).bold().foregroundColor(theme.accent.color) + Text(match.after))
                    .lineLimit(2).foregroundStyle(theme.text2.color)
            } else {
                Text(model.chatFindQuery.count > 128 ? "Use up to 128 characters." : "Searches the loaded messages only, not archived history.")
                    .foregroundStyle(theme.text3.color)
            }
        }
        .font(.system(size: 11.5)).buttonStyle(.borderless)
        .padding(.horizontal, Spacing.conversation).padding(.vertical, 8)
        .background(theme.fill1.color)
        .onAppear { focused = true }
        .onChange(of: model.chatFindFocusTick) { _, _ in focused = true }
    }

    private var count: String {
        guard !results.matches.isEmpty else { return "0 matches" }
        return "\(min(model.chatFindSelection, results.matches.count - 1) + 1) of \(results.matches.count)\(results.more ? "+" : "")"
    }
}
