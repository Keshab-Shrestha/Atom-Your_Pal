import Foundation

/// ADR-273 (design reference: Ghostex, MIT, its threads list): Board jobs as a tree. Each child sits right under the job that
/// started it, a manager shows how many workers it started and how old it is, and a quiet job gets a red dot.
public enum JobTree {
    /// The quiet dot's tip; the runtime marks a job quiet after 8 minutes (`QUIET_AFTER_MS` in job-quiet.ts).
    public static let quietTip = "No new output for 8 min"
    /// The deepest level drawn; ADR-272 allows 4, so this only stops a bad loop.
    static let maxDepth = 8

    /// `items` in tree order: each child right after its parent, one step deeper, in the order given. An item whose parent is
    /// not in `items` is a root.
    public static func ordered<T>(_ items: [T], id: (T) -> Int, parent: (T) -> Int?) -> [(item: T, depth: Int)] {
        let ids = Set(items.map(id))
        var children: [Int: [T]] = [:]
        var roots: [T] = []
        for item in items {
            if let p = parent(item), p != id(item), ids.contains(p) { children[p, default: []].append(item) } else { roots.append(item) }
        }
        var out: [(item: T, depth: Int)] = []
        var placed = Set<Int>()
        func place(_ item: T, _ depth: Int) {
            guard placed.insert(id(item)).inserted else { return }
            out.append((item, depth))
            guard depth < maxDepth else { return }
            for child in children[id(item)] ?? [] { place(child, depth + 1) }
        }
        for root in roots { place(root, 0) }
        // A loop (a parent cycle) has no root: show what is left flat rather than lose it.
        for item in items where !placed.contains(id(item)) { place(item, 0) }
        return out
    }

    /// How many jobs each job started directly, over every job ARK knows.
    public static func workerCounts(_ jobs: [HelperJob]) -> [Int: Int] {
        jobs.reduce(into: [:]) { counts, job in if let p = job.parentId { counts[p, default: 0] += 1 } }
    }

    /// "1 worker", "3 workers".
    public static func workersText(_ n: Int) -> String { n == 1 ? "1 worker" : "\(n) workers" }

    /// A short age: "now" under a minute, then "2m", "1h", "3d".
    public static func age(since: Date?, now: Date = Date()) -> String? {
        guard let since else { return nil }
        let s = max(0, Int(now.timeIntervalSince(since)))
        if s < 60 { return "now" }
        if s < 3600 { return "\(s / 60)m" }
        if s < 86_400 { return "\(s / 3600)h" }
        return "\(s / 86_400)d"
    }

    /// One line of at most `max` characters: line breaks and runs of spaces become one space, and a cut ends in "…".
    public static func line(_ text: String?, max: Int = 120) -> String? {
        guard let text else { return nil }
        let flat = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard !flat.isEmpty else { return nil }
        return flat.count > max ? String(flat.prefix(max - 1)).trimmingCharacters(in: .whitespaces) + "…" : flat
    }
}

/// The glyph a worker row shows (ADR-273).
public enum WorkerMark: Sendable, Equatable {
    case running, needsYou, queued, done, failed, stopped

    /// A plan to approve or a held task needs Keshab before any state does.
    public static func of(_ job: HelperJob) -> WorkerMark {
        if job.awaitsApproval || job.held != nil { return .needsYou }
        switch job.state {
        case .running: return .running
        case .queued: return .queued
        case .done: return .done
        case .failed: return .failed
        case .stopped: return .stopped
        }
    }

    public var title: String {
        switch self {
        case .running: "Running"
        case .needsYou: "Needs you"
        case .queued: "Queued"
        case .done: "Done"
        case .failed: "Failed"
        case .stopped: "Stopped"
        }
    }
}

/// The Workers card's rows past its limit (ADR-273): the first `limit` while it is folded, all of them when open.
public enum WorkersFold {
    public static let limit = 5

    public static func shown<T>(_ rows: [T], showAll: Bool) -> (rows: [T], hidden: Int) {
        showAll || rows.count <= limit ? (rows, 0) : (Array(rows.prefix(limit)), rows.count - limit)
    }
}
