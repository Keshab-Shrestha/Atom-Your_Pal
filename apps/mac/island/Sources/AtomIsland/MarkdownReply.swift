import SwiftUI
import AtomIslandCore

/// A reply that has Markdown beyond plain sentences (a table, a list, code, headings), drawn as blocks.
/// Plain replies keep the glowing caret path in `ReplyText`.
struct MarkdownReply: View {
    let text: String
    let latest: Bool
    var copyEnabled = true
    @Environment(\.theme) private var theme

    var body: some View {
        let blocks = MarkdownBlocks.parse(text)
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in MarkdownBlockView(block: block, latest: latest, copyEnabled: copyEnabled) }
        }
        .font(.system(size: 14))
        .foregroundStyle(theme.text.color)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A separate node view keeps recursive quotes/lists finite in SwiftUI's view type.
private struct MarkdownBlockView: View {
    let block: MarkdownBlock
    let latest: Bool
    let copyEnabled: Bool
    @Environment(\.theme) private var theme

    @ViewBuilder var body: some View {
        switch block {
        case .paragraph(let s):
            inline(s).lineSpacing(5).fixedSize(horizontal: false, vertical: true)
        case .heading(let level, let s):
            inline(s).font(.system(size: level <= 1 ? 16 : level == 2 ? 15 : 14, weight: .semibold))
        case .list(let items, let number):
            VStack(alignment: .leading, spacing: 5) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .top, spacing: 7) {
                        HStack(spacing: 4) {
                            if let number { Text("\(number + index).").foregroundStyle(theme.text3.color) }
                            if let checked = item.checked {
                                Image(systemName: checked ? "checkmark.square" : "square")
                                    .foregroundStyle(theme.text3.color)
                                    .accessibilityLabel(checked ? "Completed task" : "Incomplete task")
                                    .padding(.top, 2)
                            } else if number == nil {
                                Text("•").foregroundStyle(theme.text3.color)
                            }
                        }
                        VStack(alignment: .leading, spacing: 5) {
                            if !item.text.isEmpty { inline(item.text).fixedSize(horizontal: false, vertical: true) }
                            if !item.children.isEmpty { children(item.children) }
                        }
                    }
                    .accessibilityElement(children: .contain)
                }
            }
        case .quote(let blocks):
            children(blocks)
                .padding(.leading, 12).padding(.vertical, 3)
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 1.5).fill(theme.text3.color.opacity(0.5)).frame(width: 3)
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Block quote")
        case .rule:
            Rectangle().fill(theme.separator.color).frame(height: 1).padding(.vertical, 5)
                .accessibilityLabel("Section separator")
        case .code(let s, let language):
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(language ?? "Code").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                    Spacer()
                    ChatCopyControl(title: "Copy code") { MarkdownCopy.code(s) }
                        .disabled(!copyEnabled)
                        .help(copyEnabled ? "Copy only this code block, without its fences" : "Copy is available when this reply finishes")
                }
                .padding(.horizontal, 10).padding(.top, 4)
                SideScroll {
                    Text(s).font(.system(size: 12, design: .monospaced)).padding(10)
                }
            }
            .background(RoundedRectangle(cornerRadius: 8).fill(theme.text.color.opacity(0.06)))
            .accessibilityElement(children: .contain)
            .accessibilityLabel(language.map { "\($0) code block" } ?? "Code block")
            .accessibilityActions {
                if copyEnabled { Button("Copy code") { _ = ChatClipboard.write(MarkdownCopy.code(s)) } }
            }
        case .table(let header, let rows, let alignment):
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("Table").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                    Spacer()
                    ChatCopyControl(title: "Copy table", choices: MarkdownCopy.Format.allCases.map { format in
                        ChatCopyControl.Choice(title: format.title) {
                            MarkdownCopy.table(header: header, rows: rows, alignment: alignment, format: format)
                        }
                    })
                    .disabled(!copyEnabled)
                    .help(copyEnabled ? "Copy this table as Markdown and HTML; open the menu for TSV or CSV" : "Copy is available when this reply finishes")
                }
                table(header: header, rows: rows)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Table")
            .accessibilityActions {
                if copyEnabled {
                    ForEach(MarkdownCopy.Format.allCases, id: \.self) { format in
                        Button("Copy table: \(format.title)") {
                            _ = ChatClipboard.write(MarkdownCopy.table(header: header, rows: rows, alignment: alignment, format: format))
                        }
                    }
                }
            }
        }
    }

    private func children(_ blocks: [MarkdownBlock]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, child in
                AnyView(MarkdownBlockView(block: child, latest: latest, copyEnabled: copyEnabled))
            }
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
