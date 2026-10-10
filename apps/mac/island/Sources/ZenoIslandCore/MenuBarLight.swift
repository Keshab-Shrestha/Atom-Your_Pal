/// The menu-bar item's Wisp glyph (ADR-084): one silhouette for every state, never a different symbol. Only three
/// moments colour it: Wisp's light while listening, amber when Wisp needs you, coral when something went wrong.
/// Everything else is the plain template glyph, which follows the menu bar's own appearance.
public enum MenuBarLight: Sendable, Equatable {
    case plain, lit, attention, problem

    public init(_ kind: IslandStatus.Kind) {
        switch kind {
        case .listening: self = .lit
        case .asking, .notice: self = .attention
        case .problem: self = .problem
        case .starting, .ready, .transcribing, .thinking, .speaking, .acting: self = .plain
        }
    }

    /// Plain is a template image (macOS tints it); the others are drawn in colour.
    public var isTemplate: Bool { self == .plain }
}
