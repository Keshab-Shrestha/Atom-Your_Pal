import Foundation
import AtomIslandCore

struct ChatControlsState {
    struct Undo {
        let id: String
        let pinned: Bool
        let archived: Bool
        let version: Int
    }
    var snapshot: ChatControlResponse?
    var briefReceipt: ChatControlResponse?
    var inspecting: ChatControlRequest?
    var mutation: ChatControlRequest?
    var undoRequest: String?
    var waitingExpired = false
    var undo: Undo?
    var notice: String?
    var historyShown = false
    var history: ChatControlResponse?
    var reading: ChatControlRequest?
    var cursor = ChatHistoryCursor()
    var previous: [ChatHistoryCursor] = []
}

extension IslandModel {
    var savedChat: ChatInfo? { chats?.chats.first { $0.id == chats?.current } }
    var chatBranchAvailable: Bool { chatControls.mutation == nil && !queue.running && !queue.awaitingStart }

    func inspectSavedChat() {
        guard let chat = savedChat else { chatControls.snapshot = nil; return }
        let request = ChatControlRequest(action: .inspect, id: chat.id)
        chatControls.inspecting = request
        send(.chatControl(request))
        controlTimeout(request)
    }

    func resetChatControlReading() {
        chatControls.snapshot = nil; chatControls.inspecting = nil; chatControls.briefReceipt = nil
        chatControls.historyShown = false; chatControls.history = nil; chatControls.reading = nil
        chatControls.previous = []; chatControls.cursor = ChatHistoryCursor()
    }

    func setChatFlags(_ chat: ChatInfo, pinned: Bool? = nil, archived: Bool? = nil) {
        guard chatControls.mutation == nil else { return }
        startChatMutation(ChatControlRequest(action: .flags, id: chat.id, pinned: pinned, archived: archived, version: chat.flagsVersion))
    }

    func saveChatBrief(chat: String, text: String, version: Int) -> String? {
        guard chat == chats?.current, savedChat != nil, chatBranchAvailable,
              chats?.currentReadOnlyNotice == nil, ChatBrief.valid(text) else { return nil }
        let request = ChatControlRequest(action: .brief, id: chat, version: version, text: text)
        chatControls.briefReceipt = nil
        startChatMutation(request)
        return request.request
    }

    func undoChatFlags() {
        guard let undo = chatControls.undo, chatControls.mutation == nil else { return }
        let request = ChatControlRequest(action: .flags, id: undo.id, pinned: undo.pinned, archived: undo.archived, version: undo.version)
        chatControls.undoRequest = request.request
        startChatMutation(request)
    }

    func setChatContinuity(enabled: Bool, version: Int) {
        guard let chat = savedChat, chatBranchAvailable, chats?.currentReadOnlyNotice == nil else { return }
        startChatMutation(ChatControlRequest(action: .continuity, id: chat.id, version: version, enabled: enabled))
    }

    func forkSavedChat(kind: String = "fork", through: Int? = nil, revision: String? = nil) {
        guard chatBranchAvailable, let chat = savedChat,
              let revision = revision ?? chatControls.snapshot?.revision,
              let through = through ?? chatControls.snapshot?.info?.messages else { return }
        startChatMutation(ChatControlRequest(action: .fork, id: chat.id, revision: revision, through: through, kind: kind))
    }

    private func startChatMutation(_ request: ChatControlRequest) {
        chatControls.mutation = request
        chatControls.waitingExpired = false
        chatControls.notice = nil
        send(.chatControl(request))
        controlTimeout(request)
    }

    func retryChatControlConfirmation() {
        guard let request = chatControls.mutation else { return }
        chatControls.waitingExpired = false
        send(.chatControl(request)) // the original request id: a fork is never recreated by a transport retry
        controlTimeout(request)
    }

    func openSavedHistory() {
        guard savedChat != nil else { return }
        chatControls.historyShown = true
        refreshSavedHistory()
    }

    func openSavedHistoryMessage(_ message: Int) {
        guard savedChat != nil, message > 0 else { return }
        chatControls.historyShown = true
        chatControls.previous = []
        readSavedHistory(ChatHistoryCursor(message: message), revision: nil)
    }

    func refreshSavedHistory() {
        chatControls.previous = []
        readSavedHistory(ChatHistoryCursor(), revision: nil)
    }

    func nextSavedHistory() {
        guard chatControls.reading == nil, let next = chatControls.history?.page?.next else { return }
        chatControls.previous.append(chatControls.cursor)
        readSavedHistory(next, revision: chatControls.history?.revision)
    }

    func previousSavedHistory() {
        guard chatControls.reading == nil, let previous = chatControls.previous.popLast() else { return }
        readSavedHistory(previous, revision: chatControls.history?.revision)
    }

    func latestSavedHistory() {
        guard let count = chatControls.snapshot?.info?.messages else { return }
        chatControls.previous = []
        readSavedHistory(ChatHistoryCursor(message: max(1, count - 7)), revision: nil)
    }

    private func readSavedHistory(_ cursor: ChatHistoryCursor, revision: String?) {
        guard let chat = savedChat else { return }
        let request = ChatControlRequest(action: .page, id: chat.id, revision: revision, message: cursor.message, offset: cursor.offset)
        chatControls.cursor = cursor; chatControls.reading = request; chatControls.history = nil
        send(.chatControl(request))
        controlTimeout(request)
    }

    func acceptChatControl(_ response: ChatControlResponse) {
        switch response.action {
        case .inspect:
            guard chatControls.inspecting?.request == response.request, response.id == chats?.current else { return }
            chatControls.inspecting = nil
            chatControls.snapshot = response.ok ? response : nil
            if !response.ok { chatControls.notice = response.error }
        case .page:
            guard chatControls.reading?.request == response.request, response.id == chats?.current, chatControls.historyShown else { return }
            chatControls.reading = nil
            chatControls.history = response.ok ? response : nil
            if !response.ok { chatControls.notice = response.error }
        case .flags, .fork, .brief, .continuity:
            guard let request = chatControls.mutation, request.request == response.request, request.id == response.id else { return }
            if request.action == .brief { chatControls.briefReceipt = response }
            let undoing = chatControls.undoRequest == response.request
            chatControls.mutation = nil; chatControls.waitingExpired = false; chatControls.undoRequest = nil
            guard response.ok else {
                if undoing { chatControls.undo = nil }
                chatControls.notice = response.error ?? "The chat change was not confirmed. Refresh before trying again."
                send(.chatsList)
                return
            }
            if request.action == .brief {
                chatControls.notice = "Brief saved for this chat. It will accompany the next request; file permissions are unchanged."
            }
            if request.action == .continuity {
                chatControls.notice = request.enabled == true
                    ? "Automatic summaries enabled for later long-chat exchanges."
                    : "Automatic summaries paused and their derived copy cleared. Original history, your brief and permissions are unchanged."
            }
            if let flags = response.metadata {
                chatControls.undo = undoing ? nil : ChatControlsState.Undo(id: response.id, pinned: flags.previousPinned,
                    archived: flags.previousArchived, version: flags.version)
                chatControls.notice = undoing ? "Chat organization restored." : request.archived != nil
                    ? (flags.archived ? "Chat archived." : "Chat unarchived.") : (flags.pinned ? "Chat pinned." : "Chat unpinned.")
            }
            if let branch = response.branch {
                if branch.created, !branch.draft.isEmpty, branch.id == chats?.current, composerEmpty {
                    composerText = branch.draft
                    composerFocusTick += 1
                    chatControls.notice = "New chat ready. Review the prompt before sending. Earlier file/network effects remain; attachments and file permissions were not copied."
                } else {
                    chatControls.notice = branch.created && !branch.draft.isEmpty
                        ? "Fork saved. The prompt was not restored because its composer changed; find the original prompt in the source chat's saved history."
                        : branch.created ? "Fork saved; the original chat is unchanged. Review its history and draft before sending."
                        : "The existing fork was reopened. Review it before sending; input was not replayed."
                }
            }
            inspectSavedChat()
        }
    }

    private func controlTimeout(_ request: ChatControlRequest) {
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(10))
            guard let self else { return }
            if self.chatControls.mutation?.request == request.request {
                self.chatControls.waitingExpired = true
                self.chatControls.notice = "The chat change is not yet confirmed. Check the result before starting another change."
            } else if self.chatControls.inspecting?.request == request.request {
                self.chatControls.inspecting = nil
                self.chatControls.notice = "Saved chat details did not arrive. Refresh to try again."
            } else if self.chatControls.reading?.request == request.request {
                self.chatControls.reading = nil
                self.chatControls.notice = "History did not arrive. Reload to try again."
            }
        }
    }
}
