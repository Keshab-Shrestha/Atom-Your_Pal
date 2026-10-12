import SwiftUI
import AtomIslandCore

// ADR-076: "What can I ask?" and the Claude plan meters.

/// Settings → What can I ask?: the Talk and Dictate shortcuts with their keys, then each tool that is on with phrases
/// to try. Before the runtime's `capabilities` event arrives, only the shortcuts.
struct ExamplesSection: View {
    let model: IslandModel

    var body: some View {
        Card("Shortcuts") {
            shortcutRow(.talk)
            RowDivider()
            shortcutRow(.dictate)
        }
        if let items = model.capabilities {
            if items.isEmpty {
                Card { Row(title: "No tools are on", detail: "ZENO can still answer questions and chat.") { EmptyView() } }
            } else {
                Card("Things to try", footer: "Only tools that are on are listed.") {
                    ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                        if index > 0 { RowDivider() }
                        CapabilityRow(item: item)
                    }
                }
            }
        }
    }

    private func shortcutRow(_ action: ShortcutAction) -> some View {
        Row(title: action.title, detail: action.detail) {
            KeyCap(text: model.settings.shortcut(for: action)?.display ?? "Off")
        }
    }
}

private struct CapabilityRow: View {
    let item: CapabilityItem
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(item.title).font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
            if !item.examples.isEmpty {
                FlowLayout(spacing: 5) {
                    ForEach(Array(item.examples.enumerated()), id: \.offset) { _, example in ExampleChip(text: example) }
                }
            }
        }
        .padding(.horizontal, Spacing.well)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// A phrase to say, in quotes on a soft pill.
struct ExampleChip: View {
    let text: String
    @Environment(\.theme) private var theme

    var body: some View {
        Text("“\(text)”")
            .font(.system(size: 11))
            .foregroundStyle(theme.text2.color)
            .lineLimit(1)
            .padding(.horizontal, theme.isGhost ? 10 : 8)
            .frame(height: theme.isGhost ? 24 : 21)
            .background(ControlFill(Capsule(), fill: theme.fill2.color)) // Void: a hairline pill
    }
}

/// A shortcut's keys, readable at row size.
private struct KeyCap: View {
    let text: String
    @Environment(\.theme) private var theme

    var body: some View {
        Text(text)
            .font(theme.idFont(.system(size: 11.5, weight: .semibold, design: .rounded), size: 11, weight: .medium))
            .foregroundStyle(theme.text.color)
            .padding(.horizontal, 8)
            .frame(height: 22)
            .background(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous).fill(theme.isGhost ? Color.clear : theme.fill2.color))
            .overlay(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous).strokeBorder(theme.separator.color, lineWidth: theme.isGhost ? 1 : 0.5))
    }
}

/// Under "Ask ZENO anything": a few phrases to try and the link to the full list.
struct EmptyConversationExamples: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(spacing: 8) {
            let examples = CapabilityItem.firstExamples(model.capabilities ?? [])
            if !examples.isEmpty {
                FlowLayout(spacing: 5, centered: true) {
                    ForEach(Array(examples.enumerated()), id: \.offset) { _, example in ExampleChip(text: example) }
                }
                .frame(maxWidth: 320)
            }
            Button { model.showExamples() } label: {
                Text("What can I ask?")
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(theme.accent.color)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }
}

/// The Claude plan's two windows as small meters (ADR-076). Shown only once usage has arrived.
struct PlanMetersCard: View {
    let usage: PlanUsage?
    var title = "Claude plan usage"

    var body: some View {
        if let usage, !usage.isEmpty {
            Card(title, footer: usage.overage == true ? "Extra usage is on: Claude would charge for more, so ZENO stops." : nil) {
                if let five = usage.fiveHour { PlanMeter(title: "5-hour", fraction: five) }
                if usage.fiveHour != nil, usage.sevenDay != nil { RowDivider() }
                if let week = usage.sevenDay { PlanMeter(title: "Weekly", fraction: week) }
            }
        }
    }
}

struct PlanMeter: View {
    let title: String
    let fraction: Double
    /// Side padding: a well's inset in a card of rows, none inside the now card.
    var inset: CGFloat = Spacing.well
    var height: CGFloat = 34
    @Environment(\.theme) private var theme

    var body: some View {
        let percent = PlanUsage.percent(fraction)
        HStack(spacing: 10) {
            Text(title).font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                .frame(width: 52, alignment: .leading)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.fill2.color)
                    Capsule().fill(color).frame(width: max(percent > 0 ? 5 : 0, proxy.size.width * CGFloat(percent) / 100))
                }
            }
            .frame(height: 6)
            Text("\(percent)%")
                .font(theme.idFont(.system(size: 11.5, weight: .medium).monospacedDigit(), size: 11))
                .foregroundStyle(PlanUsage.level(fraction) == .normal ? theme.text2.color : color)
                .frame(width: 38, alignment: .trailing)
        }
        .padding(.horizontal, inset)
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title) usage")
        .accessibilityValue("\(percent) percent")
    }

    private var color: Color {
        switch PlanUsage.level(fraction) {
        case .normal: theme.accent.color
        case .attention: theme.attention.color
        case .problem: theme.problem.color
        }
    }
}
