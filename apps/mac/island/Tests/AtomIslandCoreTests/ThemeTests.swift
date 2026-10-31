import Foundation
import Testing
@testable import AtomIslandCore

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
        // Coloured text on the surface: status lines, problems.
        #expect(on(p.problem, bg) >= 4.5, "problem text")
        #expect(on(p.success, bg) >= 4.5, "success text")
        #expect(on(p.attention, bg) >= 3, "attention icon")
    }

    /// The three text levels are three colours, each softer than the one above (Daylight's secondary text and captions
    /// were one colour until 2026-10-16, found on the Design system page).
    @Test(arguments: AppTheme.allCases)
    func textLevelsDiffer(theme: AppTheme) {
        let p = theme.palette
        let bg = p.surfaceSolid
        func on(_ c: RGBA) -> Double { RGBA.contrast(c.over(bg), bg) }
        #expect(on(p.text) > on(p.text2), "\(theme.title): secondary text is softer than main text")
        #expect(on(p.text2) - on(p.text3) >= 1, "\(theme.title): captions are visibly softer than secondary text (\(on(p.text2)) vs \(on(p.text3)))")
    }

    @Test func darkAndLightThemes() {
        #expect(AppTheme.void.palette.isDark && AppTheme.ember.palette.isDark && AppTheme.teal.palette.isDark)
        #expect(!AppTheme.daylight.palette.isDark)
        #expect(!AppTheme.allCases.contains { $0.palette.accentIsGradient }, "every theme left has one flat accent")
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
        let suite = "atom.test.theme.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        let settings = IslandSettings(defaults: defaults)
        #expect(settings.theme == .void)
        settings.theme = .plum
        let reloaded = IslandSettings(defaults: defaults)
        #expect(reloaded.theme == .plum)
        reloaded.resetAppearance()
        #expect(reloaded.theme == .void)
    }

    @MainActor @Test func unknownStoredValuesFallBack() {
        let suite = "atom.test.theme.bad.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(99, forKey: "atom.look.theme")
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
    }

    /// Daylight (2026-10-15): Void's flat look in light, from the UI playground. A stored choice of 6 reads back, and
    /// the secondary text is lighter than the main text (the playground's `#000000` was not).
    @MainActor @Test func daylightIsFlatLightAndStored() {
        let p = AppTheme.daylight.palette
        #expect(p.surfaceStyle == .flat && !p.usesGlow && !p.usesShadows && p.accent == RGBA(hex: 0x5B50E6))
        #expect(RGBA.contrast(p.text2, p.surfaceSolid) < RGBA.contrast(p.text, p.surfaceSolid), "secondary text is softer")
        #expect(AppTheme.allCases.contains(.daylight) && AppTheme(rawValue: 6) == .daylight)
        let suite = "atom.test.theme.daylight.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.set(AppTheme.daylight.rawValue, forKey: IslandSettings.themeKey)
        #expect(IslandSettings(defaults: defaults).theme == .daylight)
        defaults.removePersistentDomain(forName: suite)
    }

    /// 2026-10-31 (Keshab): seven themes were removed. A stored choice of any of them reads back as Void; the rest stay.
    @MainActor @Test func removedThemesFallBackToVoid() {
        for removed in [0, 1, 2, 3, 4, 9, 11] {
            let suite = "atom.test.theme.removed.\(UUID().uuidString)"
            let defaults = UserDefaults(suiteName: suite)!
            defaults.set(removed, forKey: IslandSettings.themeKey)
            #expect(IslandSettings(defaults: defaults).theme == .void, "raw \(removed)")
            defaults.removePersistentDomain(forName: suite)
        }
        #expect(AppTheme.allCases.map(\.rawValue).sorted() == [5, 6, 7, 8, 10, 12, 13])
        let suite = "atom.test.theme.kept.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.set(AppTheme.teal.rawValue, forKey: IslandSettings.themeKey)
        #expect(IslandSettings(defaults: defaults).theme == .teal)
        defaults.removePersistentDomain(forName: suite)
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
        #expect(!AppTheme.allCases.filter { $0 != .void && $0 != .daylight }.contains { t in
            let q = t.palette
            return q.surfaceStyle != .glass || q.buttonStyle != .filled || !q.usesGlow || !q.usesShadows || q.monoIdentifiers || q.statusDots
        }, "the other themes look as before")
    }
}
