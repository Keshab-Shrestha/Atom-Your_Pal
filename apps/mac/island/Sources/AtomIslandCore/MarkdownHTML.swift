import Foundation

extension MarkdownBlocks {
    /// The reply as HTML, for the clipboard: Notes, Pages, Mail and Docs paste a real table from it.
    /// The plain-text flavour stays the Markdown itself.
    public static func html(_ text: String) -> String {
        parse(text).map(html(of:)).joined()
    }

    private static func html(of block: MarkdownBlock) -> String {
        switch block {
        case .paragraph(let s):
            return "<p>\(inline(s).replacingOccurrences(of: "\n", with: "<br>"))</p>"
        case .heading(let level, let s):
            return "<h\(level)>\(inline(s))</h\(level)>"
        case .list(let items, let number):
            let tag = number == nil ? "ul" : "ol"
            let start = number.map { $0 > 1 ? " start=\"\($0)\"" : "" } ?? ""
            return "<\(tag)\(start)>" + items.map { "<li>\(inline($0))</li>" }.joined() + "</\(tag)>"
        case .code(let s):
            return "<pre><code>\(escape(s))</code></pre>"
        case .table(let header, let rows):
            let head = "<tr>" + header.map { "<th>\(inline($0))</th>" }.joined() + "</tr>"
            let body = rows.map { "<tr>" + $0.map { "<td>\(inline($0))</td>" }.joined() + "</tr>" }.joined()
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
