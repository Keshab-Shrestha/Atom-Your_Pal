import AppKit
import SwiftUI
import ZenoIslandCore

// ADR-057: one theme drives every surface. Views read `\.theme` (a `ThemePalette`) and never use literal colours,
// so switching Quiet Native / Luminous / Warm in Settings restyles the panel, status card, bubbles, work strip and
// point label at once.

extension RGBA {
    var color: Color { Color(.sRGB, red: r, green: g, blue: b, opacity: a) }
    var nsColor: NSColor { NSColor(srgbRed: r, green: g, blue: b, alpha: a) }
}

private struct ThemeKey: EnvironmentKey { static let defaultValue = ThemePalette.lantern }

extension EnvironmentValues {
    var theme: ThemePalette {
        get { self[ThemeKey.self] }
        set { self[ThemeKey.self] = newValue }
    }
}

extension ThemePalette {
    var colorScheme: ColorScheme { isDark ? .dark : .light }

    /// The accent as a fill: a gradient in Luminous, flat elsewhere.
    var accentFill: AnyShapeStyle {
        accentIsGradient
            ? AnyShapeStyle(LinearGradient(colors: [accent.color, accentEnd.color], startPoint: .leading, endPoint: .trailing))
            : AnyShapeStyle(accent.color)
    }

    /// The surface's own fill: flat, or Lantern's top-to-bottom night gradient. `solid` uses the opaque colours
    /// (Solid panel setting, snapshots); otherwise the tint laid over the blur, scaled by `opacity`.
    func surfaceFill(solid: Bool, opacity: Double = 1) -> AnyShapeStyle {
        let bottom = solid ? surfaceSolid : surface.with(alpha: surface.a * opacity)
        guard let surfaceTop else { return AnyShapeStyle(bottom.color) }
        let top = solid ? surfaceTop : surfaceTop.with(alpha: bottom.a)
        return AnyShapeStyle(LinearGradient(colors: [top.color, bottom.color], startPoint: .top, endPoint: .bottom))
    }

    /// Tints for ZENO's states, from the theme: live states use `live`, the brain's states the accent's end,
    /// attention and problems their own colours. Quiet states use secondary text.
    func tint(_ kind: IslandStatus.Kind) -> Color {
        switch kind {
        case .starting: text2.color
        case .ready: success.color
        case .listening: live.color
        case .transcribing, .thinking: accentEnd.color
        case .speaking: accent.color
        case .notice, .asking: attention.color
        case .problem: problem.color
        case .acting: live.color
        }
    }
}

extension View {
    /// Applies the user's theme to a surface's content: the palette, and light or dark controls to match.
    func themed(_ palette: ThemePalette) -> some View {
        environment(\.theme, palette)
            .environment(\.colorScheme, palette.colorScheme)
            .tint(palette.accent.color)
    }
}

/// A themed surface: glass (the blur plus the theme's tint) or solid, a hairline border and a bright top rim.
struct SurfaceBackground<S: InsettableShape>: View {
    let shape: S
    /// Draw the blur. False in snapshots (only the window server can draw it) and for the Solid panel setting.
    var glass: Bool
    /// How much of the theme's fill to lay over the blur (bubble opacity setting); 1 is the theme's own.
    var fillScale: Double = 1
    /// For a rounded rectangle: use the system's Liquid Glass at this radius instead of a SwiftUI material.
    var systemGlassRadius: CGFloat? = nil
    @Environment(\.theme) private var theme

    var body: some View {
        ZStack {
            if glass {
                if let radius = systemGlassRadius {
                    GlassBackground(cornerRadius: radius, tint: theme.surface.with(alpha: theme.surface.a * 0.7).nsColor, dark: theme.isDark)
                } else {
                    shape.fill(theme.isDark ? .ultraThinMaterial : .regularMaterial)
                }
                shape.fill(theme.surfaceFill(solid: false, opacity: min(1, fillScale) * (systemGlassRadius == nil ? 1 : 0.55)))
            } else {
                shape.fill(theme.surfaceFill(solid: true))
            }
            // Top rim: light catching the edge of the glass.
            shape.strokeBorder(
                LinearGradient(colors: [theme.rim.color, theme.border.color, theme.border.color], startPoint: .top, endPoint: .bottom),
                lineWidth: 0.6)
        }
    }
}

/// A key-cap hint such as "esc" or "⌘↩".
struct KeyHint: View {
    let text: String
    @Environment(\.theme) private var theme

    var body: some View {
        Text(text)
            .font(.system(size: 9.5, weight: .semibold, design: .rounded))
            .foregroundStyle(theme.text3.color)
            .padding(.horizontal, 4)
            .frame(minHeight: 15)
            .background(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(theme.separator.color, lineWidth: 0.8))
    }
}

/// Lantern's spacing (ADR-084, design study §3 A, one step more generous after Keshab's "lets have a padding for the
/// whole and more when it is in conversation"): the panel's side inset, the inset inside a well, and the
/// conversation's own, stiller margins.
enum Spacing {
    /// Between the panel's edge and its content: header, tabs, Settings wells, the composer.
    static let panel: CGFloat = 22
    /// Inside a well (rounded group of rows): a row's side padding.
    static let well: CGFloat = 14
    /// Between wells in Settings.
    static let wells: CGFloat = 18
    /// The conversation's side margin and the space between turns.
    static let conversation: CGFloat = 26
    static let turn: CGFloat = 28
    /// The composer sits this close to the panel's sides and bottom, with corners concentric to the panel's
    /// (panel radius = composer radius + this gap), so the bottom corners read as one shape.
    static let composer: CGFloat = 10
}
