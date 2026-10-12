import Foundation
import Testing
@testable import AtomIslandCore

/// ADR-095: Managers on the wire, on the Board's chips, on the floor and in "All agents".
private func worker(_ id: String, manager: String?, _ jobs: [HelperJob] = []) -> Helper {
    Helper(id: id, name: id.capitalized, available: true, app: nil, jobs: jobs, role: "researcher", manager: manager)
}

private func running(_ id: Int, step: String? = nil) -> HelperJob {
    var j = HelperJob(id: id, task: "t", state: .running)
    j.step = step
    return j
}

private func awaiting(_ id: Int) -> HelperJob {
    var j = HelperJob(id: id, task: "t", state: .queued)
    j.planFirst = true
    j.planStatus = "awaiting"
    return j
}

private func team(_ managers: Int) -> HelpersList {
    let ms = (0..<managers).map { HelperManager(id: "m\($0)", name: "Manager \($0)", agents: ["w\($0)a", "w\($0)b"]) }
    let helpers = (0..<managers).flatMap { [worker("w\($0)a", manager: "m\($0)"), worker("w\($0)b", manager: "m\($0)")] } + [worker("loose", manager: nil)]
    return HelpersList(helpers: helpers, apps: [], managers: ms)
}

@Suite("Managers (ADR-095)")
struct ManagerTests {
    static let line = #"{"type":"helpers","apps":[],"helpers":[{"id":"sid","name":"Sid","available":true,"app":null,"manager":"research","jobs":[]},{"id":"tinker","name":"Tinker","available":false,"app":null,"jobs":[]}],"managers":[{"id":"research","name":"Research","mode":"plan","soul":{"name":"Research","personality":"Calm.","howItWorks":"","rules":"","lessons":""},"soulVersion":2,"budget":{"cap":15,"spent":0.4},"agents":["sid"],"jobs":[{"id":9,"task":"Research mesh","state":"queued","createdAt":"2026-10-12T00:00:00Z"},{"id":"bad"}]},{"id":"x"},{"id":"coding","name":"Coding","agents":[],"jobs":[]}]}"#

    @Test func managersAreDecodedWithTheirAgentsModeBudgetAndRuns() throws {
        guard case .helpers(let list) = try decodeEvent(Self.line) else { Issue.record("not helpers"); return }
        #expect(list.managers.map(\.id) == ["research", "coding"], "a malformed Manager is left out")
        let research = list.managers[0]
        #expect(research.plansAndReviews && research.modeTitle == "Plans and reviews")
        #expect(research.soulVersion == 2 && research.budget == HelperBudget(cap: 15, spent: 0.4) && research.agents == ["sid"])
        #expect(research.jobs.map(\.id) == [9], "a malformed run is left out")
        #expect(list.managers[1].mode == "group" && !list.managers[1].plansAndReviews, "group by default")
        #expect(list.helpers.first?.manager == "research" && list.helpers.last?.manager == nil)
        #expect(list.agents(of: research).map(\.id) == ["sid"])
        #expect(list.item(9)?.helperName == "Research", "a Manager's run opens like a task")
        guard case .helpers(let older) = try decodeEvent(HelperTaskTests.line) else { Issue.record("not helpers"); return }
        #expect(older.managers.isEmpty, "an older runtime: no Managers")
    }

    @Test func commandsCarryTheirFields() throws {
        func fields(_ c: IslandCommand) throws -> [String: Any] {
            try JSONSerialization.jsonObject(with: Data(c.line.utf8)) as? [String: Any] ?? [:]
        }
        #expect(try fields(.managerCreate(name: "Travel", mode: "plan")) as NSDictionary == ["type": "manager.create", "name": "Travel", "mode": "plan"])
        #expect(try fields(.managerRename(id: "travel", name: "Trips")) as NSDictionary == ["type": "manager.rename", "id": "travel", "name": "Trips"])
        #expect(try fields(.managerMode(id: "travel", mode: "group")) as NSDictionary == ["type": "manager.mode", "id": "travel", "mode": "group"])
        #expect(try fields(.managerDelete(id: "travel")) as NSDictionary == ["type": "manager.delete", "id": "travel"])
        #expect(try fields(.agentManager(helper: "sid", manager: "research")) as NSDictionary == ["type": "agent.manager", "helper": "sid", "manager": "research"])
    }

    @Test func theWindowOpensAManagerAndSendsItsChanges() throws {
        var state = HelpersState()
        state.apply(try decodeEvent(Self.line))
        state.selectManager("research")
        #expect(state.selectedManager?.name == "Research")
        #expect(state.setManagerMode(plansAndReviews: true) == nil, "unchanged")
        #expect(state.setManagerMode(plansAndReviews: false) == .managerMode(id: "research", mode: "group"))
        #expect(state.renameManager(" Research ") == nil)
        #expect(state.renameManager("Finding") == .managerRename(id: "research", name: "Finding"))
        #expect(state.setManagerBudget(5) == .helperBudget(helper: "research", cap: 5))
        #expect(state.deleteManager() == nil && state.problem?.contains("still has Agents") == true)
        state.selectHelper("sid")
        #expect(state.selectedManager == nil, "an Agent's page replaces it")
        #expect(state.moveAgent(to: "research") == nil, "already there")
        #expect(state.moveAgent(to: "coding") == .agentManager(helper: "sid", manager: "coding"))
        #expect(state.moveAgent(to: "nope") == nil)
        state.openNewManager()
        #expect(state.createManager(name: "  ", plansAndReviews: true) == nil && state.problem != nil)
        #expect(state.createManager(name: "Travel", plansAndReviews: true) == .managerCreate(name: "Travel", mode: "plan"))
        let added = Self.line.replacingOccurrences(of: #"{"id":"x"},"#, with: #"{"id":"travel","name":"Travel","agents":[],"jobs":[]},"#)
        state.apply(try decodeEvent(added))
        #expect(state.selectedManager?.id == "travel" && !state.isCreatingManager, "the new Manager is chosen")
        state.apply(try decodeEvent(Self.line))
        #expect(state.selectedManager == nil, "a removed Manager's page closes")
    }

    @Test func chipsShowEveryManagerWithNAtWorkAndNeedsYou() {
        #expect(TeamRoster.managerChips(in: team(0)).isEmpty, "no Managers: the worker chips stay")
        var one = team(1)
        one.helpers[0].jobs = [running(1), running(2)]
        one.helpers[1].jobs = [running(3)]
        one.managers[0].jobs = [running(4)]
        let chip = TeamRoster.managerChips(in: one)
        #expect(chip.map(\.id) == ["m0"] && chip[0].atWork == 4 && chip[0].line == "4 at work" && !chip[0].needsYou)
        var five = team(5)
        five.helpers[3].jobs = [awaiting(5)] // w1b's plan waits for Keshab
        five.helpers[4].jobs = [HelperJob(id: 6, task: "t", state: .failed)] // a failure is not "needs you"
        let chips = TeamRoster.managerChips(in: five)
        #expect(chips.count == 5)
        #expect(chips.map(\.needsYou) == [false, true, false, false, false])
        #expect(chips[0].line == "2 agents · Group only")
    }

    @Test func theFloorHasOneDeskPerManager() {
        let none = OfficePlan(list: team(0))
        #expect(none.seats.map(\.helperId) == ["loose"], "no Managers: workers, as before")
        var one = team(1)
        one.helpers[1].jobs = [running(1, step: "Reading 2 of 8 pages")]
        let plan = OfficePlan(list: one)
        #expect(plan.seats.count == 1 && plan.seats[0].manager && plan.seats[0].helperId == "m0")
        #expect(plan.seats[0].spot == .desk(0) && plan.seats[0].animation == "working" && plan.seats[0].bubble == "1 at work")
        #expect(plan.envelopes.isEmpty)
        var five = team(5)
        five.helpers[2].jobs = [running(1)]
        five.helpers[3].jobs = [running(2), running(3)]
        five.helpers[6].jobs = [awaiting(4)]
        let floor = OfficePlan(list: five)
        #expect(floor.seats.count == 5)
        let m1 = floor.seats.first { $0.helperId == "m1" }!
        #expect(m1.spot == .desk(1) && m1.bubble == "3 at work")
        let m3 = floor.seats.first { $0.helperId == "m3" }!
        #expect(m3.flag == .needsYou && m3.bubble == "Needs you" && m3.spot == .lounge(2), "the lounge: Managers with nobody working")
        #expect(floor.seats.filter { if case .lounge = $0.spot { true } else { false } }.map(\.helperId) == ["m0", "m2", "m3", "m4"])
        #expect(floor.needsYou == 1 && floor.moreAtWork == 0 && floor.moreIdle == 0)
    }

    @Test func aManagersFailedRunNeedsYouIsAnIssueAndMarksItsChipAndDesk() {
        var one = team(1)
        var run = HelperJob(id: 7, task: "Research mesh", state: .failed)
        run.error = "None of Manager 0's tasks finished."
        run.goalId = 3
        run.goal = "Plan the mesh network"
        one.managers[0].jobs = [run]
        let needs = NeedsYouItem.all(in: one)
        #expect(needs.map(\.id) == ["failed-7"] && needs[0].helperId == "m0" && needs[0].helperName == "Manager 0")
        #expect(needs[0].detail == "None of Manager 0's tasks finished.")
        #expect(TeamIssues.all(in: one).map(\.id) == [7])
        let chip = TeamRoster.managerChips(in: one)[0]
        #expect(chip.needsYou && chip.failed)
        let desk = OfficePlan(list: one).seats[0]
        #expect(desk.flag == .failed && desk.bubble == "Run failed")
        let overview = TeamOverview(list: one)
        #expect(overview.goals.map(\.id) == [3] && overview.goals[0].text == "Plan the mesh network" && overview.goals[0].failed == 1)
        var state = HelpersState()
        state.apply(.helpers(one))
        #expect(state.retry(7) == .jobRetry(id: 7), "Retry works on a Manager's run")
        // A later run that did not fail clears the chip's "!".
        one.managers[0].jobs = [HelperJob(id: 8, task: "Research mesh", state: .done), run]
        #expect(!TeamRoster.managerChips(in: one)[0].failed)
    }

    @Test func aManagersHeldRunNeedsYou() {
        var one = team(1)
        var run = HelperJob(id: 9, task: "Research mesh", state: .queued)
        run.held = "Manager 0's daily budget is used up."
        one.managers[0].jobs = [run]
        let needs = NeedsYouItem.all(in: one)
        #expect(needs.map(\.id) == ["held-9"] && needs[0].kind == .held && needs[0].helperId == "m0")
        let chip = TeamRoster.managerChips(in: one)[0]
        #expect(chip.needsYou && !chip.failed)
        let plan = OfficePlan(list: one)
        #expect(plan.seats[0].flag == .needsYou && plan.needsYou == 1)
        var state = HelpersState()
        state.apply(.helpers(one))
        #expect(state.stopJob(9) == .jobStop(id: 9), "Stop works on a Manager's run without a chosen worker")
    }

    @Test func allAgentsAreGroupedByManager() {
        let list = team(2)
        let groups = TeamRoster.grouped(TeamRoster.search(list.helpers, ""), in: list)
        #expect(groups.map(\.title) == ["Manager 0", "Manager 1", "No manager"])
        #expect(groups.map { $0.helpers.map(\.id) } == [["w0a", "w0b"], ["w1a", "w1b"], ["loose"]])
        #expect(TeamRoster.grouped(TeamRoster.search(list.helpers, "w1a"), in: list).map(\.title) == ["Manager 1"])
        #expect(TeamRoster.grouped(list.helpers, in: team(0)).map(\.title) == [""], "no Managers: one list")
        #expect(list.tasks(of: list.managers[0]).isEmpty)
    }
}
