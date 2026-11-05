import Foundation
import Testing
@testable import ArkIslandCore

/// Workflows in the window (2026-11-02): the runtime's event decodes, the trigger reads as words, a new one is sent without an id.
@Suite("Workflows")
struct WorkflowsTests {
    @Test func theEventDecodesAndTriggersReadAsWords() throws {
        let json = #"{"type":"workflows","workflows":[{"id":"w1","name":"Morning digest","enabled":true,"trigger":{"kind":"schedule","schedule":{"kind":"daily","minute":480}},"steps":[{"helper":"sid","task":"Collect"},{"helper":"quill","task":"Summarise"}],"createdAt":"2026-11-02T00:00:00.000Z"}],"problem":"The name is empty."}"#
        guard case .workflows(let list) = try decodeEvent(json) else { Issue.record("not a workflows event"); return }
        #expect(list.problem == "The name is empty.")
        let flow = try #require(list.workflows.first)
        #expect(flow.name == "Morning digest" && flow.enabled && flow.steps.map(\.helper) == ["sid", "quill"])
        #expect(flow.triggerTitle == "Every day at 8:00")
        #expect(Workflow(name: "x", trigger: .init(kind: "event", event: "task.failed"), steps: []).triggerTitle == "When a Board task fails")
        #expect(Workflow(name: "x", trigger: .init(kind: "schedule", schedule: .init(kind: "hours", every: 4)), steps: []).triggerTitle == "Every 4 hours")
        #expect(Workflow(name: "x", steps: []).triggerTitle == "By hand")
    }

    @Test func aNewWorkflowIsSentWithoutAnIdAndWorkflowsIsAPage() {
        let object = Workflow(name: "New", steps: [.init(helper: "sid", task: "Go")]).jsonObject
        #expect(object["id"] == nil && object["name"] as? String == "New" && (object["steps"] as? [[String: Any]])?.count == 1)
        #expect(SidebarLayout.standard.top.contains(.workflows))
        #expect(SidebarLayout(top: [.dashboard], bottom: [.settings]).top.contains(.workflows), "a saved layout gets the new page back")
    }

    @Test func theNextRunComesFromTheRuntimeAndIsNotSavedBack() throws {
        let list = Workflow.list(from: [
            ["id": "a", "name": "Daily", "enabled": true, "trigger": ["kind": "schedule", "schedule": ["kind": "daily", "minute": 480]], "steps": [], "nextAt": "2026-11-06T08:00:00.000Z"],
            ["id": "b", "name": "By hand", "enabled": true, "trigger": ["kind": "manual"], "steps": []],
        ])
        #expect(list.count == 2)
        #expect(list[0].nextAt == ISO8601DateFormatter().date(from: "2026-11-06T08:00:00Z"))
        #expect(list[1].nextAt == nil)
        #expect(list[0].jsonObject["nextAt"] == nil, "the runtime refuses fields it did not make")
    }
}
