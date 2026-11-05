import CoreText
import SwiftUI
import ArkIslandCore

/// Keep original type sizes and hierarchy, then apply the user's scale and typeface once at font resolution.
/// This supports the app's macOS 14 minimum without relying on newer Font.scaled APIs.
struct AppFont {
    private let resolve: (CGFloat, AppTypeface) -> Font
    /// The size before the user's scale, after `TypeScale.snap`.
    let points: CGFloat
    private init(points: CGFloat, _ resolve: @escaping (CGFloat, AppTypeface) -> Font) {
        self.points = points
        self.resolve = resolve
    }
    /// Any size a view asks for lands on the type scale (2026-11-01 redesign: 38 sizes became five).
    static func system(size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) -> Self {
        let step = TypeScale.snap(size)
        return Self(points: step) { scale, face in AppFonts.font(size: step * scale, weight: weight, design: design, face: face) }
    }
    static var headline: Self { .system(size: 13, weight: .semibold) }
    static var caption2: Self { .system(size: 11) }
    func monospacedDigit() -> Self { Self(points: points) { resolve($0, $1).monospacedDigit() } }
    func font(at size: AppTextSize, face: AppTypeface = .system) -> Font { resolve(size.scale, face) }
}

/// The typefaces behind `AppFont` (Settings > Appearance > Typeface). Monospaced text stays SF Mono in every face.
/// The bundled faces are files in `assets/fonts` (SIL OFL), registered for this process at launch; a face whose file
/// is missing falls back to the system font, so text never disappears.
enum AppFonts {
    /// Families registered from the bundled files. Written once at launch, before any view draws.
    nonisolated(unsafe) private static var registered: Set<String> = []

    static func font(size: CGFloat, weight: Font.Weight, design: Font.Design, face: AppTypeface) -> Font {
        if design == .monospaced { return .system(size: size, weight: weight, design: .monospaced) }
        // 2026-11-02: serif text (page titles in Paper & Teal and Ink & Sage, soul titles) is Instrument Serif when bundled
        // (OFL, assets/fonts); it has one weight, so the asked weight is not used. Otherwise New York.
        if design == .serif, registered.contains("Instrument Serif") { return Font.custom("Instrument Serif", fixedSize: size) }
        guard let family = face.family, !face.bundled || registered.contains(family) else {
            return .system(size: size, weight: weight, design: design)
        }
        return Font.custom(family, fixedSize: size).weight(weight)
    }

    /// Registers the bundled font files once. In ARK.app they are in Resources/fonts (build-app.sh copies them);
    /// in a development build (the gallery) in the repo's `assets/fonts`, found above the executable.
    /// Whether a family was registered (the UIcons font is optional: each Mac downloads its own copy, see `Glyph`).
    static func has(_ family: String) -> Bool { registered.contains(family) }

    static func register() {
        guard registered.isEmpty, let folder = locate() else { return }
        let vendor = folder.appendingPathComponent("vendor", isDirectory: true)
        let files = ((try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [])
            + ((try? FileManager.default.contentsOfDirectory(at: vendor, includingPropertiesForKeys: nil)) ?? [])
        for file in files where ["ttf", "otf", "woff"].contains(file.pathExtension.lowercased()) {
            var error: Unmanaged<CFError>?
            if !CTFontManagerRegisterFontsForURL(file as CFURL, .process, &error) {
                FileHandle.standardError.write(Data("fonts: could not register \(file.lastPathComponent)\n".utf8))
            }
            let descriptors = CTFontManagerCreateFontDescriptorsFromURL(file as CFURL) as? [CTFontDescriptor] ?? []
            for descriptor in descriptors {
                if let family = CTFontDescriptorCopyAttribute(descriptor, kCTFontFamilyNameAttribute) as? String { registered.insert(family) }
            }
        }
    }

    private static func locate() -> URL? {
        if Bundle.main.bundleURL.pathExtension == "app" { return Bundle.main.resourceURL?.appendingPathComponent("fonts", isDirectory: true) }
        var folder = Bundle.main.executableURL?.deletingLastPathComponent().standardizedFileURL
        while let current = folder, current.pathComponents.count > 1 {
            let candidate = current.appendingPathComponent("assets/fonts", isDirectory: true)
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            folder = current.deletingLastPathComponent()
        }
        return nil
    }
}

private struct AppTextSizeKey: EnvironmentKey { static let defaultValue = AppTextSize.standard }
private struct AppTypefaceKey: EnvironmentKey { static let defaultValue = AppTypeface.system }
extension EnvironmentValues {
    var appTextSize: AppTextSize {
        get { self[AppTextSizeKey.self] }
        set { self[AppTextSizeKey.self] = newValue }
    }
    var appTypeface: AppTypeface {
        get { self[AppTypefaceKey.self] }
        set { self[AppTypefaceKey.self] = newValue }
    }
}

private struct AppFontModifier: ViewModifier {
    let font: AppFont
    @Environment(\.appTextSize) private var size
    @Environment(\.appTypeface) private var face
    func body(content: Content) -> some View {
        content.font(font.font(at: size, face: face)).environment(\.glyphPointSize, font.points * size.scale)
    }
}

private struct GlyphPointSizeKey: EnvironmentKey { static let defaultValue: CGFloat = 13 }
extension EnvironmentValues {
    /// The point size of the text around an icon, so a `Glyph` matches it.
    var glyphPointSize: CGFloat {
        get { self[GlyphPointSizeKey.self] }
        set { self[GlyphPointSizeKey.self] = newValue }
    }
}

extension View {
    func appFont(_ font: AppFont) -> some View { modifier(AppFontModifier(font: font)) }

    /// The user's text size and typeface for a surface's content.
    func appTypography(_ settings: IslandSettings) -> some View {
        environment(\.appTextSize, settings.textSize).environment(\.appTypeface, settings.typeface)
    }
}

extension Text {
    /// Inline concatenation and Canvas require Text, rather than an opaque modified View.
    func appFont(_ font: AppFont, scaledBy size: AppTextSize, face: AppTypeface = .system) -> Text { self.font(font.font(at: size, face: face)) }
}

extension ThemePalette {
    /// A page's title: a larger serif in the editorial themes (`serifTitles`), else the usual semibold sans.
    func pageTitleFont(_ size: CGFloat = 20) -> AppFont {
        serifTitles ? .system(size: size + 8, design: .serif) : .system(size: size, weight: .semibold)
    }

    func appIdentifierFont(_ font: AppFont, size: CGFloat, weight: Font.Weight = .regular) -> AppFont {
        monoIdentifiers ? .system(size: size, weight: weight, design: .monospaced) : font
    }
}
