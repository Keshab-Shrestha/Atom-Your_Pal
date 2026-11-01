import SwiftUI
import ArkIslandCore

/// The "/" picker above the message box (ADR-117): up to eight rows of ARK's commands, skills and Claude commands. The
/// composer owns the keys (Up, Down, Return or Tab picks, Escape closes); a click picks too.
struct SlashPicker: View {
    let items: [SlashItem]
    let selected: Int
    let choose: (SlashItem) -> Void
    @Namespace private var selection
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(items.prefix(SlashMenu.limit).enumerated()), id: \.element.id) { index, item in
                Button { choose(item) } label: { row(item, selected: index == selected) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(item.title), \(item.sourceLabel). \(item.detail)")
                    .accessibilityAddTraits(index == selected ? [.isButton, .isSelected] : .isButton)
            }
        }
        .animation(Motion.snap(reduceMotion), value: selected)
        .padding(4)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl + 4, style: .continuous).fill(theme.surfaceSolid.color))
        .shadow(color: .black.opacity(theme.isFlat ? 0 : theme.isDark ? 0.3 : 0.1), radius: 10, y: 4)
        .overlay(RoundedRectangle(cornerRadius: theme.radiusControl + 4, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Commands")
    }

    private func row(_ item: SlashItem, selected: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(item.title).appFont(.system(size: 12, weight: .medium, design: .monospaced)).foregroundStyle(tint(item))
            if !item.hint.isEmpty { Text(item.hint).appFont(.system(size: 11, design: .monospaced)).foregroundStyle(theme.text3.color) }
            Text(item.detail).appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(1)
            Spacer(minLength: 8)
            Text(item.sourceLabel).appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .slidingSelection(selected, in: selection, radius: theme.radiusControl, fill: theme.fill3.color)
        .contentShape(Rectangle())
    }

    /// ARK's own commands in the text colour, skills in the identifier colour, Claude commands plain.
    private func tint(_ item: SlashItem) -> Color {
        switch item.source {
        case .ark: theme.text.color
        case .skill: theme.idColor(theme.text)
        case .command: theme.text2.color
        }
    }
}

/// The "@" menu above the message box (ADR-126): helpers, Second brain notes and "A file…". Same keys as the "/" picker,
/// except that Escape keeps the words.
struct MentionPicker: View {
    let items: [MentionItem]
    let selected: Int
    let choose: (MentionItem) -> Void
    @Namespace private var selection
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(items.prefix(MentionMenu.limit).enumerated()), id: \.element.id) { index, item in
                Button { choose(item) } label: { row(item, selected: index == selected) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(item.name), \(item.detail)")
                    .accessibilityAddTraits(index == selected ? [.isButton, .isSelected] : .isButton)
            }
        }
        .animation(Motion.snap(reduceMotion), value: selected)
        .padding(4)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl + 4, style: .continuous).fill(theme.surfaceSolid.color))
        .shadow(color: .black.opacity(theme.isFlat ? 0 : theme.isDark ? 0.3 : 0.1), radius: 10, y: 4)
        .overlay(RoundedRectangle(cornerRadius: theme.radiusControl + 4, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Mentions")
    }

    private func row(_ item: MentionItem, selected: Bool) -> some View {
        HStack(alignment: .center, spacing: 8) {
            Glyph(systemName: item.symbol).appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text2.color).frame(width: 16)
            Text(item.kind == .helper ? "@" + item.name : item.name).appFont(.system(size: 12, weight: .medium))
                .foregroundStyle(item.kind == .helper ? theme.idColor(theme.text) : theme.text.color).lineLimit(1)
            Spacer(minLength: 8)
            Text(item.detail).appFont(.system(size: 10.5))
                .foregroundStyle(theme.text3.color).lineLimit(1)
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .slidingSelection(selected, in: selection, radius: theme.radiusControl, fill: theme.fill3.color)
        .contentShape(Rectangle())
    }
}
