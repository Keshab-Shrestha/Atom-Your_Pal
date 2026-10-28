import AppKit

/// Copies a secret (the Local API token) to the pasteboard the way password managers do (code review, 2026-10-16). It is marked
/// concealed and transient, which clipboard managers that follow the nspasteboard.org convention skip, and it is cleared after
/// `clearAfter` seconds if nothing else has been copied since. Before this the token was an ordinary copy that every clipboard
/// history kept for good.
public enum SecretClipboard {
    public static let concealed = NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")
    public static let transient = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")
    /// How long the secret stays on the pasteboard (seconds).
    public static let clearAfter: Double = 60

    public static func copy(_ text: String, to board: NSPasteboard = .general, clearAfter seconds: Double = clearAfter) {
        board.clearContents()
        board.declareTypes([.string, concealed, transient], owner: nil)
        board.setString(text, forType: .string)
        board.setData(Data(), forType: concealed)
        board.setData(Data(), forType: transient)
        let mine = board.changeCount
        let holder = Holder(board)
        pending.set(holder, mine)
        Task {
            try? await Task.sleep(for: .seconds(seconds))
            // Only if it is still the secret: a later copy of anything else is the user's and stays.
            if holder.board.changeCount == mine { holder.board.clearContents() }
        }
    }

    /// What is still waiting to be cleared, so that quitting inside the delay clears it too (the token stayed on the pasteboard for good
    /// when ATOM quit within 60 seconds of "Copy token"; code review, 2026-10-16).
    private static let pending = Pending()

    /// Clears the pasteboard now if it still holds the secret that was copied last. Call it when the app quits.
    public static func clearIfStillSecret() {
        guard let (holder, count) = pending.take() else { return }
        if holder.board.changeCount == count { holder.board.clearContents() }
    }

    private final class Pending: @unchecked Sendable {
        private let lock = NSLock()
        private var value: (Holder, Int)?
        func set(_ holder: Holder, _ count: Int) { lock.withLock { value = (holder, count) } }
        func take() -> (Holder, Int)? { lock.withLock { defer { value = nil }; return value } }
    }

    /// NSPasteboard is not marked Sendable, but reading its change count and clearing it are safe from any thread.
    private final class Holder: @unchecked Sendable {
        let board: NSPasteboard
        init(_ board: NSPasteboard) { self.board = board }
    }
}
