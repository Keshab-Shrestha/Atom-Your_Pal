import AppKit
import SwiftUI
import AtomIslandCore

/// ADR-091: ATOM.app's icon, in the app's own look: Pal on the black Void tile with its graphite hairline and a faint
/// glow of Pal's light behind it. Rendered at 1024 × 1024 (`ATOM_ISLAND_GALLERY_ONLY=icon`); `scripts/make-icon.sh`
/// turns it into `assets/icon/ATOM.icns`.
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
        let light = Color(red: 0.49, green: 0.92, blue: 0.81)
        return ZStack {
            shape.fill(LinearGradient(colors: [Color(red: 0.07, green: 0.25, blue: 0.25), Color(red: 0.025, green: 0.095, blue: 0.13)], startPoint: .topLeading, endPoint: .bottomTrailing))
                .shadow(color: .black.opacity(0.25), radius: 18, y: 10)
            shape.fill(RadialGradient(colors: [light.opacity(0.22), .clear], center: UnitPoint(x: 0.35, y: 0.3), startRadius: 0, endRadius: tile * 0.8))
            Ellipse().strokeBorder(light.opacity(0.28), lineWidth: 3)
                .frame(width: tile * 0.83, height: tile * 0.44).rotationEffect(.degrees(-24))
            shape.strokeBorder(.white.opacity(0.2), lineWidth: 3)
            if let pal = PalLibrary.pal {
                PalPortrait(character: pal, animation: "idle", time: 0.6, size: tile * 0.94, glow: false)
            }
        }
        .frame(width: tile, height: tile)
        .frame(width: size, height: size)
    }
}
