import Foundation

/// A panel (2026-11-02, after Empryo's "Morphs"; the runtime's panels.ts): a named set of blocks on the Panels page, and on Home when
/// pinned. It is inert data: a block holds its own state (a ticked item, a counter), and a button acts only when it is clicked.
public struct Panel: Codable, Sendable, Equatable, Identifiable {
    public struct Item: Codable, Sendable, Equatable {
        public var text: String
        public var done: Bool?
        public init(text: String, done: Bool? = nil) { self.text = text; self.done = done }
    }
    public struct Series: Codable, Sendable, Equatable {
        public var name: String
        public var values: [Double]
        public init(name: String, values: [Double]) { self.name = name; self.values = values }
    }
    public struct Chart: Codable, Sendable, Equatable {
        public var type: String
        public var title: String?
        public var labels: [String]
        public var series: [Series]
        public init(type: String, title: String? = nil, labels: [String], series: [Series]) { self.type = type; self.title = title; self.labels = labels; self.series = series }
    }
    public struct Action: Codable, Sendable, Equatable {
        /// "ask" (a new chat with the prompt in the box), "open" (a page) or "workflow" (run one).
        public var kind: String
        public var prompt: String?
        public var page: String?
        public var id: String?
        public init(kind: String, prompt: String? = nil, page: String? = nil, id: String? = nil) { self.kind = kind; self.prompt = prompt; self.page = page; self.id = id }
    }
    public struct Block: Codable, Sendable, Equatable {
        /// text, stat, progress, checklist, notes, counter, chart or button.
        public var kind: String
        public var label: String?
        public var text: String?
        public var value: String?
        public var detail: String?
        public var max: Double?
        public var count: Double?
        public var step: Double?
        public var items: [Item]?
        public var chart: Chart?
        public var action: Action?
        public init(kind: String, label: String? = nil, text: String? = nil, value: String? = nil, detail: String? = nil, max: Double? = nil, count: Double? = nil,
                    step: Double? = nil, items: [Item]? = nil, chart: Chart? = nil, action: Action? = nil) {
            self.kind = kind; self.label = label; self.text = text; self.value = value; self.detail = detail; self.max = max; self.count = count
            self.step = step; self.items = items; self.chart = chart; self.action = action
        }
    }

    public var id: String
    public var name: String
    public var enabled: Bool
    public var home: Bool
    public var blocks: [Block]
    public var createdAt: String?
    public var updatedAt: String?

    public init(id: String = "", name: String, enabled: Bool = true, home: Bool = false, blocks: [Block], createdAt: String? = nil, updatedAt: String? = nil) {
        self.id = id; self.name = name; self.enabled = enabled; self.home = home; self.blocks = blocks; self.createdAt = createdAt; self.updatedAt = updatedAt
    }

    /// The JSON object the runtime's `panel.save` takes; a new panel leaves out its empty id.
    public var jsonObject: [String: Any] {
        guard let data = try? JSONEncoder().encode(self), var object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
        if id.isEmpty { object.removeValue(forKey: "id") }
        return object
    }

    public static func list(from value: Any?) -> [Panel] {
        guard let value, let data = try? JSONSerialization.data(withJSONObject: value) else { return [] }
        return (try? JSONDecoder().decode([Panel].self, from: data)) ?? []
    }
}

public struct PanelList: Sendable, Equatable {
    public var panels: [Panel]
    public var problem: String?
    public init(panels: [Panel], problem: String? = nil) { self.panels = panels; self.problem = problem }
}

/// `{{live.needsYou}}` in a stat or progress value: ARK's own numbers, filled in when the panel is drawn. `{{live.tokensToday|short}}`
/// writes 12K, as the Dashboard does. A name ARK does not know shows a dash.
public enum PanelTemplate {
    public static let liveNames = ["needsYou", "working", "agents", "chats", "workflows", "tokensToday", "tokensWeek"]

    public static func render(_ text: String, live: [String: Int]) -> String {
        guard text.contains("{{") else { return text }
        var out = ""
        var rest = Substring(text)
        while let open = rest.range(of: "{{") {
            out += rest[..<open.lowerBound]
            guard let close = rest[open.upperBound...].range(of: "}}") else { out += rest[open.lowerBound...]; return out }
            let token = rest[open.upperBound..<close.lowerBound].trimmingCharacters(in: .whitespaces)
            let parts = token.split(separator: "|", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            if let name = parts.first, name.hasPrefix("live."), let n = live[String(name.dropFirst(5))] {
                out += parts.count > 1 && parts[1] == "short" ? TokenTotals.short(n) : String(n)
            } else {
                out += "—"
            }
            rest = rest[close.upperBound...]
        }
        return out + rest
    }

    /// How far a progress block is, 0 to 1: its rendered value over its max. A value that is not a number is 0.
    public static func fraction(value: String, max: Double?, live: [String: Int]) -> Double {
        guard let n = Double(render(value, live: live).trimmingCharacters(in: .whitespaces)), let max, max > 0 else { return 0 }
        return Swift.min(1, Swift.max(0, n / max))
    }
}
