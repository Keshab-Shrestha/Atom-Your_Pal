import SwiftUI
import ArkIslandCore

/// Appearance (ADR-057): the theme for every surface. Pal is always the 2D pixel character (ADR-093).
struct AppearanceSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let settings = model.settings
        let themes: [AppTheme] = [.ember, .sapphire, .champagne, .plum, .teal]
        Card("Font", footer: "Changes text across workspace pages, chat messages and typing fields. Model names, paths and code stay in SF Mono. Saved on this Mac.") {
            ChoiceRow(title: "Typeface", selection: settings.typeface) { settings.typeface = $0 }
            RowDivider()
            ChoiceRow(title: "Text size", selection: settings.textSize) { settings.textSize = $0 }
            RowDivider()
            Text("A calmer place to do your best work.")
                .appFont(.system(size: 14)).foregroundStyle(theme.text.color)
                .padding(.horizontal, Spacing.well).padding(.vertical, Spacing.well)
                .accessibilityLabel("Font preview")
        }
        Card("Icons", footer: UIcons.inUse
             ? "Icons: \(UIcons.credit). Free with this credit; your Mac downloaded its own copy during setup."
             : "Apple's SF Symbols. Run sh scripts/setup.sh to download Flaticon's UIcons for this Mac.") { EmptyView() }
        // ADR-255: the material for every theme.
        Card("Material", footer: settings.reduceTransparency
             ? "Reduce Transparency is on in System Settings, so ARK draws Flat until you turn it off."
             : "Glass: frosted panes over a soft light that drifts and takes ARK's mood. Blue while it works, amber when something needs you, red for a problem. Flat: solid panes.") {
            Row(title: "Ambient glass", detail: "Frosted panes and a light that follows what ARK is doing") {
                ThemedSwitch(isOn: settings.glass, set: { settings.glass = $0 }, label: "Ambient glass")
            }
        }
        Card("Workspace themes", footer: "Applied to the whole window and companion. " + settings.theme.detail) {
            VStack(spacing: 8) {
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
            VStack(spacing: 8) {
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
        // ADR-277: glass over the desktop instead of ARK's own light. After the themes, so the top of the page stays as it was.
        Card("Window", footer: Self.translucencyFooter(settings)) {
            Row(title: "Translucent window", detail: "The desktop shows through the window, blurred and tinted") {
                ThemedSwitch(isOn: settings.translucentWindow, set: { settings.translucentWindow = $0 }, label: "Translucent window")
                    .disabled(!settings.translucentAvailable)
                    .opacity(settings.translucentAvailable ? 1 : 0.5)
            }
            if settings.translucentWindow {
                RowDivider()
                ChoiceRow(title: "Strength", detail: "How much of the desktop shows through",
                          selection: settings.translucencyStrength) { settings.translucencyStrength = $0 }
            }
        }
        ResetPageCard(footer: "The theme, material, window, typeface and text size go back to their defaults.") { settings.resetAppearance() }
    }

    /// Why the window stays opaque, or what the setting does. Text keeps its contrast at every strength.
    static func translucencyFooter(_ settings: IslandSettings) -> String {
        if settings.reduceTransparency { return "Reduce Transparency is on in System Settings, so the window stays opaque." }
        if settings.increaseContrast { return "Increase Contrast is on in System Settings, so the window stays opaque." }
        if !settings.glass { return "Needs Ambient glass. With Flat, the window stays opaque." }
        return "Text keeps a readable contrast at every strength, on a light or a dark desktop."
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
            VStack(spacing: 8) {
                ZStack(alignment: .topLeading) {
                    RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(p.surfaceFill(solid: true))
                    VStack(alignment: .leading, spacing: 4) {
                        Capsule().fill(p.text.color.opacity(0.85)).frame(maxWidth: 30).frame(height: 4)
                        Capsule().fill(p.text2.color).frame(maxWidth: 44).frame(height: 3)
                        Spacer(minLength: 0)
                        HStack(spacing: 4) {
                            Capsule().fill(p.accentFill).frame(maxWidth: 22).frame(height: 8)
                            Capsule().fill(p.fill3.color).frame(maxWidth: 14).frame(height: 8)
                        }
                    }
                    .padding(8)
                }
                .frame(height: 54)
                .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(p.border.color, lineWidth: 0.5))
                Text(option.title)
                    .appFont(.system(size: 11, weight: selected ? .semibold : .regular))
                    .multilineTextAlignment(.center).frame(minHeight: 28, alignment: .top)
                    .foregroundStyle(selected ? theme.text.color : theme.text2.color)
            }
            .padding(4)
            .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(selected ? theme.accent.color : .clear, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .accessibilityLabel("Theme \(option.title)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
