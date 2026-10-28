import Foundation
import CoreGraphics

// The second brain: notes that link to each other, drawn as a graph (Obsidian's idea). The runtime sends the notes and
// their links; this file holds what the window shows and where each note sits. Pure: no views, no timers.

/// What a note is. "memory", "episode", "chat" and "project" are mirrored from ATOM's memory; "note" is written; "entity"
/// is a name that several notes share.
public enum BrainKind: String, Sendable, CaseIterable, Equatable {
    case note, memory, episode, chat, project, entity

    /// The name the legend shows.
    public var title: String {
        switch self {
        case .note: "Notes"
        case .memory: "Facts"
        case .episode: "Conversation notes"
        case .chat: "Kept chats"
        case .project: "Projects"
        case .entity: "Names"
        }
    }

    public var symbol: String {
        switch self {
        case .note: "doc.text"
        case .memory: "brain"
        case .episode: "text.bubble"
        case .chat: "bubble.left.and.bubble.right"
        case .project: "folder"
        case .entity: "person.crop.square"
        }
    }

    /// Notes of these kinds are written by the user or the agent; the others follow ATOM's memory and are replaced when it changes.
    public var isWritten: Bool { self == .note }
}

public struct BrainNode: Sendable, Equatable, Identifiable {
    public var id: Int
    public var title: String
    public var kind: BrainKind
    /// Linked to, never written.
    public var ghost: Bool
    public var tags: [String]
    /// Links in and out.
    public var degree: Int
    public var updatedAt: Date?

    public init(id: Int, title: String, kind: BrainKind = .note, ghost: Bool = false, tags: [String] = [], degree: Int = 0, updatedAt: Date? = nil) {
        self.id = id
        self.title = title
        self.kind = kind
        self.ghost = ghost
        self.tags = tags
        self.degree = degree
        self.updatedAt = updatedAt
    }
}

public struct BrainEdge: Sendable, Equatable {
    public var a: Int
    public var b: Int
    /// Found by ATOM, not written in a note.
    public var auto: Bool

    public init(a: Int, b: Int, auto: Bool = false) {
        self.a = a
        self.b = b
        self.auto = auto
    }
}

public struct BrainTag: Sendable, Equatable, Identifiable {
    public var tag: String
    public var count: Int
    public var id: String { tag }

    public init(tag: String, count: Int) {
        self.tag = tag
        self.count = count
    }
}

public struct BrainGraphData: Sendable, Equatable {
    public var nodes: [BrainNode]
    public var edges: [BrainEdge]
    /// Notes the runtime left out (it sends the most linked 400).
    public var omitted: Int
    public var tags: [BrainTag]

    public init(nodes: [BrainNode] = [], edges: [BrainEdge] = [], omitted: Int = 0, tags: [BrainTag] = []) {
        self.nodes = nodes
        self.edges = edges
        self.omitted = omitted
        self.tags = tags
    }

    /// How many real notes there are (ghosts are links to notes nobody wrote yet).
    public var noteCount: Int { nodes.filter { !$0.ghost }.count }
}

/// A note in another note's link list.
public struct BrainLink: Sendable, Equatable, Identifiable {
    public var id: Int
    public var title: String
    public var kind: BrainKind
    public var ghost: Bool
    public var auto: Bool

    public init(id: Int, title: String, kind: BrainKind = .note, ghost: Bool = false, auto: Bool = false) {
        self.id = id
        self.title = title
        self.kind = kind
        self.ghost = ghost
        self.auto = auto
    }
}

/// One note with its text, the notes it links to and the notes that link to it.
public struct BrainNoteData: Sendable, Equatable, Identifiable {
    public var source: BrainNoteSource?
    public var id: Int
    public var title: String
    public var body: String
    public var kind: BrainKind
    public var ghost: Bool
    public var tags: [String]
    public var links: [BrainLink]
    public var backlinks: [BrainLink]
    public var updatedAt: Date?

    public init(id: Int, title: String, body: String = "", kind: BrainKind = .note, ghost: Bool = false, tags: [String] = [],
                links: [BrainLink] = [], backlinks: [BrainLink] = [], updatedAt: Date? = nil, source: BrainNoteSource? = nil) {
        self.source = source
        self.id = id
        self.title = title
        self.body = body
        self.kind = kind
        self.ghost = ghost
        self.tags = tags
        self.links = links
        self.backlinks = backlinks
        self.updatedAt = updatedAt
    }

    /// The user may edit a note he or the agent wrote, and write a ghost. A mirrored note follows ATOM's memory.
    public var isEditable: Bool { kind.isWritten || ghost }
}

public struct BrainHit: Sendable, Equatable, Identifiable {
    public var id: Int
    public var title: String
    public var kind: BrainKind
    public var snippet: String

    public init(id: Int, title: String, kind: BrainKind = .note, snippet: String = "") {
        self.id = id
        self.title = title
        self.kind = kind
        self.snippet = snippet
    }
}

public struct BrainKindCount: Sendable, Equatable, Identifiable {
    public var kind: BrainKind
    public var count: Int
    public var id: String { kind.rawValue }

    public init(kind: BrainKind, count: Int) {
        self.kind = kind
        self.count = count
    }
}

/// What the second brain's page shows: the graph, the open note, the search, and which kinds are hidden.
public struct BrainState: Sendable, Equatable {
    public private(set) var graph: BrainGraphData?
    public private(set) var selectedId: Int?
    public private(set) var note: BrainNoteData?
    public private(set) var hits: [BrainHit]?
    /// The words the hits answer; an answer to older words is dropped.
    public var query = ""
    public var hiddenKinds: Set<BrainKind> = []
    /// Only notes with this tag (nil: all).
    public var tagFilter: String?
    /// Why the last command was refused (a note's title taken, a note too long).
    public private(set) var error: String?
    /// The page was opened: a restarted runtime is asked again.
    public private(set) var opened = false

    public init() {}

    /// The page opened: ask for the graph (and its changes from then on).
    public mutating func open() -> IslandCommand {
        opened = true
        return .brainGet
    }

    public mutating func setGraph(_ value: BrainGraphData) {
        graph = value
        error = nil
        // A selected note that is gone is dropped.
        if let id = selectedId, !value.nodes.contains(where: { $0.id == id }) {
            selectedId = nil
            note = nil
        }
    }

    public mutating func setNote(_ value: BrainNoteData) {
        note = value
        selectedId = value.id
        error = nil
    }

    public mutating func setHits(query words: String, _ value: [BrainHit]) {
        guard words == query.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
        hits = value
    }

    public mutating func fail(_ message: String) { error = message }

    /// Opens a note by its id (a click on a node or a link). Nil clears the selection.
    public mutating func select(_ id: Int?) -> IslandCommand? {
        guard let id else {
            selectedId = nil
            note = nil
            return nil
        }
        selectedId = id
        if note?.id != id { note = nil }
        return .brainNote(id: id)
    }

    /// New words: search them, or clear the hits for empty words.
    public mutating func search(_ words: String) -> IslandCommand? {
        query = words
        let clean = words.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else {
            hits = nil
            return nil
        }
        return .brainSearch(query: clean)
    }

    /// The graph changed (a save, a delete, a source refresh): ask again for the active words, because the runtime sends hits only
    /// when asked. The old hits stay until it answers, so a refused change loses nothing; nil when no words are active.
    public func refreshSearch() -> IslandCommand? {
        let clean = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty ? nil : .brainSearch(query: clean)
    }

    /// The nodes the filters let through: shown kinds and the chosen tag. Ghosts follow their kind ("note").
    public var visibleIds: Set<Int> {
        guard let graph else { return [] }
        return Set(graph.nodes.filter { node in
            if hiddenKinds.contains(node.kind) { return false }
            if let tag = tagFilter, !node.tags.contains(tag) { return false }
            return true
        }.map(\.id))
    }

    /// Notes that match the search words by title or hit, drawn bright while the others dim.
    public var matchedIds: Set<Int>? {
        guard let hits, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return Set(hits.map(\.id))
    }

    /// The count of notes of each kind, in the legend's order; a kind with none is left out.
    public func counts() -> [BrainKindCount] {
        guard let graph else { return [] }
        var out: [BrainKindCount] = []
        for kind in BrainKind.allCases {
            let n = graph.nodes.filter { $0.kind == kind && !$0.ghost }.count
            if n > 0 { out.append(BrainKindCount(kind: kind, count: n)) }
        }
        return out
    }

    /// The commands for a note: a new note, a rename or change, a delete.
    public func saveCommand(id: Int?, title: String, body: String) -> IslandCommand {
        .brainSave(id: id, title: title, body: body)
    }
}

/// Where each note sits: a force-directed layout (Fruchterman and Reingold). Linked notes pull together, all notes push
/// apart, and a weak pull to the middle keeps lonely notes in view. Positions are in the square -1...1.
public enum BrainLayout {
    public static func solve(ids: [Int], edges: [(Int, Int)], previous: [Int: CGPoint] = [:], iterations: Int = 140) -> [Int: CGPoint] {
        let n = ids.count
        if n == 0 { return [:] }
        if n == 1 { return [ids[0]: .zero] }
        var index: [Int: Int] = [:]
        for (i, id) in ids.enumerated() { index[id] = i }
        var px = [Double](repeating: 0, count: n)
        var py = [Double](repeating: 0, count: n)
        let golden = 2.399963229728653
        var known = 0
        for (i, id) in ids.enumerated() {
            if let p = previous[id] {
                px[i] = Double(p.x)
                py[i] = Double(p.y)
                known += 1
            } else {
                // A new note starts on a spiral, so the start is the same every time.
                let radius = 0.9 * (Double(i) + 0.5).squareRoot() / Double(n).squareRoot()
                let angle = Double(i) * golden
                px[i] = radius * cos(angle)
                py[i] = radius * sin(angle)
            }
        }
        var pairs: [(Int, Int)] = []
        for edge in edges {
            guard let a = index[edge.0], let b = index[edge.1], a != b else { continue }
            pairs.append((a, b))
        }
        let k = 0.9 * (4.0 / Double(n)).squareRoot()
        // A layout that continues from known positions moves less.
        var temperature = known * 2 > n ? 0.04 : 0.12
        let cooling = temperature / Double(iterations + 1)
        var dx = [Double](repeating: 0, count: n)
        var dy = [Double](repeating: 0, count: n)
        for _ in 0..<iterations {
            for i in 0..<n {
                dx[i] = 0
                dy[i] = 0
            }
            for i in 0..<n {
                for j in (i + 1)..<n {
                    var ddx = px[i] - px[j]
                    var ddy = py[i] - py[j]
                    var d2 = ddx * ddx + ddy * ddy
                    if d2 < 1e-8 {
                        ddx = 0.001 * Double(i - j)
                        ddy = 0.001
                        d2 = ddx * ddx + ddy * ddy
                    }
                    let d = d2.squareRoot()
                    let force = k * k / d
                    let fx = ddx / d * force
                    let fy = ddy / d * force
                    dx[i] += fx
                    dy[i] += fy
                    dx[j] -= fx
                    dy[j] -= fy
                }
            }
            for (a, b) in pairs {
                let ddx = px[a] - px[b]
                let ddy = py[a] - py[b]
                let d = max((ddx * ddx + ddy * ddy).squareRoot(), 1e-4)
                let force = d * d / k
                let fx = ddx / d * force
                let fy = ddy / d * force
                dx[a] -= fx
                dy[a] -= fy
                dx[b] += fx
                dy[b] += fy
            }
            for i in 0..<n {
                dx[i] -= px[i] * 0.12
                dy[i] -= py[i] * 0.12
                let length = max((dx[i] * dx[i] + dy[i] * dy[i]).squareRoot(), 1e-9)
                let step = min(length, temperature)
                px[i] += dx[i] / length * step
                py[i] += dy[i] / length * step
            }
            temperature -= cooling
        }
        // Fit the picture into the square -1...1, keeping its shape.
        let minX = px.min() ?? 0, maxX = px.max() ?? 0, minY = py.min() ?? 0, maxY = py.max() ?? 0
        let span = max(maxX - minX, maxY - minY, 1e-6)
        let midX = (minX + maxX) / 2, midY = (minY + maxY) / 2
        var out: [Int: CGPoint] = [:]
        for (i, id) in ids.enumerated() {
            out[id] = CGPoint(x: (px[i] - midX) / span * 2, y: (py[i] - midY) / span * 2)
        }
        return out
    }

    /// The node nearest to a point (in the same square), within `radius`; nil when none is close enough.
    public static func nearest(to point: CGPoint, in positions: [Int: CGPoint], within radius: Double) -> Int? {
        var best: (id: Int, distance: Double)?
        for (id, p) in positions {
            let d = (Double(p.x - point.x) * Double(p.x - point.x) + Double(p.y - point.y) * Double(p.y - point.y)).squareRoot()
            if d <= radius, best == nil || d < best!.distance { best = (id, d) }
        }
        return best?.id
    }
}
