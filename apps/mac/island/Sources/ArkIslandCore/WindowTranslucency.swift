import Foundation

// Translucent window (ADR-277). Design reference: Ghostex (github.com/maddada/Ghostex, MIT), whose main window shows the
// desktop, blurred and tinted, behind the sidebar, the chat and the title bar. No code is taken from it.
//
// A variant of ambient glass (ADR-255): the backdrop is the real desktop, blurred by the system, in place of ARK's own light.
// The layers, from the back: the desktop, the system's blur, a tint of the theme's base colour, the panes (translucent tints),
// then the content. Only the opacities live here; the window and the blur are AppKit (DesktopWindowAppearance).

/// How much of the desktop shows through. Default medium.
public enum TranslucencyStrength: Int, SettingsChoice {
    case low = 0, medium, high

    public var title: String {
        switch self {
        case .low: "Low"
        case .medium: "Medium"
        case .high: "High"
        }
    }
}

public enum WindowTranslucency {
    /// The opacity of one layer at low, medium and high strength.
    struct Steps {
        let low, medium, high: Double
        func at(_ strength: TranslucencyStrength) -> Double {
            switch strength {
            case .low: low
            case .medium: medium
            case .high: high
            }
        }
    }

    /// The tint over the blur. It is all that is over the desktop at the window's edge and under the title bar.
    static let tint = Steps(low: 0.55, medium: 0.45, high: 0.35)
    /// Each pane over the tint. The rail and the sidebar are the most see-through; the work pane, cards and bubbles the least.
    static let rail = Steps(low: 0.50, medium: 0.40, high: 0.38)
    static let panel = Steps(low: 0.50, medium: 0.40, high: 0.38)
    static let work = Steps(low: 0.70, medium: 0.60, high: 0.50)
    static let workspace = Steps(low: 0.75, medium: 0.65, high: 0.55)
    static let card = Steps(low: 0.80, medium: 0.72, high: 0.65)
    static let bubble = Steps(low: 0.80, medium: 0.72, high: 0.65)

    /// The contrast that text must keep over a pane, whatever the desktop is: main text 4.5:1, secondary text 3:1.
    public static let mainTextContrast = 4.5
    public static let secondaryTextContrast = 3.0
    /// The brightest and the darkest desktop: the worst cases for dark and for light themes.
    public static let extremeBackdrops = [RGBA.white(1), RGBA(0, 0, 0, 1)]

    /// The tint layer over the blur: the theme's base colour.
    public static func tint(_ theme: AppTheme, strength: TranslucencyStrength) -> RGBA {
        AmbientScene.base(theme).with(alpha: tint.at(strength))
    }

    /// The panes over the tint. `frame` stays opaque, so what must hide what is under it (`surfaceSolid`, a terminal) stays opaque.
    /// A pane whose text would fall under the contrast floor over a white or a black desktop gets more opaque until it passes.
    public static func lanes(_ theme: AppTheme, strength: TranslucencyStrength) -> WorkspaceColors {
        var lanes = ThemeBuilder.glassLanes(theme)
        let under = tint(theme, strength: strength)
        let p = lanes.palette
        let nav = lanes.navigationPalette
        lanes.rail = readable(lanes.rail.with(alpha: rail.at(strength)), under: under, text: nav)
        lanes.panel = readable(lanes.panel.with(alpha: panel.at(strength)), under: under, text: p)
        lanes.work = readable(lanes.work.with(alpha: work.at(strength)), under: under, text: p)
        lanes.workspace = readable(lanes.workspace.with(alpha: workspace.at(strength)), under: under, text: p)
        lanes.card = readable(lanes.card.with(alpha: card.at(strength)), under: under, text: p)
        lanes.bubble = readable(lanes.bubble.with(alpha: bubble.at(strength)), under: under, text: p)
        return lanes
    }

    /// The pane, or a more opaque one, so that main and secondary text keep their floor over every extreme desktop.
    static func readable(_ pane: RGBA, under tint: RGBA, text p: ThemePalette) -> RGBA {
        var a = pane.a
        func passes(_ alpha: Double) -> Bool {
            extremeBackdrops.allSatisfy { desktop in
                let behind = pane.with(alpha: alpha).over(tint.over(desktop))
                return RGBA.contrast(p.text, behind) >= mainTextContrast && RGBA.contrast(p.text2, behind) >= secondaryTextContrast
            }
        }
        // ponytail: linear search in 0.02 steps (at most 50 tries per pane); fine for six panes per settings change.
        while a < 1, !passes(a) { a = min(1, a + 0.02) }
        return pane.with(alpha: a)
    }

    /// The system blur under the tint: a dark material for dark themes, a light one for light themes (names of
    /// `NSVisualEffectView.Material`, so the core stays free of AppKit).
    public enum Material: String, Sendable { case hudWindow, sidebar }
    public static func material(dark: Bool) -> Material { dark ? .hudWindow : .sidebar }
}
