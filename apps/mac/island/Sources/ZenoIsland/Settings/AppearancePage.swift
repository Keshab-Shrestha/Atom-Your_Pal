import SwiftUI
import ZenoIslandCore

/// Appearance (ADR-057): the theme for every surface and Wisp's look, chosen separately.
struct AppearanceSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let settings = model.settings
        Card("Theme", footer: settings.theme.detail) {
            HStack(spacing: 4) {
                ForEach(AppTheme.allCases) { option in
                    ThemeSwatch(option: option, selected: settings.theme == option) { settings.theme = option }
                }
            }
            .padding(8)
        }
        Card("Wisp", footer: wispDetail(settings.wispStyle)) {
            HStack(spacing: 8) {
                ForEach(wispOptions(settings.wispStyle)) { option in
                    WispSwatch(option: option, selected: settings.wispStyle == option) { settings.wispStyle = option }
                }
            }
            .padding(10)
        }
        ResetPageCard(footer: "The theme and Wisp's style go back to their defaults.") { settings.resetAppearance() }
    }

    /// Avatar is offered once its images exist (ADR-085), or while it is the stored choice.
    private func wispOptions(_ current: WispStyle) -> [WispStyle] {
        WispStyle.allCases.filter { $0 != .avatar || current == .avatar || AvatarImages.hasWisp }
    }

    private func wispDetail(_ style: WispStyle) -> String {
        switch style {
        case .ghost: "The original ghost, refined: its eyes and glow show the mood"
        case .orb: "A floating marble of light: the light inside it shows the mood"
        case .companion: "A small character with a face: its pose and face show the mood"
        case .avatar: AvatarImages.hasWisp ? "Your own character, from the images in assets/avatars: its face shows the mood"
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

/// A Wisp style choice, showing that Wisp.
private struct WispSwatch: View {
    let option: WispStyle
    let selected: Bool
    let action: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(LinearGradient(colors: [Color(red: 0.16, green: 0.2, blue: 0.29), Color(red: 0.25, green: 0.3, blue: 0.42)], startPoint: .top, endPoint: .bottom))
                    WispView(mood: .resting, time: 0.3, size: 40, glow: 0.9, style: option)
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
        .accessibilityLabel("Wisp style \(option.title)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
