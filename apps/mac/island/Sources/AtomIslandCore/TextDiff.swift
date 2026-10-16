import Foundation

// ADR-129 (upgrades.md B1): the difference between two texts, as hunks the user can accept or deny one by one. Pure: no
// views, no model. Lines first (Myers' algorithm); inside a changed block, words, so "make it shorter" shows the words
// that changed and not the whole paragraph. Offsets are UTF-16 offsets, the same units as `NSRange`, so a text view can
// use them as they are. No hunk ever splits a character: lines break after "\n" and words and single characters are
// whole.

/// One change: `oldRange` of the old text becomes `newText`. An insertion has an empty `oldRange`; a deletion has an
/// empty `newText`.
public struct DiffHunk: Sendable, Equatable, Identifiable {
    public let id: Int
    /// UTF-16 offsets into the old text.
    public let oldRange: Range<Int>
    /// UTF-16 offsets into the new text.
    public let newRange: Range<Int>
    public let oldText: String
    public let newText: String

    public init(id: Int, oldRange: Range<Int>, newRange: Range<Int>, oldText: String, newText: String) {
        self.id = id
        self.oldRange = oldRange
        self.newRange = newRange
        self.oldText = oldText
        self.newText = newText
    }
}

public enum TextDiff {
    /// Above this many lines in either text, only lines are compared (no words inside a changed block).
    public static let maxRefinedLines = 5_000
    /// A text that differs from the other by more than this many lines (or words) is one change.
    public static let maxEdits = 2_000
    /// A changed block with more words than this on either side is one change.
    public static let maxRefinedTokens = 20_000

    /// The hunks that turn `old` into `new`, in order, not touching each other. Empty when the texts are the same.
    public static func hunks(old: String, new: String) -> [DiffHunk] {
        let o = Array(old.utf16)
        let n = Array(new.utf16)
        if o == n { return [] }
        let oStarts = lineStarts(o)
        let nStarts = lineStarts(n)
        let oLines = oStarts.count - 1
        let nLines = nStarts.count - 1
        var table: [[UInt16]: Int] = [:]
        func id(_ key: [UInt16]) -> Int {
            if let known = table[key] { return known }
            let next = table.count
            table[key] = next
            return next
        }
        let a = (0..<oLines).map { id(Array(o[oStarts[$0]..<oStarts[$0 + 1]])) }
        let b = (0..<nLines).map { id(Array(n[nStarts[$0]..<nStarts[$0 + 1]])) }
        let refine = oLines <= maxRefinedLines && nLines <= maxRefinedLines
        var out: [DiffHunk] = []
        for block in myers(a, b) {
            let oldRange = oStarts[block.a0]..<oStarts[block.a1]
            let newRange = nStarts[block.b0]..<nStarts[block.b1]
            if refine, !oldRange.isEmpty, !newRange.isEmpty {
                let words = refined(String(decoding: o[oldRange], as: UTF16.self), String(decoding: n[newRange], as: UTF16.self))
                if !words.isEmpty {
                    for w in words {
                        out.append(DiffHunk(
                            id: out.count,
                            oldRange: (oldRange.lowerBound + w.old.lowerBound)..<(oldRange.lowerBound + w.old.upperBound),
                            newRange: (newRange.lowerBound + w.new.lowerBound)..<(newRange.lowerBound + w.new.upperBound),
                            oldText: w.oldText,
                            newText: w.newText
                        ))
                    }
                    continue
                }
            }
            out.append(DiffHunk(
                id: out.count,
                oldRange: oldRange,
                newRange: newRange,
                oldText: String(decoding: o[oldRange], as: UTF16.self),
                newText: String(decoding: n[newRange], as: UTF16.self)
            ))
        }
        return out
    }

    // MARK: lines

    /// Where each line starts (a line ends after its "\n"), and the end of the text last: `count + 1` entries.
    static func lineStarts(_ u: [UInt16]) -> [Int] {
        var starts = [0]
        for (i, c) in u.enumerated() where c == 10 { starts.append(i + 1) }
        if starts.last! != u.count { starts.append(u.count) }
        return starts
    }

    // MARK: words

    struct Part {
        var old: Range<Int>
        var new: Range<Int>
        var oldText: String
        var newText: String
    }

    /// The words of a changed block that differ, as offsets inside the block. Empty when the block cannot be refined.
    static func refined(_ old: String, _ new: String) -> [Part] {
        let ot = tokens(old)
        let nt = tokens(new)
        if ot.count > maxRefinedTokens || nt.count > maxRefinedTokens { return [] }
        var table: [[UInt16]: Int] = [:]
        func id(_ token: String) -> Int {
            let key = Array(token.utf16)
            if let known = table[key] { return known }
            let next = table.count
            table[key] = next
            return next
        }
        let a = ot.map(id)
        let b = nt.map(id)
        var blocks = myers(a, b)
        // Two changes with only spaces between them read better as one.
        var merged: [ChangeBlock] = []
        for block in blocks {
            if var last = merged.last, last.a1 < block.a0, ot[last.a1..<block.a0].allSatisfy({ $0.allSatisfy(\.isWhitespace) }) {
                last.a1 = block.a1
                last.b1 = block.b1
                merged[merged.count - 1] = last
            } else {
                merged.append(block)
            }
        }
        blocks = merged
        let oStarts = offsets(ot)
        let nStarts = offsets(nt)
        let oU = Array(old.utf16)
        let nU = Array(new.utf16)
        return blocks.map { blk in
            let oldRange = oStarts[blk.a0]..<oStarts[blk.a1]
            let newRange = nStarts[blk.b0]..<nStarts[blk.b1]
            return Part(old: oldRange, new: newRange, oldText: String(decoding: oU[oldRange], as: UTF16.self), newText: String(decoding: nU[newRange], as: UTF16.self))
        }
    }

    /// Words, and between them runs of spaces and single other characters. Joined, the tokens are the text.
    static func tokens(_ s: String) -> [String] {
        var out: [String] = []
        var cursor = s.startIndex
        func gap(_ part: Substring) {
            var run = ""
            for ch in part {
                if ch.isWhitespace {
                    run.append(ch)
                } else {
                    if !run.isEmpty { out.append(run); run = "" }
                    out.append(String(ch))
                }
            }
            if !run.isEmpty { out.append(run) }
        }
        s.enumerateSubstrings(in: s.startIndex..<s.endIndex, options: [.byWords, .substringNotRequired]) { _, range, _, _ in
            if cursor < range.lowerBound { gap(s[cursor..<range.lowerBound]) }
            out.append(String(s[range]))
            cursor = range.upperBound
        }
        if cursor < s.endIndex { gap(s[cursor...]) }
        return out
    }

    /// UTF-16 offset of each token's start, and the end last.
    static func offsets(_ tokens: [String]) -> [Int] {
        var starts = [0]
        starts.reserveCapacity(tokens.count + 1)
        for t in tokens { starts.append(starts.last! + t.utf16.count) }
        return starts
    }

    // MARK: Myers

    /// `a[a0..<a1]` is replaced by `b[b0..<b1]`.
    struct ChangeBlock: Equatable {
        var a0: Int
        var a1: Int
        var b0: Int
        var b1: Int
    }

    /// The shortest edit script between two lists of ids (Myers, 1986), as change blocks in order, never touching. A pair
    /// that needs more than `maxEdits` edits is one block.
    static func myers(_ a: [Int], _ b: [Int]) -> [ChangeBlock] {
        var pre = 0
        while pre < a.count, pre < b.count, a[pre] == b[pre] { pre += 1 }
        var suf = 0
        while suf < a.count - pre, suf < b.count - pre, a[a.count - 1 - suf] == b[b.count - 1 - suf] { suf += 1 }
        let n = a.count - pre - suf
        let m = b.count - pre - suf
        if n == 0, m == 0 { return [] }
        let whole = [ChangeBlock(a0: pre, a1: pre + n, b0: pre, b1: pre + m)]
        if n == 0 || m == 0 { return whole }
        let limit = min(n + m, maxEdits)
        let off = limit + 1
        var v = [Int](repeating: 0, count: 2 * limit + 3)
        var trace: [[Int]] = []
        var found = -1
        search: for d in 0...limit {
            trace.append(Array(v[(off - d)...(off + d)])) // the diagonals -d...d before this round
            var k = -d
            while k <= d {
                var x: Int
                if k == -d || (k != d && v[off + k - 1] < v[off + k + 1]) {
                    x = v[off + k + 1]
                } else {
                    x = v[off + k - 1] + 1
                }
                var y = x - k
                while x < n, y < m, a[pre + x] == b[pre + y] { x += 1; y += 1 }
                v[off + k] = x
                if x >= n, y >= m {
                    found = d
                    break search
                }
                k += 2
            }
        }
        if found < 0 { return whole }
        // Walk back from the end: 0 keeps an item, 1 deletes one from `a`, 2 inserts one from `b`.
        var ops: [UInt8] = []
        var x = n
        var y = m
        var d = found
        while d > 0 {
            let before = trace[d]
            let k = x - y
            let previous = (k == -d || (k != d && before[k - 1 + d] < before[k + 1 + d])) ? k + 1 : k - 1
            let px = before[previous + d]
            let py = px - previous
            while x > px, y > py {
                ops.append(0)
                x -= 1
                y -= 1
            }
            if x == px {
                ops.append(2)
                y -= 1
            } else {
                ops.append(1)
                x -= 1
            }
            x = px
            y = py
            d -= 1
        }
        while x > 0, y > 0 {
            ops.append(0)
            x -= 1
            y -= 1
        }
        ops.reverse()
        var blocks: [ChangeBlock] = []
        var ai = 0
        var bi = 0
        var current: ChangeBlock?
        for op in ops {
            if op == 0 {
                if let c = current {
                    blocks.append(c)
                    current = nil
                }
                ai += 1
                bi += 1
            } else {
                if current == nil { current = ChangeBlock(a0: ai, a1: ai, b0: bi, b1: bi) }
                if op == 1 {
                    ai += 1
                    current!.a1 = ai
                } else {
                    bi += 1
                    current!.b1 = bi
                }
            }
        }
        if let c = current { blocks.append(c) }
        return blocks.map { ChangeBlock(a0: $0.a0 + pre, a1: $0.a1 + pre, b0: $0.b0 + pre, b1: $0.b1 + pre) }
    }
}
