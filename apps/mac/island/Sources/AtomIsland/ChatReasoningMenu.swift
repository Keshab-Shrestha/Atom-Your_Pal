import SwiftUI
import AtomIslandCore

struct ChatReasoningMenu: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        if let choice = model.chats?.reasoning, let chat = model.chats?.current {
            Menu {
                Button {
                    model.chooseChatReasoning(chat: chat, choice: choice, effort: "")
                } label: {
                    Label("Default (" + ChatReasoning.title(choice.default) + ")", systemImage: choice.selected == nil ? "checkmark" : "circle")
                }
                ForEach(choice.levels, id: \.self) { level in
                    Button {
                        model.chooseChatReasoning(chat: chat, choice: choice, effort: level)
                    } label: {
                        Label(ChatReasoning.title(level), systemImage: choice.selected == level ? "checkmark" : "circle")
                    }
                }
                if let note = choice.note { Divider(); Text(note) }
                if choice.levels.isEmpty {
                    Divider()
                    Button("Refresh model catalog") { model.refreshModels() }
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "brain").font(.system(size: 11))
                    Text(choice.title + "  ⌄").font(.system(size: 12))
                }.foregroundStyle(theme.text2.color)
            }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            .help(choice.note ?? "Thinking for this chat. Applies to the next message; more thinking can take longer.")
            .accessibilityLabel("Thinking for this chat: " + choice.title)
            .accessibilityIdentifier("chat.reasoning")
            .disabled(model.queue.running || model.status.isBusy || model.chats?.currentReadOnlyNotice != nil)
        }
    }
}
