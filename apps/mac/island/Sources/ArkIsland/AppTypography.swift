import CoreText
import SwiftUI
import ArkIslandCore

/// Keep original type sizes and hierarchy, then apply the user's scale and typeface once at font resolution.
/// This supports the app's macOS 14 minimum without relying on newer Font.scaled APIs.
struct AppFont {
    private let resolve: (CGFloat, AppTypeface) -> Font
    private init(_ resolve: @escaping (CGFloat, AppTypeface) -> Font) { self.resolve = resolve }
    static func system(size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) -> Self {
        Self { scale, face in AppFonts.font(size: size * scale, weight: weight, design: design, face: face) }
    }
    static var headline: Self { .system(size: 13, weight: .semibold) }
    static var caption2: Self { .system(size: 10) }
    func monospacedDigit() -> Self { Self { resolve($0, $1).monospacedDigit() } }
    func font(at size: AppTextSize, face: AppTypeface = .system) -> Font { resolve(size.scale, face) }
}

/// The typefaces behind `AppFont` (Settings > Appearance > Typeface). Monospaced text stays SF Mono in every face.
/// Inter and Geist are files in `assets/fonts` (SIL OFL), registered for this process at launch; a face whose file
/// is missing falls back to the system font, so text never disappears.
enum AppFonts {
    /// Families registered from the bundled files. Written once at launch, before any view draws.
    nonisolated(unsafe) private static var registered: Set<String> = []

    static func font(size: CGFloat, weight: Font.Weight, design: Font.Design, face: AppTypeface) -> Font {
        if design == .monospaced { return .system(size: size, weight: weight, design: .monospaced) }
        switch face {
        case .system: return .system(size: size, weight: weight, design: design)
        case .rounded: return .system(size: size, weight: weight, design: design == .serif ? .serif : .rounded)
        case .inter, .geist:
            guard let family = face.family, registered.contains(family) else {
                return .system(size: size, weight: weight, design: design)
            }
            return Font.custom(family, fixedSize: size).weight(weight)
        }
    }

    /// Registers the bundled font files once. In ARK.app they are in Resources/fonts (build-app.sh copies them);
    /// in a development build (the gallery) in the repo's `assets/fonts`, found above the executable.
    static func register() {
        guard registered.isEmpty, let folder = locate(),
              let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) else { return }
        for file in files where ["ttf", "otf"].contains(file.pathExtension.lowercased()) {
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
    func body(content: Content) -> some View { content.font(font.font(at: size, face: face)) }
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
    func appIdentifierFont(_ font: AppFont, size: CGFloat, weight: Font.Weight = .regular) -> AppFont {
        monoIdentifiers ? .system(size: size, weight: weight, design: .monospaced) : font
    }
}
