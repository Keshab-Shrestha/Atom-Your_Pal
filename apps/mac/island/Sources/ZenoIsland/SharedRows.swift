import SwiftUI
import ZenoIslandCore

struct IconButton: View {
    let symbol: String
    let label: String
    let action: () -> Void
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(theme.text2.color)
                .frame(width: 22, height: 22)
                .background(Circle().fill(hovering.wrappedValue ? theme.fill3.color : theme.fill1.color))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
        .help(label)
        .accessibilityLabel(label)
    }
}

/// A rounded group of rows, like a System Settings section.
struct Card<Content: View>: View {
    let title: String?
    var footer: String? = nil
    @ViewBuilder let content: Content
    @Environment(\.theme) private var theme

    init(_ title: String? = nil, footer: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.footer = footer
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title {
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.text2.color)
                    .padding(.leading, 4)
            }
            VStack(alignment: .leading, spacing: 0) { content }
                .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).fill(theme.fill1.color))
                .overlay(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).strokeBorder(theme.separator.color.opacity(0.6), lineWidth: 0.5))
            if let footer {
                Text(footer)
                    .font(.system(size: 10.5))
                    .foregroundStyle(theme.text3.color)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
            }
        }
    }
}

struct Row<Trailing: View>: View {
    let title: String
    var detail: String? = nil
    @ViewBuilder let trailing: Trailing
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                if let detail, !detail.isEmpty {
                    Text(detail).font(.system(size: 10.5)).foregroundStyle(theme.text2.color)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 6)
            trailing
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 8)
        .frame(minHeight: 36)
    }
}

struct RowDivider: View {
    @Environment(\.theme) private var theme
    var body: some View { Rectangle().fill(theme.separator.color).frame(height: 0.5).padding(.leading, 11) }
}

/// A switch drawn in the theme (the system's mini switch does not render in snapshots, and its colour is the
/// system accent rather than ZENO's).
struct ThemedSwitch: View {
    let isOn: Bool
    let set: (Bool) -> Void
    var label: String
    @Environment(\.theme) private var theme

    var body: some View {
        Button { set(!isOn) } label: {
            ZStack(alignment: isOn ? .trailing : .leading) {
                Capsule().fill(isOn ? theme.accentFill : AnyShapeStyle(theme.fill3.color))
                Circle()
                    .fill(Color.white)
                    .shadow(color: .black.opacity(0.22), radius: 1, y: 0.5)
                    .padding(2)
            }
            .frame(width: 30, height: 18)
            .animation(.spring(response: 0.22, dampingFraction: 0.8), value: isOn)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityValue(isOn ? "On" : "Off")
        .accessibilityAddTraits(.isButton)
    }
}

/// A small segmented picker for 2–4 short choices.
struct Segmented<Choice: SettingsChoice>: View {
    let selection: Choice
    let set: (Choice) -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 1) {
            ForEach(Array(Choice.allCases), id: \.self) { choice in
                let selected = choice == selection
                Button { set(choice) } label: {
                    Text(choice.title)
                        .font(.system(size: 11, weight: selected ? .semibold : .regular))
                        .foregroundStyle(selected ? theme.text.color : theme.text2.color)
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.horizontal, 8)
                        .frame(height: 22)
                        .background {
                            if selected {
                                RoundedRectangle(cornerRadius: theme.radiusControl - 1, style: .continuous)
                                    .fill(theme.isDark ? theme.fill3.color : Color.white)
                                    .shadow(color: .black.opacity(theme.isDark ? 0 : 0.08), radius: 1, y: 0.5)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl + 1, style: .continuous).fill(theme.fill2.color))
    }
}

/// A pop-up menu showing the current choice, for longer lists.
struct ThemedMenu<Choice: SettingsChoice>: View {
    let selection: Choice
    let set: (Choice) -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        Menu {
            ForEach(Array(Choice.allCases), id: \.self) { choice in
                Button { set(choice) } label: {
                    if choice == selection { Label(choice.title, systemImage: "checkmark") } else { Text(choice.title) }
                }
            }
        } label: {
            MenuLabel(text: selection.title)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .fixedSize()
    }
}

/// What a pop-up menu shows when closed: the value and an up-down chevron.
struct MenuLabel: View {
    let text: String
    var dimmed = false
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 5) {
            Text(text)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(dimmed ? theme.text2.color : theme.text.color)
                .lineLimit(1)
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(theme.text2.color)
        }
        .padding(.horizontal, 9)
        .frame(height: 24)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous).fill(theme.fill2.color))
        .contentShape(Rectangle())
    }
}

/// A small text button in the theme.
struct PillButton: View {
    let title: String
    var symbol: String? = nil
    var prominent = false
    let action: () -> Void
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let symbol { Image(systemName: symbol).font(.system(size: 10, weight: .semibold)) }
                Text(title).font(.system(size: 11.5, weight: .semibold))
            }
            .foregroundStyle(prominent ? theme.onAccent.color : theme.text.color)
            .padding(.horizontal, 10)
            .frame(height: 24)
            .background {
                RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous)
                    .fill(prominent ? theme.accentFill : AnyShapeStyle(hovering.wrappedValue ? theme.fill3.color : theme.fill2.color))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
    }
}

/// "Reset this page" at the bottom of a settings page with choices (ADR-079). The footer says what goes back.
struct ResetPageCard: View {
    let footer: String
    let reset: () -> Void

    var body: some View {
        Card(footer: footer) {
            Row(title: "Reset this page") { PillButton(title: "Reset", action: reset) }
        }
    }
}

/// A setting with a few named choices: a title, a segmented picker (or a menu for long lists) and an optional
/// one-line explanation below.
struct ChoiceRow<Choice: SettingsChoice>: View {
    let title: String
    var detail: String? = nil
    let selection: Choice
    let set: (Choice) -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(title).font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                Spacer(minLength: 6)
                if Choice.allCases.count <= 4 {
                    Segmented(selection: selection, set: set)
                } else {
                    ThemedMenu(selection: selection, set: set)
                }
            }
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.system(size: 10.5))
                    .foregroundStyle(theme.text2.color)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 11)
        .padding(.vertical, 8)
    }
}

/// Lays out children left to right, wrapping onto new lines.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    /// Each row centred instead of starting at the left edge.
    var centered = false

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX + (centered ? max(0, (bounds.width - row.width) / 2) : 0)
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Line { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Line] {
        var lines: [Line] = [Line()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = lines[lines.count - 1].indices.isEmpty ? size.width : lines[lines.count - 1].width + spacing + size.width
            if needed > width, !lines[lines.count - 1].indices.isEmpty {
                lines.append(Line())
            }
            var line = lines[lines.count - 1]
            line.width = line.indices.isEmpty ? size.width : line.width + spacing + size.width
            line.height = max(line.height, size.height)
            line.indices.append(index)
            lines[lines.count - 1] = line
        }
        return lines
    }
}
