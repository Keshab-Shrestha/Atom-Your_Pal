import Foundation

/// The filter chips of the Needs you page (from the HTML preview): All, Approvals, Plans, Suggestions, Held, Failed.
/// A filter only chooses what shows. It never answers, hides the count of the rest, or changes what waits.
public enum NeedsYouFilter: Int, CaseIterable, Sendable {
    case all, approvals, plans, suggestions, held, failed

    public var title: String {
        switch self {
        case .all: "All"
        case .approvals: "Approvals"
        case .plans: "Plans"
        case .suggestions: "Suggestions"
        case .held: "Held"
        case .failed: "Failed"
        }
    }

    /// Whether a waiting item of this kind shows under the filter. Every kind has exactly one group besides All.
    public func matches(_ kind: NeedsYouItem.Kind) -> Bool {
        switch self {
        case .all: true
        case .approvals: false
        case .plans: kind == .plan
        case .suggestions: kind == .proposal || kind == .skillDraft || kind == .skillEdit || kind == .skillHub
        case .held: kind == .held
        case .failed: kind == .failed
        }
    }

    /// ATOM's own approval card (a command or a file edit) has no item in the list.
    public var showsApproval: Bool { self == .all || self == .approvals }
    /// Failed tasks are listed apart from the waiting items (ADR-116).
    public var showsFailed: Bool { self == .all || self == .failed }

    /// The number on each chip. A failed item inside `items` is counted by `failed` only.
    public static func counts(items: [NeedsYouItem], failed: Int, hasApproval: Bool) -> [NeedsYouFilter: Int] {
        let waiting = items.filter { $0.kind != .failed }
        var counts: [NeedsYouFilter: Int] = [
            .approvals: hasApproval ? 1 : 0,
            .failed: failed,
        ]
        for filter in [NeedsYouFilter.plans, .suggestions, .held] {
            counts[filter] = waiting.filter { filter.matches($0.kind) }.count
        }
        counts[.all] = counts.values.reduce(0, +)
        return counts
    }
}
