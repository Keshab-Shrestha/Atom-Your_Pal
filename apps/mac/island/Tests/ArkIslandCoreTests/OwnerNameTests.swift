import Foundation
import Testing
@testable import ArkIslandCore

/// ADR-271: the owner's name, asked on first run, kept in the island settings and sent to the runtime.
@Suite("Owner name")
@MainActor
struct OwnerNameTests {
    private func withDefaults(_ body: (UserDefaults) -> Void) {
        let name = "ark.test.owner.\(UUID().uuidString)"
        defer { UserDefaults().removePersistentDomain(forName: name) }
        body(UserDefaults(suiteName: name)!)
    }

    @Test("a fresh install asks; a saved name is kept across launches and stops the question")
    func roundTrip() {
        withDefaults { defaults in
            let first = IslandSettings(defaults: defaults)
            #expect(first.ownerName == nil)
            #expect(OwnerName.needsAsking(saved: first.ownerName))
            first.ownerName = "  Sam \n Lee "
            #expect(first.ownerName == "Sam Lee")
            let next = IslandSettings(defaults: defaults)
            #expect(next.ownerName == "Sam Lee")
            #expect(!OwnerName.needsAsking(saved: next.ownerName))
            next.ownerName = "   "
            #expect(next.ownerName == nil, "an empty name is not stored")
            #expect(IslandSettings(defaults: defaults).ownerName == nil)
        }
    }

    @Test("the name in use: saved, else the Mac user's first name, else \"you\"")
    func fallbacks() {
        #expect(OwnerName.known(saved: "Sam Lee", fullUserName: "Ana Ito") == "Sam Lee")
        #expect(OwnerName.known(saved: nil, fullUserName: "Ana Ito") == "Ana")
        #expect(OwnerName.known(saved: nil, fullUserName: "") == nil)
        #expect(OwnerName.display(saved: nil, fullUserName: "") == "you")
        #expect(OwnerName.clean(String(repeating: "x", count: 80))?.count == OwnerName.maxLength)
    }

    @Test("owner.set carries the name")
    func command() {
        #expect(IslandCommand.ownerSet(name: "Sam").line == #"{"name":"Sam","type":"owner.set"}"# + "\n")
    }
}
