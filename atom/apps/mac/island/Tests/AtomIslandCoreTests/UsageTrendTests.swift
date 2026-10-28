import Foundation
import Testing
@testable import AtomIslandCore

/// 2026-10-15: the Dashboard's lead number says how today compares with a usual day.
@Suite("Usage trend")
struct UsageTrendTests {
    private func summary(today: Int, days: [Int]) -> TokenUsageSummary {
        TokenUsageSummary(
            today: TokenTotals(input: today, output: 0),
            week: TokenTotals(input: days.reduce(0, +)),
            days: days.enumerated().map { DayTokens(day: "2026-10-\(10 + $0.offset)", totals: TokenTotals(input: $0.element)) })
    }

    @Test func aboveBelowAndUsual() {
        // Six earlier days at 1000, 2000, 3000: the mean is 2000.
        let earlier = [1000, 2000, 3000]
        #expect(summary(today: 2500, days: earlier + [2500]).todayTrend == .above(percent: 25))
        #expect(summary(today: 1000, days: earlier + [1000]).todayTrend == .below(percent: 50))
        #expect(summary(today: 2050, days: earlier + [2050]).todayTrend == .usual, "within 5% is a usual day")
    }

    @Test func daysWithoutUseDoNotPullTheMeanDown() {
        #expect(summary(today: 1000, days: [0, 0, 1000, 0, 1000]).todayTrend == .usual)
    }

    @Test func noEarlierUseMeansNoTrend() {
        #expect(summary(today: 500, days: [0, 0, 0, 500]).todayTrend == nil)
        #expect(summary(today: 500, days: []).todayTrend == nil)
    }

    @Test func theWordsAreShort() {
        #expect(UsageTrend.above(percent: 12).text == "12% above a usual day so far")
        #expect(UsageTrend.below(percent: 40).text == "40% below a usual day so far")
        #expect(UsageTrend.usual.text == "about a usual day so far")
    }

    @Test func aRecentTurnNamesItsKind() {
        #expect(RecentTokens(kind: .turn, model: "m", input: 1, output: 1, cacheRead: 0, cacheWrite: 0).kindTitle == "This turn")
        #expect(RecentTokens(kind: .note, model: "m", input: 1, output: 1, cacheRead: 0, cacheWrite: 0).kindTitle == "Note")
    }

    @Test func theUsageTimeIsKeptWhenUsageArrives() throws {
        var state = HelpersState()
        #expect(state.usageUpdatedAt == nil)
        let line = #"{"type":"helpers","apps":[],"teamTasks":[],"helpers":[],"managers":[],"usage":{"today":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"dollars":0,"runs":1},"week":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"dollars":0,"runs":1},"days":[],"byWorker":[],"byModel":[]}}"#
        state.apply(try decodeEvent(line))
        #expect(state.usageUpdatedAt != nil && abs(state.usageUpdatedAt!.timeIntervalSinceNow) < 5)
    }
}
