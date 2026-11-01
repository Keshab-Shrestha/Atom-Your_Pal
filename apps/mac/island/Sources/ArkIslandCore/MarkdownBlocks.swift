import Foundation

public enum MarkdownTableAlignment: String, Equatable, Sendable {
    case none, left, center, right
}

public struct MarkdownListItem: Equatable, Sendable {
    public var text: String
    /// A display-only task state; nil means an ordinary list item.
    public var checked: Bool?
    public var children: [MarkdownBlock]
    public init(text: String, checked: Bool? = nil, children: [MarkdownBlock] = []) {
        self.text = text
        self.checked = checked
        self.children = children
    }
}

/// Native display/clipboard blocks. This is a bounded Markdown subset, not an execution format.
public enum MarkdownBlock: Equatable, Sendable {
    case paragraph(String)
    case heading(level: Int, text: String)
    case list(items: [MarkdownListItem], number: Int?)
    case code(String, language: String? = nil)
    case table(header: [String], rows: [[String]], alignment: [MarkdownTableAlignment] = [])
    case quote([MarkdownBlock])
    case rule
}

public enum MarkdownBlocks {
    /// Beyond this depth source remains visible as a paragraph, without dropping content.
    public static let maxNesting = 16

    public static func isRich(_ text: String) -> Bool {
        parse(text).contains { if case .paragraph = $0 { false } else { true } }
    }

    public static func parse(_ text: String) -> [MarkdownBlock] {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        return parse(normalized.components(separatedBy: "\n"), depth: 0)
    }

    private static func parse(_ lines: [String], depth: Int) -> [MarkdownBlock] {
        guard depth < maxNesting else { return [.paragraph(lines.joined(separator: "\n"))] }
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
            if let fence = openingFence(trimmed) {
                flush()
                var body: [String] = []
                i += 1
                while i < lines.count, !closesFence(lines[i], fence) { body.append(lines[i]); i += 1 }
                if i < lines.count { i += 1 }
                blocks.append(.code(body.joined(separator: "\n"), language: fence.language))
            } else if trimmed.isEmpty {
                flush()
                i += 1
            } else if quoteContent(line) != nil {
                flush()
                var quoted: [String] = []
                while i < lines.count, let content = quoteContent(lines[i]) { quoted.append(content); i += 1 }
                blocks.append(.quote(parse(quoted, depth: depth + 1)))
            } else if isRule(trimmed) {
                flush()
                blocks.append(.rule)
                i += 1
            } else if let heading = headingOf(trimmed) {
                flush()
                blocks.append(heading)
                i += 1
            } else if isTableRow(trimmed), i + 1 < lines.count, isDivider(lines[i + 1]) {
                flush()
                let header = cells(of: trimmed)
                let marks = cells(of: lines[i + 1]).map { cell -> MarkdownTableAlignment in
                    if cell.hasPrefix(":"), cell.hasSuffix(":") { return .center }
                    if cell.hasPrefix(":") { return .left }
                    if cell.hasSuffix(":") { return .right }
                    return .none
                }
                let alignment = marks.allSatisfy { $0 == .none } ? [] : marks
                var rows: [[String]] = []
                i += 2
                while i < lines.count, isTableRow(lines[i].trimmingCharacters(in: .whitespaces)) {
                    rows.append(pad(cells(of: lines[i]), to: header.count))
                    i += 1
                }
                blocks.append(.table(header: header, rows: rows, alignment: alignment))
            } else if let first = listMarker(line) {
                flush()
                blocks.append(list(lines, index: &i, first: first, depth: depth))
            } else {
                paragraph.append(trimmed)
                i += 1
            }
        }
        flush()
        return blocks
    }

    private struct Marker {
        var indent: Int
        var contentIndent: Int
        var text: String
        var number: Int?
    }

    private static func list(_ lines: [String], index: inout Int, first: Marker, depth: Int) -> MarkdownBlock {
        var items: [MarkdownListItem] = []
        while index < lines.count, let marker = listMarker(lines[index]), marker.indent == first.indent,
              (marker.number == nil) == (first.number == nil), !isRule(lines[index]) {
            let task = taskText(marker.text)
            var text = task.text
            var children: [String] = []
            index += 1
            while index < lines.count {
                let line = lines[index]
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.isEmpty {
                    var next = index + 1
                    while next < lines.count, lines[next].trimmingCharacters(in: .whitespaces).isEmpty { next += 1 }
                    guard next < lines.count else { break }
                    if let sibling = listMarker(lines[next]), sibling.indent == first.indent,
                       (sibling.number == nil) == (first.number == nil), !isRule(lines[next]) {
                        index = next
                        break
                    }
                    guard indentation(lines[next]) >= marker.contentIndent else { break }
                    children.append(contentsOf: repeatElement("", count: next - index))
                    index = next
                } else if indentation(line) >= marker.contentIndent {
                    children.append(removingIndent(line, columns: marker.contentIndent))
                    index += 1
                } else if indentation(line) >= first.indent, children.isEmpty, listMarker(line) == nil, quoteContent(line) == nil,
                          headingOf(trimmed) == nil, openingFence(trimmed) == nil, !isRule(trimmed), !isTableRow(trimmed) {
                    // A wrapped unindented sentence belongs to the current item until a new block/blank line.
                    text += "\n" + trimmed
                    index += 1
                } else {
                    break
                }
            }
            items.append(MarkdownListItem(text: text, checked: task.checked, children: children.isEmpty ? [] : parse(children, depth: depth + 1)))
        }
        return .list(items: items, number: first.number)
    }

    private static func listMarker(_ line: String) -> Marker? {
        let trimmed = line.drop(while: { $0 == " " || $0 == "\t" })
        let prefix: Int
        var number: Int?
        if let first = trimmed.first, "-*+•".contains(first) {
            prefix = 1
        } else {
            let digits = trimmed.prefix { $0.isASCII && $0.isNumber }
            guard !digits.isEmpty, digits.count <= 9, let value = Int(digits),
                  let mark = trimmed.dropFirst(digits.count).first, mark == "." || mark == ")" else { return nil }
            number = value
            prefix = digits.count + 1
        }
        let rest = trimmed.dropFirst(prefix)
        guard rest.first == " " || rest.first == "\t" else { return nil }
        let text = rest.drop(while: { $0 == " " || $0 == "\t" })
        let consumed = line.count - text.count
        return Marker(indent: indentation(line), contentIndent: columns(String(line.prefix(consumed))), text: String(text), number: number)
    }

    private static func taskText(_ text: String) -> (text: String, checked: Bool?) {
        for (prefix, checked) in [("[ ]", false), ("[x]", true), ("[X]", true)] where text.hasPrefix(prefix) {
            let rest = text.dropFirst(3)
            if rest.isEmpty || rest.first == " " || rest.first == "\t" {
                return (String(rest.drop(while: { $0 == " " || $0 == "\t" })), checked)
            }
        }
        return (text, nil)
    }

    private struct Fence { var mark: Character; var count: Int; var language: String? }
    private static func openingFence(_ line: String) -> Fence? {
        guard let mark = line.first, mark == "`" || mark == "~" else { return nil }
        let count = line.prefix { $0 == mark }.count
        guard count >= 3 else { return nil }
        let info = line.dropFirst(count).trimmingCharacters(in: .whitespaces)
        guard mark != "`" || !info.contains("`") else { return nil }
        let token = info.split(whereSeparator: \.isWhitespace).first.map(String.init)
        let allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_+.#-"
        let language = token.flatMap { value in value.count <= 48 && value.allSatisfy { allowed.contains($0) } ? value : nil }
        return Fence(mark: mark, count: count, language: language)
    }

    private static func closesFence(_ line: String, _ fence: Fence) -> Bool {
        let text = line.trimmingCharacters(in: .whitespaces)
        let run = text.prefix { $0 == fence.mark }.count
        return run >= fence.count && text.dropFirst(run).trimmingCharacters(in: .whitespaces).isEmpty
    }

    private static func quoteContent(_ line: String) -> String? {
        var text = line.drop(while: { $0 == " " || $0 == "\t" })
        guard text.first == ">" else { return nil }
        text.removeFirst()
        if text.first == " " || text.first == "\t" { text.removeFirst() }
        return String(text)
    }

    private static func isRule(_ line: String) -> Bool {
        let marks = line.filter { $0 != " " && $0 != "\t" }
        guard marks.count >= 3, let first = marks.first, "-*_".contains(first) else { return false }
        return marks.allSatisfy { $0 == first }
    }

    private static func headingOf(_ line: String) -> MarkdownBlock? {
        let hashes = line.prefix { $0 == "#" }.count
        guard (1...6).contains(hashes), line.dropFirst(hashes).first == " " else { return nil }
        return .heading(level: hashes, text: line.dropFirst(hashes).trimmingCharacters(in: .whitespaces))
    }

    private static func columns(_ prefix: String) -> Int {
        prefix.reduce(0) { count, character in count + (character == "\t" ? 4 - count % 4 : 1) }
    }
    private static func indentation(_ line: String) -> Int { columns(String(line.prefix { $0 == " " || $0 == "\t" })) }
    private static func removingIndent(_ line: String, columns count: Int) -> String {
        var text = line[...]
        var removed = 0
        while removed < count, let first = text.first, first == " " || first == "\t" {
            removed += first == "\t" ? 4 - removed % 4 : 1
            text.removeFirst()
        }
        return String(repeating: " ", count: max(0, removed - count)) + text
    }

    private static func isTableRow(_ line: String) -> Bool { line.hasPrefix("|") && line.dropFirst().contains("|") }
    private static func isDivider(_ line: String) -> Bool {
        let text = line.trimmingCharacters(in: .whitespaces)
        return isTableRow(text) && text.contains("-") && text.allSatisfy { "|-: ".contains($0) }
    }

    private static func cells(of line: String) -> [String] {
        let text = line.trimmingCharacters(in: .whitespaces)
        var parts: [String] = []
        var current = ""
        var escaped = false
        for character in text {
            if character == "|", !escaped { parts.append(current); current = "" }
            else { current.append(character) }
            escaped = character == "\\" ? !escaped : false
        }
        parts.append(current)
        if text.hasPrefix("|") { parts.removeFirst() }
        if parts.last == "", text.hasSuffix("|") { parts.removeLast() }
        return parts.map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func pad(_ row: [String], to count: Int) -> [String] {
        row.count >= count ? Array(row.prefix(count)) : row + Array(repeating: "", count: count - row.count)
    }
}
