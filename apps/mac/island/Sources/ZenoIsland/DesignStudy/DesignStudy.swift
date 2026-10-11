import AppKit
import SwiftUI
import ZenoIslandCore

// Gallery only (sheet 14-design-study, docs/design/design-study.md): three candidate visual directions for the
// panel, drawn with sample content. Nothing here is used by the live app; it reads no model and changes no setting.

@MainActor
enum DesignStudy {
    static func render(to directory: URL) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        save(StudySheet(title: "A. Lantern", idea: "Pal's light is the only colour. State is shown by how bright it burns.",
                        wallpaper: .night) {
            LanternPanel(page: .conversation)
            LanternPanel(page: .settings)
        }, name: "14-design-study-a-lantern", to: directory)
        save(StudySheet(title: "B. Mist", idea: "Daylight and ink. Pal speaks in a serif voice; the glow lives only on Pal.",
                        wallpaper: .day) {
            MistPanel(page: .conversation)
            MistPanel(page: .settings)
        }, name: "14-design-study-b-mist", to: directory)
        save(StudySheet(title: "C. Halo", idea: "A black island that grows from the menu bar. Its rim carries Pal's state colour.",
                        wallpaper: .dusk) {
            HaloPanel(page: .conversation)
            HaloPanel(page: .settings)
        }, name: "14-design-study-c-halo", to: directory)
        save(LanternExtrasSheet(), name: "14-design-study-a-lantern-bubble-helpers", to: directory)
    }

    static func save(_ view: some View, name: String, to directory: URL) {
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
              let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else {
            FileHandle.standardError.write(Data("design study: could not render \(name)\n".utf8))
            return
        }
        try? png.write(to: directory.appendingPathComponent("\(name).png"))
    }
}

/// A colour from a 0xRRGGBB literal (study files only; the live app takes colours from `ThemePalette`).
func hx(_ value: UInt32, _ opacity: Double = 1) -> Color {
    RGBA(hex: value, alpha: opacity).color
}

enum StudyPage { case conversation, settings }

/// The sample conversation every direction shows: one finished turn, then a reply still arriving.
enum StudyCopy {
    static let ask1 = "What's on my calendar this afternoon?"
    static let reply1 = "You have a design review at 3 and a call with Aiko at 4:30. Nothing after that."
    static let ask2 = "Remind me to send the deck before the call."
    /// The streaming reply: settled words, then the newest words still fading in.
    static let reply2Settled = "Done. I'll remind you at 4:15 to send the deck"
    static let reply2Arriving = ["before", "your", "call"]

    struct Page { let symbol: String; let title: String; let value: String }
    static let talking: [Page] = [
        Page(symbol: "sparkle.magnifyingglass", title: "What can I ask?", value: "6 tools"),
        Page(symbol: "command", title: "Shortcuts", value: "⌃⌥"),
        Page(symbol: "mic", title: "Dictation", value: "Hold or tap"),
    ]
    static let look: [Page] = [
        Page(symbol: "paintpalette", title: "Appearance", value: "Lantern, Ghost"),
        Page(symbol: "face.smiling", title: "Pal", value: "Medium"),
    ]
    static let mind: [Page] = [
        Page(symbol: "brain", title: "Memory", value: "3 facts"),
        Page(symbol: "gearshape", title: "General", value: "Sounds on"),
    ]
}

/// A desktop behind each panel, so its glass and shadow read as they would on screen.
enum StudyWallpaper {
    case night, day, dusk

    @ViewBuilder var view: some View {
        switch self {
        case .night:
            ZStack {
                LinearGradient(colors: [hx(0x1B2440), hx(0x2B3558), hx(0x3A3F66)], startPoint: .topLeading, endPoint: .bottomTrailing)
                Circle().fill(hx(0x5C7BC7, 0.45)).frame(width: 520).blur(radius: 120).offset(x: -260, y: 220)
                Circle().fill(hx(0x8A6BB8, 0.35)).frame(width: 420).blur(radius: 110).offset(x: 300, y: -120)
            }
        case .day:
            ZStack {
                LinearGradient(colors: [hx(0xC9D7E8), hx(0xDCE4EE), hx(0xE9E2DA)], startPoint: .top, endPoint: .bottom)
                Circle().fill(hx(0x9FC2E6, 0.55)).frame(width: 520).blur(radius: 120).offset(x: -280, y: 200)
                Circle().fill(hx(0xF2D3B8, 0.5)).frame(width: 420).blur(radius: 120).offset(x: 320, y: -140)
            }
        case .dusk:
            ZStack {
                LinearGradient(colors: [hx(0x2A2F45), hx(0x4A3E5C), hx(0x7A5A63)], startPoint: .top, endPoint: .bottom)
                Circle().fill(hx(0xE0926E, 0.35)).frame(width: 520).blur(radius: 130).offset(x: 260, y: 260)
                Circle().fill(hx(0x5E6FB0, 0.4)).frame(width: 460).blur(radius: 120).offset(x: -300, y: -100)
            }
        }
    }

    var isLight: Bool { self == .day }
}

/// A presentation sheet: a heading, then each panel hanging from a sample menu bar over the wallpaper.
struct StudySheet<Content: View>: View {
    let title: String
    let idea: String
    let wallpaper: StudyWallpaper
    @ViewBuilder let content: Content

    var body: some View {
        let ink = wallpaper.isLight ? hx(0x1B2A44) : Color.white
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 22, weight: .semibold, design: .rounded)).foregroundStyle(ink)
                Text(idea).font(.system(size: 13)).foregroundStyle(ink.opacity(0.72))
            }
            HStack(alignment: .top, spacing: 28) { content }
        }
        .padding(.horizontal, 32)
        .padding(.top, 28)
        .padding(.bottom, 36)
        .background(wallpaper.view)
        .clipped()
    }
}

/// A slice of a menu bar with ZENO's item, drawn above a panel so the item and the panel read together.
struct StudyMenuBar<Item: View>: View {
    var light = false
    @ViewBuilder let item: Item

    var body: some View {
        let ink = light ? hx(0x1B2A44) : Color.white
        HStack(spacing: 14) {
            Spacer()
            item
            Image(systemName: "wifi").font(.system(size: 12, weight: .semibold)).foregroundStyle(ink.opacity(0.85))
            Image(systemName: "battery.75percent").font(.system(size: 13)).foregroundStyle(ink.opacity(0.85))
            Text("Sat 10 Oct  16:52").font(.system(size: 12.5, weight: .medium)).foregroundStyle(ink.opacity(0.9))
        }
        .padding(.horizontal, 12)
        .frame(height: 26)
        .background(light ? Color.white.opacity(0.45) : Color.black.opacity(0.22))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}
