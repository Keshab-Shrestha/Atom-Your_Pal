import Foundation

/// The small line above a chat's title: the project, "Pinned" and the model, in that order (from the HTML preview's
/// header chips). It says only what is known. The context-window ring of the preview is not here: ATOM has no figure for
/// how much of the window a chat uses.
public enum ChatHeaderMeta {
    public static func line(project: String?, pinned: Bool, model: String?) -> String? {
        let parts = [project, pinned ? "Pinned" : nil, model].compactMap { $0.map(oneLine) }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// Runs of white space, including line breaks, become one space.
    private static func oneLine(_ text: String) -> String {
        text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}
