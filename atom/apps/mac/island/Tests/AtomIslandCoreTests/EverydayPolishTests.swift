import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Everyday polish: sleep and lock (ADR-076)")
struct SleepStateTests {
    /// `#expect` cannot call a mutating method itself.
    private func apply(_ s: inout SleepState, _ signal: SleepState.Signal) -> Bool { s.apply(signal) }

    @Test func sleepOrLockPausesAndBothMustClearToResume() {
        var s = SleepState()
        #expect(!s.paused)
        #expect(apply(&s, .screensSlept))
        #expect(s.paused)
        #expect(!apply(&s, .locked)) // already paused: no second pause
        #expect(!apply(&s, .screensWoke)) // still locked
        #expect(s.paused)
        #expect(apply(&s, .unlocked))
        #expect(!s.paused)
    }

    @Test func repeatedSignalsChangeNothing() {
        var s = SleepState()
        #expect(apply(&s, .locked))
        #expect(!apply(&s, .locked))
        #expect(!apply(&s, .screensWoke)) // a wake without a sleep
        #expect(apply(&s, .unlocked))
        #expect(!apply(&s, .unlocked))
    }
}

@Suite("Everyday polish: capabilities and plan usage events (ADR-076)")
struct EverydayProtocolTests {
    @Test func decodesCapabilities() throws {
        let event = try decodeEvent(#"{"type":"capabilities","items":[{"title":"Open apps and websites","examples":["Open Safari","Go to YouTube"]},{"title":"Timers","examples":["Set a timer for 5 minutes"]}]}"#)
        #expect(event == .capabilities([
            CapabilityItem(title: "Open apps and websites", examples: ["Open Safari", "Go to YouTube"]),
            CapabilityItem(title: "Timers", examples: ["Set a timer for 5 minutes"]),
        ]))
        #expect(event.name == "capabilities")
    }

    @Test func skipsMalformedCapabilityItemsInsteadOfFailing() throws {
        let event = try decodeEvent(#"{"type":"capabilities","items":[{"title":"Weather","examples":["Weather in Tokyo",3,""]},{"examples":["no title"]},{"title":"","examples":[]},"text",{"title":"No examples"},{"title":"Notes","examples":[]}]}"#)
        #expect(event == .capabilities([
            CapabilityItem(title: "Weather", examples: ["Weather in Tokyo"]),
            CapabilityItem(title: "Notes", examples: []),
        ]))
    }

    @Test func capabilitiesWithoutItemsIsAnError() {
        #expect(throws: ProtocolError.missingField(event: "capabilities", field: "items")) { try decodeEvent(#"{"type":"capabilities"}"#) }
        #expect(throws: ProtocolError.invalidValue(event: "capabilities", field: "items")) { try decodeEvent(#"{"type":"capabilities","items":{}}"#) }
    }

    @Test func firstExamplesTakeOnePerCapability() {
        let items = (1...6).map { CapabilityItem(title: "T\($0)", examples: ["a\($0)", "b\($0)"]) } + [CapabilityItem(title: "Empty", examples: [])]
        #expect(CapabilityItem.firstExamples(items) == ["a1", "a2", "a3", "a4"])
        #expect(CapabilityItem.firstExamples([]) == [])
    }

    @Test func decodesPlanUsageWithEveryFieldOptional() throws {
        #expect(try decodeEvent(#"{"type":"plan.usage","fiveHour":0.42,"sevenDay":0.12,"overage":false}"#)
            == .planUsage(PlanUsage(fiveHour: 0.42, sevenDay: 0.12, overage: false)))
        #expect(try decodeEvent(#"{"type":"plan.usage","sevenDay":1}"#) == .planUsage(PlanUsage(sevenDay: 1)))
        #expect(try decodeEvent(#"{"type":"plan.usage"}"#) == .planUsage(PlanUsage()))
        #expect(try decodeEvent(#"{"type":"plan.usage"}"#).name == "plan.usage")
    }

    @Test func ignoresUsageOutsideZeroToTwoOrNotANumber() throws {
        #expect(try decodeEvent(#"{"type":"plan.usage","fiveHour":2.5,"sevenDay":-0.1}"#) == .planUsage(PlanUsage()))
        #expect(try decodeEvent(#"{"type":"plan.usage","fiveHour":"0.4","sevenDay":true,"overage":"yes"}"#) == .planUsage(PlanUsage()))
        #expect(try decodeEvent(#"{"type":"plan.usage","fiveHour":2,"sevenDay":0}"#) == .planUsage(PlanUsage(fiveHour: 2, sevenDay: 0)))
    }

    @Test func aPartialReportKeepsTheOtherWindow() {
        let first = PlanUsage(fiveHour: 0.42, sevenDay: 0.12, overage: false)
        #expect(first.merging(PlanUsage(fiveHour: 0.5)) == PlanUsage(fiveHour: 0.5, sevenDay: 0.12, overage: false))
        #expect(PlanUsage().isEmpty)
        #expect(!PlanUsage(sevenDay: 0).isEmpty)
    }

    @Test func meterColourAndPercentage() {
        #expect(PlanUsage.level(0.79) == .normal)
        #expect(PlanUsage.level(0.8) == .attention)
        #expect(PlanUsage.level(0.949) == .attention)
        #expect(PlanUsage.level(0.95) == .problem)
        #expect(PlanUsage.level(1.6) == .problem)
        #expect(PlanUsage.percent(0.42) == 42)
        #expect(PlanUsage.percent(0.856) == 86)
        #expect(PlanUsage.percent(1.7) == 100) // shown held to 100%
    }
}

@Suite("Everyday polish: switch provider on a rate limit (ADR-076)")
struct RateLimitSwitchTests {
    static let info = #"{"type":"info","provider":"claude-plan","model":"claude-opus-5-5","providers":[{"id":"claude","name":"Claude","available":false,"models":[{"id":"claude-sonnet-5-5","name":"Claude Sonnet 5.5"}]},{"id":"claude-plan","name":"Claude (my plan)","available":true,"models":[{"id":"claude-opus-5-5","name":"Claude Opus 5.5"}]},{"id":"gemini","name":"Gemini","available":true,"models":[{"id":"gemini-3.8-flash","name":"Gemini 3.8 Flash"},{"id":"gemini-3.6-flash","name":"Gemini 3.6 Flash"}]}]}"#
    static let limit = #"{"type":"error","stage":"model","kind":"rate_limit","message":"Your Claude plan limit is reached. It resets at 3 pm.","retryable":true}"#

    @Test func offersTheOtherUsableProviderWithItsFirstModel() throws {
        var status = IslandStatus()
        status.apply(try decodeEvent(Self.info))
        status.apply(try decodeEvent(Self.limit))
        #expect(status.failure == PlainFailure(sentence: "Claude (my plan) has reached its limit for now.", button: "Switch to Gemini",
                                               action: .switchModel(provider: "gemini", model: "gemini-3.8-flash")))
        #expect(IslandCommand.modelSet(provider: "gemini", model: "gemini-3.8-flash").type == "model.set")
    }

    @Test func noCardWhenNoOtherProviderIsUsable() throws {
        var status = IslandStatus()
        status.apply(try decodeEvent(Self.info.replacingOccurrences(of: #""name":"Gemini","available":true"#, with: #""name":"Gemini","available":false"#)))
        status.apply(try decodeEvent(Self.limit))
        #expect(status.failure == nil)
        #expect(status.title == "Model limit reached")
    }

    @Test func onlyModelRateLimitsOfferASwitch() throws {
        var status = IslandStatus()
        status.apply(try decodeEvent(Self.info))
        status.apply(try decodeEvent(#"{"type":"error","stage":"model","kind":"timeout","message":"The model took too long."}"#))
        #expect(status.failure == nil)
    }

    @Test func theCardGoesOnceTheSwitchIsConfirmed() throws {
        var status = IslandStatus()
        status.apply(try decodeEvent(Self.info))
        status.apply(try decodeEvent(Self.limit))
        #expect(status.failure != nil)
        status.apply(try decodeEvent(Self.info.replacingOccurrences(of: #""provider":"claude-plan","model":"claude-opus-5-5""#,
                                                                    with: #""provider":"gemini","model":"gemini-3.8-flash""#)))
        #expect(status.failure == nil)
    }
}
