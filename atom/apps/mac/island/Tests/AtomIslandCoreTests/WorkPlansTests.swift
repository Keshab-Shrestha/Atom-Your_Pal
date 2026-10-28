import Foundation
import Testing
@testable import AtomIslandCore

/// ADR-111: work plans on the wire and in the notch.
@Suite("Work plans (ADR-111)")
struct WorkPlansTests {
    static let line = #"""
    {"type":"helpers","apps":[],"helpers":[],"plans":[
      {"id":2,"goal":"Compare kits","createdAt":"2026-10-10T08:00:00Z","complete":false,"stuck":false,"portions":[
        {"n":1,"agent":"sid","name":"Sid","task":"Find kits","after":[],"job":7,"state":"done"},
        {"n":2,"agent":"penny","name":"Penny","task":"Price them","after":[1],"state":"running","job":8},
        {"n":3,"agent":"sid","task":"Advise","after":[1,2],"state":"waiting"},
        {"n":4,"agent":"sid","task":"Bad state","state":"paused"},
        {"agent":"sid","task":"No number","state":"done"}
      ]},
      {"id":1,"goal":"Old","complete":true,"portions":[]},
      {"goal":"No id","portions":[]}
    ]}
    """#.replacingOccurrences(of: "\n", with: "")

    @Test func decodesPlansAndLeavesOutMalformedOnes() throws {
        guard case .helpers(let list) = try decodeEvent(Self.line) else { Issue.record("not helpers"); return }
        #expect(list.plans.map(\.id) == [2, 1], "the event's order")
        let plan = list.plans[0]
        #expect(plan.goal == "Compare kits" && plan.createdAt != nil)
        #expect(plan.portions.map(\.n) == [1, 2, 3], "a portion with an unknown state or no number is left out")
        #expect(plan.portions.map(\.state) == [.done, .running, .waiting])
        #expect(plan.portions[1].after == [1] && plan.portions[1].job == 8)
        #expect(plan.portions[2].name == "sid", "no name reads as the agent id")
        #expect(list.plans[1].complete)
    }

    @Test func anOlderRuntimeSendsNoPlans() throws {
        guard case .helpers(let list) = try decodeEvent(#"{"type":"helpers","apps":[],"helpers":[]}"#) else { Issue.record("not helpers"); return }
        #expect(list.plans.isEmpty && list.activePlan == nil)
    }

    @Test func aPortionSaysWhatItWaitsFor() {
        let portions = [
            PlanPortion(n: 1, agent: "sid", name: "Sid", task: "a", state: .done),
            PlanPortion(n: 2, agent: "penny", name: "Penny", task: "b", state: .running),
            PlanPortion(n: 3, agent: "sid", name: "Sid", task: "c", after: [1], state: .waiting),
            PlanPortion(n: 4, agent: "sid", name: "Sid", task: "d", after: [1, 2], state: .waiting),
        ]
        #expect(portions[2].stateText(portions: portions) == "Ready")
        #expect(portions[3].stateText(portions: portions) == "Waits for P2")
        #expect(portions[1].stateText(portions: portions) == "Working")
        #expect(portions[0].stateText(portions: portions) == "Done")
    }

    @Test func theSummaryNamesProgressCompletionAndFailure() {
        let p = { (n: Int, s: PlanPortion.State) in PlanPortion(n: n, agent: "sid", name: "Sid", task: "t", state: s) }
        #expect(WorkPlanItem(id: 1, goal: "g", portions: [p(1, .done), p(2, .running), p(3, .waiting)]).summary == "1 of 3 done")
        #expect(WorkPlanItem(id: 1, goal: "g", portions: [p(1, .done)], complete: true).summary == "Complete")
        #expect(WorkPlanItem(id: 1, goal: "g", portions: [p(1, .failed), p(2, .blocked)], stuck: true).summary == "Stuck: P1 did not finish")
        #expect(WorkPlanItem(id: 1, goal: "g", portions: [], stuck: true).summary == "Stuck")
    }

    @Test func theActivePlanIsTheNewestOneThatGoesOn() {
        let done = WorkPlanItem(id: 3, goal: "done", portions: [], complete: true)
        let stuck = WorkPlanItem(id: 2, goal: "stuck", portions: [], stuck: true)
        let live = WorkPlanItem(id: 1, goal: "live", portions: [])
        var list = HelpersList(helpers: [], apps: [])
        list.plans = [done, stuck, live]
        #expect(list.activePlan?.id == 1)
        list.plans = [done, stuck]
        #expect(list.activePlan == nil)
    }
}
