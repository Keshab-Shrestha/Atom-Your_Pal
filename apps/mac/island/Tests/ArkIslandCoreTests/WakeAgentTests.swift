import Foundation
import Testing
@testable import ArkIslandCore

@Suite("Wake agent")
struct WakeAgentTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    @Test("wakes a minute before the earliest future routine; none ahead means no wake")
    func nextWake() {
        let times = [now.addingTimeInterval(-500), now.addingTimeInterval(7200), now.addingTimeInterval(3600)]
        #expect(WakeAgent.nextWake(routineTimes: times, now: now) == now.addingTimeInterval(3540))
        #expect(WakeAgent.nextWake(routineTimes: [now.addingTimeInterval(-5)], now: now) == nil)
        #expect(WakeAgent.nextWake(routineTimes: [], now: now) == nil)
    }

    @Test("a routine less than a minute away wakes at its own time")
    func soon() {
        #expect(WakeAgent.nextWake(routineTimes: [now.addingTimeInterval(30)], now: now) == now.addingTimeInterval(30))
    }

    @Test("the agent file opens the app once at that minute, never at load, and escapes the path")
    func plist() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let at = Date(timeIntervalSince1970: 1_800_000_000) // 2027-01-15 08:00 UTC
        let text = WakeAgent.plist(appPath: "/Applications/A&B <ARK>.app", at: at, calendar: calendar)
        #expect(text.contains("<key>Label</key><string>dev.ark.wake</string>"))
        #expect(text.contains("<string>/Applications/A&amp;B &lt;ARK&gt;.app</string>"))
        #expect(text.contains("<key>Month</key><integer>1</integer>"))
        #expect(text.contains("<key>Day</key><integer>15</integer>"))
        #expect(text.contains("<key>Hour</key><integer>8</integer>"))
        #expect(text.contains("<key>Minute</key><integer>0</integer>"))
        #expect(text.contains("<key>RunAtLoad</key><false/>"))
        #expect(text.contains("<string>-g</string>"))
    }

    @Test("the agent lives in the user's LaunchAgents folder")
    func location() {
        #expect(WakeAgent.agentURL(home: URL(fileURLWithPath: "/Users/me")).path == "/Users/me/Library/LaunchAgents/dev.ark.wake.plist")
    }
}
