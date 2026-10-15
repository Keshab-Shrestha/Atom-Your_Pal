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
        Task {
            try? await Task.sleep(for: .seconds(seconds))
            // Only if it is still the secret: a later copy of anything else is the user's and stays.
            if holder.board.changeCount == mine { holder.board.clearContents() }
        }
    }

    /// NSPasteboard is not marked Sendable, but reading its change count and clearing it are safe from any thread.
    private final class Holder: @unchecked Sendable {
        let board: NSPasteboard
        init(_ board: NSPasteboard) { self.board = board }
    }
}
