import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Workspace pane")
struct WorkspacePaneTests {
    @Test func narrowWindowsAndSidebarChangesClampWithoutLosingPreference() {
        let narrow = WorkspacePaneLayout(available: 600, preferred: 520)
        #expect(!narrow.split); #expect(narrow.pane == 600)
        let desktop = WorkspacePaneLayout(available: 687, preferred: 520)
        #expect(desktop.split); #expect(desktop.pane == 338)
        #expect(687 - desktop.pane - WorkspacePaneLayout.divider >= WorkspacePaneLayout.minimumChat)
        let wide = WorkspacePaneLayout(available: 1100, preferred: 520)
        #expect(wide.split); #expect(wide.pane == 520)
        #expect(WorkspacePaneLayout(available: 649, preferred: 420).pane == 300)
        #expect(!WorkspacePaneLayout(available: 648, preferred: 420).split)
    }
    @Test func corruptWidthsNeverProduceNegativeOrNonfiniteGeometry() {
        #expect(WorkspacePaneLayout.preference(.infinity) == 420)
        #expect(WorkspacePaneLayout.preference(.nan) == 420)
        #expect(WorkspacePaneLayout.preference(-30) == 300)
        #expect(WorkspacePaneLayout.preference(2000) == 720)
        #expect(WorkspacePaneLayout(available: -10, preferred: .nan).pane == 0)
        #expect(WorkspacePaneLayout(available: .infinity, preferred: 400).pane == 0)
    }
    @MainActor @Test func settingsPersistOnlySupportedSurfaceAndBoundedWidth() {
        let name = "atom.tests.workspace.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let initial = IslandSettings(defaults: defaults)
        #expect(initial.workspaceSurface == "home"); #expect(initial.workspaceWidth == 420)
        initial.workspaceSurface = "git"; initial.workspaceWidth = 512
        let restored = IslandSettings(defaults: defaults)
        #expect(restored.workspaceSurface == "git"); #expect(restored.workspaceWidth == 512)
        restored.workspaceSurface = "terminal"
        #expect(IslandSettings(defaults: defaults).workspaceSurface == "terminal")
        defaults.set("unknown", forKey: IslandSettings.workspaceSurfaceKey)
        defaults.set(-100, forKey: IslandSettings.workspaceWidthKey)
        let invalid = IslandSettings(defaults: defaults)
        #expect(invalid.workspaceSurface == "home"); #expect(invalid.workspaceWidth == 300)
    }
}
