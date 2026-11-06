import Foundation
import Testing
@testable import ArkIslandCore

@Suite("Job tree (ADR-273)")
struct JobTreeTests {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    private func job(_ id: Int, _ state: JobState = .running, parent: Int? = nil, chat: String? = "c1") -> HelperJob {
        HelperJob(id: id, task: "Task \(id)", state: state, createdAt: now, parentId: parent, chatId: chat)
    }

    @Test("children follow their parent one step deeper; an orphan is a root; a loop still shows every job")
    func ordersAsTree() {
        let jobs = [job(1), job(2), job(3, parent: 1), job(4, parent: 3), job(5, parent: 99)]
        let tree = JobTree.ordered(jobs, id: \.id, parent: \.parentId)
        #expect(tree.map(\.item.id) == [1, 3, 4, 2, 5])
        #expect(tree.map(\.depth) == [0, 1, 2, 0, 0])
        let loop = JobTree.ordered([job(7, parent: 8), job(8, parent: 7)], id: \.id, parent: \.parentId)
        #expect(Set(loop.map(\.item.id)) == [7, 8])
    }

    @Test("a manager counts the jobs it started directly")
    func countsWorkers() {
        let counts = JobTree.workerCounts([job(1), job(2, parent: 1), job(3, parent: 1), job(4, parent: 2)])
        #expect(counts == [1: 2, 2: 1])
        #expect(JobTree.workersText(1) == "1 worker")
        #expect(JobTree.workersText(3) == "3 workers")
    }

    @Test("a detail becomes one line, cut with an ellipsis")
    func truncates() {
        #expect(JobTree.line("Found\n three   flights") == "Found three flights")
        #expect(JobTree.line(String(repeating: "a", count: 200), max: 10) == "aaaaaaaaa…")
        #expect(JobTree.line("  \n ") == nil)
        #expect(JobTree.line(nil) == nil)
    }

    @Test("the mark puts a plan to approve or a held task before the state")
    func marks() {
        var plan = job(1, .queued)
        plan.planStatus = "awaiting"
        var held = job(2, .failed)
        held.held = "Interrupted"
        #expect(WorkerMark.of(plan) == .needsYou)
        #expect(WorkerMark.of(held) == .needsYou)
        #expect(JobState.allCases.map { WorkerMark.of(job(1, $0)) } == [.queued, .running, .done, .failed, .stopped])
    }

    @Test("the Workers card folds past five rows")
    func folds() {
        let rows = Array(1...7)
        #expect(WorkersFold.shown(rows, showAll: false).rows == [1, 2, 3, 4, 5])
        #expect(WorkersFold.shown(rows, showAll: false).hidden == 2)
        #expect(WorkersFold.shown(rows, showAll: true).rows == rows)
        #expect(WorkersFold.shown(Array(1...5), showAll: false).hidden == 0)
    }

    @Test("chat rows carry the worker count, the mark and a quiet time only while running")
    func chatRows() {
        var quiet = job(2, parent: 1)
        quiet.quietSince = now.addingTimeInterval(-600)
        var doneQuiet = job(3, .done, parent: 1)
        doneQuiet.quietSince = now
        doneQuiet.endedAt = now
        let kame = Helper(id: "kame", name: "Kame", available: true, app: nil, jobs: [job(1), quiet, doneQuiet], role: "coder")
        let rows = ChatAgentWork.rows(helpers: [kame], chat: "c1", now: now)
        #expect(rows.map(\.id) == [1, 2, 3])
        #expect(rows.map(\.workers) == [2, 0, 0])
        #expect(rows.map { $0.quietSince != nil } == [false, true, false])
        #expect(rows.map(\.mark) == [.running, .running, .done])
    }

    @Test("the protocol reads quietSince")
    func parsesQuietSince() throws {
        let json = #"{"type":"helpers","apps":[],"helpers":[{"id":"kame","name":"Kame","available":true,"jobs":[{"id":4,"task":"T","state":"running","createdAt":"2026-11-06T10:00:00.000Z","quietSince":"2026-11-06T10:01:00.000Z"},{"id":5,"task":"U","state":"running","createdAt":"2026-11-06T10:00:00.000Z"}]}]}"#
        guard case .helpers(let list) = try decodeEvent(json) else { Issue.record("not a helpers event"); return }
        #expect(list.helpers.first?.jobs.map { $0.quietSince != nil } == [true, false])
    }
}
