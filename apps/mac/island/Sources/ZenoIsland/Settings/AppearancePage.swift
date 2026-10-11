import SwiftUI
import ZenoIslandCore

/// Appearance (ADR-057): the theme for every surface and Pal's look, chosen separately.
struct AppearanceSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let settings = model.settings
        // Six themes since Void (ADR-086): two rows of three, so every name fits on one line.
        let themes = AppTheme.allCases
        Card("Theme", footer: settings.theme.detail) {
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
        Card("Pal", footer: palDetail(settings.palStyle)) {
            HStack(spacing: 8) {
                ForEach(palOptions(settings.palStyle)) { option in
                    PalSwatch(option: option, selected: settings.palStyle == option) { settings.palStyle = option }
                }
            }
            .padding(10)
        }
        ResetPageCard(footer: "The theme and Pal's style go back to their defaults.") { settings.resetAppearance() }
    }

    /// Avatar is offered once its images exist (ADR-085), or while it is the stored choice.
    private func palOptions(_ current: PalStyle) -> [PalStyle] {
        PalStyle.allCases.filter { $0 != .avatar || current == .avatar || AvatarImages.hasPal }
    }

    private func palDetail(_ style: PalStyle) -> String {
        switch style {
        case .ghost: "The original ghost, refined: its eyes and glow show the mood"
        case .orb: "A floating marble of light: the light inside it shows the mood"
        case .companion: "A small character with a face: its pose and face show the mood"
        case .avatar: AvatarImages.hasPal ? "Your own character, from the images in assets/avatars: its face shows the mood"
            : "Your own character: add its images to assets/avatars and rebuild. Until then, the orb"
        }
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

/// A Pal style choice, showing that Pal.
private struct PalSwatch: View {
    let option: PalStyle
    let selected: Bool
    let action: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                ZStack {
                    if theme.isFlat {
                        // Void: Pal on black in a hairline, no gradient.
                        RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous).fill(theme.surfaceSolid.color)
                        RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous).strokeBorder(theme.border.color, lineWidth: 1)
                    } else {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(LinearGradient(colors: [Color(red: 0.16, green: 0.2, blue: 0.29), Color(red: 0.25, green: 0.3, blue: 0.42)], startPoint: .top, endPoint: .bottom))
                    }
                    PalView(mood: .resting, time: 0.3, size: 40, glow: 0.9, style: option)
                }
                .frame(height: 62)
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
        .accessibilityLabel("Pal style \(option.title)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
