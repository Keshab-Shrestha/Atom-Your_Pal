import Foundation
import Testing
@testable import ArkIslandCore

/// ADR-277: the translucent window. Text must read over the panes whatever the desktop is, the strength must set how much
/// shows through, and the system's accessibility settings must keep the window opaque.
@Suite("Translucent window")
struct WindowTranslucencyTests {
    @Test(arguments: AppTheme.allCases)
    func textReadsAtHighStrengthOverAWhiteAndABlackDesktop(theme: AppTheme) {
        let lanes = WindowTranslucency.lanes(theme, strength: .high)
        let tint = WindowTranslucency.tint(theme, strength: .high)
        let p = lanes.palette
        for desktop in WindowTranslucency.extremeBackdrops {
            let under = tint.over(desktop)
            let panes = [("panel", lanes.panel, p), ("work", lanes.work, p), ("workspace", lanes.workspace, p),
                         ("card", lanes.card, p), ("bubble", lanes.bubble, p), ("rail", lanes.rail, lanes.navigationPalette)]
            for (name, pane, palette) in panes {
                let behind = pane.over(under)
                let main = RGBA.contrast(palette.text, behind), secondary = RGBA.contrast(palette.text2, behind)
                #expect(main >= 4.5, "\(theme.title) \(name) over \(desktop): main text \(main)")
                #expect(secondary >= 3, "\(theme.title) \(name) over \(desktop): secondary text \(secondary)")
            }
        }
    }

    @Test(arguments: AppTheme.allCases)
    func moreStrengthShowsMoreOfTheDesktop(theme: AppTheme) {
        let (low, medium, high) = (WindowTranslucency.lanes(theme, strength: .low), WindowTranslucency.lanes(theme, strength: .medium),
                                   WindowTranslucency.lanes(theme, strength: .high))
        for pane in [\WorkspaceColors.rail, \.panel, \.work, \.workspace, \.card, \.bubble] {
            #expect(low[keyPath: pane].a >= medium[keyPath: pane].a && medium[keyPath: pane].a >= high[keyPath: pane].a)
            #expect(high[keyPath: pane].a < 1, "\(theme.title): a pane is never fully opaque")
        }
        #expect(WindowTranslucency.tint(theme, strength: .low).a > WindowTranslucency.tint(theme, strength: .high).a)
        #expect(high.panel.a <= high.work.a, "\(theme.title): the sidebar is more see-through than the work pane")
        #expect(high.frame.a == 1, "the frame stays opaque, so surfaceSolid and masks stay opaque")
    }

    @Test func theTableIsTheFloorWhereContrastAllows() {
        // Void is the default theme: at medium strength its panes keep the table's values, so the strength is real.
        let lanes = WindowTranslucency.lanes(.void, strength: .medium)
        #expect(abs(lanes.work.a - WindowTranslucency.work.medium) < 0.001)
        #expect(abs(lanes.card.a - WindowTranslucency.card.medium) < 0.001)
    }

    @Test func eachThemePicksAMaterialForItsLightness() {
        #expect(WindowTranslucency.material(dark: true) == .hudWindow)
        #expect(WindowTranslucency.material(dark: false) == .sidebar)
    }

    @MainActor @Test func offByDefaultStoredAndOpaqueForAccessibility() {
        let name = "ark.tests.translucent.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let s = IslandSettings(defaults: defaults)
        #expect(!s.translucentWindow && !s.translucentShown && s.translucencyStrength == .medium)
        let opaque = s.lanes.work
        s.translucentWindow = true
        s.translucencyStrength = .high
        #expect(s.translucentShown && s.lanes.work == WindowTranslucency.lanes(s.theme, strength: .high).work)
        let reloaded = IslandSettings(defaults: defaults)
        #expect(reloaded.translucentWindow && reloaded.translucencyStrength == .high, "both choices are stored")

        #expect(s.translucentAvailable, "the switch works")
        s.reduceTransparency = true
        #expect(!s.translucentAvailable, "the switch is off when the system asks for less transparency")
        #expect(!s.translucentShown && s.lanes.work == WorkspaceColors.for(s.theme).work, "Reduce Transparency: flat and opaque")
        s.reduceTransparency = false
        s.increaseContrast = true
        #expect(!s.translucentShown && s.lanes.work == opaque, "Increase Contrast: glass over ARK's own light, as with the setting off")
        s.increaseContrast = false
        s.glass = false
        #expect(!s.translucentShown, "the translucent window is a kind of glass")
    }
}
