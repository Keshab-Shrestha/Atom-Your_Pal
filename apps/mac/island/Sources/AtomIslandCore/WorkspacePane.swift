import Foundation

/// File surfaces use the checked host protocol; Browser and Terminal are user-operated native surfaces.
public enum WorkspaceSurface: String, CaseIterable, Sendable {
    case files, changes, git, browser, terminal
    public var title: String { self == .git ? "Git" : rawValue.capitalized }
    public var symbol: String {
        switch self { case .files: "doc.on.doc"; case .changes: "plus.forwardslash.minus"; case .git: "arrow.triangle.branch"; case .browser: "globe"; case .terminal: "terminal" }
    }
    public var detail: String {
        switch self {
        case .files: "Browse and preview project files"
        case .changes: "Review tracked task edits and Undo"
        case .git: "Inspect local status and file diffs"
        case .browser: "Open a web page beside this chat"
        case .terminal: "Run your own shell in the project folder"
        }
    }
}

/// Bounds use the chat area's width, after the sidebar. Temporary clamping never overwrites the saved preference.
public struct WorkspacePaneLayout: Sendable, Equatable {
    public static let divider = 9.0
    public static let minimumPane = 300.0
    public static let minimumChat = 340.0
    public static func preference(_ width: Double) -> Double {
        width.isFinite ? min(720, max(minimumPane, width)) : 420
    }
    public let split: Bool
    public let pane: Double
    public init(available: Double, preferred: Double) {
        let available = available.isFinite ? max(0, available) : 0
        split = available >= Self.minimumPane + Self.minimumChat + Self.divider
        pane = split ? min(Self.preference(preferred), available - Self.minimumChat - Self.divider) : available
    }
}
