import Foundation

/// The small line above a chat's title: the project, "Pinned" and the model, in that order (from the HTML preview's
/// header chips). It says only what is known. The preview's context ring is a figure here: the runtime's replay estimate
/// as a share of its budget, which is not a provider token meter.
public enum ChatHeaderMeta {
    /// `context` is the replay share of its budget, such as "1%" (`ChatDetailsFacts.percentText`), once the chat is inspected.
    public static func line(project: String?, pinned: Bool, model: String?, context: String? = nil) -> String? {
        let parts = [project, pinned ? "Pinned" : nil, model, context.map { $0 + " context" }].compactMap { $0.map(oneLine) }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// Runs of white space, including line breaks, become one space.
    private static func oneLine(_ text: String) -> String {
        text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}
