import AppKit
import CoreImage
import SwiftUI
import ArkIslandCore

/// ADR-277: the translucent window. A snapshot cannot draw the system's blur of the desktop, so these shots emulate it: the
/// window sits on a wallpaper-like colour field, and inside the window the same field is blurred. The system material's own
/// tint is not drawn, so the shots are a little more see-through than the screen (the worst case for contrast).
extension IslandGallery {
    enum Wallpaper: String { case dusk, bright, night }

    /// Dark (Void) and light (Daylight) at each strength over a dusk photo; then each at high strength over its worst desktop.
    static func writeTranslucent(to directory: URL) {
        let shots: [(AppTheme, String, TranslucencyStrength, Wallpaper)] =
            TranslucencyStrength.allCases.flatMap { s in [(AppTheme.void, "dark", s, Wallpaper.dusk), (.daylight, "light", s, .dusk)] }
            + [(.void, "dark", .high, .bright), (.daylight, "light", .high, .night)]
        for (theme, look, strength, wallpaper) in shots {
            let (model, suite) = translucentModel(theme: theme, strength: strength, suite: "\(look).\(strength.rawValue).\(wallpaper.rawValue)")
            defer { UserDefaults().removePersistentDomain(forName: suite) }
            let suffix = wallpaper == .dusk ? "" : "-\(wallpaper.rawValue)"
            save(onDesktop(HelpersView(model: model).environment(\.islandSnapshot, true), wallpaper: wallpaper),
                 name: "55-translucent-\(look)-\(strength.title.lowercased())\(suffix)", to: directory)
        }
    }

    /// A chat with a short exchange and a translucent window, in a throwaway defaults suite.
    private static func translucentModel(theme: AppTheme, strength: TranslucencyStrength, suite: String) -> (IslandModel, String) {
        let name = "ark.gallery.translucent.\(suite).\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        let model = IslandModel(settings: IslandSettings(defaults: defaults))
        model.settings.theme = theme
        model.settings.ownerName = "Alex" // no first-run name sheet over the window
        model.settings.translucentWindow = true
        model.settings.translucencyStrength = strength
        model.status.apply(.running(pid: 1))
        if let event = try? decodeEvent(#"{"type":"chats","current":"cedar","chats":[{"id":"cedar","title":"Cedar launch","updatedAt":"2026-10-19T00:00:00Z","messages":2},{"id":"notes","title":"Release notes","updatedAt":"2026-10-18T00:00:00Z","messages":4}]}"#) { model.apply(event) }
        if let event = try? decodeEvent(#"{"type":"state","state":"idle"}"#) { model.apply(event); model.status.apply(event) }
        model.conversation.replay([
            ChatLine(fromUser: true, text: "What is left before the Cedar launch?"),
            ChatLine(fromUser: false, text: "Three things:\n\n1. **Links**: two pages still point to the old docs.\n2. **Notes**: the blog post needs a last read.\n3. **Tests**: the cart suite passed on the second run.\n\nI can fix the links now if you like."),
        ])
        return (model, name)
    }

    /// The window over a desktop: sharp wallpaper outside, the same wallpaper blurred inside, as `NSVisualEffectView` draws it.
    private static func onDesktop(_ window: some View, wallpaper: Wallpaper) -> some View {
        let canvas = CGSize(width: 1200, height: 860), inset: CGFloat = 50
        let size = CGSize(width: canvas.width - inset * 2, height: canvas.height - inset * 2)
        return ZStack(alignment: .topLeading) {
            WallpaperField(kind: wallpaper)
            ZStack {
                blurred(WallpaperField(kind: wallpaper).frame(width: canvas.width, height: canvas.height))
                    .resizable().frame(width: canvas.width, height: canvas.height)
                    .offset(x: -inset, y: -inset)
                    .frame(width: size.width, height: size.height, alignment: .topLeading).clipped()
                window.frame(width: size.width, height: size.height)
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .shadow(color: .black.opacity(0.35), radius: 24, y: 10)
            .offset(x: inset, y: inset)
        }
        .frame(width: canvas.width, height: canvas.height)
    }

    /// The view drawn, then blurred by Core Image (SwiftUI's `.blur` draws in tiles under `ImageRenderer`).
    private static func blurred(_ view: some View, radius: Double = 40) -> Image {
        let renderer = ImageRenderer(content: view)
        guard let cg = renderer.cgImage else { return Image(systemName: "questionmark") }
        let input = CIImage(cgImage: cg)
        let output = input.clampedToExtent().applyingGaussianBlur(sigma: radius).cropped(to: input.extent)
        guard let image = CIContext().createCGImage(output, from: input.extent) else { return Image(systemName: "questionmark") }
        return Image(decorative: image, scale: 1)
    }
}

/// A photo-like desktop: a sky, a sun or clouds, and hills, with hard edges so the blur shows.
private struct WallpaperField: View {
    let kind: IslandGallery.Wallpaper

    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width, h = proxy.size.height
            ZStack {
                LinearGradient(colors: sky, startPoint: .top, endPoint: .bottom)
                ForEach(Array(spots.enumerated()), id: \.offset) { _, spot in
                    Ellipse().fill(spot.color).frame(width: spot.w * w, height: spot.h * h).position(x: spot.x * w, y: spot.y * h)
                }
                hill(w, h, peak: 0.55, height: 0.58).fill(ground.0)
                hill(w, h, peak: 0.25, height: 0.72).fill(ground.1)
            }
        }
    }

    private var sky: [Color] {
        switch kind {
        case .dusk: [Color(red: 0.11, green: 0.16, blue: 0.42), Color(red: 0.78, green: 0.36, blue: 0.42), Color(red: 0.98, green: 0.62, blue: 0.30)]
        case .bright: [Color(red: 0.72, green: 0.87, blue: 1.0), .white]
        case .night: [Color(red: 0.01, green: 0.01, blue: 0.03), Color(red: 0.04, green: 0.05, blue: 0.10)]
        }
    }

    private var spots: [(color: Color, x: Double, y: Double, w: Double, h: Double)] {
        switch kind {
        case .dusk: [(Color(red: 1, green: 0.85, blue: 0.48), 0.70, 0.52, 0.16, 0.22), (Color(red: 0.45, green: 0.30, blue: 0.70).opacity(0.7), 0.20, 0.25, 0.45, 0.25)]
        case .bright: [(.white, 0.25, 0.22, 0.35, 0.16), (.white, 0.70, 0.35, 0.40, 0.18), (.white, 0.50, 0.12, 0.25, 0.10)]
        case .night: [(Color(red: 0.12, green: 0.14, blue: 0.30).opacity(0.6), 0.75, 0.20, 0.30, 0.25)]
        }
    }

    private var ground: (Color, Color) {
        switch kind {
        case .dusk: (Color(red: 0.24, green: 0.12, blue: 0.30), Color(red: 0.10, green: 0.05, blue: 0.16))
        case .bright: (Color(red: 0.95, green: 0.90, blue: 0.80), Color(red: 0.99, green: 0.97, blue: 0.93))
        case .night: (Color(red: 0.02, green: 0.02, blue: 0.04), .black)
        }
    }

    /// A smooth hill from the left edge to the right edge; `height` is where its top is, as a fraction from the top.
    private func hill(_ w: Double, _ h: Double, peak: Double, height: Double) -> Path {
        Path { p in
            p.move(to: CGPoint(x: 0, y: h))
            p.addLine(to: CGPoint(x: 0, y: h * (height + 0.12)))
            p.addQuadCurve(to: CGPoint(x: w, y: h * (height + 0.08)), control: CGPoint(x: w * peak, y: h * (height - 0.25)))
            p.addLine(to: CGPoint(x: w, y: h))
            p.closeSubpath()
        }
    }
}

// MARK: - A real translucent window for a manual check (ADR-277)

extension IslandGallery {
    private static var liveWindow: NSWindow?
    private static var liveModel: IslandModel?

    /// Development only (`ARK_ISLAND_GALLERY_ONLY=translucent-live`): shows a translucent window with sample data over the desktop
    /// for `ARK_ISLAND_GALLERY_SECONDS` (default 8) seconds, prints its window number for `screencapture -l`, then quits. No
    /// runtime, no network and a throwaway defaults suite, so it can run next to a running ARK. `ARK_ISLAND_GALLERY_THEME=light`
    /// draws Daylight; the strength is `ARK_ISLAND_GALLERY_STRENGTH` (low, medium or high).
    static func showTranslucentLive() {
        let theme: AppTheme = ArkEnv.read("ARK_ISLAND_GALLERY_THEME") == "light" ? .daylight : .void
        let strength = TranslucencyStrength.allCases.first { $0.title.lowercased() == ArkEnv.read("ARK_ISLAND_GALLERY_STRENGTH") } ?? .medium
        let (model, suite) = translucentModel(theme: theme, strength: strength, suite: "live")
        model.settings.reduceTransparency = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
        model.settings.increaseContrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
        let window = NSWindow(contentRect: NSRect(x: 120, y: 120, width: 1100, height: 760),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        let hosting = NSHostingView(rootView: HelpersView(model: model))
        hosting.sizingOptions = []
        window.contentView = hosting
        DesktopWindowAppearance.apply(to: window, palette: ChatAppearance.palette(settings: model.settings), translucent: model.settings.translucentShown)
        window.orderFrontRegardless()
        (liveWindow, liveModel) = (window, model)
        print("gallery-live: window \(window.windowNumber) translucent \(model.settings.translucentShown)")
        fflush(stdout)
        let seconds = Double(ArkEnv.read("ARK_ISLAND_GALLERY_SECONDS") ?? "") ?? 8
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
            UserDefaults().removePersistentDomain(forName: suite)
            exit(0) // NSApp.terminate does not end this mode, which skips the app's normal start
        }
    }
}
