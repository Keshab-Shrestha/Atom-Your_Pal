import Foundation
import Testing
@testable import AtomIslandCore

/// ADR-106: one turn, then idle. "Answer without keys" is off on a fresh install and its stored choice is honoured.
@Suite("Follow-up default")
@MainActor
struct FollowUpDefaultTests {
    @Test("a fresh install does not listen after a reply")
    func offByDefault() {
        let name = "atom.test.followup.\(UUID().uuidString)"
        defer { UserDefaults().removePersistentDomain(forName: name) }
        #expect(IslandSettings(defaults: UserDefaults(suiteName: name)!).followUpEnabled == false)
    }

    @Test("a stored choice of on is honoured")
    func storedOn() {
        let name = "atom.test.followup.\(UUID().uuidString)"
        defer { UserDefaults().removePersistentDomain(forName: name) }
        let defaults = UserDefaults(suiteName: name)!
        IslandSettings(defaults: defaults).followUpEnabled = true
        #expect(IslandSettings(defaults: defaults).followUpEnabled == true)
    }
}
