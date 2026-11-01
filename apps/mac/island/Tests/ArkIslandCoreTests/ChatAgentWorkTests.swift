import Foundation
import Testing
@testable import ArkIslandCore

@Suite("Chat agent work")
struct ChatAgentWorkTests {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    private func job(_ id: Int, _ state: JobState, chat: String?, started: Double, ended: Double? = nil, step: String? = nil, summary: String? = nil) -> HelperJob {
        HelperJob(id: id, task: "Task \(id)", state: state, createdAt: now.addingTimeInterval(started), endedAt: ended.map { now.addingTimeInterval($0) },
                  step: step, summary: summary, chatId: chat)
    }

    @Test("only this chat's agents show: running always, finished for an hour, oldest first")
    func rowsForOneChat() {
        let kame = Helper(id: "kame", name: "Kame", available: true, app: nil, jobs: [
            job(3, .running, chat: "c1", started: -30, step: "Using WebSearch"),
            job(1, .done, chat: "c1", started: -600, ended: -300, summary: "Found three flights"),
            job(2, .done, chat: "c1", started: -9000, ended: -7200),
            job(4, .running, chat: "c2", started: -10),
        ], role: "researcher")
        let sid = Helper(id: "sid", name: "Sid", available: true, app: nil, jobs: [job(5, .queued, chat: "c1", started: -5)], role: "coder")
        let rows = ChatAgentWork.rows(helpers: [kame, sid], chat: "c1", now: now)
        #expect(rows.map(\.id) == [1, 3, 5])
        #expect(rows.map(\.detail) == ["Found three flights", "Using WebSearch", "Waiting to start"])
        #expect(rows.map(\.agent) == ["Kame", "Kame", "Sid"])
        #expect(ChatAgentWork.rows(helpers: [kame, sid], chat: nil, now: now).isEmpty)
    }
}
