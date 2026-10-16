import Foundation

// ADR-129 (upgrades.md B1): a proposed edit as a list of changes the user accepts or denies one by one. Pure state: the
// window draws it. Accepting applies at once (no separate Save): the owner takes `result` after every decision, and
// `undo()` takes the last decision back.

public enum EditDecision: Sendable, Equatable {
    case accepted, denied
}

public struct EditReview: Sendable, Equatable {
    public let original: String
    public let proposed: String
    public let hunks: [DiffHunk]
    public private(set) var decisions: [Int: EditDecision] = [:]
    /// The decisions before each step, newest last, for `undo()`.
    private var history: [[Int: EditDecision]] = []

    public init(original: String, proposed: String) {
        self.original = original
        self.proposed = proposed
        hunks = TextDiff.hunks(old: original, new: proposed)
    }

    /// The changes that wait for an answer.
    public var pending: [DiffHunk] { hunks.filter { decisions[$0.id] == nil } }
    /// Nothing waits for an answer (also true when there was nothing to change).
    public var isSettled: Bool { pending.isEmpty }
    /// The two texts are the same: ATOM changed nothing.
    public var isUnchanged: Bool { hunks.isEmpty }
    public var canUndo: Bool { !history.isEmpty }

    /// The original with every accepted change applied; a change not yet answered, or denied, stays as it was.
    public var result: String {
        let o = Array(original.utf16)
        var out: [UInt16] = []
        out.reserveCapacity(o.count)
        var cursor = 0
        for h in hunks {
            out.append(contentsOf: o[cursor..<h.oldRange.lowerBound])
            if decisions[h.id] == .accepted {
                out.append(contentsOf: Array(h.newText.utf16))
            } else {
                out.append(contentsOf: o[h.oldRange])
            }
            cursor = h.oldRange.upperBound
        }
        out.append(contentsOf: o[cursor...])
        return String(decoding: out, as: UTF16.self)
    }

    /// Accepts one change; returns the text to keep now. An unknown change, or one already answered, changes nothing.
    @discardableResult
    public mutating func accept(_ id: Int) -> String { decide(id, .accepted) }

    @discardableResult
    public mutating func deny(_ id: Int) -> String { decide(id, .denied) }

    @discardableResult
    public mutating func acceptAll() -> String { decideAll(.accepted) }

    @discardableResult
    public mutating func denyAll() -> String { decideAll(.denied) }

    /// Takes back the last step (one change, or one "all"); returns the text to keep now, nil when there is nothing to undo.
    @discardableResult
    public mutating func undo() -> String? {
        guard let previous = history.popLast() else { return nil }
        decisions = previous
        return result
    }

    /// The change after `id` that waits for an answer (wrapping round), for the next-change keys; nil when none waits.
    public func nextPending(after id: Int?) -> DiffHunk? {
        let waiting = pending
        guard !waiting.isEmpty else { return nil }
        guard let id else { return waiting.first }
        return waiting.first { $0.id > id } ?? waiting.first
    }

    public func previousPending(before id: Int?) -> DiffHunk? {
        let waiting = pending
        guard !waiting.isEmpty else { return nil }
        guard let id else { return waiting.last }
        return waiting.last { $0.id < id } ?? waiting.last
    }

    private mutating func decide(_ id: Int, _ decision: EditDecision) -> String {
        guard hunks.contains(where: { $0.id == id }), decisions[id] == nil else { return result }
        history.append(decisions)
        decisions[id] = decision
        return result
    }

    private mutating func decideAll(_ decision: EditDecision) -> String {
        let waiting = pending
        guard !waiting.isEmpty else { return result }
        history.append(decisions)
        for h in waiting { decisions[h.id] = decision }
        return result
    }
}
