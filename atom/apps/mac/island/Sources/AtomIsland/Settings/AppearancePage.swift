import SwiftUI
import AtomIslandCore

/// Appearance (ADR-057): the theme for every surface. Pal is always the 2D pixel character (ADR-093).
struct AppearanceSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let settings = model.settings
        let themes: [AppTheme] = [.sapphire, .champagne, .emerald, .plum, .cobalt, .teal]
        Card("Font size", footer: "Changes text across workspace pages, chat messages and typing fields. Saved on this Mac.") {
            ChoiceRow(title: "Text size", selection: settings.textSize) { settings.textSize = $0 }
            Text("A calmer place to do your best work.")
                .appFont(.system(size: 14)).foregroundStyle(theme.text.color)
                .padding(.horizontal, Spacing.well).padding(.bottom, Spacing.well)
                .accessibilityLabel("Font size preview")
        }
        Card("Workspace themes", footer: "Applied to the whole window and companion. " + settings.theme.detail) {
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
        Card("Original themes") {
            VStack(spacing: 6) {
                let originals = AppTheme.allCases.filter { !themes.contains($0) }
                ForEach(Array(stride(from: 0, to: originals.count, by: 3)), id: \.self) { start in
                    HStack(spacing: 4) {
                        ForEach(originals[start..<min(start + 3, originals.count)]) { option in
                            ThemeSwatch(option: option, selected: settings.theme == option) { settings.theme = option }
                        }
                    }
                }
            }.padding(8)
        }
        ResetPageCard(footer: "The theme and font size go back to their defaults.") { settings.resetAppearance() }
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
                    .appFont(.system(size: 11, weight: selected ? .semibold : .regular))
                    .multilineTextAlignment(.center).frame(minHeight: 28, alignment: .top)
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
