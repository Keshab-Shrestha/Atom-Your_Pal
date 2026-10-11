import CoreGraphics
import Foundation

/// The look of ZENO's surfaces: panel, status card, work strip, bubbles and the point label (ADR-057).
/// Each theme is a set of colours and corner radii; layout and behaviour are the same in all of them.
public enum AppTheme: Int, SettingsChoice, Identifiable {
    /// Flat black with 1 px graphite hairlines, ghost buttons and mono identifiers; colour only on small status dots,
    /// no glow or shadow anywhere (ADR-086, after Resend's style). The default. Listed first.
    case void = 5
    /// Night glass in cool greys; the only colour is Pal's own light, and state is how brightly it burns
    /// (ADR-084). Raw values keep older stored choices valid.
    case lantern = 3
    /// Lantern in daylight: pale cool glass, ink text, the light kept for Pal's glow.
    case lanternDay = 4
    /// Dark glass and system-like controls, one teal accent. Looks like it shipped with macOS.
    case native = 0
    /// Near-black glass with a cyan → violet gradient for selection, the main button and live sound.
    case luminous
    /// Warm off-white paper glass, ink text, a coral accent and mint for live states.
    case warm

    public var id: Int { rawValue }
    public var title: String {
        switch self {
        case .void: "Void"
        case .lantern: "Lantern"
        case .lanternDay: "Lantern Day"
        case .native: "Quiet Native"
        case .luminous: "Luminous"
        case .warm: "Warm"
        }
    }
    public var detail: String {
        switch self {
        case .void: "Flat black with hairlines; colour only where it shows a status"
        case .lantern: "Night glass lit only by Pal's light"
        case .lanternDay: "Pale glass by day, with Pal's light"
        case .native: "Dark glass with one teal accent, like a built-in Mac app"
        case .luminous: "Near-black glass with a cyan-to-violet glow"
        case .warm: "Light paper glass with a coral accent"
        }
    }
    public var palette: ThemePalette { ThemePalette.for(self) }
}

/// How Pal is drawn (ADR-057). Behaviour, size and placement are the same for every style.
public enum PalStyle: Int, SettingsChoice, Identifiable {
    /// The ghost, refined: a luminous dome with a soft hem; the eyes and glow carry the mood.
    case ghost = 0
    /// A floating marble of light with two eyes; the light inside it carries the mood.
    case orb
    /// A warmer character with a small expressive face; pose and face carry the mood.
    case companion
    /// Keshab's own character from exported images (ADR-085); ZENO's motion and light around it. Drawn as the orb
    /// when the images are missing.
    case avatar

    public var id: Int { rawValue }
    public var title: String {
        switch self {
        case .ghost: "Ghost"
        case .orb: "Orb"
        case .companion: "Companion"
        case .avatar: "Avatar"
        }
    }
}

/// An sRGB colour with alpha, 0...1. Core stays free of SwiftUI; the app turns these into `Color`.
public struct RGBA: Sendable, Equatable {
    public var r: Double, g: Double, b: Double, a: Double

    public init(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) {
        self.r = r; self.g = g; self.b = b; self.a = a
    }

    /// From a hex value such as 0x5BD6E8.
    public init(hex: UInt32, alpha: Double = 1) {
        self.init(Double((hex >> 16) & 0xFF) / 255, Double((hex >> 8) & 0xFF) / 255, Double(hex & 0xFF) / 255, alpha)
    }

    public static func white(_ a: Double) -> RGBA { RGBA(1, 1, 1, a) }
    public static func ink(_ hex: UInt32, _ a: Double) -> RGBA { RGBA(hex: hex, alpha: a) }

    public func with(alpha: Double) -> RGBA { RGBA(r, g, b, alpha) }

    /// This colour laid over an opaque `background`.
    public func over(_ background: RGBA) -> RGBA {
        RGBA(r * a + background.r * (1 - a), g * a + background.g * (1 - a), b * a + background.b * (1 - a), 1)
    }

    /// WCAG relative luminance of the opaque colour.
    public var luminance: Double {
        func channel(_ c: Double) -> Double { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }

    /// WCAG contrast ratio between two opaque colours (1...21).
    public static func contrast(_ a: RGBA, _ b: RGBA) -> Double {
        let (l1, l2) = (a.luminance, b.luminance)
        return (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)
    }
}

/// Every colour and radius the surfaces use, for one theme. Views read only these, never literal colours, so a
/// theme change restyles everything at once.
public struct ThemePalette: Sendable, Equatable {
    /// Light or dark: decides the system controls' appearance and the blur material.
    public var isDark: Bool
    /// The surface fill laid over the blur (glass) or used alone (solid, and in snapshots).
    public var surface: RGBA
    public var surfaceSolid: RGBA
    /// Hairline border around surfaces, and the bright top rim on glass.
    public var border: RGBA
    public var rim: RGBA

    /// Text: primary, secondary, tertiary (captions, timings).
    public var text: RGBA
    public var text2: RGBA
    public var text3: RGBA

    /// Fills for wells, rows and controls, from faint to strong, and the separator between rows.
    public var fill1: RGBA
    public var fill2: RGBA
    public var fill3: RGBA
    public var separator: RGBA

    /// The accent: selection, the main button, focus. `accentEnd` makes it a gradient (Luminous); equal to
    /// `accent` for a flat accent. `onAccent` is text on the accent.
    public var accent: RGBA
    public var accentEnd: RGBA
    public var onAccent: RGBA
    /// Live sound (meters, waveform) and the listening state.
    public var live: RGBA
    /// Attention (approval), problems, success.
    public var attention: RGBA
    public var onAttention: RGBA
    public var problem: RGBA
    public var success: RGBA

    /// The user's own message in the conversation.
    public var userBubble: RGBA
    public var onUserBubble: RGBA

    /// Concentric corner radii: the surface, a card inside it, a control inside a card.
    public var radiusSurface: CGFloat
    public var radiusCard: CGFloat
    public var radiusControl: CGFloat

    /// Lantern (ADR-084): the top of the surface's vertical gradient (nil: a flat surface), and Pal's light
    /// falling on the panel from the header. The glow's alpha scales the state's brightness; 0 draws none.
    public var surfaceTop: RGBA? = nil
    public var glow = RGBA(0, 0, 0, 0)

    /// ADR-086 (Void): how surfaces, buttons and states are drawn. The defaults are every older theme's look.
    /// Glass (blur plus tint) or one flat, opaque colour with a hairline border.
    public var surfaceStyle = SurfaceStyle.glass
    /// Filled buttons, or ghost buttons (transparent, a 1 px hairline that brightens on hover).
    public var buttonStyle = ButtonLook.filled
    /// Glows (lit rims, pools of light, glowing dots and carets, Pal's halo) and drop shadows.
    public var usesGlow = true
    public var usesShadows = true
    /// Identifiers (model and app names, timings, shortcuts, job details) in SF Mono.
    public var monoIdentifiers = false
    /// ZENO's state as small coloured dots rather than tinted icons and light.
    public var statusDots = false
    /// The hairline once the pointer is over a ghost control.
    public var borderHover = RGBA.white(0.3)
    /// Violet for identifiers in mono, and the "thinking" dot (ADR-086). Nil: no identifier colour.
    public var identifier: RGBA? = nil
    /// The gap between the panel's edge and a control in its corner (the composer, the approval buttons); the
    /// control's radius is `radiusSurface - cornerGap`, so the corners stay concentric.
    public var cornerGap: CGFloat = 10

    public enum SurfaceStyle: Sendable, Equatable { case glass, flat }
    public enum ButtonLook: Sendable, Equatable { case filled, ghost }

    /// The accent is a gradient, not a flat colour.
    public var accentIsGradient: Bool { accent != accentEnd }

    public static func `for`(_ theme: AppTheme) -> ThemePalette {
        switch theme {
        case .void: void
        case .lantern: lantern
        case .lanternDay: lanternDay
        case .native: native
        case .luminous: luminous
        case .warm: warm
        }
    }

    /// Void (ADR-086, docs/design/resend-reference.md): a pure black canvas, `#292d30` hairlines instead of shadows,
    /// bone-white text, ghost buttons, radii 24 / 16 / 6. Colour only for status: blue listening or running, violet
    /// thinking (and identifiers), green done or ready, amber needs you, red a problem. Dark only. Captions use
    /// `#878b92`: the reference's Iron `#6e727a` is 4.3:1 on black, under AA, so it is left to disabled things and
    /// the hovered hairline. Cards are not filled; `fill2`/`fill3` are only for tracks and a selected segment.
    public static let void = ThemePalette(
        isDark: true,
        surface: RGBA(hex: 0x000000), surfaceSolid: RGBA(hex: 0x000000),
        border: RGBA(hex: 0x292D30), rim: RGBA(hex: 0x292D30),
        text: RGBA(hex: 0xF0F0F0), text2: RGBA(hex: 0xA1A4A5), text3: RGBA(hex: 0x878B92),
        fill1: .white(0), fill2: RGBA(hex: 0x16181B), fill3: RGBA(hex: 0x222529), separator: RGBA(hex: 0x292D30),
        accent: RGBA(hex: 0xFFFFFF), accentEnd: RGBA(hex: 0xFFFFFF), onAccent: RGBA(hex: 0x000000),
        live: RGBA(hex: 0x70B8FF),
        attention: RGBA(hex: 0xFFCA16), onAttention: RGBA(hex: 0x000000),
        problem: RGBA(hex: 0xFF9592), success: RGBA(hex: 0x3AD389),
        userBubble: .white(0), onUserBubble: RGBA(hex: 0xA1A4A5),
        radiusSurface: 24, radiusCard: 16, radiusControl: 6,
        surfaceStyle: .flat, buttonStyle: .ghost, usesGlow: false, usesShadows: false, monoIdentifiers: true,
        statusDots: true, borderHover: RGBA(hex: 0x6E727A), identifier: RGBA(hex: 0xBAA7FF), cornerGap: 8)

    /// Lantern (ADR-084, design study §3 A): night glass, cool greys, one light (#8FD3FF). Amber only when
    /// Pal needs you, coral only when something went wrong; ready and success are the light too.
    public static let lantern = ThemePalette(
        isDark: true,
        surface: RGBA(hex: 0x10162A, alpha: 0.82), surfaceSolid: RGBA(hex: 0x10162A),
        border: .white(0.06), rim: .white(0.16),
        text: RGBA(hex: 0xEAF1FF), text2: RGBA(hex: 0xA7B4CC), text3: RGBA(hex: 0x7F8BA6),
        fill1: .white(0.045), fill2: .white(0.075), fill3: .white(0.12), separator: .white(0.07),
        accent: RGBA(hex: 0x8FD3FF), accentEnd: RGBA(hex: 0x8FD3FF), onAccent: RGBA(hex: 0x0B1B33),
        live: RGBA(hex: 0x8FD3FF),
        attention: RGBA(hex: 0xFFC069), onAttention: RGBA(hex: 0x2B1A00),
        problem: RGBA(hex: 0xFF8A7A), success: RGBA(hex: 0x8FD3FF),
        userBubble: .white(0.055), onUserBubble: RGBA(hex: 0xA7B4CC),
        radiusSurface: 26, radiusCard: 14, radiusControl: 9,
        surfaceTop: RGBA(hex: 0x161F3A), glow: RGBA(hex: 0x8FD3FF))

    /// Lantern Day: pale cool glass and ink. Text and controls use a deep light-blue (#1F6FA8) and amber #A05E00
    /// (the study's #A86200 is only 4.4:1 on this surface) so they read; the glow stays Pal's own #8FD3FF.
    public static let lanternDay = ThemePalette(
        isDark: false,
        surface: RGBA(hex: 0xF3F6FB, alpha: 0.88), surfaceSolid: RGBA(hex: 0xF3F6FB),
        border: .ink(0x1B2A44, 0.10), rim: .white(0.9),
        text: RGBA(hex: 0x121A2E), text2: RGBA(hex: 0x4A5670), text3: RGBA(hex: 0x5E6A82),
        fill1: .ink(0x1B2A44, 0.04), fill2: .ink(0x1B2A44, 0.07), fill3: .ink(0x1B2A44, 0.11), separator: .ink(0x1B2A44, 0.08),
        accent: RGBA(hex: 0x1F6FA8), accentEnd: RGBA(hex: 0x1F6FA8), onAccent: .white(1),
        live: RGBA(hex: 0x1F6FA8),
        attention: RGBA(hex: 0xA05E00), onAttention: .white(1),
        problem: RGBA(hex: 0xB42318), success: RGBA(hex: 0x1F6FA8),
        userBubble: .ink(0x1B2A44, 0.05), onUserBubble: RGBA(hex: 0x4A5670),
        radiusSurface: 26, radiusCard: 14, radiusControl: 9,
        surfaceTop: RGBA(hex: 0xFAFCFE), glow: RGBA(hex: 0x8FD3FF, alpha: 0.9))

    /// A: dark Liquid-Glass, system-like, one teal accent from Pal's glow.
    public static let native = ThemePalette(
        isDark: true,
        surface: RGBA(hex: 0x202226, alpha: 0.72), surfaceSolid: RGBA(hex: 0x1E2024),
        border: .white(0.10), rim: .white(0.16),
        text: .white(0.92), text2: .white(0.66), text3: .white(0.56),
        fill1: .white(0.06), fill2: .white(0.10), fill3: .white(0.16), separator: .white(0.085),
        accent: RGBA(hex: 0x5BD6E8), accentEnd: RGBA(hex: 0x5BD6E8), onAccent: RGBA(hex: 0x062A31),
        live: RGBA(hex: 0x5BD6E8),
        attention: RGBA(hex: 0xFFB547), onAttention: RGBA(hex: 0x2B1A00),
        problem: RGBA(hex: 0xFF8A65), success: RGBA(hex: 0x5FD38D),
        userBubble: RGBA(hex: 0x5BD6E8, alpha: 0.18), onUserBubble: .white(0.95),
        radiusSurface: 18, radiusCard: 10, radiusControl: 6,
        glow: RGBA(hex: 0x5BD6E8, alpha: 0.5))

    /// B: near-black deep glass; the orb's cyan → periwinkle → violet gradient used sparingly.
    public static let luminous = ThemePalette(
        isDark: true,
        surface: RGBA(hex: 0x0E1016, alpha: 0.80), surfaceSolid: RGBA(hex: 0x0B0D12),
        border: .white(0.09), rim: .white(0.15),
        text: .white(0.95), text2: .white(0.68), text3: .white(0.60),
        fill1: .white(0.05), fill2: .white(0.09), fill3: .white(0.15), separator: .white(0.08),
        accent: RGBA(hex: 0x7EEBFF), accentEnd: RGBA(hex: 0xB69CFF), onAccent: RGBA(hex: 0x0B0D12),
        live: RGBA(hex: 0x6FE7FF),
        attention: RGBA(hex: 0xFFB86B), onAttention: RGBA(hex: 0x2A1600),
        problem: RGBA(hex: 0xFF7A6B), success: RGBA(hex: 0x62E6B4),
        userBubble: RGBA(hex: 0x8EA2FF, alpha: 0.22), onUserBubble: .white(0.96),
        radiusSurface: 22, radiusCard: 12, radiusControl: 8,
        glow: RGBA(hex: 0x7EEBFF, alpha: 0.5))

    /// C: warm off-white paper glass, ink type, coral accent, mint for live states.
    public static let warm = ThemePalette(
        isDark: false,
        surface: RGBA(hex: 0xFBF8F3, alpha: 0.88), surfaceSolid: RGBA(hex: 0xFBF8F3),
        border: .ink(0x462D14, 0.14), rim: .white(0.9),
        text: RGBA(hex: 0x1D1B18), text2: .ink(0x1D1B18, 0.68), text3: .ink(0x1D1B18, 0.64),
        fill1: .ink(0x604828, 0.05), fill2: .ink(0x604828, 0.08), fill3: .ink(0x604828, 0.13), separator: .ink(0x1D1B18, 0.09),
        accent: RGBA(hex: 0xBF4527), accentEnd: RGBA(hex: 0xBF4527), onAccent: .white(1),
        live: RGBA(hex: 0x08776A),
        attention: RGBA(hex: 0x8F5600), onAttention: .white(1),
        problem: RGBA(hex: 0xB83F22), success: RGBA(hex: 0x167A53),
        userBubble: RGBA(hex: 0xFF7A59, alpha: 0.14), onUserBubble: RGBA(hex: 0x1D1B18),
        radiusSurface: 22, radiusCard: 14, radiusControl: 10)
}
