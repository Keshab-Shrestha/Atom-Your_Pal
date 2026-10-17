import Foundation

// Remembering by itself (upgrades.md C2): facts the conversation notes noticed, waiting for the user's Accept. The runtime
// keeps them (at most 3, for 14 days); this holds what the window shows and builds the commands. Nothing is kept until Accept.

/// One fact waiting for an answer.
public struct FactSuggestion: Sendable, Equatable, Identifiable {
    public var id: Int
    public var text: String
    public var createdAt: Date?

    public init(id: Int, text: String, createdAt: Date? = nil) {
        self.id = id
        self.text = text
        self.createdAt = createdAt
    }
}

/// The runtime's answer: the switch and the facts that wait.
public struct SuggestionsList: Sendable, Equatable {
    public var enabled: Bool
    public var items: [FactSuggestion]

    public init(enabled: Bool, items: [FactSuggestion] = []) {
        self.enabled = enabled
        self.items = items
    }
}

public struct SuggestionsState: Sendable, Equatable {
    public private(set) var enabled = true
    public private(set) var items: [FactSuggestion] = []
    /// The suggestion being edited, and its words so far.
    public private(set) var editingId: Int?
    public var draft = ""
    /// Why the last Accept was refused (it looks like a secret, memory is full).
    public private(set) var error: String?
    /// The window asked once: a restarted runtime is asked again.
    public private(set) var asked = false

    public init() {}

    /// The window shows the suggestions: ask once (the runtime then sends its changes).
    public mutating func open() -> IslandCommand? {
        guard !asked else { return nil }
        asked = true
        return .suggestionsGet
    }

    public mutating func apply(_ list: SuggestionsList) {
        enabled = list.enabled
        items = list.items
        error = nil
        // A suggestion that was answered elsewhere ends its edit.
        if let id = editingId, !list.items.contains(where: { $0.id == id }) { stopEditing() }
    }

    public mutating func fail(_ message: String) { error = message }

    /// Keeps the fact as it is.
    public mutating func accept(_ id: Int) -> IslandCommand? {
        guard items.contains(where: { $0.id == id }) else { return nil }
        error = nil
        return .suggestionsAccept(id: id, text: nil)
    }

    /// Never again.
    public mutating func deny(_ id: Int) -> IslandCommand? {
        guard items.contains(where: { $0.id == id }) else { return nil }
        if editingId == id { stopEditing() }
        error = nil
        return .suggestionsDeny(id: id)
    }

    public mutating func startEditing(_ id: Int) {
        guard let item = items.first(where: { $0.id == id }) else { return }
        editingId = id
        draft = item.text
        error = nil
    }

    public mutating func stopEditing() {
        editingId = nil
        draft = ""
    }

    /// Accepts the edited words. Nil when nothing is being edited or the words are empty or too long to keep (300 characters).
    public mutating func acceptEdit() -> IslandCommand? {
        guard let id = editingId else { return nil }
        let words = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty, words.count <= Suggestions.maxFactCharacters else { return nil }
        stopEditing()
        error = nil
        return .suggestionsAccept(id: id, text: words)
    }

    public func setEnabled(_ on: Bool) -> IslandCommand { .suggestionsSet(enabled: on) }
}

public enum Suggestions {
    /// The longest fact the runtime keeps.
    public static let maxFactCharacters = 300
}
