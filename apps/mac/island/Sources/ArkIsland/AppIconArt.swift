import AppKit
import SwiftUI
import ArkIslandCore

/// ARK.app's icon (2026-11-01 redesign): an arch, the ark, standing on one warm bar, on a flat graphite tile. No gradient, glow,
/// ring, hairline or shadow (taste-skill tells). The tile keeps Apple's icon shape, which macOS expects. Rendered at 1024 × 1024
/// (`ARK_ISLAND_GALLERY_ONLY=icon`); `scripts/make-icon.sh` turns it into `assets/icon/ARK.icns`.
@MainActor
enum AppIconArt {
    static let size: CGFloat = 1024
    /// Apple's grid: the tile is 824 of 1024.
    static let tile: CGFloat = 824

    static func render(to directory: URL) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let renderer = ImageRenderer(content: icon)
        renderer.scale = 1
        guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
              let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else {
            FileHandle.standardError.write(Data("icon: could not render\n".utf8))
            return
        }
        try? png.write(to: directory.appendingPathComponent("icon-1024.png"))
    }

    static var icon: some View {
        ZStack {
            RoundedRectangle(cornerRadius: tile * 0.225, style: .continuous).fill(RGBA.oklch(0.2, 0.004, 50).color)
            ArchMark().fill(RGBA.oklch(0.96, 0.004, 80).color)
                .frame(width: tile * 0.5, height: tile * 0.4)
                .offset(y: -tile * 0.04)
            Rectangle().fill(AppTheme.ember.tone.accent.color)
                .frame(width: tile * 0.56, height: tile * 0.065)
                .offset(y: tile * 0.215)
        }
        .frame(width: tile, height: tile)
        .frame(width: size, height: size)
    }
}

/// An arch: a half ring on two straight legs, the legs as thick as the ring.
struct ArchMark: Shape {
    func path(in rect: CGRect) -> Path {
        let outer = rect.width / 2, thickness = rect.width * 0.2, inner = outer - thickness
        let center = CGPoint(x: rect.midX, y: rect.minY + outer)
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX, y: center.y))
        p.addArc(center: center, radius: outer, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.maxX - thickness, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.maxX - thickness, y: center.y))
        p.addArc(center: center, radius: inner, startAngle: .degrees(0), endAngle: .degrees(180), clockwise: true)
        p.addLine(to: CGPoint(x: rect.minX + thickness, y: rect.maxY))
        p.closeSubpath()
        return p
    }
}
