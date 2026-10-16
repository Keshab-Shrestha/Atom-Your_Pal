import Testing
@testable import AtomIslandCore

// 2026-10-16 (code check, third review pass): small fixes that came from the Swift core review.
@Suite("Review fixes")
struct ReviewFixesTests {
    private let settingsError = IslandEvent.error(RuntimeError(stage: "settings", message: "That note is gone."))
    private let protocolError = IslandEvent.error(RuntimeError(stage: "protocol", message: "Unknown command."))
    private let modelError = IslandEvent.error(RuntimeError(stage: "model", message: "Limit reached."))

    @Test func aSettingsOrProtocolErrorDoesNotEndTheTurnThatIsRunning() {
        var conversation = Conversation()
        conversation.apply(.transcript("Hi"))
        conversation.apply(settingsError)
        conversation.apply(protocolError)
        conversation.apply(.reply("Hello"))
        conversation.apply(.turnComplete(TurnTimings(speechMs: 1, transcriptionMs: 1, modelMs: 1, firstSoundMs: 1)))
        #expect(conversation.turns.map(\.outcome) == [.answered], "the answer still arrived")

        var approval = ApprovalState()
        approval.apply(.approvalRequest(ApprovalRequest(id: "a", summary: "Click Send", reason: "r")))
        approval.apply(settingsError)
        #expect(approval.pending != nil, "the question is still waiting for its answer")
        approval.apply(modelError)
        #expect(approval.pending == nil, "a real failure ends the turn")

        var pointing = PointingState()
        pointing.apply(.computerPoint(PointTarget(x: 1, y: 2, w: 3, h: 4, label: "here")))
        pointing.apply(settingsError)
        #expect(pointing.target != nil)
        pointing.apply(modelError)
        #expect(pointing.target == nil)
    }

    @Test func micStartingHasItsOwnNotice() {
        #expect(IslandStatus.noticeTitle("mic_starting") == "Microphone starting")
        #expect(IslandStatus.noticeDetail("mic_starting") == "Try again in a moment")
        #expect(IslandStatus.noticeTitle("something_else") == "Nothing sent")
    }

    @Test func aVocabularyFileWithWindowsLineEndingsIsReadLineByLine() {
        let parsed = DictationVocabulary.parse("# names\r\nAtom\r\nKeshab\r\n")
        #expect(parsed.entries.count == 2)
    }

    @Test func aModelIdWithATrailingNewlineIsNotValid() {
        #expect(ModelInfo.isValidModelId("gpt-4"))
        #expect(!ModelInfo.isValidModelId("gpt-4\n"))
        #expect(!ModelInfo.isValidModelId("gpt 4"))
    }
}
