import Foundation

/// The whole chat as one HTML page for "Select text" (2026-11-02, Keshab: "select any amount of texts and its format (bold,
/// italic, underlined and also tables as it is)"). A text view shows it, so one drag or ⌘A spans every message, and a copy keeps
/// the formatting. A chart becomes its numbers as a table; a drawing or an image becomes a short label. Pure.
public enum ChatTranscript {
    /// Colours as CSS hex ("#e6e6e6") and the body size in points.
    public struct Style: Sendable, Equatable {
        public var text: String, muted: String, rule: String, size: Int
        public init(text: String, muted: String, rule: String, size: Int = 14) {
            self.text = text; self.muted = muted; self.rule = rule; self.size = size
        }
    }

    public static func html(_ conversation: Conversation, style: Style) -> String {
        let css = """
        body { font-family: -apple-system, "Helvetica Neue", sans-serif; font-size: \(style.size)px; color: \(style.text); line-height: 1.45; }
        .who { font-size: \(style.size - 3)px; font-weight: 600; color: \(style.muted); margin: 20px 0 4px 0; }
        table { border-collapse: collapse; margin: 6px 0; width: 100%; border: 1px solid \(style.rule); }
        th, td { border: 1px solid \(style.rule); padding: 4px 8px; text-align: left; }
        pre, code { font-family: Menlo, monospace; font-size: \(style.size - 2)px; }
        blockquote { color: \(style.muted); }
        """
        let body = conversation.turns.map { turn -> String in
            var parts: [String] = []
            let said = turn.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
            if !said.isEmpty {
                let paragraphs = said.components(separatedBy: "\n\n").map { "<p>" + MarkdownBlocks.escape($0).replacingOccurrences(of: "\n", with: "<br>") + "</p>" }
                parts.append("<div class=\"who\">You</div>" + paragraphs.joined())
            }
            if let reply = turn.reply?.trimmingCharacters(in: .whitespacesAndNewlines), !reply.isEmpty {
                parts.append("<div class=\"who\">ARK</div>" + blocks(reply).map(MarkdownBlocks.html(of:)).joined())
            }
            return parts.joined()
        }.joined()
        return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>\(css)</style></head><body>\(body)</body></html>"
    }

    /// A reply's blocks with its media made selectable: chart → table, drawing → label, image line → label.
    public static func blocks(_ reply: String) -> [MarkdownBlock] {
        MarkdownBlocks.parse(reply).map { block in
            switch block {
            case .code(let s, let language) where language?.lowercased() == "chart":
                guard let chart = ReplyChart.parse(s) else { return block }
                let table = chart.table
                return .table(header: [chart.title ?? ""] + table.header.dropFirst(), rows: table.rows)
            case .code(let s, let language) where language?.lowercased() == "svg":
                return ReplySVG.check(s) == nil ? block : .paragraph("*Drawing*")
            case .paragraph(let s):
                guard let pieces = ReplyImage.pieces(s) else { return block }
                return .paragraph(pieces.map { piece in
                    switch piece {
                    case .text(let t): t
                    case .image(let image): "*Image: \(image.alt.isEmpty ? "untitled" : image.alt)*"
                    }
                }.joined(separator: "\n"))
            default:
                return block
            }
        }
    }
}
