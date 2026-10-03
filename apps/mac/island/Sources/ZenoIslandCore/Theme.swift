import CoreGraphics
import Foundation

/// The look of ZENO's surfaces: panel, status card, work strip, bubbles and the point label (ADR-057).
/// Each theme is a set of colours and corner radii; layout and behaviour are the same in all of them.
public enum AppTheme: Int, SettingsChoice, Identifiable {
    /// Dark glass and system-like controls, one teal accent. Looks like it shipped with macOS.
    case native = 0
    /// Near-black glass with a cyan → violet gradient for selection, the main button and live sound.
    case luminous
    /// Warm off-white paper glass, ink text, a coral accent and mint for live states.
    case warm

    public var id: Int { rawValue }
    public var title: String {
        switch self {
        case .native: "Quiet Native"
        case .luminous: "Luminous"
        case .warm: "Warm"
        }
    }
    public var detail: String {
        switch self {
        case .native: "Dark glass with one teal accent, like a built-in Mac app"
        case .luminous: "Near-black glass with a cyan-to-violet glow"
        case .warm: "Light paper glass with a coral accent"
        }
    }
    public var palette: ThemePalette { ThemePalette.for(self) }
}

/// How Wisp is drawn (ADR-057). Behaviour, size and placement are the same for every style.
public enum WispStyle: Int, SettingsChoice, Identifiable {
    /// The ghost, refined: a luminous dome with a soft hem; the eyes and glow carry the mood.
    case ghost = 0
    /// A floating marble of light with two eyes; the light inside it carries the mood.
    case orb
    /// A warmer character with a small expressive face; pose and face carry the mood.
    case companion

    public var id: Int { rawValue }
    public var title: String {
        switch self {
        case .ghost: "Ghost"
        case .orb: "Orb"
        case .companion: "Companion"
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

    /// The accent is a gradient, not a flat colour.
    public var accentIsGradient: Bool { accent != accentEnd }

    public static func `for`(_ theme: AppTheme) -> ThemePalette {
        switch theme {
        case .native: native
        case .luminous: luminous
        case .warm: warm
        }
    }

    /// A: dark Liquid-Glass, system-like, one teal accent from Wisp's glow.
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
        radiusSurface: 18, radiusCard: 10, radiusControl: 6)

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
        radiusSurface: 22, radiusCard: 12, radiusControl: 8)

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
