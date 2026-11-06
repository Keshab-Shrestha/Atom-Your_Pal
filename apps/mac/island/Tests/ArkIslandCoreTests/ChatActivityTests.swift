import Foundation
import Testing
@testable import ArkIslandCore

@Suite("Queue rows and Catch me up (ADR-274)")
struct ChatActivityTests {
    private let then = Date(timeIntervalSince1970: 1_000_000)

    private func queue(_ texts: String...) -> MessageQueue {
        var q = MessageQueue()
        _ = q.turn(.thinking)
        for text in texts { q.add(text: text, files: ComposerDraft(), chat: "c1") }
        return q
    }

    @Test("a row moves to a new place and the others keep their order; an unknown id or a far index is safe")
    func movesARow() {
        var q = queue("a", "b", "c")
        let c = q.messages[2].id
        let top = q.move(id: c, to: 0)
        #expect(top && q.messages.map(\.text) == ["c", "a", "b"])
        let last = q.move(id: c, to: 99)
        #expect(last && q.messages.map(\.text) == ["a", "b", "c"], "dropped on the last row: it goes last")
        let up = q.move(id: q.messages[1].id, to: -1)
        #expect(up && q.messages.map(\.text) == ["b", "a", "c"], "⌥↑ moves it up; past the top it stays on top")
        let unknown = q.move(id: "nope", to: 0)
        #expect(!unknown)
        #expect(q.messages.map(\.text) == ["b", "a", "c"])
    }

    @Test("the saved list follows the live order; held entries keep their places")
    func savedFollowsLive() {
        var q = queue("a", "b")
        let held = QueuedMessage(text: "held", files: ComposerDraft(), chat: "c1")
        let saved = [held, q.messages[0], q.messages[1]]
        q.move(id: q.messages[1].id, to: 0)
        #expect(q.ordered(saved).map(\.text) == ["held", "b", "a"])
        #expect(q.ordered([held]).map(\.text) == ["held"])
    }

    @Test("Edit and Remove take only that row; Send now takes any row and the rest go in order")
    func takesOneRow() {
        var q = queue("a", "b", "c")
        let b = q.messages[1].id
        let edited = q.take(id: b)
        #expect(edited?.text == "b" && q.messages.map(\.text) == ["a", "c"])
        let again = q.take(id: b)
        #expect(again == nil, "once")
        let sentNow = q.take(id: q.messages[1].id) // Send now on the last row
        #expect(sentNow?.text == "c" && q.messages.map(\.text) == ["a"])
        let a = q.messages[0]
        q.didDispatch()
        _ = q.turn(.thinking)
        let next = q.turn(.idle)
        #expect(next == .send(a) && q.messages.isEmpty, "the rest still go in order when that answer ends")
    }

    private func info(_ messages: Int) -> ChatInfo { ChatInfo(id: "c1", title: "Chat", messages: messages) }
    private func helpers(_ jobs: HelperJob...) -> [Helper] {
        [Helper(id: "kame", name: "Kame", available: true, app: nil, jobs: jobs, role: "coder")]
    }
    private func job(_ id: Int, _ state: JobState, chat: String = "c1") -> HelperJob {
        HelperJob(id: id, task: "Task", state: state, chatId: chat)
    }

    @Test("new messages or a Board job from this chat that started or changed are news; nothing seen is not")
    func findsNews() {
        let seen = ChatActivity.mark(chat: info(4), helpers: helpers(job(1, .running)), at: then)
        #expect(!ChatActivity.isNew(seen, since: nil), "a chat never seen has nothing to catch up on")
        #expect(!ChatActivity.isNew(ChatActivity.mark(chat: info(4), helpers: helpers(job(1, .running)), at: then), since: seen))
        #expect(ChatActivity.isNew(ChatActivity.mark(chat: info(6), helpers: helpers(job(1, .running)), at: then), since: seen))
        #expect(ChatActivity.isNew(ChatActivity.mark(chat: info(4), helpers: helpers(job(1, .done)), at: then), since: seen))
        #expect(ChatActivity.isNew(ChatActivity.mark(chat: info(4), helpers: helpers(job(1, .running), job(2, .queued)), at: then), since: seen))
        #expect(!ChatActivity.isNew(ChatActivity.mark(chat: info(4), helpers: helpers(job(1, .running), job(3, .done, chat: "c2")), at: then), since: seen),
                "another chat's job is not news here")
        #expect(!ChatActivity.isNew(ChatActivity.mark(chat: info(4), helpers: helpers(), at: then), since: seen), "a job that left the Board is not news")
        #expect(!ChatActivity.isNew(ChatActivity.mark(chat: info(4), helpers: nil, at: then), since: seen), "Board not known yet")
        #expect(!ChatActivity.isNew(ChatActivity.mark(chat: info(3), helpers: helpers(job(1, .running)), at: then), since: seen))
    }

    @Test("a view keeps the last known jobs when the Board is not known, and only the newest views are kept")
    func remembers() {
        let first = ChatActivity.mark(chat: info(4), helpers: helpers(job(1, .running)), at: then)
        var seen = ChatActivity.remember(first, for: "c1", in: [:])
        seen = ChatActivity.remember(ChatActivity.mark(chat: info(5), helpers: nil, at: then + 60), for: "c1", in: seen)
        #expect(seen["c1"]?.messages == 5)
        #expect(seen["c1"]?.jobs == ["1": "running"])
        var many: [String: ChatSeen] = [:]
        for i in 0...ChatActivity.limit { many = ChatActivity.remember(ChatSeen(at: then + Double(i), messages: 0, jobs: nil), for: "c\(i)", in: many) }
        #expect(many.count == ChatActivity.limit)
        #expect(many["c0"] == nil, "the oldest view goes first")
    }

    @Test("the request names the time, and the date when it was another day")
    func writesTheRequest() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Tokyo")!
        let since = Date(timeIntervalSince1970: 1_793_000_000) // 2026-10-26 16:33 JST
        #expect(ChatActivity.request(since: since, now: since + 600, calendar: calendar)
            == "Catch me up: summarise in a few lines what happened in this chat since 16:33.")
        #expect(ChatActivity.request(since: since, now: since + 86_400, calendar: calendar).hasSuffix("since Oct 26, 16:33."))
    }
}
