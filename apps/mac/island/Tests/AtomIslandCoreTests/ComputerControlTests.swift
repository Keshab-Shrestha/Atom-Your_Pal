import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Computer control protocol (ADR-054)")
struct ComputerControlProtocolTests {
    @Test func approvalAnswerIsOneLineWithARealBoolean() throws {
        let line = IslandCommand.approvalAnswer(id: "a1", approved: true).line
        #expect(line.hasSuffix("\n"))
        #expect(!line.dropLast().contains("\n"))
        let object = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
        #expect(object?["type"] as? String == "approval.answer")
        #expect(object?["id"] as? String == "a1")
        #expect(object?["approved"] as? Bool == true)
        #expect(IslandCommand.approvalAnswer(id: "a1", approved: false).type == "approval.answer")
    }

    @Test func approvalAnswerEscapesTheId() throws {
        let tricky = "a\"1\\ \n é"
        let object = try JSONSerialization.jsonObject(with: Data(IslandCommand.approvalAnswer(id: tricky, approved: false).line.utf8)) as? [String: Any]
        #expect(object?["id"] as? String == tricky)
        #expect(object?["approved"] as? Bool == false)
    }

    @Test func decodesTheThreeComputerEvents() throws {
        #expect(try decodeEvent(#"{"type":"computer.step","text":"Typing in TextEdit"}"#) == .computerStep("Typing in TextEdit"))
        #expect(try decodeEvent(#"{"type":"approval.request","id":"a1","summary":"Click \"Send\" in Mail","reason":"it may send"}"#)
            == .approvalRequest(ApprovalRequest(id: "a1", summary: "Click \"Send\" in Mail", reason: "it may send")))
        #expect(try decodeEvent(#"{"type":"approval.closed","id":"a1"}"#) == .approvalClosed(id: "a1"))
    }

    @Test func malformedComputerEventsAreErrorsNotCrashes() {
        #expect(throws: ProtocolError.self) { try decodeEvent(#"{"type":"approval.request","summary":"x","reason":"y"}"#) }
        #expect(throws: ProtocolError.self) { try decodeEvent(#"{"type":"approval.request","id":"a","reason":"y"}"#) }
        #expect(throws: ProtocolError.self) { try decodeEvent(#"{"type":"approval.closed"}"#) }
        #expect(throws: ProtocolError.self) { try decodeEvent(#"{"type":"computer.step"}"#) }
    }

    @Test func eventNamesNeverContainWhatTheyCarry() {
        #expect(IslandEvent.computerStep("secret app").name == "computer.step")
        #expect(IslandEvent.approvalRequest(ApprovalRequest(id: "a", summary: "secret", reason: "r")).name == "approval.request")
        #expect(IslandEvent.approvalClosed(id: "a").name == "approval.closed")
    }
}

@Suite("Computer control status and approval state")
struct ComputerControlStateTests {
    let request = ApprovalRequest(id: "a1", summary: "Delete \"Report\" in Finder", reason: "it deletes something")

    @Test func aStepShowsAsUsingTheMacAndKeepsTheIslandBusy() {
        var status = IslandStatus()
        status.apply(.state(.thinking))
        status.apply(.computerStep("Typing in TextEdit"))
        #expect(status.kind == .acting)
        #expect(status.title == "Using your Mac")
        #expect(status.detail == "Typing in TextEdit")
        #expect(status.isBusy)
        #expect(!status.needsAttention)
    }

    @Test func aRequestShowsAsNeedingTheUsersOKAndKeepsTheIslandBusy() {
        var status = IslandStatus()
        status.apply(.approvalRequest(request))
        #expect(status.kind == .asking)
        #expect(status.title == "Needs your OK")
        #expect(status.isBusy)
    }

    @Test func whenTheRequestClosesTheStatusGoesBackToWorking() {
        var status = IslandStatus()
        status.apply(.approvalRequest(request))
        status.apply(.approvalClosed(id: "a1"))
        #expect(status.kind == .thinking)
        // A closing that arrives late, after the turn moved on, must not pull the status back.
        status.apply(.state(.speaking))
        status.apply(.approvalClosed(id: "a1"))
        #expect(status.kind == .speaking)
    }

    @Test func theTurnEndingReturnsToReady() {
        var status = IslandStatus()
        status.apply(.ready(ReadyInfo(protocolVersion: 1, provider: "gemini", model: "gemini-3.5-flash", microphone: ":default", voice: true)))
        status.apply(.computerStep("Looking at Mail"))
        status.apply(.state(.idle))
        #expect(status.kind == .ready)
    }

    @Test func approvalStateHoldsOneRequestAtATime() {
        var state = ApprovalState()
        #expect(state.pending == nil)
        state.apply(.approvalRequest(request))
        #expect(state.pending == request)
        let second = ApprovalRequest(id: "a2", summary: "Quit Mail", reason: "it quits")
        state.apply(.approvalRequest(second))
        #expect(state.pending == second)
    }

    @Test func closedOnlyClearsTheMatchingRequest() {
        var state = ApprovalState()
        state.apply(.approvalRequest(request))
        state.apply(.approvalClosed(id: "other"))
        #expect(state.pending == request)
        state.apply(.approvalClosed(id: "a1"))
        #expect(state.pending == nil)
    }

    @Test func theTurnEndingOrAResetOrARestartClearsIt() {
        for event in [IslandEvent.state(.idle), .conversationReset, .error(RuntimeError(stage: "model", message: "x"))] {
            var state = ApprovalState()
            state.apply(.approvalRequest(request))
            state.apply(event)
            #expect(state.pending == nil, "\(event.name)")
        }
        var state = ApprovalState()
        state.apply(.approvalRequest(request))
        state.runtimeStopped()
        #expect(state.pending == nil)
    }

    @Test func otherEventsLeaveItAlone() {
        var state = ApprovalState()
        state.apply(.approvalRequest(request))
        for event in [IslandEvent.state(.thinking), .computerStep("Clicking in Mail"), .micLevel(0.5), .reply("ok")] {
            state.apply(event)
        }
        #expect(state.pending == request)
    }

    @Test func answeringTakesTheRequestAndNamesTheAnswer() {
        var state = ApprovalState()
        state.apply(.approvalRequest(request))
        let command = state.answer(approved: true)
        #expect(command == .approvalAnswer(id: "a1", approved: true))
        #expect(state.pending == nil)
        #expect(state.answer(approved: true) == nil) // nothing left to answer: no second answer goes out
    }

    @Test func petBrainReactsToTheNewKinds() {
        var brain = PetBrain(width: 800, now: 0)
        brain.update(status: .acting, at: 1)
        #expect(brain.mood == .thinking)
        brain.update(status: .asking, at: 2)
        #expect(brain.mood == .thinking)
    }
}
