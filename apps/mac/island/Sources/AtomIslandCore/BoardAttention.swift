import Foundation

/// What waits for Keshab on the Board (2026-10-15, ADR-116): things to answer (a plan, a command, a skill, a suggestion) and
/// tasks that failed. The sidebar's Board row and the Board's Needs you tab both read it, so they always agree.
public struct BoardAttention: Sendable, Equatable {
    /// Plans, command approvals, skill drafts and edits, and suggestions: things only Keshab can answer.
    public var asks: Int
    /// Tasks that failed and have not been retried or dropped.
    public var failed: Int
    /// Tasks at work now.
    public var running: Int

    public init(asks: Int = 0, failed: Int = 0, running: Int = 0) {
        self.asks = asks
        self.failed = failed
        self.running = running
    }

    /// `approvalPending`: ATOM itself asks for a go-ahead (a command to run, a click to make).
    public init(list: HelpersList?, approvalPending: Bool) {
        self.init(
            asks: (list.map { NeedsYouItem.all(in: $0).count } ?? 0) + (approvalPending ? 1 : 0),
            failed: list.map { TeamIssues.all(in: $0).count } ?? 0,
            running: list?.board.first { $0.column == .running }?.items.count ?? 0)
    }

    /// Everything that waits: the number on the Needs you tab and on the sidebar badge.
    public var total: Int { asks + failed }
    public var needsYou: Bool { total > 0 }

    /// One short phrase for the sidebar row (about 18 characters, so it never cuts off).
    public var rowText: String {
        if asks > 0 && failed > 0 { return "\(asks) ask · \(failed) failed" }
        if asks > 0 { return "\(asks) need\(asks == 1 ? "s" : "") you" }
        if failed > 0 { return "\(failed) failed" }
        if running > 0 { return "\(running) running" }
        return "Every task"
    }

    /// The tip and the VoiceOver words: all three numbers.
    public var detail: String { "\(asks) to answer, \(failed) failed, \(running) running" }

    /// The Board view a click on the sidebar row opens: Needs you when anything waits, so it cannot be missed; otherwise
    /// the view Keshab was in.
    public func view(whenOpening current: BoardView) -> BoardView { needsYou ? .needsYou : current }
}
