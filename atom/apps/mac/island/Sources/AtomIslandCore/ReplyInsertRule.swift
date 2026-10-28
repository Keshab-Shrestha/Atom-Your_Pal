import Foundation

/// The reply panel's Insert button (Keshab chose a reviewed Insert on 2026-10-23): it names the app the draft goes to and works only for a
/// finished, non-empty draft while that app still runs. Inserting never presses Return or sends; that stays the user's step.
public enum ReplyInsertRule {
    public static func button(appName: String, appRunning: Bool, draft: String, ready: Bool) -> (title: String, enabled: Bool) {
        let name = appName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "the app" : appName
        let hasText = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return ("Insert into \(name)", ready && appRunning && hasText)
    }

    /// An unreadable selection is not proof that the caret is empty.
    public static func selectionBlock(length: Int?, appName: String) -> String? {
        guard let length, length >= 0 else {
            return "ATOM could not verify the selection in \(appName). Nothing was inserted; use Copy draft."
        }
        guard length == 0 else {
            return "Text is selected in \(appName); Insert would replace it. Click where the reply should go, then Insert again. Nothing was inserted."
        }
        return nil
    }

    /// Checked after activation and immediately before insertion, without an asynchronous gap before the write.
    public static func destinationBlock(appName: String, appRunning: Bool, frontmost: Bool, editable: Bool, secure: Bool, selectionLength: Int?) -> String? {
        guard appRunning, frontmost else {
            return "ATOM could not focus \(appName). Nothing was inserted; use Copy draft."
        }
        guard !secure, editable else {
            return "Focus an ordinary editable reply field in \(appName). Nothing was inserted; use Copy draft."
        }
        return selectionBlock(length: selectionLength, appName: appName)
    }
}
