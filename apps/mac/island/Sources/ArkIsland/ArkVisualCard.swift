import Charts
import SwiftUI
import ArkIslandCore

/// ADR-276: a ```ark-visual block as one card: stat tiles, bar rows, a line chart (Swift Charts) and tables, under a header with
/// Copy (the numbers as Markdown tables) and Source (the JSON). Design reference: Ghostex's result cards; drawn in ARK's tokens.
struct ArkVisualCard: View {
    let visual: ArkVisual
    let source: String
    let copyEnabled: Bool
    @State private var showsSource = false
    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
        VStack(alignment: .leading, spacing: 12) {
            header
            if showsSource {
                Text(source).appFont(.system(size: 12, design: .monospaced)).foregroundStyle(theme.text2.color)
                    .fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(Array(visual.blocks.enumerated()), id: \.offset) { _, block in blockView(block) }
            }
        }
        .padding(14)
        .background(shape.fill(theme.fill1.color))
        .overlay(shape.strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
        .frame(maxWidth: 640, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(visual.accessibilitySummary)
        .accessibilityActions {
            if copyEnabled { Button("Copy as Markdown") { _ = ChatClipboard.write(copy) } }
            Button(showsSource ? "Show card" : "Show source") { showsSource.toggle() }
        }
    }

    private var copy: MarkdownCopy.Content { MarkdownCopy.Content(text: visual.markdown, html: MarkdownBlocks.html(visual.markdown)) }

    private var header: some View {
        HStack(spacing: 8) {
            Glyph(systemName: "chart.bar.doc.horizontal").appFont(.system(size: 12, weight: .semibold)).foregroundStyle(theme.accent.color)
            Text(visual.title).appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(2)
            Spacer(minLength: 8)
            QuietButton(title: showsSource ? "Card" : "Source", symbol: showsSource ? "chart.bar" : "curlybraces") { showsSource.toggle() }
                .help(showsSource ? "Show the card" : "Show the JSON this card is drawn from")
            ChatCopyControl(title: "Copy") { copy }
                .disabled(!copyEnabled)
                .help(copyEnabled ? "Copy the card's numbers as Markdown tables" : "Copy is available when this reply finishes")
        }
    }

    @ViewBuilder private func blockView(_ block: ArkVisual.Block) -> some View {
        switch block {
        case .stats(let title, let items):
            section(title) {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 8, alignment: .topLeading)], alignment: .leading, spacing: 8) {
                    ForEach(Array(items.enumerated()), id: \.offset) { _, stat in tile(stat) }
                }
            }
        case .bar(let title, let unit, let data):
            section(title) { bars(data, unit: unit) }
        case .line(let title, let unit, let data):
            section(title) {
                Chart(Array(data.enumerated()), id: \.offset) { _, point in
                    LineMark(x: .value("Label", point.label), y: .value(unit ?? "Value", point.value))
                        .foregroundStyle(theme.accent.color)
                    PointMark(x: .value("Label", point.label), y: .value(unit ?? "Value", point.value))
                        .foregroundStyle(theme.accent.color).symbolSize(18)
                }
                .chartYAxisLabel(unit ?? "")
                .frame(height: 180)
            }
        case .table(let title, let columns, let rows):
            section(title) { table(columns, rows) }
        }
    }

    /// Horizontal bars in plain SwiftUI: label on the left, one accent bar, the value at its end. Bars start at zero; a negative
    /// value draws as an empty bar with its number. Swift Charts drew hairline bars for a category axis offscreen, so rows are used.
    private func bars(_ data: [ArkVisual.Point], unit: String?) -> some View {
        let top = max(data.map(\.value).max() ?? 0, 0)
        return Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 6) {
            ForEach(Array(data.enumerated()), id: \.offset) { _, point in
                GridRow {
                    Text(point.label).appFont(.system(size: 12)).foregroundStyle(theme.text2.color).lineLimit(1)
                        .frame(maxWidth: 180, alignment: .leading)
                    GeometryReader { box in
                        let share = top > 0 ? max(point.value, 0) / top : 0
                        RoundedRectangle(cornerRadius: 2, style: .continuous).fill(theme.accent.color)
                            .frame(width: max(box.size.width * share, share > 0 ? 2 : 0), height: 14)
                            .frame(maxHeight: .infinity, alignment: .center)
                    }
                    .frame(height: 18)
                    Text(ReplyChart.number(point.value) + (unit.map { " \($0)" } ?? "")).appFont(.system(size: 11.5)).monospacedDigit()
                        .foregroundStyle(theme.text3.color).lineLimit(1).gridColumnAlignment(.trailing)
                }
            }
        }
    }

    private func tile(_ stat: ArkVisual.Stat) -> some View {
        let tone: Color? = switch stat.tone {
        case .good: theme.success.color
        case .bad: theme.problem.color
        case .neutral: nil
        }
        let shape = RoundedRectangle(cornerRadius: max(theme.radiusCard - 2, 0), style: .continuous)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                if let tone { Circle().fill(tone).frame(width: 6, height: 6) }
                Text(stat.label).appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color).lineLimit(1)
            }
            Text(stat.value).appFont(.system(size: 20, weight: .semibold)).monospacedDigit().foregroundStyle(theme.text.color).lineLimit(1)
                .minimumScaleFactor(0.6)
            if let note = stat.note {
                Text(note).appFont(.system(size: 11)).foregroundStyle(tone ?? theme.text3.color).lineLimit(2)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(shape.fill(theme.fill2.color))
        .overlay(shape.strokeBorder(theme.separator.color, lineWidth: 0.5))
    }

    private func section<Content: View>(_ title: String?, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title { Text(title).appFont(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text2.color) }
            content()
        }
    }

    private func table(_ columns: [String], _ rows: [[String]]) -> some View {
        Grid(alignment: .topLeading, horizontalSpacing: 18, verticalSpacing: 6) {
            GridRow {
                ForEach(Array(columns.enumerated()), id: \.offset) { _, c in
                    Text(c).appFont(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text2.color)
                }
            }
            Divider().gridCellUnsizedAxes(.horizontal)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                GridRow {
                    ForEach(Array(row.enumerated()), id: \.offset) { _, c in
                        Text(c).appFont(.system(size: 12.5)).foregroundStyle(theme.text.color)
                            .fixedSize(horizontal: false, vertical: true).frame(maxWidth: 260, alignment: .leading)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
