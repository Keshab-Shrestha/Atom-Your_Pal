import SwiftUI
import AtomIslandCore

/// Appearance (ADR-057): the theme for every surface. Pal is always the 2D pixel character (ADR-093).
struct AppearanceSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let settings = model.settings
        // Six themes since Void (ADR-086): two rows of three, so every name fits on one line.
        let themes = AppTheme.allCases
        Card("Window appearance", footer: "The desktop uses neutral surfaces throughout. Companion themes below share their light or dark appearance with the window.") {
            HStack(spacing: 8) {
                ForEach([AppTheme.daylight, .void]) { option in
                    Button { settings.theme = option } label: {
                        HStack {
                            Image(systemName: option.palette.isDark ? "moon" : "sun.max")
                            Text(option.palette.isDark ? "Dark" : "Light")
                            Spacer()
                            if settings.theme.palette.isDark == option.palette.isDark { Image(systemName: "checkmark") }
                        }
                        .font(.system(size: 13)).padding(12)
                        .background(theme.fill1.color, in: RoundedRectangle(cornerRadius: 8))
                    }.buttonStyle(.plain)
                        .accessibilityLabel(option.palette.isDark ? "Dark appearance" : "Light appearance")
                        .accessibilityAddTraits(settings.theme.palette.isDark == option.palette.isDark ? .isSelected : [])
                }
            }.padding(10)
        }
        Card("Companion theme", footer: settings.theme.detail) {
            VStack(spacing: 6) {
                ForEach(Array(stride(from: 0, to: themes.count, by: 3)), id: \.self) { start in
                    HStack(spacing: 4) {
                        ForEach(themes[start..<min(start + 3, themes.count)]) { option in
                            ThemeSwatch(option: option, selected: settings.theme == option) { settings.theme = option }
                        }
                    }
                }
            }
            .padding(8)
        }
        ResetPageCard(footer: "The theme goes back to its default.") { settings.resetAppearance() }
    }
}

/// A theme choice drawn as a tiny panel in that theme.
private struct ThemeSwatch: View {
    let option: AppTheme
    let selected: Bool
    let action: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        let p = option.palette
        Button(action: action) {
            VStack(spacing: 6) {
                ZStack(alignment: .topLeading) {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).fill(p.surfaceFill(solid: true))
                    VStack(alignment: .leading, spacing: 4) {
                        Capsule().fill(p.text.color.opacity(0.85)).frame(maxWidth: 30).frame(height: 4)
                        Capsule().fill(p.text2.color).frame(maxWidth: 44).frame(height: 3)
                        Spacer(minLength: 0)
                        HStack(spacing: 4) {
                            Capsule().fill(p.accentFill).frame(maxWidth: 22).frame(height: 8)
                            Capsule().fill(p.fill3.color).frame(maxWidth: 14).frame(height: 8)
                        }
                    }
                    .padding(7)
                }
                .frame(height: 54)
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(p.border.color, lineWidth: 0.5))
                Text(option.title)
                    .font(.system(size: 11, weight: selected ? .semibold : .regular))
                    .foregroundStyle(selected ? theme.text.color : theme.text2.color)
            }
            .padding(4)
            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(selected ? theme.accent.color : .clear, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .accessibilityLabel("Theme \(option.title)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
