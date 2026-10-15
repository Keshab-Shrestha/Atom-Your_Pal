import SwiftUI
import AtomIslandCore

/// A reply that has Markdown beyond plain sentences (a table, a list, code, headings), drawn as blocks.
/// Plain replies keep the glowing caret path in `ReplyText`.
struct MarkdownReply: View {
    let text: String
    let latest: Bool
    @Environment(\.theme) private var theme

    var body: some View {
        let blocks = MarkdownBlocks.parse(text)
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in view(for: block) }
        }
        .font(.system(size: 13.5))
        .foregroundStyle(latest ? theme.text.color : theme.text2.color)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func view(for block: MarkdownBlock) -> some View {
        switch block {
        case .paragraph(let s):
            inline(s).lineSpacing(3).fixedSize(horizontal: false, vertical: true)
        case .heading(let level, let s):
            inline(s).font(.system(size: level <= 1 ? 16 : level == 2 ? 15 : 14, weight: .semibold))
        case .list(let items, let number):
            VStack(alignment: .leading, spacing: 3) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(number.map { "\($0 + index)." } ?? "•").foregroundStyle(theme.text3.color)
                        inline(item).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        case .code(let s):
            SideScroll {
                Text(s).font(.system(size: 12, design: .monospaced)).padding(10)
            }
            .background(RoundedRectangle(cornerRadius: 8).fill(theme.text.color.opacity(0.06)))
        case .table(let header, let rows):
            table(header: header, rows: rows)
        }
    }

    /// A grid when it fits the width the chat has, else a card for each row with one "Header: value" line per column.
    /// A grid wider than the window would hide columns off the side (scroll bars stay hidden until used); cards show everything.
    private func table(header: [String], rows: [[String]]) -> some View {
        ViewThatFits(in: .horizontal) {
            grid(header: header, rows: rows)
            cards(header: header, rows: rows)
        }
    }

    private func grid(header: [String], rows: [[String]]) -> some View {
        Grid(alignment: .topLeading, horizontalSpacing: 18, verticalSpacing: 6) {
            GridRow { ForEach(Array(header.enumerated()), id: \.offset) { _, h in cell(h).fontWeight(.semibold) } }
            Divider().gridCellUnsizedAxes(.horizontal)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                GridRow { ForEach(Array(row.enumerated()), id: \.offset) { _, c in cell(c) } }
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(theme.text.color.opacity(0.05)))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.border.color, lineWidth: 0.5))
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func cards(header: [String], rows: [[String]]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                VStack(alignment: .leading, spacing: 3) {
                    inline(row.first ?? "").fontWeight(.semibold)
                    ForEach(Array(zip(header, row).dropFirst().enumerated()), id: \.offset) { _, pair in
                        (inline(pair.0).fontWeight(.semibold).foregroundColor(theme.text3.color) + Text(": ").foregroundColor(theme.text3.color) + inline(pair.1))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 8).fill(theme.text.color.opacity(0.05)))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.border.color, lineWidth: 0.5))
            }
        }
    }

    private static let cellWidthLimit: CGFloat = 260

    private func cell(_ s: String) -> some View {
        inline(s).font(.system(size: 13)).fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: Self.cellWidthLimit, alignment: .leading)
    }

    /// Bold, italic, `code` and links; whitespace and line breaks stay as written.
    private func inline(_ s: String) -> Text {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        if let attributed = try? AttributedString(markdown: s, options: options) { return Text(attributed) }
        return Text(s)
    }
}

/// A sideways scroll view for wide tables and code; laid out flat in development snapshots, which cannot draw scroll views.
private struct SideScroll<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        if snapshot {
            content.fixedSize(horizontal: true, vertical: false).frame(maxWidth: .infinity, alignment: .leading).clipped() // natural width, as a scroll view starts
        } else {
            ScrollView(.horizontal, showsIndicators: true) { content.padding(.bottom, 6) }
        }
    }
}
