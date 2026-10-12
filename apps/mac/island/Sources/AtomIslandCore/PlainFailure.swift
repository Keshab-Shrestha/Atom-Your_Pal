import Foundation

/// What the one button on an error card does (ADR-075).
public enum FailureAction: Sendable, Equatable {
    /// Opens Terminal running this command (a fixed command from the table below, never user text).
    case openTerminal(command: String)
    /// Settings → AI model.
    case openModelSettings
    /// Shows this text (a command or instructions) in the card.
    case showCommand(String)
    case openSettingsPane(URL)
    /// Starts the runtime again with a fresh `RestartPolicy`.
    case restartRuntime
    case openLog
    /// Sends `model.set` with this provider and model (ADR-076): offered on a rate-limit card, never done on its own.
    case switchModel(provider: String, model: String)
}

/// A known setup failure in plain words: one sentence and one action (ADR-075). Unknown failures have none and keep
/// today's text; the full technical message always stays in Settings (the now card).
public struct PlainFailure: Sendable, Equatable {
    public var sentence: String
    public var button: String
    public var action: FailureAction

    public init(sentence: String, button: String, action: FailureAction) {
        self.sentence = sentence
        self.button = button
        self.action = action
    }

    /// The runtime is not running: the card also offers "Open log".
    public var offersLog: Bool { action == .restartRuntime }

    /// A runtime error message, or a dictation failure (its title and message).
    ///
    /// The texts matched, and where they come from:
    /// - "Claude Code is not signed in. Run `claude auth login` …" and "Claude Code was not found. Install it, then run
    ///   `claude auth login` …" (services/llm-gateway/src/providers/claude-plan.ts); "Install Claude Code and run
    ///   `claude auth login` to use …" (apps/mac/src/model-settings.ts).
    /// - "Whisper model not found at …" (apps/mac/src/stt.ts); the dictation title "Speech model missing"
    ///   (DictationController, Parakeet).
    /// - The dictation title "Microphone is off" (DictationController); "ATOM is not allowed to use the microphone."
    ///   (apps/mac/src/audio.ts).
    public static func match(title: String = "", message: String) -> PlainFailure? {
        if message.contains("claude auth login") {
            if message.contains("not signed in") {
                return PlainFailure(sentence: "Sign in to Claude Code to use your Claude plan.", button: "Open Terminal",
                                    action: .openTerminal(command: "claude auth login"))
            }
            return PlainFailure(sentence: "Claude Code isn't installed, so your Claude plan can't be used.", button: "How to set up",
                                action: .showCommand("Install Claude Code, then sign in with: claude auth login"))
        }
        if message.contains("Whisper model not found") {
            let marker = "Download it with: "
            let help = message.range(of: marker).map { String(message[$0.upperBound...]) } ?? message
            return PlainFailure(sentence: "The Whisper speech model isn't on this Mac.", button: "How to download", action: .showCommand(help))
        }
        if title == "Speech model missing" {
            return PlainFailure(sentence: "The dictation model hasn't downloaded yet.", button: "How to download",
                                action: .showCommand("ATOM downloads it (about 450 MB) the first time you dictate. Check the internet connection, then dictate again."))
        }
        if title == "Microphone is off" || message.contains("not allowed to use the microphone") {
            return PlainFailure(sentence: "ATOM isn't allowed to use the microphone.", button: "Open Settings",
                                action: .openSettingsPane(PermissionRow.microphone.settingsURL))
        }
        return nil
    }

    /// Shorthand for a runtime error message.
    public static func match(_ message: String) -> PlainFailure? { match(title: "", message: message) }

    /// The runtime stopped and will not be restarted on its own: "Restart ATOM" and "Open log".
    public static func forStatus(_ status: RuntimeSupervisor.Status) -> PlainFailure? {
        let sentence: String
        switch status {
        case .failed: sentence = "ATOM stopped after crashing several times."
        case .configError(let message):
            sentence = match(message).map { "\($0.sentence) Fix it, then restart ATOM." } ?? "ATOM's settings in .env need fixing. The log says which."
        case .stopped: sentence = "ATOM is not running."
        case .running, .restarting: return nil
        }
        return PlainFailure(sentence: sentence, button: "Restart ATOM", action: .restartRuntime)
    }

    /// The model's limit is reached (a `rate_limit` error) and another provider is usable: "Switch to <name>" with its
    /// first model, as the AI model page picks when the provider changes (ADR-076). Nil when no other provider is usable.
    public static func rateLimited(current: String, providers: [ProviderOption]) -> PlainFailure? {
        guard let other = providers.first(where: { $0.id != current && $0.available && !$0.models.isEmpty }),
              let model = other.models.first else { return nil }
        let name = providers.first { $0.id == current }?.name ?? "This model"
        return PlainFailure(sentence: "\(name) has reached its limit for now.", button: "Switch to \(other.name)",
                            action: .switchModel(provider: other.id, model: model.id))
    }
}
