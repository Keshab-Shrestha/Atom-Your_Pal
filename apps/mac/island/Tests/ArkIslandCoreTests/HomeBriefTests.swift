import Testing
@testable import ArkIslandCore

/// Home's greeting and fact (2026-11-02).
@Suite("Home brief")
struct HomeBriefTests {
    @Test func greetingByTheHour() {
        #expect(HomeBrief.greeting(hour: 8, name: "Keshab Shrestha") == "Good morning, Keshab.")
        #expect(HomeBrief.greeting(hour: 14, name: "Keshab") == "Good afternoon, Keshab.")
        #expect(HomeBrief.greeting(hour: 21, name: "") == "Good evening.")
        #expect(HomeBrief.greeting(hour: 2, name: "Ana") == "Good evening, Ana.")
    }

    @Test func whatWaitsComesFirst() {
        #expect(HomeBrief.fact(needsYou: 3, working: 2, tokensToday: 900) == "3 things need you, and 2 agents are at work.")
        #expect(HomeBrief.fact(needsYou: 1, working: 0, tokensToday: 0) == "1 thing needs you.")
        #expect(HomeBrief.fact(needsYou: 0, working: 1, tokensToday: 0) == "1 agent is at work. Nothing needs you.")
        #expect(HomeBrief.fact(needsYou: 0, working: 0, tokensToday: 12_400).hasPrefix("All quiet: "))
        #expect(HomeBrief.fact(needsYou: 0, working: 0, tokensToday: 0) == "All quiet. Ask ARK anything.")
    }
}
