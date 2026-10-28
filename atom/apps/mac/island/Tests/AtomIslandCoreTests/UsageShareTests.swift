import Testing
@testable import AtomIslandCore

/// The share a token kind has of the seven-day total, as the Dashboard's Token mix shows it.
struct UsageShareTests {
    @Test func aShareBelowTenPercentKeepsOneDecimal() {
        #expect(TokenTotals.sharePercent(27_000, of: 1_700_000) == "1.6%")
        #expect(TokenTotals.sharePercent(1, of: 4) == "25%")
        #expect(TokenTotals.sharePercent(9, of: 100) == "9.0%")
    }

    @Test func aLargerShareIsAWholeNumber() {
        #expect(TokenTotals.sharePercent(290_000, of: 1_700_000) == "17%")
        #expect(TokenTotals.sharePercent(1_400_000, of: 1_700_000) == "82%")
        #expect(TokenTotals.sharePercent(5, of: 5) == "100%")
    }

    @Test func theEdgesRoundTheSameWayAtBothEnds() {
        #expect(TokenTotals.sharePercent(0, of: 100) == "0%")
        #expect(TokenTotals.sharePercent(5, of: 0) == "0%", "no total, no share")
        #expect(TokenTotals.sharePercent(1, of: 100_000) == "<0.1%", "a share that exists is never shown as zero")
        #expect(TokenTotals.sharePercent(996, of: 10_000) == "10%", "9.96 rounds up to a whole number, not to 10.0%")
        #expect(TokenTotals.sharePercent(-3, of: 10) == "0%")
    }
}
