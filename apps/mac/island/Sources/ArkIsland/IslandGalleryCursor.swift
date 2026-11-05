import AppKit

extension IslandGallery {
    /// 2026-11-02: the fingertip agent pointer at four times its size on a dark and a light ground, idle and active, with the
    /// arrival ring halfway out. A red dot marks `CursorArt.tip`, where ARK acts.
    static func writeAgentCursor(to directory: URL) {
        let scale: CGFloat = 4, size = CursorArt.size
        let width = Int(size.width * scale) * 4, height = Int(size.height * scale)
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4,
                                         hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: rep) else { return }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        for (index, (ground, active, ripple)) in [(NSColor(white: 0.1, alpha: 1), false, false), (NSColor(white: 0.1, alpha: 1), true, true),
                                                  (NSColor(white: 0.96, alpha: 1), false, false), (NSColor(white: 0.96, alpha: 1), true, true)].enumerated() {
            let x = CGFloat(index) * size.width * scale
            ground.setFill()
            NSRect(x: x, y: 0, width: size.width * scale, height: size.height * scale).fill()
            let art = CursorArt(frame: NSRect(origin: .zero, size: size))
            art.active = active
            if ripple { art.showRipple(at: 0.5) }
            let image = NSImage(size: size, flipped: true) { _ in
                art.draw(art.bounds)
                return true
            }
            image.draw(in: NSRect(x: x, y: 0, width: size.width * scale, height: size.height * scale))
            NSColor.red.setFill()
            NSBezierPath(ovalIn: NSRect(x: x + CursorArt.tip.x * scale - 3, y: CursorArt.tip.y * scale - 3, width: 6, height: 6)).fill()
        }
        NSGraphicsContext.restoreGraphicsState()
        try? rep.representation(using: .png, properties: [:])?.write(to: directory.appendingPathComponent("49-agent-cursor.png"))
    }

    /// 2026-11-05 (ADR-249): the main cursor and three lane cursors, each tinted and wearing its lane's name, on a dark ground.
    static func writeAgentCursorLanes(to directory: URL) {
        let scale: CGFloat = 4
        let looks: [(NSColor?, String)] = [(nil, ""), (AgentCursorController.laneTints[0], "a"), (AgentCursorController.laneTints[1], "notes"), (AgentCursorController.laneTints[2], "mail")]
        let width = Int(looks.reduce(CGFloat(0)) { $0 + CursorArt.size(label: $1.1).width } * scale), height = Int(CursorArt.size.height * scale)
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4,
                                         hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: rep) else { return }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        NSColor(white: 0.1, alpha: 1).setFill()
        NSRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)).fill()
        var x: CGFloat = 0
        for (tint, label) in looks {
            let size = CursorArt.size(label: label)
            let art = CursorArt(frame: NSRect(origin: .zero, size: size))
            art.tint = tint
            art.label = label
            art.active = true
            let image = NSImage(size: size, flipped: true) { _ in
                art.draw(art.bounds)
                return true
            }
            image.draw(in: NSRect(x: x, y: 0, width: size.width * scale, height: size.height * scale))
            x += size.width * scale
        }
        NSGraphicsContext.restoreGraphicsState()
        try? rep.representation(using: .png, properties: [:])?.write(to: directory.appendingPathComponent("50-agent-cursor-lanes.png"))
    }
}
