import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Hide and show the window sidebar (ADR-128)")
@MainActor
struct SidebarVisibilityTests {
    private func fresh() -> (UserDefaults, String) {
        let name = "atom.test.\(UUID().uuidString)"
        return (UserDefaults(suiteName: name)!, name)
    }

    @Test func sidebarIsShownByDefault() {
        let (defaults, name) = fresh()
        defer { UserDefaults().removePersistentDomain(forName: name) }
        #expect(IslandSettings(defaults: defaults).sidebarHidden == false)
    }

    @Test func hiddenChoiceSurvivesARestart() {
        let (defaults, name) = fresh()
        defer { UserDefaults().removePersistentDomain(forName: name) }
        IslandSettings(defaults: defaults).sidebarHidden = true
        #expect(IslandSettings(defaults: defaults).sidebarHidden == true)
        let again = IslandSettings(defaults: defaults)
        again.sidebarHidden = false
        #expect(IslandSettings(defaults: defaults).sidebarHidden == false)
    }

    @Test func titleNamesTheNextAction() {
        #expect(WindowChrome.sidebarToggleTitle(hidden: false) == "Hide Sidebar")
        #expect(WindowChrome.sidebarToggleTitle(hidden: true) == "Show Sidebar")
    }

    @Test func tooltipCarriesTheShortcut() {
        #expect(WindowChrome.sidebarToggleHelp(hidden: false) == "Hide sidebar (⌥⌘H)")
        #expect(WindowChrome.sidebarToggleHelp(hidden: true) == "Show sidebar (⌥⌘H)")
    }
}
