import Foundation
import Testing
@testable import AtomIslandCore

/// ADR-094 part C: room for many agents on the Board's chips and the office floor.
private let now = Date(timeIntervalSinceReferenceDate: 800_000_000)

private func agent(_ i: Int, role: String = "researcher", _ jobs: [HelperJob] = []) -> Helper {
    Helper(id: "a\(i)", name: "Agent \(i)", available: true, app: nil, jobs: jobs, role: role)
}

private func job(_ id: Int, _ state: JobState, minutesAgo: Double) -> HelperJob {
    var j = HelperJob(id: id, task: "t", state: state)
    j.createdAt = now.addingTimeInterval(-minutesAgo * 60)
    if state == .done || state == .failed { j.endedAt = j.createdAt }
    return j
}

private func list(_ helpers: [Helper]) -> HelpersList { HelpersList(helpers: helpers, apps: []) }

@Suite("Team chips (ADR-094)")
struct TeamChipsTests {
    @Test func aTeamOfTwelveOrFewerShowsEveryone() {
        #expect(TeamRoster.chips(in: list([]), now: now).isEmpty)
        #expect(TeamRoster.chips(in: list([agent(0)]), now: now).map(\.id) == ["a0"])
        let twelve = (0..<12).map { agent($0) }
        #expect(TeamRoster.chips(in: list(twelve), now: now).map(\.id) == twelve.map(\.id), "all twelve, in the team's order")
    }

    @Test func pastTwelveOnlyWhoMattersNow() {
        // Thirteen with nothing going on: no chips (All agents holds them).
        #expect(TeamRoster.chips(in: list((0..<13).map { agent($0) }), now: now).isEmpty)
        var team = (0..<13).map { agent($0) }
        team[12].jobs = [job(1, .running, minutesAgo: 5)]
        team[3].jobs = [job(2, .done, minutesAgo: 60 * 30)] // a day and a half ago: not shown
        team[7].jobs = [job(3, .done, minutesAgo: 60)]
        #expect(TeamRoster.chips(in: list(team), now: now).map(\.id) == ["a12", "a7"])
    }

    @Test func fiftyAgentsWorkingThenWaitingThenRecentAtMostTwelve() {
        var team = (0..<50).map { agent($0) }
        // Working: started 10, 30 and 20 minutes ago → longest at work first.
        team[40].jobs = [job(1, .running, minutesAgo: 10)]
        team[41].jobs = [job(2, .running, minutesAgo: 30)]
        team[42].jobs = [job(3, .running, minutesAgo: 20)]
        // Waiting for Keshab: a failed task, a plan to approve, a held task.
        team[10].jobs = [job(4, .failed, minutesAgo: 60 * 40)]
        var plan = job(5, .queued, minutesAgo: 60 * 40)
        plan.planStatus = "awaiting"
        team[11].jobs = [plan]
        var held = job(6, .queued, minutesAgo: 60 * 40)
        held.held = "The team's budget is spent."
        team[12].jobs = [held]
        // Used in the last day: ten of them, the later index more recent.
        for i in 20..<30 { team[i].jobs = [job(100 + i, .done, minutesAgo: Double(300 - i * 10))] }
        let chips = TeamRoster.chips(in: list(team), now: now).map(\.id)
        #expect(chips.count == TeamRoster.chipLimit)
        #expect(Array(chips.prefix(6)) == ["a41", "a42", "a40", "a10", "a11", "a12"])
        #expect(Array(chips.dropFirst(6)) == ["a29", "a28", "a27", "a26", "a25", "a24"], "most recent first, cut at twelve")
    }

    @Test func theOrderIsStable() {
        var team = (0..<20).map { agent($0) }
        for i in [3, 9, 15] { team[i].jobs = [job(i, .running, minutesAgo: 15)] } // the same start: the team's order
        let first = TeamRoster.chips(in: list(team), now: now).map(\.id)
        #expect(first == ["a3", "a9", "a15"])
        #expect(TeamRoster.chips(in: list(team), now: now.addingTimeInterval(1)).map(\.id) == first)
        // One more starts later: it joins at the end; nobody moves.
        team[1].jobs = [job(50, .running, minutesAgo: 1)]
        #expect(TeamRoster.chips(in: list(team), now: now).map(\.id) == first + ["a1"])
    }

    @Test func searchesByNameOrRoleInAnyCase() {
        let team = [Helper(id: "sid", name: "Sid", available: true, app: nil, jobs: [], role: "researcher"),
                    Helper(id: "penny", name: "Penny", available: true, app: nil, jobs: [], role: "financial adviser"),
                    Helper(id: "kame", name: "Kame", available: true, app: nil, jobs: [], role: "coder"),
                    Helper(id: "hana", name: "Hana", available: true, app: nil, jobs: [], role: "hr")]
        #expect(TeamRoster.search(team, "").map(\.id) == ["hana", "kame", "penny", "sid"], "everyone, A to Z")
        #expect(TeamRoster.search(team, "  sI ").map(\.id) == ["sid"])
        #expect(TeamRoster.search(team, "RESEARCH").map(\.id) == ["sid"])
        #expect(TeamRoster.search(team, "financial info").map(\.id) == ["penny"], "the role as the window says it")
        #expect(TeamRoster.search(team, "adviser").map(\.id) == ["penny"], "and as the runtime says it")
        #expect(TeamRoster.search(team, "HR").map(\.id) == ["hana"])
        #expect(TeamRoster.search(team, "nobody").isEmpty)
        let fifty = (0..<50).map { agent($0, role: $0 % 2 == 0 ? "coder" : "writer") }
        #expect(TeamRoster.search(fifty, "agent 4").map(\.id) == ["a4", "a40", "a41", "a42", "a43", "a44", "a45", "a46", "a47", "a48", "a49"])
        #expect(TeamRoster.search(fifty, "Writer").count == 25)
    }
}

@Suite("Office floor seats (ADR-094)")
struct FloorSeatingTests {
    func desks(_ plan: OfficePlan) -> [String: Int] {
        Dictionary(uniqueKeysWithValues: plan.seats.compactMap { s in if case .desk(let d) = s.spot { (s.helperId, d) } else { nil } })
    }

    func lounge(_ plan: OfficePlan) -> [String] {
        plan.seats.compactMap { s -> (Int, String)? in if case .lounge(let l) = s.spot { (l, s.helperId) } else { nil } }.sorted { $0.0 < $1.0 }.map(\.1)
    }

    @Test func noneOneAndTwelveAtWorkSitAtTheirOwnDesks() {
        let empty = OfficePlan(list: list([]), now: now)
        #expect(empty.seats.isEmpty && empty.moreAtWork == 0 && empty.moreIdle == 0)
        let one = OfficePlan(list: list([agent(0, [job(1, .running, minutesAgo: 1)])]), now: now)
        #expect(desks(one) == ["a0": 0] && one.moreAtWork == 0)
        // Twelve at work, started in reverse: each still at its own seat (its place in the team).
        let twelve = (0..<12).map { agent($0, [job($0 + 1, .running, minutesAgo: Double($0))]) }
        let plan = OfficePlan(list: list(twelve), now: now)
        #expect(desks(plan) == Dictionary(uniqueKeysWithValues: (0..<12).map { ("a\($0)", $0) }))
        #expect(plan.moreAtWork == 0 && plan.moreIdle == 0)
    }

    @Test func thirteenAtWorkTheLatestWaitsBehindTheSign() {
        let team = (0..<13).map { agent($0, [job($0 + 1, .running, minutesAgo: Double(100 - $0))]) } // a12 started last
        let plan = OfficePlan(list: list(team), now: now)
        #expect(plan.seats.count == 12 && plan.moreAtWork == 1)
        #expect(desks(plan)["a12"] == nil)
        #expect(Set(desks(plan).values) == Set(0..<12), "every seat used once")
    }

    @Test func fiftyAgentsTwelveSeatsTenInTheLoungeAndTwoSigns() {
        var team = (0..<50).map { agent($0) }
        for i in 0..<20 { team[i * 2 + 1].jobs = [job(i + 1, .running, minutesAgo: Double(60 - i))] } // odd ones, a1 first
        team[30].jobs = [job(200, .failed, minutesAgo: 60 * 48)]
        team[44].jobs = [job(201, .done, minutesAgo: 2)]
        let plan = OfficePlan(list: list(team), now: now)
        #expect(desks(plan).count == 12 && plan.moreAtWork == 8)
        #expect(Set(desks(plan).keys) == Set((0..<12).map { "a\($0 * 2 + 1)" }), "the twelve who started first")
        #expect(Set(desks(plan).values) == Set(0..<12))
        #expect(lounge(plan).count == 10 && plan.moreIdle == 20)
        #expect(Array(lounge(plan).prefix(3)) == ["a30", "a44", "a0"], "the failed one, the most recent, then the team's order")
        #expect(plan.seats.count == 22)
    }

    @Test func seatsAreStableAsOthersStartAndFinish() {
        var team = (0..<30).map { agent($0) }
        for i in [2, 14, 26] { team[i].jobs = [job(i + 1, .running, minutesAgo: Double(50 - i))] } // 2, then 14, then 26
        let before = desks(OfficePlan(list: list(team), now: now))
        #expect(before == ["a2": 2, "a14": 3, "a26": 4], "a14's own seat (14 % 12 = 2) is taken: the next free one")
        // Someone starts later: the earlier ones keep their seats.
        team[5].jobs = [job(99, .running, minutesAgo: 1)]
        let after = desks(OfficePlan(list: list(team), now: now))
        #expect(after.filter { $0.key != "a5" } == before && after["a5"] == 5)
        // The same list twice: the same plan.
        #expect(OfficePlan(list: list(team), now: now) == OfficePlan(list: list(team), now: now))
    }

    @Test func theNeedsYouBoardCountsWorkersLeftOutToo() {
        var team = (0..<15).map { agent($0) }
        for i in 0..<15 {
            var held = job(i + 1, .queued, minutesAgo: Double(i))
            held.held = "The team's budget is spent."
            team[i].jobs = [held]
        }
        let plan = OfficePlan(list: list(team), now: now)
        #expect(plan.seats.count == 10 && plan.moreIdle == 5 && plan.needsYou == 15)
    }
}
