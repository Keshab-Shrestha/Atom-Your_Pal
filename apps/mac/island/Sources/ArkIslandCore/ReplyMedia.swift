import Foundation

/// A chart in a reply (2026-11-02, Keshab: "i asked to make me a chart .. it gave me md style of response"): ARK writes a
/// ```chart block holding JSON and the window draws it with Swift Charts. Pure: decoding and checks only.
/// `{"type":"bar","title":"Sales","labels":["Jan","Feb"],"series":[{"name":"2026","values":[12,15]}]}`
public struct ReplyChart: Equatable, Sendable, Decodable {
    public enum Kind: String, Equatable, Sendable, Decodable { case bar, line, pie }
    public struct Series: Equatable, Sendable, Decodable {
        public let name: String
        public let values: [Double]
    }

    public let type: Kind
    public let title: String?
    public let labels: [String]
    public let series: [Series]

    public static let maxLabels = 50, maxSeries = 6, maxText = 120, maxBytes = 32_000

    /// The chart, or nil when the block is not a whole, sane chart (a reply still streaming, a wrong count, a NaN):
    /// the window then shows the block as code.
    public static func parse(_ json: String) -> ReplyChart? {
        guard json.utf8.count <= maxBytes, let chart = try? JSONDecoder().decode(Self.self, from: Data(json.utf8)) else { return nil }
        let texts = chart.labels + chart.series.map(\.name) + [chart.title ?? ""]
        guard (1...maxLabels).contains(chart.labels.count), (1...maxSeries).contains(chart.series.count),
              Set(chart.labels).count == chart.labels.count, texts.allSatisfy({ $0.count <= maxText }),
              chart.series.allSatisfy({ $0.values.count == chart.labels.count && $0.values.allSatisfy(\.isFinite) }) else { return nil }
        if chart.type == .pie {
            guard chart.series.count == 1, chart.series[0].values.allSatisfy({ $0 >= 0 }), chart.series[0].values.contains(where: { $0 > 0 }) else { return nil }
        }
        return chart
    }

    /// The same numbers as a table, for copying: one row per label, one column per series.
    public var table: (header: [String], rows: [[String]]) {
        let header = [""] + series.map(\.name)
        let rows = labels.indices.map { i in [labels[i]] + series.map { Self.number($0.values[i]) } }
        return (header, rows)
    }

    public static func number(_ value: Double) -> String {
        value.rounded() == value && abs(value) < 1e15 ? String(Int64(value)) : String(format: "%.4g", value)
    }
}

/// A picture in a reply (2026-11-02, Keshab: "ialso need images"): a Markdown image on a line of its own,
/// `![what it shows](source)`. A file is an absolute path (or `~/`, or a file URL) to an image file; a web image is https.
public struct ReplyImage: Equatable, Sendable {
    public enum Source: Equatable, Sendable { case file(URL), web(URL) }
    public let alt: String
    public let source: Source

    public static let fileTypes: Set<String> = ["png", "jpg", "jpeg", "gif", "heic", "webp", "tiff", "tif", "bmp", "svg"]

    /// A paragraph split into its text and its image lines, in order.
    public enum Piece: Equatable, Sendable { case text(String), image(ReplyImage) }

    nonisolated(unsafe) private static let line = try! NSRegularExpression(pattern: #"^!\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"\n]*")?\)$"#)

    /// One line that is only an image, or nil.
    public static func parse(_ text: String, home: String = NSHomeDirectory()) -> ReplyImage? {
        let s = text.trimmingCharacters(in: .whitespaces)
        guard let m = line.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
              let altRange = Range(m.range(at: 1), in: s) else { return nil }
        let raw = (Range(m.range(at: 2), in: s) ?? Range(m.range(at: 3), in: s)).map { String(s[$0]) } ?? ""
        guard let source = source(raw, home: home) else { return nil }
        return ReplyImage(alt: String(s[altRange]), source: source)
    }

    /// Text lines stay text; nil when the paragraph has no image line.
    public static func pieces(_ paragraph: String, home: String = NSHomeDirectory()) -> [Piece]? {
        var pieces: [Piece] = []
        var text: [String] = []
        for line in paragraph.components(separatedBy: "\n") {
            if let image = parse(line, home: home) {
                if !text.isEmpty { pieces.append(.text(text.joined(separator: "\n"))); text = [] }
                pieces.append(.image(image))
            } else {
                text.append(line)
            }
        }
        if !text.isEmpty { pieces.append(.text(text.joined(separator: "\n"))) }
        return pieces.contains { if case .image = $0 { true } else { false } } ? pieces : nil
    }

    private static func source(_ raw: String, home: String) -> Source? {
        if raw.lowercased().hasPrefix("https://") {
            guard let url = URL(string: raw), url.host?.isEmpty == false, url.user == nil, url.password == nil else { return nil }
            return .web(url)
        }
        let path: String
        if raw.lowercased().hasPrefix("file://") {
            guard let url = URL(string: raw), url.isFileURL else { return nil }
            path = url.path
        } else if raw.hasPrefix("~/") {
            path = home + String(raw.dropFirst())
        } else if raw.hasPrefix("/") {
            path = raw.removingPercentEncoding ?? raw
        } else {
            return nil // http, data:, relative paths: not drawn
        }
        let url = URL(fileURLWithPath: path).standardizedFileURL
        return fileTypes.contains(url.pathExtension.lowercased()) ? .file(url) : nil
    }
}
