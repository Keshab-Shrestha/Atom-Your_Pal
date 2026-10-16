import CoreGraphics
import Foundation

// ADR-124: the Design system page (Settings → Design system). It draws ATOM's own components in Void or Daylight
// (Showcase) and lists every design token with its value, its Swift source and, for colours, its contrast (Tokens).
// The token list lives here, without SwiftUI, so a test can hold it equal to design/atom-design-system/tokens.css.

/// The page's two views.
public enum DesignShowcaseMode: String, SettingsChoice, Identifiable {
    case showcase, tokens
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .showcase: "Showcase"
        case .tokens: "Tokens"
        }
    }
}

/// The themes the page previews: the two flat themes that tokens.css describes. The glass themes are not in it.
public enum DesignPreviewTheme: String, SettingsChoice, Identifiable {
    case void, daylight
    public var id: String { rawValue }
    public var title: String { theme.title }
    public var theme: AppTheme {
        switch self {
        case .void: .void
        case .daylight: .daylight
        }
    }

    /// The preview opens on the theme in use when it is a flat one, otherwise on Void (the default).
    public init(current: AppTheme) {
        self = current == .daylight ? .daylight : .void
    }
}

/// One design token as tokens.css names it, with the value one theme gives it.
public struct DesignToken: Sendable, Equatable, Identifiable {
    public enum Group: String, CaseIterable, Sendable {
        case surfaces = "Surfaces", text = "Text", accent = "Accent", status = "Status"
        case radius = "Radius", spacing = "Spacing", type = "Type", depth = "Depth and focus", motion = "Motion"
    }

    public enum Value: Sendable, Equatable {
        case color(RGBA)
        case points(CGFloat)
        case duration(milliseconds: Int)
        case text(String)
    }

    /// The CSS custom property, e.g. `--fg`.
    public var name: String
    public var group: Group
    /// What the token is for, in a few words.
    public var role: String
    public var value: Value
    /// Where the Swift app reads it, e.g. `text` (a `ThemePalette` field) or `Spacing scale`.
    public var source: String
    /// For text and status colours: contrast on the window (1...21).
    public var contrast: Double?
    /// A short form for values too long to read in a row (font stacks); the full value is still `cssValue`.
    public var summary: String?

    public init(name: String, group: Group, role: String, value: Value, source: String, contrast: Double? = nil, summary: String? = nil) {
        self.name = name
        self.group = group
        self.role = role
        self.value = value
        self.source = source
        self.contrast = contrast
        self.summary = summary
    }

    public var id: String { name }
    public var cssVariable: String { "var(\(name))" }

    public var color: RGBA? { if case .color(let c) = value { c } else { nil } }
    public var points: CGFloat? { if case .points(let p) = value { p } else { nil } }

    /// The value as tokens.css writes it.
    public var cssValue: String {
        switch value {
        case .color(let c): c.hex
        case .points(let p): "\(Self.number(p))px"
        case .duration(let ms): "\(ms)ms"
        case .text(let s): s
        }
    }

    /// The value as the page shows it.
    public var display: String {
        if let summary { return summary }
        return switch value {
        case .color(let c): c.hex
        case .points(let p): "\(Self.number(p)) pt"
        case .duration(let ms): "\(ms) ms"
        case .text(let s): s
        }
    }

    static func number(_ p: CGFloat) -> String {
        p.rounded() == p ? String(Int(p)) : String(format: "%g", Double(p))
    }
}

extension RGBA {
    /// `#RRGGBB` of the opaque colour.
    public var hex: String {
        func byte(_ c: Double) -> Int { Int((min(max(c, 0), 1) * 255).rounded()) }
        return String(format: "#%02X%02X%02X", byte(r), byte(g), byte(b))
    }
}

/// Every token of design/atom-design-system/tokens.css, for one theme.
public enum DesignCatalog {
    /// DESIGN.md section 3: one size per role.
    public struct TypeStep: Sendable, Equatable {
        public var name: String
        public var size: CGFloat
        public var role: String
    }

    public static let typeScale: [TypeStep] = [
        TypeStep(name: "--text-caption", size: 11, role: "Caption"),
        TypeStep(name: "--text-secondary", size: 12, role: "Secondary"),
        TypeStep(name: "--text-body", size: 13, role: "Body"),
        TypeStep(name: "--text-row", size: 15, role: "Row title"),
        TypeStep(name: "--text-title", size: 18, role: "Page title"),
        TypeStep(name: "--text-number", size: 26, role: "Number"),
    ]

    /// The 4 pt grid (DESIGN.md section 4).
    /// With what each step is for, and the Swift `Spacing` name where there is one. There is no `--space-7`.
    public static let spacing: [(name: String, points: CGFloat, role: String, source: String)] = [
        ("--space-1", 4, "Icon to its word", "Spacing scale"),
        ("--space-2", 8, "Between controls in a row", "Spacing scale"),
        ("--space-3", 12, "Between rows of a group", "Spacing scale"),
        ("--space-4", 16, "A row's side padding in a card", "Spacing.well"),
        ("--space-5", 20, "Between cards", "Spacing.wells"),
        ("--space-6", 24, "The window's edge to its content", "Spacing.panel"),
        ("--space-8", 32, "Between sections of a page", "Spacing scale"),
    ]

    public static let fontSans = #"-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif"#
    public static let fontMono = #"ui-monospace, "SF Mono", Menlo, monospace"#
    public static let easeStandard = "cubic-bezier(0.2, 0, 0, 1)"

    public static func tokens(for theme: AppTheme) -> [DesignToken] {
        let p = theme.palette
        let bg = p.surfaceSolid
        func color(_ name: String, _ group: DesignToken.Group, _ role: String, _ rgba: RGBA, _ source: String, contrast: Bool = false) -> DesignToken {
            let opaque = rgba.over(bg)
            return DesignToken(name: name, group: group, role: role, value: .color(opaque), source: source,
                               contrast: contrast ? RGBA.contrast(opaque, bg) : nil)
        }
        var all: [DesignToken] = [
            color("--bg", .surfaces, "Window", bg, "surfaceSolid"),
            color("--surface", .surfaces, p.fill1.a == 0 ? "Card (its edge is the hairline)" : "Card", bg, "surfaceSolid"),
            color("--surface-2", .surfaces, "Track, selected segment", p.fill2, "fill2"),
            color("--surface-3", .surfaces, "Stronger fill", p.fill3, "fill3"),
            color("--border", .surfaces, "Hairline", p.border, "border"),
            color("--border-hover", .surfaces, "Hairline on hover", p.borderHover, "borderHover"),
            color("--fg", .text, "Main text", p.text, "text", contrast: true),
            color("--fg-2", .text, "Secondary text", p.text2, "text2", contrast: true),
            color("--fg-3", .text, "Caption", p.text3, "text3", contrast: true),
            color("--accent", .accent, "Main action, one selected item", p.accent, "accent", contrast: true),
            color("--accent-on", .accent, "Text on the accent", p.onAccent, "onAccent"),
            color("--live", .status, "Listening, running", p.live, "live", contrast: true),
            color("--warn", .status, "Needs you", p.attention, "attention", contrast: true),
            color("--danger", .status, "Problem", p.problem, "problem", contrast: true),
            color("--success", .status, "Done, ready", p.success, "success", contrast: true),
            color("--identifier", .status, "Model names, app names, timings", p.identifier ?? p.accent, p.identifier == nil ? "accent" : "identifier", contrast: true),
            DesignToken(name: "--radius-lg", group: .radius, role: "The window", value: .points(p.radiusSurface), source: "radiusSurface"),
            DesignToken(name: "--radius-md", group: .radius, role: "A card in it", value: .points(p.radiusCard), source: "radiusCard"),
            DesignToken(name: "--radius-sm", group: .radius, role: "A control in a card", value: .points(p.radiusControl), source: "radiusControl"),
        ]
        all += spacing.map { DesignToken(name: $0.name, group: .spacing, role: $0.role, value: .points($0.points), source: $0.source) }
        all += [
            DesignToken(name: "--font-sans", group: .type, role: "Titles and text", value: .text(fontSans), source: ".system", summary: "SF Pro, then system-ui"),
            DesignToken(name: "--font-mono", group: .type, role: "Identifiers and readouts", value: .text(fontMono), source: "idFont", summary: "SF Mono, then Menlo"),
        ]
        all += typeScale.map { DesignToken(name: $0.name, group: .type, role: $0.role, value: .points($0.size), source: "Type scale") }
        all += [
            DesignToken(name: "--elev-flat", group: .depth, role: "The window, rows", value: .text("none"), source: "isFlat"),
            DesignToken(name: "--elev-ring", group: .depth, role: "Cards, fields, menus", value: .text("0 0 0 1px var(--border)"), source: "cardWell"),
            DesignToken(name: "--focus-ring", group: .depth, role: "Keyboard focus", value: .text("0 0 0 2px var(--fg)"), source: "System focus ring"),
            DesignToken(name: "--motion-fast", group: .motion, role: "State change, hover", value: .duration(milliseconds: 150), source: "Motion.plain"),
            DesignToken(name: "--motion-base", group: .motion, role: "Something arrives", value: .duration(milliseconds: 200), source: "Motion.snap, a 0.20 s spring"),
            DesignToken(name: "--ease-standard", group: .motion, role: "The one curve", value: .text(easeStandard), source: "CSS only: Swift uses springs"),
        ]
        return all
    }
}
