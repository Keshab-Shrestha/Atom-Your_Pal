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
        #expect(AppTheme.lantern.palette.isDark)
        #expect(!AppTheme.lanternDay.palette.isDark)
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
        #expect(settings.theme == .lantern)
        #expect(settings.wispStyle == .orb)
        settings.theme = .warm
        settings.wispStyle = .companion
        let reloaded = IslandSettings(defaults: defaults)
        #expect(reloaded.theme == .warm)
        #expect(reloaded.wispStyle == .companion)
        reloaded.resetAppearance()
        #expect(reloaded.theme == .lantern)
        #expect(reloaded.wispStyle == .orb)
    }

    @MainActor @Test func unknownStoredValuesFallBack() {
        let suite = "zeno.test.theme.bad.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(99, forKey: "zeno.look.theme")
        defaults.set(-4, forKey: "zeno.wisp.style")
        let settings = IslandSettings(defaults: defaults)
        #expect(settings.theme == .lantern)
        #expect(settings.wispStyle == .orb)
    }

    /// Lantern (ADR-084): one hue. Accent, live sound, success and the glow are all Wisp's light; only attention
    /// and problems differ. Lantern Day keeps the glow but draws text and controls in a deeper blue for contrast.
    @Test func lanternHasOneLight() {
        let night = ThemePalette.lantern, day = ThemePalette.lanternDay
        let light = RGBA(hex: 0x8FD3FF)
        #expect(night.accent == light && night.live == light && night.success == light && night.glow == light)
        #expect(!night.accentIsGradient && !day.accentIsGradient)
        #expect(day.glow.with(alpha: 1) == light && day.accent == RGBA(hex: 0x1F6FA8))
        for p in [night, day] {
            #expect(p.attention != p.accent && p.problem != p.accent && p.attention != p.problem)
            #expect(p.surfaceTop != nil && p.glow.a > 0)
            // The light as text (Change model, links) on the panel.
            #expect(RGBA.contrast(p.accent, p.surfaceSolid) >= 4.5, "light as text")
            #expect(RGBA.contrast(p.attention, p.surfaceSolid) >= 4.5, "amber as text (meter at 86%)")
        }
        #expect(ThemePalette.warm.glow.a == 0, "Warm keeps its paper look: no glow")
    }

    /// ADR-084: Lantern is the default for new installs and, once, for anyone still on the old default.
    @MainActor @Test func lanternBecomesTheDefaultOnce() {
        func fresh(_ setup: (UserDefaults) -> Void) -> (IslandSettings, UserDefaults, String) {
            let suite = "zeno.test.theme.move.\(UUID().uuidString)"
            let defaults = UserDefaults(suiteName: suite)!
            setup(defaults)
            return (IslandSettings(defaults: defaults), defaults, suite)
        }
        // A new install.
        let (new, d1, s1) = fresh { _ in }
        defer { d1.removePersistentDomain(forName: s1) }
        #expect(new.theme == .lantern)

        // Quiet Native stored before Lantern existed (picked, or the old default after a reset): moved once.
        let (old, d2, s2) = fresh { $0.set(AppTheme.native.rawValue, forKey: IslandSettings.themeKey) }
        defer { d2.removePersistentDomain(forName: s2) }
        #expect(old.theme == .lantern)
        #expect(IslandSettings(defaults: d2).theme == .lantern, "the move is saved")
        // Choosing Quiet Native again after the move sticks.
        old.theme = .native
        #expect(IslandSettings(defaults: d2).theme == .native)

        // Any other stored choice is kept.
        let (warm, d3, s3) = fresh { $0.set(AppTheme.warm.rawValue, forKey: IslandSettings.themeKey) }
        defer { d3.removePersistentDomain(forName: s3) }
        #expect(warm.theme == .warm)
    }
}
