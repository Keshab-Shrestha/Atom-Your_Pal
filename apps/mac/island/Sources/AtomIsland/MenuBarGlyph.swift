import AppKit
import AtomIslandCore

/// Pal's silhouette for the menu bar (ADR-084), drawn here rather than taken from any icon set. It is Pal's own
/// ghost body (`PalView`'s round, egg-shaped head whose sides draw in toward the hem), with the hem as one soft
/// wave trailing into a tail that sweeps down to the left as if Pal were drifting right, and Pal's tall eyes,
/// glancing the way it floats, cut out so the bar shows through. No flat bottom, no row of even feet.
@MainActor
enum MenuBarGlyph {
    /// The image's size: a menu-bar icon, with room around the glyph for the glow.
    static let canvas = NSSize(width: 20, height: 18)
    private static let glyph = NSSize(width: 13.6, height: 16)

    /// The status item's image. Plain is a template; the coloured ones pick their shade when drawn, from the
    /// menu bar's appearance (light or dark), so they read on both.
    /// `flat`: Void's flat status colours with no glow (ADR-086).
    static func image(_ light: MenuBarLight, flat: Bool = false, description: String) -> NSImage {
        let image = NSImage(size: canvas, flipped: true) { rect in
            let dark = NSAppearance.currentDrawing().bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            draw(light, dark: dark, flat: flat, in: rect)
            return true
        }
        image.isTemplate = light.isTemplate
        image.accessibilityDescription = description
        return image
    }

    /// For the gallery: the same drawing for a known menu-bar appearance, optionally enlarged.
    static func image(_ light: MenuBarLight, dark: Bool, scale: CGFloat = 1, flat: Bool = false) -> NSImage {
        let image = NSImage(size: NSSize(width: canvas.width * scale, height: canvas.height * scale), flipped: true) { _ in
            NSGraphicsContext.current?.cgContext.scaleBy(x: scale, y: scale)
            draw(light, dark: dark, flat: flat, in: NSRect(origin: .zero, size: canvas))
            return true
        }
        image.isTemplate = light.isTemplate
        return image
    }

    private static func draw(_ light: MenuBarLight, dark: Bool, flat: Bool, in rect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        let frame = CGRect(x: rect.midX - glyph.width / 2, y: rect.midY - glyph.height / 2 + 0.5, width: glyph.width, height: glyph.height)
        let path = silhouette(in: frame)
        let (fill, glow) = flat ? (flatColour(light, dark: dark), nil) : colours(light, dark: dark)
        context.saveGState()
        if let glow { context.setShadow(offset: .zero, blur: 4, color: glow.cgColor) }
        context.addPath(path)
        context.setFillColor(fill.cgColor)
        context.fillPath(using: .evenOdd)
        context.restoreGState()
    }

    /// Body colour and glow. Plain is black (a template: macOS recolours it). Lit is Pal's light with its glow; on a
    /// light bar the body is the deeper Lantern Day blue so it still reads, with the same glow around it.
    private static func colours(_ light: MenuBarLight, dark: Bool) -> (NSColor, NSColor?) {
        let night = ThemePalette.lantern, day = ThemePalette.lanternDay
        switch light {
        case .plain: return (.black, nil)
        case .lit: return ((dark ? night.accent : day.accent).nsColor, night.glow.with(alpha: dark ? 0.95 : 0.8).nsColor)
        case .attention: return ((dark ? night.attention : day.attention).nsColor, nil)
        case .problem: return ((dark ? night.problem : day.problem).nsColor, nil)
        }
    }

    /// Void (ADR-086): one flat colour, no glow. On a dark bar Void's status colours (blue listening, amber, red); on
    /// a light bar, where those would not read, Lantern Day's deeper blue, amber and red.
    private static func flatColour(_ light: MenuBarLight, dark: Bool) -> NSColor {
        let night = ThemePalette.void, day = ThemePalette.lanternDay
        switch light {
        case .plain: return .black
        case .lit: return (dark ? night.live : day.live).nsColor
        case .attention: return (dark ? night.attention : day.attention).nsColor
        case .problem: return (dark ? night.problem : day.problem).nsColor
        }
    }

    /// The outline in a y-down rect, from Pal's 64-point drawing space (the body spans x 9.5...52, y 7...59).
    static func silhouette(in r: CGRect) -> CGPath {
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: r.minX + (x - 9.5) / 42.5 * r.width, y: r.minY + (y - 7) / 52 * r.height)
        }
        let path = CGMutablePath()
        path.move(to: p(32, 8))
        // A round head, its right side drawing in toward the hem.
        path.addCurve(to: p(52, 30.5), control1: p(45.5, 8), control2: p(52, 18.5))
        path.addCurve(to: p(47.5, 48), control1: p(52, 38.5), control2: p(50.5, 44.5))
        // The hem: one soft lobe, a gentle rise, then the tail flicking out and down to the left.
        path.addCurve(to: p(38.5, 50.5), control1: p(45, 53), control2: p(41, 53.5))
        path.addCurve(to: p(30.5, 50.5), control1: p(36.5, 48), control2: p(33, 48))
        path.addCurve(to: p(9.5, 58), control1: p(25.5, 54.5), control2: p(15, 59))
        // The tail's upper edge curls back in to the body, then the left side rises and rounds over the head.
        path.addCurve(to: p(14.5, 45), control1: p(12.5, 54.5), control2: p(14.5, 50.5))
        path.addCurve(to: p(12.5, 30.5), control1: p(14.5, 40), control2: p(12.5, 36))
        path.addCurve(to: p(32, 8), control1: p(12.5, 18.5), control2: p(18.5, 8))
        path.closeSubpath()
        // Pal's eyes: tall ovals, a little to the right, looking where it drifts.
        for x in [27.6, 40.4] as [CGFloat] {
            let centre = p(x, 28.5)
            let size = CGSize(width: 6.4 / 42.5 * r.width, height: 9.4 / 52 * r.height)
            path.addEllipse(in: CGRect(x: centre.x - size.width / 2, y: centre.y - size.height / 2, width: size.width, height: size.height))
        }
        return path
    }
}
