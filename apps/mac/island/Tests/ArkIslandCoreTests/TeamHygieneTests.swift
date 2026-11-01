import Foundation
import Testing
@testable import ArkIslandCore

@Suite("Team hygiene")
struct TeamHygieneTests {
    private let now = Date(timeIntervalSince1970: 2_000_000)

    private func job(_ id: Int, _ state: JobState, ended: Double = -100) -> HelperJob {
        HelperJob(id: id, task: "Task \(id)", state: state, createdAt: now.addingTimeInterval(ended - 10), endedAt: state == .queued ? nil : now.addingTimeInterval(ended))
    }

    @Test("paused agents with waiting work, repeated failures, unused servers and skills, most useful first")
    func suggestions() {
        var penny = Helper(id: "penny", name: "Penny", available: true, app: nil, jobs: [job(1, .queued), job(2, .queued)], role: "finance", kit: "research")
        penny.paused = true
        let kame = Helper(id: "kame", name: "Kame", available: true, app: nil, jobs: [job(3, .failed), job(4, .failed), job(5, .failed, ended: -9 * 86_400)],
                          role: "coder", skills: ["pdf"], kit: "folders")
        let sid = Helper(id: "sid", name: "Sid", available: true, app: nil, jobs: [], role: "researcher", kit: "research")
        let list = HelpersList(helpers: [penny, kame, sid], apps: [],
                               mcp: [McpServerItem(id: 1, name: "Linear", kind: "url", enabled: true), McpServerItem(id: 2, name: "Off", kind: "url")],
                               skills: [SkillInfo(name: "pdf", description: "d"), SkillInfo(name: "council", description: "d"), SkillInfo(name: "omh-x", description: "d", source: "ark")])
        let all = TeamHygiene.suggestions(list, now: now, limit: 10).map(\.text)
        #expect(all == [
            "Penny is paused with 2 tasks waiting.",
            "Kame failed 2 tasks this week. Its page says why.",
            "The Linear server is on, but no agent may use it.",
            "Penny and Sid have no skills.",
            "1 of your skills is not given to any agent: council.",
        ])
        #expect(TeamHygiene.suggestions(list, now: now).count == 4, "four at most on the Dashboard")
        #expect(TeamHygiene.suggestions(HelpersList(helpers: [], apps: []), now: now).isEmpty)
    }
}
