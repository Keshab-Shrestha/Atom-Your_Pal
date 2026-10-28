import Foundation
import Testing
@testable import AtomIslandCore

/// What the chat Details surface and the header's context figure say, from the saved chat's inspection (the HTML preview's
/// Details pane: context, memory used, access).
struct ChatDetailsFactsTests {
    private func info(messages: Int = 12, replay: Int = 1_000, budget: Int = 120_000, omitted: Int = 0,
                      access: String = #", "access": {"provider":"claude-plan","hostTools":true,"project":true,"fileGrants":2,"computer":false,"web":false}"#) throws -> ChatControlResponse.Info {
        let json = #"{"messages":\#(messages),"archiveBytes":9000,"replayBytes":\#(replay),"replayBudget":\#(budget),"omitted":\#(omitted)\#(access)}"#
        return try JSONDecoder().decode(ChatControlResponse.Info.self, from: Data(json.utf8))
    }

    @Test func contextIsTheReplayShareOfItsBudget() throws {
        let facts = ChatDetailsFacts(info: try info(replay: 30_000, budget: 120_000))
        #expect(facts.contextFraction == 0.25 && facts.percentText == "25%")
        #expect(facts.contextText == "30.0 KB of 120.0 KB")
        #expect(facts.messagesText == "12 messages saved")
    }

    @Test func aTinyShareIsNeverShownAsZero() throws {
        #expect(ChatDetailsFacts(info: try info(replay: 100, budget: 120_000)).percentText == "<1%")
        #expect(ChatDetailsFacts(info: try info(replay: 1_000, budget: 120_000)).percentText == "1%")
        #expect(ChatDetailsFacts(info: try info(replay: 0, budget: 120_000)).percentText == "0%")
    }

    @Test func theFractionStaysBetweenZeroAndOne() throws {
        #expect(ChatDetailsFacts(info: try info(replay: 500_000, budget: 120_000)).contextFraction == 1)
        #expect(ChatDetailsFacts(info: try info(replay: 10, budget: 0)).contextFraction == 1, "no budget: full, not a division by zero")
        #expect(ChatDetailsFacts(info: try info(replay: -5, budget: 100)).contextFraction == 0)
    }

    @Test func oneMessageReadsInTheSingular() throws {
        #expect(ChatDetailsFacts(info: try info(messages: 1)).messagesText == "1 message saved")
    }

    @Test func omittedMessagesAreNamedOnlyWhenThereAreSome() throws {
        #expect(ChatDetailsFacts(info: try info(omitted: 0)).omittedText == nil)
        #expect(ChatDetailsFacts(info: try info(omitted: 4)).omittedText == "4 earlier messages left out of the replay. The archive stays intact.")
        #expect(ChatDetailsFacts(info: try info(omitted: 1)).omittedText == "1 earlier message left out of the replay. The archive stays intact.")
    }

    @Test func accessListsWhatThisChatMayUse() throws {
        let rows = ChatDetailsFacts(info: try info()).accessRows
        #expect(rows.map(\.title) == ["ATOM tools", "Project files", "File permissions", "Computer control", "Web"])
        #expect(rows.map(\.value) == ["On", "On", "2 for this chat", "Off", "Off"])
        #expect(ChatDetailsFacts(info: try info(access: "")).accessRows.isEmpty, "no access data, no rows")
        let none = #", "access": {"provider":"p","hostTools":false,"project":false,"fileGrants":0,"computer":true,"web":true}"#
        #expect(ChatDetailsFacts(info: try info(access: none)).accessRows.map(\.value) == ["Off", "Off", "None", "On", "On"])
    }
}
