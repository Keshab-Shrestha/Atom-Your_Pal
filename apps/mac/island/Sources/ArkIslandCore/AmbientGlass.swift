import Foundation

// Ambient glass (2026-11-05, Keshab: "implement Ambient UI and Glassmorphism on our whole app", ADR-255).
//
// Glass: every theme has a second material. The window's panes, cards and floating panels become frosted tints with a light
// edge, laid over an ambient backdrop. Flat stays: the user can choose it, and the system's Reduce Transparency forces it.
//
// Ambient: the backdrop is a few large, soft pools of light in the theme's colours. They drift slowly and take on ARK's mood:
// calm, active (listening, thinking, working), attention (something needs the user) or a problem. Plain code decides the mood
// from ARK's state; nothing is sent anywhere.
//
// The panes are tints, not blur: the backdrop is already soft, so a translucent tint over it reads as frosted glass, draws the same
// in a snapshot as on screen, and keeps text contrast something a test can check (GlassThemeTests).

/// ARK's mood for the ambient light, from its state. Ordered by how much it should be seen.
public enum AmbientMood: String, Sendable, Equatable, CaseIterable {
    case calm, active, attention, problem

    /// A problem wins, then something that needs the user, then work in progress; otherwise calm.
    public init(status: IslandStatus.Kind, agentsWorking: Bool, agentsWaiting: Bool) {
        switch status {
        case .problem: self = .problem
        case .notice, .asking: self = .attention
        case _ where agentsWaiting: self = .attention
        case .listening, .transcribing, .thinking, .speaking, .acting: self = .active
        case _ where agentsWorking: self = .active
        default: self = .calm
        }
    }
}

/// One pool of light in the backdrop. Position and radius are fractions of the window (0...1); the colour fades to clear at the edge.
public struct AmbientLight: Sendable, Equatable {
    public var color: RGBA
    public var x: Double, y: Double
    public var radius: Double
    /// How far it drifts, as a fraction of the window, and how long one drift takes.
    public var drift: Double
    public var period: Double
}

public enum AmbientScene {
    /// The opaque colour under the lights: a little darker (or lighter) than the flat window frame.
    public static func base(_ theme: AppTheme) -> RGBA {
        let tone = theme.tone
        return .oklch(tone.dark ? 0.13 : 0.91, tone.chroma, tone.hue)
    }

    /// The hue of the theme's light: its accent's hue, or a cool indigo when the accent is grey (Void).
    static func lightHue(_ theme: AppTheme) -> Double {
        let lab = theme.tone.accent.oklch
        return lab.c > 0.03 ? lab.h : 268
    }

    /// The mood's own hue, or nil for calm (the theme's two lights alone).
    static func moodHue(_ mood: AmbientMood) -> Double? {
        switch mood {
        case .calm: nil
        case .active: 245
        case .attention: 75
        case .problem: 25
        }
    }

    /// The brightest a light gets at its centre. `GlassThemeTests` checks text against a pane over this.
    public static let peakAlpha = 0.85

    /// Three lights: the theme's own, a neighbour hue, and the mood (or a second theme light when calm).
    public static func lights(_ theme: AppTheme, mood: AmbientMood) -> [AmbientLight] {
        let dark = theme.tone.dark
        let hue = lightHue(theme)
        let (l, c) = dark ? (0.34, 0.09) : (0.86, 0.07)
        let light = { (h: Double, chroma: Double) in RGBA.oklch(l, chroma, h, alpha: peakAlpha) }
        let third = moodHue(mood).map { light($0, c * 1.25) } ?? light(hue + 330, c * 0.8)
        return [
            AmbientLight(color: light(hue, c), x: 0.18, y: 0.12, radius: 0.62, drift: 0.06, period: 38),
            AmbientLight(color: light(hue + 45, c * 0.85), x: 0.88, y: 0.30, radius: 0.55, drift: 0.05, period: 46),
            AmbientLight(color: third, x: 0.55, y: 0.95, radius: 0.60, drift: 0.07, period: 31),
        ]
    }
}

extension ThemeBuilder {
    /// Lightness and alpha of each pane's tint in glass, dark then light. The work pane is the clearest: the light shows most there.
    private struct GlassSteps {
        let rail, panel, work, workspace, card, bubble: (l: Double, a: Double)
        let text: (Double, Double, Double)
    }
    private static let darkGlass = GlassSteps(rail: (0.15, 0.62), panel: (0.17, 0.55), work: (0.16, 0.42), workspace: (0.18, 0.55),
                                              card: (0.20, 0.50), bubble: (0.28, 0.55), text: (0.97, 0.83, 0.73))
    private static let lightGlass = GlassSteps(rail: (0.985, 0.58), panel: (0.99, 0.55), work: (1.0, 0.48), workspace: (0.995, 0.60),
                                               card: (0.98, 0.55), bubble: (0.96, 0.62), text: (0.17, 0.38, 0.45))

    /// The panes in glass: translucent tints, and the opaque `frame` under the backdrop.
    public static func glassLanes(_ theme: AppTheme) -> WorkspaceColors {
        let tone = theme.tone
        let s = tone.dark ? darkGlass : lightGlass
        let at = { (step: (l: Double, a: Double)) in RGBA.oklch(step.l, tone.chroma, tone.hue, alpha: step.a) }
        return WorkspaceColors(frame: AmbientScene.base(theme), rail: at(s.rail), panel: at(s.panel), work: at(s.work),
                               workspace: at(s.workspace), card: at(s.card), bubble: at(s.bubble), palette: glassPalette(theme))
    }

    /// The palette in glass. Text is a step stronger than flat, so it reads over the light; fills are see-through; edges catch light.
    /// `surfaceSolid` stays opaque (the work pane over the base) for what must hide what is under it: a terminal, a mask, a sheet.
    public static func glassPalette(_ theme: AppTheme) -> ThemePalette {
        let tone = theme.tone
        let s = tone.dark ? darkGlass : lightGlass
        let ink = { (l: Double) in RGBA.oklch(l, min(tone.chroma, 0.01), tone.hue) }
        var p = palette(theme)
        let base = AmbientScene.base(theme)
        let work = RGBA.oklch(s.work.l, tone.chroma, tone.hue, alpha: s.work.a)
        p.surfaceStyle = .glass
        p.surface = RGBA.oklch(tone.dark ? 0.19 : 0.985, tone.chroma, tone.hue, alpha: tone.dark ? 0.62 : 0.66)
        p.surfaceSolid = work.over(base)
        p.text = ink(s.text.0); p.text2 = ink(s.text.1); p.text3 = ink(s.text.2)
        if tone.dark {
            p.fill1 = .white(0.04); p.fill2 = .white(0.07); p.fill3 = .white(0.10)
            p.border = .white(0.12); p.separator = .white(0.08); p.rim = .white(0.26); p.borderHover = .white(0.3)
        } else {
            p.fill1 = .white(0.45); p.fill2 = RGBA(0, 0, 0, 0.045); p.fill3 = RGBA(0, 0, 0, 0.075)
            p.border = RGBA(0, 0, 0, 0.08); p.separator = RGBA(0, 0, 0, 0.06); p.rim = .white(0.85); p.borderHover = RGBA(0, 0, 0, 0.18)
        }
        p.usesShadows = true
        p.glow = RGBA.oklch(tone.dark ? 0.70 : 0.75, 0.10, AmbientScene.lightHue(theme), alpha: 0.55)
        return p
    }
}

public extension WorkspaceColors {
    /// The panes for a theme in glass or flat.
    static func `for`(_ theme: AppTheme, glass: Bool) -> WorkspaceColors { glass ? ThemeBuilder.glassLanes(theme) : ThemeBuilder.lanes(theme) }
}

public extension AppTheme {
    /// The palette in glass or flat.
    func palette(glass: Bool) -> ThemePalette { glass ? ThemeBuilder.glassPalette(self) : palette }
}

public extension RGBA {
    /// OKLCH of the colour: lightness 0...1, chroma, hue in degrees. The inverse of `oklch(_:_:_:)`.
    var oklch: (l: Double, c: Double, h: Double) {
        func linear(_ x: Double) -> Double { x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4) }
        let (lr, lg, lb) = (linear(r), linear(g), linear(b))
        let l_ = cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
        let m_ = cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
        let s_ = cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
        let l = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
        let a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
        let b = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
        let h = atan2(b, a) * 180 / .pi
        return (l, (a * a + b * b).squareRoot(), h < 0 ? h + 360 : h)
    }
}
