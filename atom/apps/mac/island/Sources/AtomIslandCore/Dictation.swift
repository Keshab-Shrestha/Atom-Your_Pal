import Foundation

/// Dictation (ADR-047): hold the shortcut, speak, let go, and the text is typed where you were.
/// This file holds the parts that need no microphone or screen, so they are unit-tested:
/// the audio rules (padding, silence check) and the user's vocabulary (names the speech model gets wrong).

// MARK: - Audio rules

/// Rules for the 16 kHz mono samples a dictation records.
public enum DictationAudio {
    public static let sampleRate = 16_000
    /// Parakeet needs at least 0.3 s of audio; very short clips are padded to a second so a single word
    /// ("yes") is still transcribed.
    public static let minimumSamples = sampleRate

    /// A clip shorter than this is an accidental tap, not speech.
    public static let tooShortSeconds = 0.25

    /// Window used for the silence check (30 ms).
    static let windowSamples = 480
    /// A window counts as speech above this level: -44 dBFS RMS.
    public static let speechRMS: Float = 0.006
    /// This many speech windows (0.12 s) make a clip "has speech".
    public static let speechWindowsNeeded = 4

    /// The clip, padded at the end with silence up to `minimumSamples`.
    public static func padded(_ samples: [Float]) -> [Float] {
        guard samples.count < minimumSamples else { return samples }
        return samples + [Float](repeating: 0, count: minimumSamples - samples.count)
    }

    public static func seconds(_ samples: [Float]) -> Double {
        Double(samples.count) / Double(sampleRate)
    }

    /// Whether the clip contains speech-level sound, so an accidental tap or a muted microphone is dropped
    /// instead of transcribed (the model invents words from silence).
    public static func hasSpeech(_ samples: [Float]) -> Bool {
        var loud = 0
        var start = 0
        while start + windowSamples <= samples.count {
            var sum: Float = 0
            for i in start..<(start + windowSamples) { sum += samples[i] * samples[i] }
            if (sum / Float(windowSamples)).squareRoot() >= speechRMS {
                loud += 1
                if loud >= speechWindowsNeeded { return true }
            }
            start += windowSamples
        }
        return false
    }

    /// The loudest sample, 0–1.
    public static func peak(_ samples: [Float]) -> Float {
        samples.reduce(0) { max($0, abs($1)) }
    }

    /// Whether the clip reached full scale: the microphone gain is too high and speech is distorted.
    public static func clipped(_ samples: [Float]) -> Bool {
        peak(samples) >= 0.999
    }
}

// MARK: - Vocabulary

/// Words the speech model writes wrongly, mapped to what the user means ("zino" → "ATOM").
/// Whole words only, case-insensitive, longest alias first. This is a plain spelling fix after the fact:
/// it never changes the audio or asks a model.
///
/// File format (one entry per line; `#` starts a comment):
///
///     ATOM: zeno, zino          the term, then the ways it comes out wrong
///     Kokoro                    only the term: fixes its capitalisation
public struct DictationVocabulary: Sendable, Equatable {
    public struct Entry: Sendable, Equatable {
        public var term: String
        public var aliases: [String]

        public init(term: String, aliases: [String] = []) {
            self.term = term
            self.aliases = aliases
        }
    }

    public private(set) var entries: [Entry]
    /// Lines that could not be read, with their line numbers, for the app to log.
    public private(set) var problems: [String] = []

    public init(entries: [Entry] = []) {
        self.entries = entries
    }

    /// What every install starts with.
    public static let builtIn = DictationVocabulary(entries: [
        Entry(term: "ATOM", aliases: ["zeno", "zino", "zeeno"]),
    ])

    public func merging(_ other: DictationVocabulary) -> DictationVocabulary {
        var result = DictationVocabulary(entries: entries + other.entries)
        result.problems = problems + other.problems
        return result
    }

    public static func parse(_ text: String) -> DictationVocabulary {
        var entries: [Entry] = []
        var problems: [String] = []
        for (index, raw) in text.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).enumerated() { // "\r\n" is one Character: split(separator: "\n") never split it
            var line = String(raw)
            if let hash = line.firstIndex(of: "#") { line = String(line[..<hash]) }
            line = line.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            let term = parts[0].trimmingCharacters(in: .whitespaces)
            guard !term.isEmpty else {
                problems.append("line \(index + 1): no word before the colon")
                continue
            }
            var aliases = parts.count > 1
                ? parts[1].split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                : []
            if aliases.isEmpty { aliases = [term] } // capitalisation only
            entries.append(Entry(term: term, aliases: aliases))
        }
        var vocabulary = DictationVocabulary(entries: entries)
        vocabulary.problems = problems
        return vocabulary
    }

    /// The text with every alias replaced by its term.
    public func apply(to text: String) -> String {
        var table: [String: String] = [:]
        for entry in entries {
            for alias in entry.aliases where !alias.isEmpty { table[alias.lowercased()] = entry.term }
        }
        guard !table.isEmpty else { return text }
        let pattern = table.keys.sorted { $0.count > $1.count }
            .map { NSRegularExpression.escapedPattern(for: $0) }.joined(separator: "|")
        guard let regex = try? NSRegularExpression(pattern: "(?<![\\p{L}\\p{N}'’])(\(pattern))(?![\\p{L}\\p{N}'’])", options: [.caseInsensitive])
        else { return text }
        var result = text
        let matches = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
        for match in matches.reversed() {
            guard let range = Range(match.range, in: result), let term = table[result[range].lowercased()] else { continue }
            result.replaceSubrange(range, with: term)
        }
        return result
    }
}

// MARK: - What a dictation looks like on the island

/// How a dictation ended.
public enum DictationOutcome: Sendable, Equatable {
    /// Typed into the app. `words` is for the island's detail line.
    case typed(words: Int)
    /// The text is on the clipboard instead, and why (e.g. a password field, no Accessibility permission).
    case copied(reason: String)
    /// Nothing was heard.
    case noSpeech
    /// The keys were let go almost at once.
    case tooShort
    /// ATOM was already talking or still finishing the last dictation.
    case busy
    /// Something broke; the message includes how to fix it.
    case failed(title: String, message: String)
}

/// The stages of a dictation, for the island.
public enum DictationPhase: Sendable, Equatable {
    /// The speech model is loading (first start after launch).
    case loading(detail: String)
    /// Listening while the keys are held.
    case listening
    /// Listening hands-free (a tap started it): the next tap finishes it.
    case listeningHandsFree
    case transcribing
    case done(DictationOutcome)
    /// Cancelled (Esc, or the shortcut was spoiled by another key): back to Ready.
    case cancelled
}
