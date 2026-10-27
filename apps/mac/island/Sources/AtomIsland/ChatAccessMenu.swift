import SwiftUI
import AtomIslandCore

struct ChatAccessMenu: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        if let current = model.chats?.access, let chat = model.chats?.current {
            Group {
                if snapshot { menuLabel(current.title, symbol: current == .full ? "lock.open" : "lock") } else {
                    Menu {
                        ForEach([ChatAccessMode.checked, .chatOnly, .askChanges, .full], id: \.rawValue) { mode in
                            Button {
                                model.chooseChatAccess(chat: chat, mode: mode, expected: current)
                            } label: {
                                Label(mode.title, systemImage: current == mode ? "checkmark" : "circle")
                            }.help(mode.detail)
                            .disabled(mode == .full && model.chats?.reasoning?.provider == "gemini-cli")
                        }
                        Divider()
                        Text(current.detail)
                        if current == .full { Text("Full access stays on after restart. New and forked chats use Saved permissions.") }
                        if model.chats?.reasoning?.provider == "gemini-cli" {
                            Text("Chat only, Ask before changes and Full access require Claude or Codex.")
                        }
                        Text("Switching modes keeps chat history and saved permissions.")
                    } label: {
                        menuLabel(current.title, symbol: current == .full ? "lock.open" : "lock")
                    }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden)
                }
            }.fixedSize()
            .help(current.detail)
            .accessibilityLabel("Access for this chat: " + current.title)
            .accessibilityIdentifier("chat.access")
            .disabled(model.queue.running || model.status.isBusy || model.chats?.currentReadOnlyNotice != nil)
        }
    }
    private func menuLabel(_ title: String, symbol: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: symbol).appFont(.system(size: 11))
            Text(title + "  ⌄").appFont(.system(size: 12))
        }.foregroundStyle(theme.text2.color)
    }
}
