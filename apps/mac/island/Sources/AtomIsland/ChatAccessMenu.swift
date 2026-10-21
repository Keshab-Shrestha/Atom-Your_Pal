import SwiftUI
import AtomIslandCore

struct ChatAccessMenu: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        if let current = model.chats?.access, let chat = model.chats?.current {
            Menu {
                ForEach(ChatAccessMode.allCases, id: \.rawValue) { mode in
                    Button {
                        model.chooseChatAccess(chat: chat, mode: mode, expected: current)
                    } label: {
                        Label(mode.title, systemImage: current == mode ? "checkmark" : "circle")
                    }.help(mode.detail)
                }
                Divider()
                Text(current.detail)
                if model.chats?.reasoning?.provider == "gemini-cli" {
                    Text("Restricted access modes require Claude or Codex.")
                }
                Text("Switching modes keeps chat history and saved permissions.")
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "lock").font(.system(size: 11))
                    Text(current.title + "  ⌄").font(.system(size: 12))
                }.foregroundStyle(theme.text2.color)
            }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            .help(current.detail)
            .accessibilityLabel("Access for this chat: " + current.title)
            .accessibilityIdentifier("chat.access")
            .disabled(model.queue.running || model.status.isBusy || model.chats?.currentReadOnlyNotice != nil)
        }
    }
}
