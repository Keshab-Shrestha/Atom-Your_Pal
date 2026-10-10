import Foundation
import Testing
@testable import ZenoIslandCore

@Suite struct ThemeTests {
    /// Text must stay readable in every theme: WCAG AA (4.5:1) for body and caption text and for labels on the
    /// accent and attention buttons, measured on the theme's solid surface.
    @Test(arguments: AppTheme.allCases)
    func textMeetsContrast(theme: AppTheme) {
        let p = theme.palette
        let bg = p.surfaceSolid
        func on(_ c: RGBA, _ b: RGBA) -> Double { RGBA.contrast(c.over(b), b) }
        #expect(on(p.text, bg) >= 7, "primary text")
        #expect(on(p.text2, bg) >= 4.5, "secondary text")
        #expect(on(p.text3, bg) >= 4.5, "captions")
        #expect(RGBA.contrast(p.onAccent, p.accent) >= 4.5, "label on accent")
        #expect(RGBA.contrast(p.onAccent, p.accentEnd) >= 4.5, "label on accent gradient end")
        #expect(RGBA.contrast(p.onAttention, p.attention) >= 4.5, "label on Allow")
        let userBubble = p.userBubble.over(bg)
        #expect(on(p.onUserBubble, userBubble) >= 4.5, "your message")
        // Coloured text on the surface: status lines, problems.
        #expect(on(p.problem, bg) >= 4.5, "problem text")
        #expect(on(p.success, bg) >= 4.5, "success text")
        #expect(on(p.attention, bg) >= 3, "attention icon")
    }

    @Test func darkAndLightThemes() {
        #expect(AppTheme.native.palette.isDark)
        #expect(AppTheme.luminous.palette.isDark)
        #expect(!AppTheme.warm.palette.isDark)
        #expect(AppTheme.luminous.palette.accentIsGradient)
        #expect(!AppTheme.native.palette.accentIsGradient)
    }

    @Test func cornerRadiiAreConcentric() {
        for theme in AppTheme.allCases {
            let p = theme.palette
            #expect(p.radiusSurface > p.radiusCard && p.radiusCard > p.radiusControl)
        }
    }

    @Test func hexAndContrastMath() {
        let teal = RGBA(hex: 0x5BD6E8)
        #expect(abs(teal.r - 91.0 / 255) < 1e-9)
        #expect(abs(RGBA.contrast(RGBA(0, 0, 0), RGBA(1, 1, 1)) - 21) < 0.01)
        #expect(RGBA.white(0.5).over(RGBA(0, 0, 0)) == RGBA(0.5, 0.5, 0.5, 1))
    }

    @MainActor @Test func themeAndWispStyleAreSavedAndReset() {
        let suite = "zeno.test.theme.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        let settings = IslandSettings(defaults: defaults)
        #expect(settings.theme == .native)
        #expect(settings.wispStyle == .orb)
        settings.theme = .warm
        settings.wispStyle = .companion
        let reloaded = IslandSettings(defaults: defaults)
        #expect(reloaded.theme == .warm)
        #expect(reloaded.wispStyle == .companion)
        reloaded.resetAppearance()
        #expect(reloaded.theme == .native)
        #expect(reloaded.wispStyle == .orb)
    }

    @MainActor @Test func unknownStoredValuesFallBack() {
        let suite = "zeno.test.theme.bad.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(99, forKey: "zeno.look.theme")
        defaults.set(-4, forKey: "zeno.wisp.style")
        let settings = IslandSettings(defaults: defaults)
        #expect(settings.theme == .native)
        #expect(settings.wispStyle == .orb)
    }
}
