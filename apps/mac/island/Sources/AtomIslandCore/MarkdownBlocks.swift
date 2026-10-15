import Foundation

/// A reply split into the blocks the chat draws: paragraphs, headings, lists, code and tables. Inline marks
/// (bold, italic, `code`, links) stay in the text; the view reads them. Nothing here talks to the model.
public enum MarkdownBlock: Equatable, Sendable {
    case paragraph(String)
    case heading(level: Int, text: String)
    /// `number` is the first number of a numbered list, nil for bullets.
    case list(items: [String], number: Int?)
    case code(String)
    case table(header: [String], rows: [[String]])
}

public enum MarkdownBlocks {
    /// True when the text holds anything beyond plain paragraphs, so the plain path can stay for simple replies.
    public static func isRich(_ text: String) -> Bool {
        parse(text).contains { if case .paragraph = $0 { false } else { true } }
    }

    public static func parse(_ text: String) -> [MarkdownBlock] {
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var i = 0

        func flush() {
            if !paragraph.isEmpty { blocks.append(.paragraph(paragraph.joined(separator: "\n"))) }
            paragraph = []
        }

        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("```") {
                flush()
                var body: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") { body.append(lines[i]); i += 1 }
                i += 1 // the closing fence; an unfinished block (still streaming) ends the text
                blocks.append(.code(body.joined(separator: "\n")))
            } else if trimmed.isEmpty {
                flush()
                i += 1
            } else if let heading = headingOf(trimmed) {
                flush()
                blocks.append(heading)
                i += 1
            } else if isTableRow(trimmed), i + 1 < lines.count, isDivider(lines[i + 1]) {
                flush()
                let header = cells(of: trimmed)
                var rows: [[String]] = []
                i += 2
                while i < lines.count, isTableRow(lines[i].trimmingCharacters(in: .whitespaces)) {
                    rows.append(pad(cells(of: lines[i]), to: header.count))
                    i += 1
                }
                blocks.append(.table(header: header, rows: rows))
            } else if let first = listItem(trimmed) {
                flush()
                var items = [first.text]
                let number = first.number
                i += 1
                while i < lines.count, let next = listItem(lines[i].trimmingCharacters(in: .whitespaces)), (next.number == nil) == (number == nil) {
                    items.append(next.text)
                    i += 1
                }
                blocks.append(.list(items: items, number: number))
            } else {
                paragraph.append(trimmed)
                i += 1
            }
        }
        flush()
        return blocks
    }

    private static func headingOf(_ line: String) -> MarkdownBlock? {
        let hashes = line.prefix { $0 == "#" }.count
        guard (1...6).contains(hashes), line.dropFirst(hashes).first == " " else { return nil }
        return .heading(level: hashes, text: line.dropFirst(hashes).trimmingCharacters(in: .whitespaces))
    }

    private static func listItem(_ line: String) -> (text: String, number: Int?)? {
        for bullet in ["- ", "* ", "+ ", "• "] where line.hasPrefix(bullet) {
            return (String(line.dropFirst(bullet.count)), nil)
        }
        let digits = line.prefix { $0.isNumber }
        guard !digits.isEmpty, digits.count <= 3, let number = Int(digits) else { return nil }
        let rest = line.dropFirst(digits.count)
        guard let mark = rest.first, mark == "." || mark == ")", rest.dropFirst().first == " " else { return nil }
        return (rest.dropFirst(2).trimmingCharacters(in: .whitespaces), number)
    }

    private static func isTableRow(_ line: String) -> Bool { line.hasPrefix("|") && line.dropFirst().contains("|") }

    /// `|---|:--:|`: only dashes, colons, pipes and spaces, with at least one dash.
    private static func isDivider(_ line: String) -> Bool {
        let t = line.trimmingCharacters(in: .whitespaces)
        return isTableRow(t) && t.contains("-") && t.allSatisfy { "|-: ".contains($0) }
    }

    private static func cells(of line: String) -> [String] {
        var t = line.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("|") { t.removeFirst() }
        if t.hasSuffix("|") { t.removeLast() }
        return t.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func pad(_ row: [String], to count: Int) -> [String] {
        row.count >= count ? Array(row.prefix(count)) : row + Array(repeating: "", count: count - row.count)
    }
}
