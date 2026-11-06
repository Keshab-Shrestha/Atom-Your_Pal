import Foundation
import ArkIslandCore

// ADR-274 (design reference: Ghostex, MIT; redrawn in ARK's own style): Catch me up. Each chat remembers locally what it held when
// it was last on screen (message count and its Board jobs' states). Coming back to a chat with more since then shows the button;
// it sends one fixed request through the normal send path. While the chat stays on screen, new activity is seen, not news.

extension IslandModel {
    /// A composer showing the current chat appeared.
    func chatViewStarted() {
        chatViewers += 1
        if chatViewers == 1 { arriveInChat() }
    }

    /// A composer showing the current chat went away. The last one records the view.
    func chatViewEnded() {
        guard chatViewers > 0 else { return }
        recordChatSeen()
        chatViewers -= 1
        if chatViewers == 0 { viewedChat = nil; pendingSeen = nil; catchUpSince = nil }
    }

    /// Sends the fixed request the way Return sends a typed message to an idle chat; the draft in the box stays.
    /// Only when nothing else runs, so it never interrupts an answer.
    func catchUp() {
        guard let since = catchUpSince, !queue.running, chatControls.mutation == nil else { return }
        guard sendIdle(ChatActivity.request(since: since)) else { return } // not sent (starting, read-only): the button stays
        catchUpSince = nil
    }

    func followChatView(_ event: IslandEvent) {
        guard chatViewers > 0 else { return }
        switch event {
        case .chats(let list) where list.current != viewedChat:
            recordChatSeen(viewedChat)
            arriveInChat()
        case .chats, .helpers:
            if let seen = pendingSeen, let mark = chatMark(), mark.jobs != nil {
                pendingSeen = nil
                if catchUpSince == nil, ChatActivity.isNew(mark, since: seen) { catchUpSince = seen.at }
            }
            recordChatSeen()
        default: break
        }
    }

    /// Compare once with the last view; after that the view follows the chat.
    private func arriveInChat() {
        viewedChat = chats?.current
        catchUpSince = nil
        pendingSeen = nil
        guard let chat = viewedChat, let mark = chatMark() else { return }
        let seen = settings.chatSeen[chat]
        if ChatActivity.isNew(mark, since: seen) { catchUpSince = seen?.at }
        else if mark.jobs == nil { pendingSeen = seen } // the Board list comes later: its changes are compared then
        recordChatSeen()
    }

    private func recordChatSeen(_ chat: String? = nil) {
        guard let chat = chat ?? viewedChat, let mark = chatMark(chat) else { return }
        settings.chatSeen = ChatActivity.remember(mark, for: chat, in: settings.chatSeen)
    }

    private func chatMark(_ chat: String? = nil) -> ChatSeen? {
        guard let id = chat ?? chats?.current, let info = chats?.chats.first(where: { $0.id == id }) else { return nil }
        return ChatActivity.mark(chat: info, helpers: helpers.list?.helpers, at: Date())
    }
}
