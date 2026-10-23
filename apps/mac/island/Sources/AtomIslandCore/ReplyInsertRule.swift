import Foundation

/// The reply panel's Insert button (Keshab chose a reviewed Insert on 2026-10-23): it names the app the draft goes to and works only for a
/// finished, non-empty draft while that app still runs. Inserting never presses Return or sends; that stays the user's step.
public enum ReplyInsertRule {
    public static func button(appName: String, appRunning: Bool, draft: String, ready: Bool) -> (title: String, enabled: Bool) {
        let name = appName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "the app" : appName
        let hasText = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return ("Insert into \(name)", ready && appRunning && hasText)
    }

    /// Insert writes the app's selected-text value, which replaces a selection: a still-selected source message would be overwritten.
    public static func selectionBlock(selected: String?, appName: String) -> String? {
        guard let selected, !selected.isEmpty else { return nil }
        return "Text is selected in \(appName); Insert would replace it. Click where the reply should go, then Insert again. Nothing was inserted."
    }
}
