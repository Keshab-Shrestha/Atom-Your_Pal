import Foundation

// Quick actions (upgrades.md C4/U4): the user presses a shortcut with some text selected in any app, picks what to do (shorter,
// translate, summarize...), and the result comes back to read or to put in place of the selection. Pure: the capture is a state
// machine over a reader the app supplies; the prompts are fixed here, in code. Nothing is read until the shortcut is pressed.

/// What ATOM can do to the text. The instruction of each is fixed text, never built from the text it works on.
public enum QuickAction: String, Sendable, CaseIterable, Identifiable {
    case summarize, translate, fixWriting, shorter, friendlier, moreFormal, explain, reply, ask

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .summarize: "Summarize"
        case .translate: "Translate"
        case .fixWriting: "Fix spelling and grammar"
        case .shorter: "Make shorter"
        case .friendlier: "Make friendlier"
        case .moreFormal: "Make more formal"
        case .explain: "Explain"
        case .reply: "Draft a reply"
        case .ask: "Ask…"
        }
    }

    public var symbol: String {
        switch self {
        case .summarize: "text.alignleft"
        case .translate: "character.bubble"
        case .fixWriting: "checkmark.seal"
        case .shorter: "arrow.down.right.and.arrow.up.left"
        case .friendlier: "face.smiling"
        case .moreFormal: "briefcase"
        case .explain: "lightbulb"
        case .reply: "arrowshape.turn.up.left"
        case .ask: "sparkles"
        }
    }

    /// The result replaces the text (with changes to accept) rather than being read: only for text the user can change.
    public var changesText: Bool {
        switch self {
        case .translate, .fixWriting, .shorter, .friendlier, .moreFormal: true
        case .summarize, .explain, .reply, .ask: false
        }
    }

    /// The instruction for the model. `extra` is the user's own words for `.ask`; the others ignore it.
    public func instruction(extra: String = "") -> String {
        switch self {
        case .summarize: "Summarize the target text in a few short sentences. Keep the key facts, names and numbers."
        case .translate: "Translate the target text. If it is mostly Japanese, translate it to English. Otherwise translate it to Japanese. Keep the meaning, tone and layout."
        case .fixWriting: "Fix the spelling, grammar and punctuation of the target text. Change nothing else: keep the words, tone and layout."
        case .shorter: "Make the target text shorter. Keep the meaning and the tone. Remove what is not needed."
        case .friendlier: "Rewrite the target text in a friendlier, warmer tone. Keep the meaning and the length about the same."
        case .moreFormal: "Rewrite the target text in a more formal tone. Keep the meaning and the length about the same."
        case .explain: "Explain the target text in plain words, in a few short sentences, for someone who does not know the subject."
        case .reply: "Write a short reply to the target text, in the first person, ready to send. Do not repeat the target text."
        case .ask: extra.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    /// The edit request for this action on `text`. Throws `EditRequestError` (an empty text, a long instruction).
    public func request(text: String, extra: String = "") throws -> EditRequest {
        try EditRequest(text: text, instruction: instruction(extra: extra))
    }
}

/// Where the text came from.
public enum QuickSource: Sendable, Equatable {
    /// The selection in the app that was in front (read through Accessibility, or copied with ⌘C).
    case selection
    /// Nothing was selected; this is what was on the clipboard.
    case clipboard

    public var label: String {
        switch self {
        case .selection: "Selected text"
        case .clipboard: "From the clipboard"
        }
    }
}

public struct QuickText: Sendable, Equatable {
    public var text: String
    public var source: QuickSource
    /// The text was cut to `SelectionCapture.maxCharacters`.
    public var truncated: Bool

    public init(text: String, source: QuickSource, truncated: Bool = false) {
        self.text = text
        self.source = source
        self.truncated = truncated
    }

    /// Text of the selection can be replaced in the app; clipboard text cannot.
    public var canReplace: Bool { source == .selection && !truncated }
}

/// What the capture found.
public enum CaptureResult: Sendable, Equatable {
    case text(QuickText)
    /// Why nothing was read, in words for the user (a password field).
    case refused(String)
    case nothing
}

/// How the app reads the selection. The order of the calls is `SelectionCapture`'s; the reads are the app's.
@MainActor
public protocol SelectionReader {
    /// The focused field is a password field: nothing is read.
    func focusIsSecure() async -> Bool
    /// The selected text of the focused element through Accessibility; nil when it has none or the app does not say.
    func accessibilitySelection() async -> String?
    /// Presses ⌘C in the app, reads what it put on the clipboard, and puts back what was there before (every type). Nil when the clipboard did not change.
    func copiedSelection() async -> String?
    /// The text on the clipboard now.
    func clipboardText() async -> String?
}

public enum SelectionCapture {
    /// A longer text is cut to this many characters, with a notice.
    public static let maxCharacters = 20_000

    /// 1) a password field: refused. 2) the selection through Accessibility. 3) else ⌘C and the clipboard, restored after.
    /// 4) else the clipboard as it was. Nothing is read before this runs.
    @MainActor
    public static func capture(using reader: SelectionReader) async -> CaptureResult {
        if await reader.focusIsSecure() {
            return .refused("A password field is focused. ATOM does not read it.")
        }
        if let found = clean(await reader.accessibilitySelection()) { return .text(limited(found, .selection)) }
        if let found = clean(await reader.copiedSelection()) { return .text(limited(found, .selection)) }
        if let found = clean(await reader.clipboardText()) { return .text(limited(found, .clipboard)) }
        return .nothing
    }

    private static func clean(_ text: String?) -> String? {
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return text
    }

    private static func limited(_ text: String, _ source: QuickSource) -> QuickText {
        guard text.count > maxCharacters else { return QuickText(text: text, source: source) }
        return QuickText(text: String(text.prefix(maxCharacters)), source: source, truncated: true)
    }
}
