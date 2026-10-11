import AppKit
import SwiftUI
import ZenoIslandCore

/// ADR-091: ZENO.app's icon, in the app's own look: Pal on the black Void tile with its graphite hairline and a faint
/// glow of Pal's light behind it. Rendered at 1024 × 1024 (`ZENO_ISLAND_GALLERY_ONLY=icon`); `scripts/make-icon.sh`
/// turns it into `assets/icon/ZENO.icns`.
@MainActor
enum AppIconArt {
    static let size: CGFloat = 1024
    /// Apple's grid: the tile is 824 of 1024, with room for its shadow.
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
        let shape = RoundedRectangle(cornerRadius: tile * 0.225, style: .continuous)
        let light = Color(red: 0.56, green: 0.83, blue: 1.0)
        return ZStack {
            shape.fill(Color.black)
                .shadow(color: .black.opacity(0.35), radius: 18, y: 10)
            // Pal's light, faint, behind it.
            shape.fill(RadialGradient(colors: [light.opacity(0.16), .clear], center: UnitPoint(x: 0.5, y: 0.56), startRadius: 0, endRadius: tile * 0.5))
            shape.strokeBorder(Color(red: 0.16, green: 0.18, blue: 0.19), lineWidth: 6)
            if let pal = PalLibrary.pal {
                PalPortrait(character: pal, animation: "idle", time: 6.0, size: tile * 0.78, glow: false)
                    .offset(y: tile * 0.02)
            }
        }
        .frame(width: tile, height: tile)
        .frame(width: size, height: size)
    }
}
