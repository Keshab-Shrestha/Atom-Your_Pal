import Foundation
import Testing
@testable import ArkIslandCore

/// ADR-255: ambient glass. Text on a translucent pane must read wherever the ambient light is, in every theme and mood.
@Suite("Ambient glass")
struct GlassThemeTests {
    /// What can sit under a pane: the bare base, or any light of any mood at its brightest.
    static func backgrounds(_ theme: AppTheme) -> [RGBA] {
        let base = AmbientScene.base(theme)
        let lights = AmbientMood.allCases.flatMap { AmbientScene.lights(theme, mood: $0) }.map { $0.color.over(base) }
        return [base] + lights
    }

    static func expectReadable(_ p: ThemePalette, on background: RGBA, _ label: String) {
        #expect(RGBA.contrast(p.text, background) >= 7, "\(label): main text \(RGBA.contrast(p.text, background))")
        #expect(RGBA.contrast(p.text2, background) >= 4.5, "\(label): secondary text \(RGBA.contrast(p.text2, background))")
        #expect(RGBA.contrast(p.text3, background) >= 4.5, "\(label): caption \(RGBA.contrast(p.text3, background))")
    }

    @Test(arguments: AppTheme.allCases)
    func textReadsOnEveryPaneOverEveryLight(theme: AppTheme) {
        let lanes = ThemeBuilder.glassLanes(theme)
        let p = lanes.palette
        for under in Self.backgrounds(theme) {
            for (name, pane) in [("panel", lanes.panel), ("work", lanes.work), ("workspace", lanes.workspace), ("card", lanes.card)] {
                let behind = pane.over(under)
                Self.expectReadable(p, on: behind, "\(theme.title) \(name)")
                Self.expectReadable(p, on: p.fill3.over(behind), "\(theme.title) \(name) on a selected row")
                Self.expectReadable(p, on: p.surface.over(behind), "\(theme.title) \(name) under a floating panel")
            }
            // A chat bubble holds text only: no rows are selected in it and no panel floats inside it.
            Self.expectReadable(p, on: lanes.bubble.over(under), "\(theme.title) bubble")
            Self.expectReadable(lanes.navigationPalette, on: lanes.rail.over(under), "\(theme.title) rail")
        }
    }

    @Test(arguments: AppTheme.allCases)
    func glassIsTranslucentAndItsMasksAreOpaque(theme: AppTheme) {
        let lanes = ThemeBuilder.glassLanes(theme)
        for pane in [lanes.rail, lanes.panel, lanes.work, lanes.workspace] { #expect(pane.a > 0.3 && pane.a < 0.8) }
        #expect(lanes.frame.a == 1, "the base under the light is opaque")
        #expect(lanes.palette.surfaceSolid.a == 1, "surfaceSolid hides what is under it, as in flat")
        #expect(lanes.palette.surfaceStyle == .glass)
    }

    @Test(arguments: AppTheme.allCases)
    func flatIsUnchanged(theme: AppTheme) {
        #expect(theme.palette(glass: false) == theme.palette)
        #expect(WorkspaceColors.for(theme, glass: false).work == WorkspaceColors.for(theme).work)
    }

    @Test func theMoodFollowsARKsState() {
        #expect(AmbientMood(status: .ready, agentsWorking: false, agentsWaiting: false) == .calm)
        #expect(AmbientMood(status: .ready, agentsWorking: true, agentsWaiting: false) == .active)
        #expect(AmbientMood(status: .thinking, agentsWorking: false, agentsWaiting: false) == .active)
        #expect(AmbientMood(status: .ready, agentsWorking: true, agentsWaiting: true) == .attention)
        #expect(AmbientMood(status: .asking, agentsWorking: false, agentsWaiting: false) == .attention)
        #expect(AmbientMood(status: .problem, agentsWorking: true, agentsWaiting: true) == .problem)
    }

    @Test func eachMoodHasItsOwnLightAndCalmHasOnlyTheTheme() {
        let calm = AmbientScene.lights(.void, mood: .calm)
        #expect(calm.count == 3)
        for mood in AmbientMood.allCases where mood != .calm {
            let lights = AmbientScene.lights(.void, mood: mood)
            #expect(lights[0] == calm[0] && lights[1] == calm[1], "the theme's two lights stay")
            #expect(lights[2] != calm[2], "\(mood) changes the third light")
        }
        #expect(AmbientScene.lights(.void, mood: .calm).allSatisfy { $0.color.a == AmbientScene.peakAlpha })
    }

    @Test func oklchRoundTrips() {
        let c = RGBA.oklch(0.6, 0.08, 200)
        let back = c.oklch
        #expect(abs(back.l - 0.6) < 0.002 && abs(back.c - 0.08) < 0.002 && abs(back.h - 200) < 0.5)
    }

    @MainActor @Test func glassIsTheDefaultAndReduceTransparencyDrawsFlat() {
        let name = "ark.tests.glass.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let s = IslandSettings(defaults: defaults)
        #expect(s.glass && s.glassShown)
        #expect(s.palette.surfaceStyle == .glass)
        s.reduceTransparency = true
        #expect(!s.glassShown && s.palette == s.theme.palette, "the system's Reduce Transparency wins")
        s.reduceTransparency = false
        s.glass = false
        #expect(IslandSettings(defaults: defaults).glass == false, "the choice is stored")
        #expect(s.lanes.work == WorkspaceColors.for(s.theme).work)
    }
}
