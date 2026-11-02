import Foundation
import Testing
@testable import ArkIslandCore

@Suite("Activity streak")
struct ActivityStreakTests {
    @Test func consecutiveDaysEndingTodayOrYesterday() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let today = Date(timeIntervalSince1970: 1_700_000_000)
        let day = { (n: Int) in calendar.date(byAdding: .day, value: -n, to: today)! }
        #expect(ActivityStreak.days([day(0), day(1), day(1), day(2), day(4)], today: today, calendar: calendar) == 3)
        #expect(ActivityStreak.days([day(1), day(2)], today: today, calendar: calendar) == 2, "today is not over yet")
        #expect(ActivityStreak.days([day(2)], today: today, calendar: calendar) == 0)
        #expect(ActivityStreak.days([], today: today, calendar: calendar) == 0)
    }
}
