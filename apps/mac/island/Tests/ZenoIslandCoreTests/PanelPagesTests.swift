import Testing
@testable import ZenoIslandCore

/// ADR-084 (Task 4.4): the Status tab is gone, so Settings home must carry every page and every Status fact.
@Suite struct PanelPagesTests {
    @Test func twoWordTabs() {
        #expect(PanelTab.allCases == [.conversation, .settings])
        #expect(PanelTab.allCases.map(\.rawValue) == ["Conversation", "Settings"])
    }

    /// Every Settings page opens from home exactly once: AI model from "Change model", the rest from rows.
    @Test func everySettingsPageIsReachableFromHome() {
        let reachable = SettingsHome.reachable
        #expect(Set(reachable) == Set(SettingsPage.allCases))
        #expect(reachable.count == SettingsPage.allCases.count)
        #expect(SettingsHome.changeModel == .model)
        #expect(!SettingsHome.groups.joined().contains(.model))
        #expect(SettingsHome.groups.allSatisfy { !$0.isEmpty })
    }

    /// Rows use monochrome outline glyphs, never the old filled, coloured tiles.
    @Test func pageGlyphsAreOutlines() {
        #expect(SettingsPage.allCases.allSatisfy { !$0.symbol.isEmpty && !$0.symbol.hasSuffix(".fill") })
    }

    /// Everything the Status tab showed is in the now card: model, provider, microphone, voice, each stage of the last
    /// turn, and the last problem.
    @Test func nowCardCarriesEveryStatusFact() throws {
        var status = IslandStatus()
        status.apply(try decodeEvent(#"{"type":"ready","protocol":1,"provider":"claude-plan","model":"claude-opus-5-5","microphone":"Mac mini Microphone","voice":true}"#))
        let info = ModelInfo(provider: "claude-plan", model: "claude-opus-5-5", providers: [
            ProviderOption(id: "claude-plan", name: "Claude (my plan)", available: true, models: [ModelOption(id: "claude-opus-5-5", name: "Claude Opus 5.5")]),
        ])
        status.apply(.info(info))
        status.apply(try decodeEvent(#"{"type":"turn.complete","speechMs":2400,"transcriptionMs":610,"modelMs":1840,"firstSoundMs":2710}"#))
        status.apply(try decodeEvent(#"{"type":"error","stage":"model","kind":"network","message":"Could not reach Claude. Check the connection.","retryable":true}"#))
        let facts = NowFacts(status: status, info: info, usage: PlanUsage(fiveHour: 0.42, sevenDay: 0.86))

        #expect(facts.provider == "Claude (my plan)")
        #expect(facts.model == "Claude Opus 5.5")
        #expect(facts.microphone == "Mac mini Microphone")
        #expect(facts.voice == "Voice ready" && facts.voiceLoaded)
        #expect(facts.lastTurn == "2.7 s to first sound")
        #expect(facts.timings.map(\.title) == ["You spoke", "Transcribing", "AI reply", "First sound"])
        #expect(facts.timings.map(\.value) == ["2.4 s", "0.6 s", "1.8 s", "2.7 s"])
        #expect(facts.problem?.message == "Could not reach Claude. Check the connection.")
        #expect(facts.usage?.fiveHour == 0.42 && facts.usage?.sevenDay == 0.86)
    }

    /// Before anything arrives: honest blanks, no invented numbers.
    @Test func nowCardBeforeTheFirstTurn() {
        let facts = NowFacts(status: IslandStatus(), info: nil, usage: PlanUsage())
        #expect(facts.model == "—")
        #expect(facts.microphone == "No microphone")
        #expect(facts.voice == "Voice not loaded" && !facts.voiceLoaded)
        #expect(facts.lastTurn == nil && facts.timings.isEmpty)
        #expect(facts.problem == nil)
        #expect(facts.usage == nil) // an empty report shows no meters
    }

    /// A turn without a first-sound time (typed, or the voice off) reports the AI's time instead.
    @Test func lastTurnWithoutFirstSound() throws {
        var status = IslandStatus()
        status.apply(try decodeEvent(#"{"type":"turn.complete","speechMs":0,"transcriptionMs":0,"modelMs":1260}"#))
        let facts = NowFacts(status: status, info: nil, usage: nil)
        #expect(facts.lastTurn == "AI reply in 1.3 s")
        #expect(facts.timings.map(\.title) == ["You spoke", "Transcribing", "AI reply"])
        #expect(NowFacts.summary(TurnTimings(speechMs: 1, transcriptionMs: 600, modelMs: 1800, firstSoundMs: nil, requestId: nil)) == "heard 0.6 s · AI 1.8 s")
    }
}
