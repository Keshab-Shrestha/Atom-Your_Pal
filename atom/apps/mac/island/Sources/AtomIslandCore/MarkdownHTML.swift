import Foundation

extension MarkdownBlocks {
    /// The reply as HTML, for the clipboard: Notes, Pages, Mail and Docs paste a real table from it.
    /// The plain-text flavour stays the Markdown itself.
    public static func html(_ text: String) -> String {
        parse(text).map(html(of:)).joined()
    }

    public static func html(of block: MarkdownBlock) -> String {
        switch block {
        case .paragraph(let s):
            return "<p>\(inline(s).replacingOccurrences(of: "\n", with: "<br>"))</p>"
        case .heading(let level, let s):
            return "<h\(level)>\(inline(s))</h\(level)>"
        case .list(let items, let number):
            let tag = number == nil ? "ul" : "ol"
            let start = number.map { $0 != 1 ? " start=\"\($0)\"" : "" } ?? ""
            return "<\(tag)\(start)>" + items.map { item in
                let task = item.checked.map { $0 ? "☑ " : "☐ " } ?? ""
                let children = item.children.map(html(of:)).joined()
                return "<li>\(task)\(inline(item.text).replacingOccurrences(of: "\n", with: "<br>"))\(children)</li>"
            }.joined() + "</\(tag)>"
        case .quote(let children):
            return "<blockquote>" + children.map(html(of:)).joined() + "</blockquote>"
        case .rule:
            return "<hr>"
        case .code(let s, _):
            return "<pre><code>\(escape(s))</code></pre>"
        case .table(let header, let rows, let alignment):
            func cell(_ text: String, tag: String, index: Int) -> String {
                let align = index < alignment.count ? alignment[index] : .none
                let style = align == .none ? "" : " style=\"text-align:\(align.rawValue)\""
                return "<\(tag)\(style)>\(inline(text.replacingOccurrences(of: "\\|", with: "|")))</\(tag)>"
            }
            let head = "<tr>" + header.enumerated().map { cell($0.element, tag: "th", index: $0.offset) }.joined() + "</tr>"
            let body = rows.map { row in
                "<tr>" + row.enumerated().map { cell($0.element, tag: "td", index: $0.offset) }.joined() + "</tr>"
            }.joined()
            return "<table border=\"1\" cellspacing=\"0\" cellpadding=\"4\">\(head)\(body)</table>"
        }
    }

    private static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
    }

    /// Bold, italic and `code` only; anything else stays as the text it is.
    private static func inline(_ s: String) -> String {
        var out = escape(s)
        for (pattern, template) in [("`([^`]+)`", "<code>$1</code>"), ("\\*\\*([^*]+)\\*\\*", "<strong>$1</strong>"), ("\\*([^*]+)\\*", "<em>$1</em>")] {
            out = out.replacingOccurrences(of: pattern, with: template, options: .regularExpression)
        }
        return out
    }
}
