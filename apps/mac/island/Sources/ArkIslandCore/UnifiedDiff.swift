import Foundation

// ADR-275 (design reference: Ghostex, MIT; redrawn in ARK's tokens): a file change as a unified diff, for the diff card.
// Pure: the view draws the rows. Lines only (Myers, from `TextDiff`); each hunk keeps up to three unchanged lines around
// its changes, and two changes closer than that share one hunk.

public struct UnifiedDiff: Sendable, Equatable {
    public struct Line: Sendable, Equatable, Identifiable {
        public enum Kind: Sendable, Equatable { case context, added, removed }
        public let id: Int
        public let kind: Kind
        /// The line's number in the old text; nil for an added line.
        public let old: Int?
        /// The line's number in the new text; nil for a removed line.
        public let new: Int?
        public let text: String
    }

    public struct Hunk: Sendable, Equatable, Identifiable {
        public let id: Int
        /// "@@ -3,4 +3,6 @@", as `diff -u` writes it.
        public let header: String
        public let lines: [Line]
    }

    public let hunks: [Hunk]
    public let added: Int
    public let removed: Int

    public static let context = 3

    public static func make(old: String, new: String) -> UnifiedDiff {
        let a = lines(old), b = lines(new)
        var table: [String: Int] = [:]
        let id = { (line: String) -> Int in
            if let known = table[line] { return known }
            table[line] = table.count
            return table.count - 1
        }
        let blocks = TextDiff.myers(a.map(id), b.map(id))
        // Changes closer than two contexts apart share a hunk.
        var groups: [[TextDiff.ChangeBlock]] = []
        for block in blocks {
            if let last = groups.last?.last, block.a0 - last.a1 <= 2 * context { groups[groups.count - 1].append(block) }
            else { groups.append([block]) }
        }
        var hunks: [Hunk] = [], added = 0, removed = 0, nextLine = 0
        for group in groups {
            let first = group[0], last = group[group.count - 1]
            let lead = min(context, first.a0)
            let trail = min(context, a.count - last.a1, b.count - last.b1)
            var oi = first.a0 - lead, ni = first.b0 - lead
            let (oldStart, newStart) = (oi, ni)
            var out: [Line] = []
            func line(_ kind: Line.Kind, _ text: String, old: Int?, new: Int?) {
                out.append(Line(id: nextLine, kind: kind, old: old.map { $0 + 1 }, new: new.map { $0 + 1 }, text: text))
                nextLine += 1
            }
            for block in group {
                while oi < block.a0 { line(.context, a[oi], old: oi, new: ni); oi += 1; ni += 1 }
                for i in block.a0..<block.a1 { line(.removed, a[i], old: i, new: nil) }
                for i in block.b0..<block.b1 { line(.added, b[i], old: nil, new: i) }
                removed += block.a1 - block.a0; added += block.b1 - block.b0
                oi = block.a1; ni = block.b1
            }
            for _ in 0..<trail { line(.context, a[oi], old: oi, new: ni); oi += 1; ni += 1 }
            let range = { (start: Int, count: Int) in count == 1 ? "\(start + 1)" : "\(count == 0 ? start : start + 1),\(count)" }
            hunks.append(Hunk(id: hunks.count, header: "@@ -\(range(oldStart, oi - oldStart)) +\(range(newStart, ni - newStart)) @@", lines: out))
        }
        return UnifiedDiff(hunks: hunks, added: added, removed: removed)
    }

    /// The text's lines without their "\n"; a final "\n" ends the last line and adds no empty one.
    static func lines(_ text: String) -> [String] {
        guard !text.isEmpty else { return [] }
        var parts = text.components(separatedBy: "\n")
        if text.hasSuffix("\n") { parts.removeLast() }
        return parts
    }

    /// The five mini squares beside "+N −M": one per changed line up to five, green for added and red for removed in proportion,
    /// the rest neutral.
    public static func squares(added: Int, removed: Int, count: Int = 5) -> (added: Int, removed: Int) {
        let total = max(0, added) + max(0, removed)
        guard total > 0 else { return (0, 0) }
        let filled = min(count, total)
        let green = Int((Double(filled) * Double(max(0, added)) / Double(total)).rounded())
        // A side with changes keeps at least one square.
        let g = removed > 0 && green == filled ? filled - 1 : added > 0 && green == 0 ? 1 : green
        return (g, filled - g)
    }

    /// "Sources/App/main.swift" splits into "main.swift" and "Sources/App".
    public static func split(path: String) -> (name: String, folder: String) {
        guard let slash = path.lastIndex(of: "/") else { return (path, "") }
        let folder = String(path[..<slash])
        return (String(path[path.index(after: slash)...]), folder.isEmpty ? "/" : folder)
    }
}
