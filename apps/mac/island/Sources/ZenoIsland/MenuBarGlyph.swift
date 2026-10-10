import AppKit
import ZenoIslandCore

/// Wisp's silhouette for the menu bar (ADR-084), drawn here rather than taken from any icon set: a dome, a
/// three-scallop hem and two eyes cut out, so the bar shows through them.
@MainActor
enum MenuBarGlyph {
    /// The image's size: a menu-bar icon, with room around the glyph for the glow.
    static let canvas = NSSize(width: 20, height: 18)
    private static let glyph = NSSize(width: 13, height: 14)

    /// The status item's image. Plain is a template; the coloured ones pick their shade when drawn, from the
    /// menu bar's appearance (light or dark), so they read on both.
    static func image(_ light: MenuBarLight, description: String) -> NSImage {
        let image = NSImage(size: canvas, flipped: true) { rect in
            let dark = NSAppearance.currentDrawing().bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            draw(light, dark: dark, in: rect)
            return true
        }
        image.isTemplate = light.isTemplate
        image.accessibilityDescription = description
        return image
    }

    /// For the gallery: the same drawing for a known menu-bar appearance, optionally enlarged.
    static func image(_ light: MenuBarLight, dark: Bool, scale: CGFloat = 1) -> NSImage {
        let image = NSImage(size: NSSize(width: canvas.width * scale, height: canvas.height * scale), flipped: true) { _ in
            NSGraphicsContext.current?.cgContext.scaleBy(x: scale, y: scale)
            draw(light, dark: dark, in: NSRect(origin: .zero, size: canvas))
            return true
        }
        image.isTemplate = light.isTemplate
        return image
    }

    private static func draw(_ light: MenuBarLight, dark: Bool, in rect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        let frame = CGRect(x: rect.midX - glyph.width / 2, y: rect.midY - glyph.height / 2 + 0.5, width: glyph.width, height: glyph.height)
        let path = silhouette(in: frame)
        let (fill, glow) = colours(light, dark: dark)
        context.saveGState()
        if let glow { context.setShadow(offset: .zero, blur: 4, color: glow.cgColor) }
        context.addPath(path)
        context.setFillColor(fill.cgColor)
        context.fillPath(using: .evenOdd)
        context.restoreGState()
    }

    /// Body colour and glow. Plain is black (a template: macOS recolours it). Lit is Wisp's light with its glow; on a
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

    /// The outline in a y-down rect: dome to the shoulders, straight sides, three scallops along the hem, and two
    /// slightly tall eyes (cut out with the even-odd rule).
    static func silhouette(in r: CGRect) -> CGPath {
        let p = CGMutablePath()
        let (x, y, w, h) = (r.minX, r.minY, r.width, r.height)
        let shoulder = y + h * 0.48
        let hem = y + h * 0.86
        p.move(to: CGPoint(x: x, y: shoulder))
        p.addCurve(to: CGPoint(x: x + w, y: shoulder), control1: CGPoint(x: x, y: y - h * 0.14), control2: CGPoint(x: x + w, y: y - h * 0.14))
        p.addLine(to: CGPoint(x: x + w, y: hem))
        let step = w / 3
        for i in 0..<3 {
            let right = x + w - CGFloat(i) * step
            p.addQuadCurve(to: CGPoint(x: right - step, y: hem), control: CGPoint(x: right - step / 2, y: y + h * 1.12))
        }
        p.closeSubpath()
        let eye = CGSize(width: w * 0.16, height: w * 0.21)
        p.addEllipse(in: CGRect(x: x + w * 0.27, y: y + h * 0.33, width: eye.width, height: eye.height))
        p.addEllipse(in: CGRect(x: x + w * 0.57, y: y + h * 0.33, width: eye.width, height: eye.height))
        return p
    }
}
