import Foundation

// ADR-275 (design reference: Ghostex, MIT; redrawn in ARK's tokens): a file change as a unified diff, for the diff card.
// Pure: the view draws the rows. Lines (Myers, from `TextDiff`); each hunk keeps up to three unchanged lines around
// its changes, and two changes closer than that share one hunk. A removed line and the added line at the same place in a
// change get the changed character range (common prefix and suffix trimmed), and `segments` shows hidden characters as
// visible marks, so a one-character or invisible change does not look like two equal lines.

public struct UnifiedDiff: Sendable, Equatable {
    public struct Line: Sendable, Equatable, Identifiable {
        /// `note` is "\\ No newline at end of file", after the line it is about, as `diff -u` writes it.
        public enum Kind: Sendable, Equatable { case context, added, removed, note }
        public let id: Int
        public let kind: Kind
        /// The line's number in the old text; nil for an added line.
        public let old: Int?
        /// The line's number in the new text; nil for a removed line.
        public let new: Int?
        public let text: String
        /// The changed characters (offsets in `text`) when this line pairs with a line of the other kind; nil otherwise.
        public var changed: Range<Int>? = nil
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
    public static let noNewline = "\\ No newline at end of file"

    public static func make(old: String, new: String) -> UnifiedDiff {
        let a = lines(old), b = lines(new)
        // A last line with no "\n" is a different line from the same text with one ("\n" never occurs in a line).
        let aEnd = old.hasSuffix("\n") ? -1 : a.count - 1, bEnd = new.hasSuffix("\n") ? -1 : b.count - 1
        let key = { (lines: [String], end: Int, i: Int) in i == end ? lines[i] + "\n" : lines[i] }
        var table: [String: Int] = [:]
        let id = { (line: String) -> Int in
            if let known = table[line] { return known }
            table[line] = table.count
            return table.count - 1
        }
        let blocks = TextDiff.myers(a.indices.map { id(key(a, aEnd, $0)) }, b.indices.map { id(key(b, bEnd, $0)) })
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
            func line(_ kind: Line.Kind, _ text: String, old: Int?, new: Int?, last: Bool = false, changed: Range<Int>? = nil) {
                out.append(Line(id: nextLine, kind: kind, old: old.map { $0 + 1 }, new: new.map { $0 + 1 }, text: text, changed: changed))
                nextLine += 1
                if last { out.append(Line(id: nextLine, kind: .note, old: nil, new: nil, text: noNewline)); nextLine += 1 }
            }
            for block in group {
                while oi < block.a0 { line(.context, a[oi], old: oi, new: ni, last: oi == aEnd); oi += 1; ni += 1 }
                let pairs = (0..<min(block.a1 - block.a0, block.b1 - block.b0)).map { changedRanges(a[block.a0 + $0], b[block.b0 + $0]) }
                for i in block.a0..<block.a1 {
                    line(.removed, a[i], old: i, new: nil, last: i == aEnd, changed: i - block.a0 < pairs.count ? pairs[i - block.a0].old : nil)
                }
                for i in block.b0..<block.b1 {
                    line(.added, b[i], old: nil, new: i, last: i == bEnd, changed: i - block.b0 < pairs.count ? pairs[i - block.b0].new : nil)
                }
                removed += block.a1 - block.a0; added += block.b1 - block.b0
                oi = block.a1; ni = block.b1
            }
            for _ in 0..<trail { line(.context, a[oi], old: oi, new: ni, last: oi == aEnd); oi += 1; ni += 1 }
            let range = { (start: Int, count: Int) in count == 1 ? "\(start + 1)" : "\(count == 0 ? start : start + 1),\(count)" }
            hunks.append(Hunk(id: hunks.count, header: "@@ -\(range(oldStart, oi - oldStart)) +\(range(newStart, ni - newStart)) @@", lines: out))
        }
        return UnifiedDiff(hunks: hunks, added: added, removed: removed)
    }

    /// The changed characters of a removed line and its added pair: what is left after the common prefix and suffix. An
    /// empty side (only added or only removed characters) is nil, so nothing is marked on it.
    public static func changedRanges(_ old: String, _ new: String) -> (old: Range<Int>?, new: Range<Int>?) {
        let o = Array(old), n = Array(new)
        var prefix = 0
        while prefix < o.count, prefix < n.count, o[prefix] == n[prefix] { prefix += 1 }
        var suffix = 0
        while suffix < o.count - prefix, suffix < n.count - prefix, o[o.count - 1 - suffix] == n[n.count - 1 - suffix] { suffix += 1 }
        let range = { (count: Int) in prefix < count - suffix ? prefix..<(count - suffix) : nil }
        return (range(o.count), range(n.count))
    }

    /// A piece of a diff line as the card draws it: plain text, or a visible mark for a hidden character, inside or outside
    /// the changed range.
    public struct Segment: Sendable, Equatable {
        public let text: String
        public let changed: Bool
        public let mark: Bool
    }

    /// The line's text in pieces. A control character shows as its Control Pictures glyph ("\r" as ␍, U+0000 as ␀, DEL as
    /// ␡); a bidi, zero-width or other format character as "⟨U+202E⟩". A tab stays a tab. Joiners inside an emoji stay.
    public static func segments(_ text: String, changed: Range<Int>?) -> [Segment] {
        var out: [Segment] = []
        func add(_ piece: String, _ changed: Bool, _ mark: Bool) {
            if let last = out.last, last.changed == changed, last.mark == mark {
                out[out.count - 1] = Segment(text: last.text + piece, changed: changed, mark: mark)
            } else { out.append(Segment(text: piece, changed: changed, mark: mark)) }
        }
        for (offset, character) in text.enumerated() {
            let inside = changed?.contains(offset) ?? false
            let emoji = character.unicodeScalars.count > 1 && character.unicodeScalars.contains { $0.properties.isEmoji && $0.value > 0x7F }
            var plain = String.UnicodeScalarView()
            for scalar in character.unicodeScalars {
                guard let mark = visibleMark(scalar), !(emoji && scalar.value == 0x200D) else { plain.append(scalar); continue }
                if !plain.isEmpty { add(String(plain), inside, false); plain = String.UnicodeScalarView() }
                add(mark, inside, true)
            }
            if !plain.isEmpty { add(String(plain), inside, false) }
        }
        return out
    }

    /// The visible stand-in for a character that would not show, or nil for one that shows (a tab counts as one that shows).
    static func visibleMark(_ scalar: Unicode.Scalar) -> String? {
        switch scalar.value {
        case 0x09: return nil
        case 0x00...0x1F: return String(Character(Unicode.Scalar(0x2400 + scalar.value)!))
        case 0x7F: return "\u{2421}"
        default: break
        }
        switch scalar.properties.generalCategory {
        case .control, .format, .lineSeparator, .paragraphSeparator: return "⟨U+\(String(format: "%04X", scalar.value))⟩"
        default: return nil
        }
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
