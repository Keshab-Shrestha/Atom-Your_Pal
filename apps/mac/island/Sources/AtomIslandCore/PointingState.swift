import Foundation

/// The place ATOM is showing the user, if any (ADR-054, Task 0.6.4). Pure state: the controller flies Pal to
/// `target` and the bubble says `line`. It ends with a new turn, a reset, an error or a runtime restart; the turn
/// merely finishing does not end it, so the user has a moment to look.
public struct PointingState: Sendable, Equatable {
    public private(set) var target: PointTarget?

    public init() {}

    public mutating func apply(_ event: IslandEvent) {
        switch event {
        case .computerPoint(let point):
            target = point
        case .state(.listening), .conversationReset, .error:
            target = nil
        default:
            break
        }
    }

    public mutating func runtimeStopped() { target = nil }

    public mutating func clear() { target = nil }

    /// What the bubble says.
    public static func line(for target: PointTarget) -> String {
        let label = target.label.trimmingCharacters(in: .whitespacesAndNewlines)
        return label.isEmpty ? "Here" : label
    }
}
