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
        #expect(AppTheme.void.palette.isDark)
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

    @MainActor @Test func themeIsSavedAndReset() {
        let suite = "zeno.test.theme.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        let settings = IslandSettings(defaults: defaults)
        #expect(settings.theme == .void)
        settings.theme = .warm
        let reloaded = IslandSettings(defaults: defaults)
        #expect(reloaded.theme == .warm)
        reloaded.resetAppearance()
        #expect(reloaded.theme == .void)
    }

    @MainActor @Test func unknownStoredValuesFallBack() {
        let suite = "zeno.test.theme.bad.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(99, forKey: "zeno.look.theme")
        let settings = IslandSettings(defaults: defaults)
        #expect(settings.theme == .void)
    }

    /// Lantern (ADR-084): one hue. Accent, live sound, success and the glow are all Pal's light; only attention
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

    /// ADR-084, then ADR-086: anyone still on an old default (Quiet Native, then Lantern) moves on once.
    @MainActor @Test func oldDefaultsMoveOnOnce() {
        func fresh(_ setup: (UserDefaults) -> Void) -> (IslandSettings, UserDefaults, String) {
            let suite = "zeno.test.theme.move.\(UUID().uuidString)"
            let defaults = UserDefaults(suiteName: suite)!
            setup(defaults)
            return (IslandSettings(defaults: defaults), defaults, suite)
        }
        // A new install.
        let (new, d1, s1) = fresh { _ in }
        defer { d1.removePersistentDomain(forName: s1) }
        #expect(new.theme == .void)

        // Quiet Native stored before Lantern existed (picked, or the old default after a reset): through Lantern to Void.
        let (old, d2, s2) = fresh { $0.set(AppTheme.native.rawValue, forKey: IslandSettings.themeKey) }
        defer { d2.removePersistentDomain(forName: s2) }
        #expect(old.theme == .void)
        #expect(IslandSettings(defaults: d2).theme == .void, "the move is saved")
        // Choosing Quiet Native again after the move sticks.
        old.theme = .native
        #expect(IslandSettings(defaults: d2).theme == .native)

        // Lantern stored by the ADR-084 move (or a reset, or a pick: they look the same) moves to Void once.
        let (lit, d4, s4) = fresh {
            $0.set(true, forKey: IslandSettings.lanternMoveKey)
            $0.set(AppTheme.lantern.rawValue, forKey: IslandSettings.themeKey)
        }
        defer { d4.removePersistentDomain(forName: s4) }
        #expect(lit.theme == .void)
        // Picking Lantern after the move sticks, and so does Lantern Day.
        lit.theme = .lantern
        #expect(IslandSettings(defaults: d4).theme == .lantern)
        let (day, d5, s5) = fresh { $0.set(AppTheme.lanternDay.rawValue, forKey: IslandSettings.themeKey) }
        defer { d5.removePersistentDomain(forName: s5) }
        #expect(day.theme == .lanternDay)

        // Any other stored choice is kept.
        let (warm, d3, s3) = fresh { $0.set(AppTheme.warm.rawValue, forKey: IslandSettings.themeKey) }
        defer { d3.removePersistentDomain(forName: s3) }
        #expect(warm.theme == .warm)
    }

    /// Void (ADR-086): the reference's colours and radii, and every glow, shadow and fill turned off. Older themes keep
    /// glass, filled buttons, glows and shadows.
    @Test func voidIsFlatBlackWithHairlines() {
        let p = ThemePalette.void
        #expect(p.surfaceSolid == RGBA(hex: 0x000000) && p.surface == p.surfaceSolid)
        #expect(p.border == RGBA(hex: 0x292D30) && p.separator == p.border && p.rim == p.border)
        #expect(p.text == RGBA(hex: 0xF0F0F0) && p.text2 == RGBA(hex: 0xA1A4A5))
        #expect((p.radiusSurface, p.radiusCard, p.radiusControl) == (24, 16, 6))
        // A control in the panel's corner: 16 at an 8 pt gap, concentric with the panel's 24.
        #expect(p.radiusSurface - p.cornerGap == 16)
        #expect(p.surfaceStyle == .flat && p.buttonStyle == .ghost)
        #expect(!p.usesGlow && !p.usesShadows && p.glow.a == 0 && p.surfaceTop == nil)
        #expect(p.monoIdentifiers && p.statusDots)
        #expect(p.fill1.a == 0, "cards are not coloured")
        // Status colours, and violet only for identifiers and thinking.
        #expect(p.live == RGBA(hex: 0x70B8FF) && p.success == RGBA(hex: 0x3AD389) && p.attention == RGBA(hex: 0xFFCA16))
        #expect(p.problem == RGBA(hex: 0xFF9592) && p.identifier == RGBA(hex: 0xBAA7FF))
        // Identifiers, status labels and the brightened hairline read on black.
        func on(_ c: RGBA) -> Double { RGBA.contrast(c, p.surfaceSolid) }
        #expect(on(p.identifier!) >= 4.5, "violet identifiers")
        #expect(on(p.live) >= 4.5 && on(p.attention) >= 4.5 && on(p.accent) >= 7)
        #expect(on(p.borderHover) > on(p.border), "hover brightens the hairline")
        #expect(!AppTheme.allCases.filter { $0 != .void }.contains { t in
            let q = t.palette
            return q.surfaceStyle != .glass || q.buttonStyle != .filled || !q.usesGlow || !q.usesShadows || q.monoIdentifiers || q.statusDots
        }, "the other themes look as before")
    }
}
