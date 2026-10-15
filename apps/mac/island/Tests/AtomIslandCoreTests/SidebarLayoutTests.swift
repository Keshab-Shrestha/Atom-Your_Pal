import Foundation
import Testing
@testable import AtomIslandCore

/// 2026-10-15: Keshab drags the sidebar's pages into any order, and between the top and the bottom group.
@Suite("Sidebar layout")
struct SidebarLayoutTests {
    @Test func startsInTheStandardOrder() {
        let layout = SidebarLayout.standard
        #expect(layout.top == [.dashboard, .inbox, .issues, .board, .scheduled, .brain])
        #expect(layout.bottom == [.plugins, .settings])
    }

    @Test func aPageMovesBeforeAnotherInTheSameGroup() {
        var layout = SidebarLayout.standard
        layout.move(.board, onto: .inbox)
        #expect(layout.top == [.dashboard, .board, .inbox, .issues, .scheduled, .brain])
        layout.move(.settings, onto: .plugins)
        #expect(layout.bottom == [.settings, .plugins])
    }

    @Test func aPageDraggedDownPassesTheOneBelowIt() {
        var layout = SidebarLayout.standard
        layout.move(.dashboard, onto: .inbox)
        #expect(layout.top == [.inbox, .dashboard, .issues, .board, .scheduled, .brain])
        layout.move(.dashboard, onto: .brain) // down to the last place of the group
        #expect(layout.top.last == .dashboard)
    }

    @Test func theMenuMovesAPageOnePlaceInsideItsGroup() {
        var layout = SidebarLayout.standard
        layout.shift(.issues, by: -1)
        #expect(layout.top.prefix(3) == [.dashboard, .issues, .inbox])
        layout.shift(.dashboard, by: -1) // already first: nothing happens
        layout.shift(.settings, by: 1) // already last: nothing happens
        #expect(layout.top.first == .dashboard && layout.bottom == [.plugins, .settings])
        layout.shift(.plugins, by: 1)
        #expect(layout.bottom == [.settings, .plugins])
    }

    @Test func aPageMovesToTheBottomGroupBesideSettingsAndPlugins() {
        var layout = SidebarLayout.standard
        layout.move(.scheduled, onto: .settings) // dropped on a row of the bottom group
        #expect(layout.bottom == [.plugins, .scheduled, .settings] && !layout.top.contains(.scheduled))
        layout.move(.brain, before: nil, toBottom: true) // dropped at the end of the bottom group
        #expect(layout.bottom.last == .brain)
        layout.move(.plugins, before: .dashboard, toBottom: false) // back to the top, in first place
        #expect(layout.top.first == .plugins && !layout.bottom.contains(.plugins))
    }

    @Test func everyPageIsInExactlyOneGroupAfterAnyMoves() {
        var layout = SidebarLayout.standard
        let items = SidebarItem.allCases
        for step in 0..<200 {
            let item = items[step % items.count], target = items[(step * 3 + 1) % items.count]
            if step % 3 == 0 { layout.move(item, onto: target) } else { layout.move(item, before: step % 5 == 0 ? nil : target, toBottom: step % 2 == 0) }
            #expect(Set(layout.top + layout.bottom) == Set(items) && layout.top.count + layout.bottom.count == items.count)
        }
    }

    @Test func aPageDroppedOnItselfStaysWhereItIs() {
        var layout = SidebarLayout.standard
        layout.move(.issues, onto: .issues)
        layout.move(.issues, before: .issues, toBottom: false)
        #expect(layout == .standard)
    }

    @Test func storageRoundTripsAndBadStorageGivesAValidLayout() {
        var layout = SidebarLayout.standard
        layout.move(.scheduled, onto: .plugins)
        layout.move(.board, onto: .dashboard)
        #expect(SidebarLayout(storage: layout.storage) == layout)
        #expect(SidebarLayout(storage: nil) == .standard)
        #expect(SidebarLayout(storage: "") == .standard)
        #expect(SidebarLayout(storage: "garbage|more,garbage") == .standard)
        // A page named twice keeps its first place; a page left out comes back to its standard group.
        let odd = SidebarLayout(storage: "inbox,inbox,dashboard|settings")
        #expect(odd.top.prefix(2) == [.inbox, .dashboard] && odd.bottom.first == .settings)
        #expect(Set(odd.top + odd.bottom) == Set(SidebarItem.allCases) && odd.top.count + odd.bottom.count == SidebarItem.allCases.count)
        #expect(odd.bottom.contains(.plugins) && odd.top.contains(.brain))
    }

    @MainActor @Test func theSettingKeepsTheLayoutAcrossRestarts() {
        let suite = "atom.test.sidebar.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let first = IslandSettings(defaults: defaults)
        #expect(first.sidebar == .standard)
        first.sidebar.move(.scheduled, onto: .settings)
        let second = IslandSettings(defaults: defaults)
        #expect(second.sidebar.bottom == [.plugins, .scheduled, .settings])
        defaults.removePersistentDomain(forName: suite)
    }
}
