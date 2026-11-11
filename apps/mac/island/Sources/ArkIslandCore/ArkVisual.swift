import Foundation

/// ADR-276: a result card in a reply (design reference: Ghostex's `visual` blocks, MIT; no code taken). An agent writes a
/// ```ark-visual block holding one strict JSON object; the window draws stat tiles, bar and line charts and tables in one card.
/// Pure and total: `parse` returns nil for anything outside the grammar or its limits, and the window then shows the source as code.
/// No scripts, no network, no HTML: only text and numbers pass.
public struct ArkVisual: Equatable, Sendable {
    public static let language = "ark-visual"
    public static let maxBytes = 64_000, maxBlocks = 6, maxPoints = 40, maxStats = 12
    public static let maxRows = 200, maxColumns = 8, maxShort = 80, maxCell = 200

    public enum Tone: String, Equatable, Sendable { case good, bad, neutral }
    public struct Stat: Equatable, Sendable {
        public let label: String, value: String, note: String?, tone: Tone
    }
    public struct Point: Equatable, Sendable {
        public let label: String, value: Double
    }
    public enum Block: Equatable, Sendable {
        case stats(title: String?, items: [Stat])
        case bar(title: String?, unit: String?, data: [Point])
        case line(title: String?, unit: String?, data: [Point])
        case table(title: String?, columns: [String], rows: [[String]])
    }

    public let title: String
    public let blocks: [Block]

    public static func parse(_ json: String) -> ArkVisual? {
        guard json.utf8.count <= maxBytes,
              let root = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
              Set(root.keys).isSubset(of: ["title", "blocks"]),
              let title = short(root["title"]), !title.isEmpty,
              let raw = root["blocks"] as? [Any], (1...maxBlocks).contains(raw.count) else { return nil }
        var blocks: [Block] = []
        for item in raw {
            guard let block = (item as? [String: Any]).flatMap(block) else { return nil }
            blocks.append(block)
        }
        return ArkVisual(title: title, blocks: blocks)
    }

    private static func block(_ b: [String: Any]) -> Block? {
        switch b["type"] as? String {
        case "stats":
            guard Set(b.keys).isSubset(of: ["type", "title", "items"]), let title = optional(b["title"]),
                  let raw = b["items"] as? [Any], (1...maxStats).contains(raw.count) else { return nil }
            var items: [Stat] = []
            for entry in raw {
                guard let s = entry as? [String: Any], Set(s.keys).isSubset(of: ["label", "value", "note", "tone"]),
                      let label = short(s["label"]), let value = cell(s["value"], limit: maxShort) else { return nil }
                let note: String?
                if s["note"] == nil { note = nil } else { guard let n = short(s["note"]) else { return nil }; note = n }
                let tone: Tone
                if s["tone"] == nil { tone = .neutral } else { guard let t = (s["tone"] as? String).flatMap(Tone.init) else { return nil }; tone = t }
                items.append(Stat(label: label, value: value, note: note, tone: tone))
            }
            return .stats(title: title, items: items)
        case let kind? where kind == "bar" || kind == "line":
            guard Set(b.keys).isSubset(of: ["type", "title", "unit", "data"]), let title = optional(b["title"]), let unit = optional(b["unit"]),
                  let raw = b["data"] as? [Any], (1...maxPoints).contains(raw.count) else { return nil }
            var data: [Point] = []
            for entry in raw {
                guard let p = entry as? [String: Any], Set(p.keys) == ["label", "value"],
                      let label = short(p["label"]), let value = number(p["value"]) else { return nil }
                data.append(Point(label: label, value: value))
            }
            guard Set(data.map(\.label)).count == data.count else { return nil } // a repeated label would merge on the axis
            return kind == "bar" ? .bar(title: title, unit: unit, data: data) : .line(title: title, unit: unit, data: data)
        case "table":
            guard Set(b.keys).isSubset(of: ["type", "title", "columns", "rows"]), let title = optional(b["title"]),
                  let rawColumns = b["columns"] as? [Any], (1...maxColumns).contains(rawColumns.count),
                  let rawRows = b["rows"] as? [Any], (1...maxRows).contains(rawRows.count) else { return nil }
            let columns = rawColumns.compactMap(short)
            guard columns.count == rawColumns.count else { return nil }
            var rows: [[String]] = []
            for entry in rawRows {
                guard let r = entry as? [Any], r.count == columns.count else { return nil }
                let cells = r.compactMap { cell($0, limit: maxCell) }
                guard cells.count == r.count else { return nil }
                rows.append(cells)
            }
            return .table(title: title, columns: columns, rows: rows)
        default:
            return nil
        }
    }

    /// A one-line text within `maxShort`.
    private static func short(_ value: Any?) -> String? {
        guard let s = value as? String, s.count <= maxShort, plain(s) else { return nil }
        return s
    }
    /// One line with no hidden characters (a U+202E would reverse what the card shows).
    private static func plain(_ s: String) -> Bool {
        !s.contains(where: \.isNewline) && HiddenCharacters.strip(s).removed == 0
    }
    /// An absent title or unit is fine (`.some(nil)`); a present one must be valid, else nil.
    private static func optional(_ value: Any?) -> String?? {
        guard let value else { return .some(nil) }
        return short(value).map { .some($0) }
    }
    /// A finite JSON number (never a boolean, which Foundation also reads as a number).
    private static func number(_ value: Any?) -> Double? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }
        return n.doubleValue
    }
    /// A table cell or stat value: text, or a number written as ARK writes numbers.
    private static func cell(_ value: Any?, limit: Int) -> String? {
        if let s = value as? String { return s.count <= limit && plain(s) ? s : nil }
        return number(value).map(ReplyChart.number)
    }
}

extension ArkVisual {
    /// What Copy puts on the clipboard: the title, then each block as a Markdown table under its own title.
    public var markdown: String {
        let parts = blocks.map { block -> String in
            let (heading, header, rows) = table(of: block)
            let text = MarkdownCopy.table(header: header, rows: rows, format: .markdown).text
            return heading.map { "**\($0)**\n\n" + text } ?? text
        }
        return (["## " + title] + parts).joined(separator: "\n\n")
    }

    /// Each block as rows, for Copy and for the Select text page.
    public func table(of block: Block) -> (title: String?, header: [String], rows: [[String]]) {
        switch block {
        case .stats(let title, let items):
            let notes = items.contains { $0.note != nil }
            return (title, notes ? ["Stat", "Value", "Note"] : ["Stat", "Value"],
                    items.map { notes ? [$0.label, $0.value, $0.note ?? ""] : [$0.label, $0.value] })
        case .bar(let title, let unit, let data), .line(let title, let unit, let data):
            return (title, ["Label", unit.map { "Value (\($0))" } ?? "Value"], data.map { [$0.label, ReplyChart.number($0.value)] })
        case .table(let title, let columns, let rows):
            return (title, columns, rows)
        }
    }

    /// What VoiceOver reads: the title, each stat, and the shape of each chart and table, never every row.
    public var accessibilitySummary: String {
        let parts = blocks.map { block -> String in
            switch block {
            case .stats(let title, let items):
                return (title.map { "\($0): " } ?? "") + items.map { "\($0.label) \($0.value)" + ($0.note.map { ", \($0)" } ?? "") }.joined(separator: ". ")
            case .bar(let title, let unit, let data):
                return chart("Bar chart", title, data.count == 1 ? "1 bar" : "\(data.count) bars", data.max { $0.value < $1.value }, unit)
            case .line(let title, let unit, let data):
                return chart("Line chart", title, data.count == 1 ? "1 point" : "\(data.count) points", data.max { $0.value < $1.value }, unit)
            case .table(let title, let columns, let rows):
                return "Table" + (title.map { " \($0)" } ?? "") + " with \(rows.count) \(rows.count == 1 ? "row" : "rows"): " + columns.joined(separator: ", ")
            }
        }
        return ([title] + parts).joined(separator: ". ") + "."
    }

    private func chart(_ kind: String, _ title: String?, _ count: String, _ top: Point?, _ unit: String?) -> String {
        let largest = top.map { ", largest \($0.label) \(ReplyChart.number($0.value))" + (unit.map { " \($0)" } ?? "") } ?? ""
        return kind + (title.map { " \($0)" } ?? "") + " with " + count + largest
    }
}
