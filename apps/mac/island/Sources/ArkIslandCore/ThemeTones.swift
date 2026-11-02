import Foundation

/// The 2026-11-01 redesign: every theme is one hue, a little chroma in its surfaces, and one accent, laid out on the same tone steps
/// (after Arc Library's neutral scale, MIT, and taste-skill's rules, MIT: structure from tone steps, not hairlines, shadows or glow).
/// Lanes, fills and text sit at fixed OKLCH lightness, so all seven themes share their spacing between tones and differ only in colour.
public struct ThemeTone: Sendable {
    public let dark: Bool
    /// The surfaces' hue (degrees) and chroma (0 is grey).
    public let hue: Double, chroma: Double
    /// The accent, for the one thing in focus and for state.
    public let accent: RGBA
}

public extension AppTheme {
    var tone: ThemeTone {
        switch self {
        case .void: ThemeTone(dark: true, hue: 250, chroma: 0, accent: .oklch(0.90, 0, 0))
        case .daylight: ThemeTone(dark: false, hue: 275, chroma: 0.004, accent: .oklch(0.50, 0.17, 275))
        case .sapphire: ThemeTone(dark: true, hue: 262, chroma: 0.022, accent: .oklch(0.72, 0.13, 262))
        case .champagne: ThemeTone(dark: true, hue: 85, chroma: 0.008, accent: .oklch(0.80, 0.09, 85))
        case .plum: ThemeTone(dark: true, hue: 318, chroma: 0.02, accent: .oklch(0.74, 0.11, 318))
        case .teal: ThemeTone(dark: true, hue: 195, chroma: 0.018, accent: .oklch(0.78, 0.10, 190))
        case .ember: ThemeTone(dark: true, hue: 50, chroma: 0.004, accent: .oklch(0.70, 0.17, 45))
        }
    }
}

public enum ThemeBuilder {
    /// One lightness per lane and fill, dark then light.
    private struct Steps {
        let frame, rail, panel, work, workspace, card, bubble, fill1, fill2, fill3: Double
        let text: (Double, Double, Double)
    }
    private static let darkSteps = Steps(frame: 0.155, rail: 0.18, panel: 0.20, work: 0.19, workspace: 0.205, card: 0.225, bubble: 0.27,
                                         fill1: 0.215, fill2: 0.245, fill3: 0.275, text: (0.96, 0.77, 0.64))
    private static let lightSteps = Steps(frame: 0.93, rail: 0.955, panel: 0.975, work: 1.0, workspace: 0.985, card: 0.968, bubble: 0.945,
                                          fill1: 0.978, fill2: 0.958, fill3: 0.925, text: (0.17, 0.44, 0.55))

    public static func lanes(_ theme: AppTheme) -> WorkspaceColors {
        let tone = theme.tone
        let s = tone.dark ? darkSteps : lightSteps
        let at = { (l: Double) in RGBA.oklch(l, tone.chroma, tone.hue) }
        return WorkspaceColors(frame: at(s.frame), rail: at(s.rail), panel: at(s.panel), work: at(s.work), workspace: at(s.workspace),
                               card: at(s.card), bubble: at(s.bubble), palette: palette(theme))
    }

    public static func palette(_ theme: AppTheme) -> ThemePalette {
        let tone = theme.tone
        let s = tone.dark ? darkSteps : lightSteps
        let at = { (l: Double) in RGBA.oklch(l, tone.chroma, tone.hue) }
        let ink = { (l: Double) in RGBA.oklch(l, min(tone.chroma, 0.01), tone.hue) }
        var p = tone.dark ? ThemePalette.void : ThemePalette.daylight
        p.surfaceSolid = at(s.work); p.surface = p.surfaceSolid; p.surfaceTop = nil
        p.text = ink(s.text.0); p.text2 = ink(s.text.1); p.text3 = ink(s.text.2)
        p.fill1 = at(s.fill1); p.fill2 = at(s.fill2); p.fill3 = at(s.fill3)
        // Edges are tone, not lines: a faint step that only shows where two equal surfaces meet.
        let edge = tone.dark ? RGBA.white(1) : RGBA(0, 0, 0, 1)
        p.border = edge.with(alpha: 0.08); p.separator = edge.with(alpha: 0.06); p.rim = p.separator
        p.borderHover = edge.with(alpha: 0.18)
        p.accent = tone.accent; p.accentEnd = tone.accent
        p.onAccent = readable(on: tone.accent)
        p.attention = tone.dark ? .oklch(0.83, 0.15, 80) : .oklch(0.53, 0.15, 70)
        p.onAttention = readable(on: p.attention)
        p.problem = tone.dark ? .oklch(0.76, 0.15, 25) : .oklch(0.54, 0.19, 25)
        p.success = tone.dark ? .oklch(0.78, 0.15, 150) : .oklch(0.49, 0.15, 150)
        p.live = tone.dark ? .oklch(0.76, 0.11, 250) : .oklch(0.52, 0.15, 255)
        p.identifier = nil; p.monoIdentifiers = false; p.statusDots = false
        p.surfaceStyle = .flat; p.buttonStyle = .filled; p.usesGlow = false; p.usesShadows = false; p.glow = RGBA(0, 0, 0, 0)
        // Square cards, round pills (Keshab, 2026-11-01): cards and controls take one small corner; pills are Capsules in the views.
        p.radiusSurface = 8; p.radiusCard = 4; p.radiusControl = 4; p.cornerGap = 4
        return p
    }

    /// Near-black or white, whichever reads better on `fill`.
    static func readable(on fill: RGBA) -> RGBA {
        let dark = RGBA.oklch(0.17, 0, 0), light = RGBA.white(1)
        return RGBA.contrast(dark, fill) >= RGBA.contrast(light, fill) ? dark : light
    }
}

public extension RGBA {
    /// OKLCH (lightness 0...1, chroma, hue in degrees) to sRGB, clamped. Björn Ottosson's OKLab matrices.
    static func oklch(_ l: Double, _ c: Double, _ h: Double, alpha: Double = 1) -> RGBA {
        let a = c * cos(h * .pi / 180), b = c * sin(h * .pi / 180)
        let l_ = l + 0.3963377774 * a + 0.2158037573 * b
        let m_ = l - 0.1055613458 * a - 0.0638541728 * b
        let s_ = l - 0.0894841775 * a - 1.2914855480 * b
        let (lc, mc, sc) = (l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_)
        let linear = [
            4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
            -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
            -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc,
        ]
        let gamma = linear.map { x -> Double in
            let v = x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1 / 2.4) - 0.055
            return min(1, max(0, v))
        }
        return RGBA(gamma[0], gamma[1], gamma[2], alpha)
    }
}
