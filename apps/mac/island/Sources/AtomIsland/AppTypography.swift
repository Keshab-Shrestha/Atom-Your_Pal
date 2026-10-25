import SwiftUI
import AtomIslandCore

/// Keep original type sizes and hierarchy, then apply the user's scale once at font resolution.
/// This supports the app's macOS 14 minimum without relying on newer Font.scaled APIs.
struct AppFont {
    private let resolve: (CGFloat) -> Font
    private init(_ resolve: @escaping (CGFloat) -> Font) { self.resolve = resolve }
    static func system(size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) -> Self {
        Self { .system(size: size * $0, weight: weight, design: design) }
    }
    static var headline: Self { .system(size: 13, weight: .semibold) }
    static var caption2: Self { .system(size: 10) }
    func monospacedDigit() -> Self { Self { resolve($0).monospacedDigit() } }
    func font(at size: AppTextSize) -> Font { resolve(size.scale) }
}

private struct AppTextSizeKey: EnvironmentKey { static let defaultValue = AppTextSize.standard }
extension EnvironmentValues {
    var appTextSize: AppTextSize {
        get { self[AppTextSizeKey.self] }
        set { self[AppTextSizeKey.self] = newValue }
    }
}

private struct AppFontModifier: ViewModifier {
    let font: AppFont
    @Environment(\.appTextSize) private var size
    func body(content: Content) -> some View { content.font(font.font(at: size)) }
}

extension View {
    func appFont(_ font: AppFont) -> some View { modifier(AppFontModifier(font: font)) }
}

extension Text {
    /// Inline concatenation and Canvas require Text, rather than an opaque modified View.
    func appFont(_ font: AppFont, scaledBy size: AppTextSize) -> Text { self.font(font.font(at: size)) }
}

extension ThemePalette {
    func appIdentifierFont(_ font: AppFont, size: CGFloat, weight: Font.Weight = .regular) -> AppFont {
        monoIdentifiers ? .system(size: size, weight: weight, design: .monospaced) : font
    }
}
