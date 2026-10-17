import Foundation

// ADR-129 (upgrades.md B4): two texts as one run of pieces, for reading what a suggestion changes. Pure: the view colours the
// pieces. The text of the pieces joined in order, without the removed ones, is the new text.

public struct DiffSegment: Sendable, Equatable {
    public enum Kind: Sendable, Equatable { case same, removed, added }
    public var kind: Kind
    public var text: String

    public init(kind: Kind, text: String) {
        self.kind = kind
        self.text = text
    }
}

public enum InlineDiff {
    /// The pieces that turn `old` into `new`: unchanged text, text that goes, text that comes. Empty texts give no pieces.
    public static func segments(old: String, new: String) -> [DiffSegment] {
        let hunks = TextDiff.hunks(old: old, new: new)
        let o = Array(old.utf16)
        var out: [DiffSegment] = []
        var cursor = 0
        func add(_ kind: DiffSegment.Kind, _ text: String) {
            if !text.isEmpty { out.append(DiffSegment(kind: kind, text: text)) }
        }
        for h in hunks {
            add(.same, String(decoding: o[cursor..<h.oldRange.lowerBound], as: UTF16.self))
            add(.removed, h.oldText)
            add(.added, h.newText)
            cursor = h.oldRange.upperBound
        }
        add(.same, String(decoding: o[cursor...], as: UTF16.self))
        return out
    }
}

extension HelperSoul {
    /// The text of a soul field by the name a proposal uses ("personality", "howItWorks", "rules", "lessons"); nil for an unknown name.
    public func text(forField field: String) -> String? {
        switch field {
        case "personality": personality
        case "howItWorks": howItWorks
        case "rules": rules
        case "lessons": lessons
        default: nil
        }
    }
}

extension SoulProposal {
    /// What accepting the proposal changes in the soul as it is now. Nil when the field is unknown.
    public func segments(against soul: HelperSoul?) -> [DiffSegment]? {
        guard let soul, let current = soul.text(forField: field) else { return nil }
        return InlineDiff.segments(old: current, new: text)
    }
}
