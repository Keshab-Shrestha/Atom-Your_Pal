import Foundation

/// ADR-143: clipboard serialization is local and independent of the renderer/pasteboard.
public enum MarkdownCopy {
    public enum Format: String, CaseIterable, Sendable {
        case markdown, tsv, csv
        public var title: String {
            switch self {
            case .markdown: "Markdown and rich table"
            case .tsv: "Tab-separated text (TSV)"
            case .csv: "Comma-separated text (CSV)"
            }
        }
    }

    public enum ReplyFormat: String, CaseIterable, Sendable {
        case markdown, plainText, richText
        public var title: String {
            switch self {
            case .markdown: "Markdown"
            case .plainText: "Plain text"
            case .richText: "Rich text"
            }
        }
    }

    public struct Content: Sendable {
        public let text: String
        public var html: String? = nil
        public var tabular: String? = nil
        public init(text: String, html: String? = nil, tabular: String? = nil) {
            self.text = text
            self.html = html
            self.tabular = tabular
        }
    }

    public static func code(_ text: String) -> Content { Content(text: text) }

    /// Markdown is the default for both the reply button and Copy last reply.
    public static func reply(_ text: String, format: ReplyFormat = .markdown) -> Content {
        switch format {
        case .markdown: Content(text: text)
        case .plainText: Content(text: plainReply(text))
        case .richText: Content(text: plainReply(text), html: MarkdownBlocks.html(text))
        }
    }

    private static func plainReply(_ text: String) -> String {
        plainBlocks(MarkdownBlocks.parse(text))
    }

    private static func plainBlocks(_ blocks: [MarkdownBlock]) -> String {
        blocks.map { block in
            switch block {
            case .paragraph(let text), .heading(_, let text): return plain(text)
            case .code(let text, _): return text // code characters are literal, never interpreted as inline Markdown
            case .list(let items, let number):
                return items.enumerated().map { index, item in
                    let task = item.checked.map { $0 ? "[x] " : "[ ] " }
                    let marker = (number.map { "\($0 + index). " } ?? (task == nil ? "• " : "")) + (task ?? "")
                    let children = plainBlocks(item.children)
                    let nested = children.isEmpty ? "" : "\n" + children.components(separatedBy: "\n").map { "  " + $0 }.joined(separator: "\n")
                    return marker + plain(item.text) + nested
                }.joined(separator: "\n")
            case .quote(let children): return plainBlocks(children)
            case .rule: return "────────"
            case .table(let header, let rows, _):
                return ([header] + rows).map { $0.map(plain).joined(separator: "\t") }.joined(separator: "\n")
            }
        }.joined(separator: "\n\n")
    }

    public static func table(header: [String], rows: [[String]], alignment: [MarkdownTableAlignment] = [], format: Format) -> Content {
        let columns = header.count
        let padded = rows.map { Array($0.prefix(columns)) + Array(repeating: "", count: max(0, columns - $0.count)) }
        if format == .markdown {
            func row(_ cells: [String]) -> String { "| " + cells.map(markdownCell).joined(separator: " | ") + " |" }
            let marks = header.indices.map { index -> String in
                switch index < alignment.count ? alignment[index] : .none {
                case .none: "---"
                case .left: ":---"
                case .center: ":---:"
                case .right: "---:"
                }
            }
            let text = ([row(header), row(marks)] + padded.map(row)).joined(separator: "\n")
            return Content(text: text, html: MarkdownBlocks.html(of: .table(header: header, rows: padded, alignment: alignment)))
        }
        let delimiter = format == .tsv ? "\t" : ","
        let text = ([header] + padded).map { cells in
            cells.map { separatedCell(plain($0), delimiter: delimiter) }.joined(separator: delimiter)
        }.joined(separator: "\r\n")
        return Content(text: text, tabular: format == .tsv ? text : nil)
    }

    private static func markdownCell(_ text: String) -> String {
        let line = text.replacingOccurrences(of: "\r\n", with: " ").replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\r", with: " ")
        var out = ""
        var escaped = false
        for character in line {
            if character == "|", !escaped { out.append("\\") }
            out.append(character)
            escaped = character == "\\" ? !escaped : false
        }
        // A trailing odd backslash must not escape the table's closing separator.
        if escaped { out.append("\\") }
        return out
    }

    private static func plain(_ text: String) -> String {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        guard let attributed = try? AttributedString(markdown: text, options: options) else { return text }
        return String(attributed.characters)
    }

    private static func separatedCell(_ text: String, delimiter: String) -> String {
        if text.contains(delimiter) || text.contains("\"") || text.contains("\n") || text.contains("\r") {
            return "\"" + text.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        return text
    }
}
