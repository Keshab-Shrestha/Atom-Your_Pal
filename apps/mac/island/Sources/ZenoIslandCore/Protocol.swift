// The messages exchanged with the ZENO runtime. Specification: docs/island-protocol.md.
import Foundation

public let supportedProtocolVersion = 1

/// The voice loop's state, as reported by the runtime.
public enum LoopState: String, Sendable, Equatable {
    case idle, listening, transcribing, thinking, speaking
}

/// Commands the island sends to the runtime.
public enum IslandCommand: String, Sendable, CaseIterable {
    case talkStart = "talk.start"
    case talkSend = "talk.send"
    case talkCancel = "talk.cancel"
    case conversationReset = "conversation.reset"
    case quit

    /// One JSON line, ending with a newline.
    public var line: String { "{\"type\":\"\(rawValue)\"}\n" }
}

public struct ReadyInfo: Sendable, Equatable {
    public var protocolVersion: Int
    public var provider: String
    public var model: String
    public var microphone: String
    /// False if the voice failed to load; replies still arrive as text.
    public var voice: Bool
}

public struct TurnTimings: Sendable, Equatable {
    public var speechMs: Int
    public var transcriptionMs: Int
    public var modelMs: Int
    public var firstSoundMs: Int?
    public var requestId: String?
}

public struct RuntimeError: Sendable, Equatable {
    /// microphone, transcription, model, speech, config, protocol or runtime.
    public var stage: String
    /// Plain language, free of credentials.
    public var message: String
    public var kind: String?
    public var retryable: Bool?
}

/// Events the runtime sends to the island.
public enum IslandEvent: Sendable, Equatable {
    case ready(ReadyInfo)
    case state(LoopState)
    case micReady
    case micLevel(Double)
    case micSilent(microphone: String)
    case transcript(String)
    case reply(String)
    case turnComplete(TurnTimings)
    case notice(kind: String, message: String)
    case conversationReset
    case error(RuntimeError)
    /// A newer runtime sent an event this island does not know; ignored for forward compatibility.
    case unknown(type: String)

    /// Event name, for logs and traces. Never includes what was said or replied.
    public var name: String {
        switch self {
        case .ready: "ready"
        case .state(let s): "state:\(s.rawValue)"
        case .micReady: "mic.ready"
        case .micLevel: "mic.level"
        case .micSilent: "mic.silent"
        case .transcript: "transcript"
        case .reply: "reply"
        case .turnComplete: "turn.complete"
        case .notice(let kind, _): "notice:\(kind)"
        case .conversationReset: "conversation.reset"
        case .error(let e): "error:\(e.stage)"
        case .unknown(let type): "unknown:\(type)"
        }
    }
}

public enum ProtocolError: Error, Equatable, CustomStringConvertible {
    case notJSON
    case missingType
    case missingField(event: String, field: String)
    case invalidValue(event: String, field: String)

    public var description: String {
        switch self {
        case .notJSON: "not a JSON object"
        case .missingType: "no \"type\""
        case .missingField(let event, let field): "\(event) is missing \"\(field)\""
        case .invalidValue(let event, let field): "\(event) has an invalid \"\(field)\""
        }
    }
}

/// Decodes one line of runtime output into an event.
public func decodeEvent(_ line: String) throws -> IslandEvent {
    guard let data = line.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data),
          let fields = object as? [String: Any]
    else { throw ProtocolError.notJSON }
    guard let type = fields["type"] as? String else { throw ProtocolError.missingType }
    let f = Fields(event: type, values: fields)

    switch type {
    case "ready":
        return .ready(ReadyInfo(
            protocolVersion: try f.int("protocol"),
            provider: try f.string("provider"),
            model: try f.string("model"),
            microphone: try f.string("microphone"),
            voice: try f.bool("voice")))
    case "state":
        let raw = try f.string("state")
        guard let state = LoopState(rawValue: raw) else { throw ProtocolError.invalidValue(event: type, field: "state") }
        return .state(state)
    case "mic.ready":
        return .micReady
    case "mic.level":
        let peak = try f.double("peak")
        return .micLevel(min(max(peak, 0), 1))
    case "mic.silent":
        return .micSilent(microphone: try f.string("microphone"))
    case "transcript":
        return .transcript(try f.string("text"))
    case "reply":
        return .reply(try f.string("text"))
    case "turn.complete":
        return .turnComplete(TurnTimings(
            speechMs: try f.int("speechMs"),
            transcriptionMs: try f.int("transcriptionMs"),
            modelMs: try f.int("modelMs"),
            firstSoundMs: f.optionalInt("firstSoundMs"),
            requestId: f.optionalString("requestId")))
    case "notice":
        return .notice(kind: try f.string("kind"), message: try f.string("message"))
    case "conversation.reset":
        return .conversationReset
    case "error":
        return .error(RuntimeError(
            stage: try f.string("stage"),
            message: try f.string("message"),
            kind: f.optionalString("kind"),
            retryable: f.optionalBool("retryable")))
    default:
        return .unknown(type: String(type.prefix(40)))
    }
}

/// Typed access to an event's fields, with errors naming the event and field.
private struct Fields {
    let event: String
    let values: [String: Any]

    func string(_ key: String) throws -> String {
        guard let value = values[key] else { throw ProtocolError.missingField(event: event, field: key) }
        guard let s = value as? String else { throw ProtocolError.invalidValue(event: event, field: key) }
        return s
    }

    func optionalString(_ key: String) -> String? { values[key] as? String }

    func number(_ key: String) throws -> NSNumber {
        guard let value = values[key] else { throw ProtocolError.missingField(event: event, field: key) }
        // JSON booleans are NSNumbers too; reject them where a number is expected.
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else {
            throw ProtocolError.invalidValue(event: event, field: key)
        }
        return n
    }

    func int(_ key: String) throws -> Int { try number(key).intValue }
    func double(_ key: String) throws -> Double { try number(key).doubleValue }

    func optionalInt(_ key: String) -> Int? {
        guard let n = values[key] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        return n.intValue
    }

    func bool(_ key: String) throws -> Bool {
        guard let value = values[key] else { throw ProtocolError.missingField(event: event, field: key) }
        guard let n = value as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else {
            throw ProtocolError.invalidValue(event: event, field: key)
        }
        return n.boolValue
    }

    func optionalBool(_ key: String) -> Bool? {
        guard let n = values[key] as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }
        return n.boolValue
    }
}
