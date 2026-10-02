// The messages exchanged with the ZENO runtime. Specification: docs/island-protocol.md.
import Foundation

public let supportedProtocolVersion = 1

/// The voice loop's state, as reported by the runtime.
public enum LoopState: String, Sendable, Equatable {
    case idle, listening, transcribing, thinking, speaking
}

/// Commands the island sends to the runtime.
public enum IslandCommand: Sendable, Equatable {
    case talkStart, talkSend, talkCancel, conversationReset, quit
    /// Switch the AI model (ADR-040). Answered with `info`, or an `error` with stage `settings`.
    case modelSet(provider: String, model: String)
    /// The user's answer to an `approval.request` (ADR-054).
    case approvalAnswer(id: String, approved: Bool)

    /// The command's `type` field. Safe for logs: never includes values.
    public var type: String {
        switch self {
        case .talkStart: "talk.start"
        case .talkSend: "talk.send"
        case .talkCancel: "talk.cancel"
        case .conversationReset: "conversation.reset"
        case .quit: "quit"
        case .modelSet: "model.set"
        case .approvalAnswer: "approval.answer"
        }
    }

    /// One JSON line, ending with a newline. Values are escaped by JSONSerialization.
    public var line: String {
        var fields: [String: Any] = ["type": type]
        if case .modelSet(let provider, let model) = self {
            fields["provider"] = provider
            fields["model"] = model
        }
        if case .approvalAnswer(let id, let approved) = self {
            fields["id"] = id
            fields["approved"] = approved // a real JSON boolean: the runtime refuses the strings "true" and "yes"
        }
        // A dictionary of strings and booleans is always valid JSON, so this cannot fail.
        guard let data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys, .withoutEscapingSlashes]),
              let json = String(data: data, encoding: .utf8)
        else { preconditionFailure("command \(type) could not be encoded") }
        return json + "\n"
    }
}

public struct ModelOption: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

public struct ProviderOption: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    /// False when the provider's API key is missing from `.env`.
    public var available: Bool
    public var models: [ModelOption]

    public init(id: String, name: String, available: Bool, models: [ModelOption]) {
        self.id = id
        self.name = name
        self.available = available
        self.models = models
    }
}

/// The model in use and the choices, from the `info` event.
public struct ModelInfo: Sendable, Equatable {
    public var provider: String
    public var model: String
    public var providers: [ProviderOption]

    public init(provider: String, model: String, providers: [ProviderOption]) {
        self.provider = provider
        self.model = model
        self.providers = providers
    }

    public var currentProvider: ProviderOption? { providers.first { $0.id == provider } }

    /// The model's name from the list, else one derived from its id.
    public var currentModelName: String {
        currentProvider?.models.first { $0.id == model }?.name
            ?? IslandStatus.displayName(provider: provider, model: model)
    }
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

/// Something ZENO will not do until the user says yes (ADR-054). Wording comes from the runtime and carries
/// the app and the action, never typed text or screen content.
public struct ApprovalRequest: Sendable, Equatable {
    public var id: String
    /// What ZENO is about to do, e.g. `Click "Send" in Mail`.
    public var summary: String
    /// Why it asks.
    public var reason: String

    public init(id: String, summary: String, reason: String) {
        self.id = id
        self.summary = summary
        self.reason = reason
    }
}

public struct RuntimeError: Sendable, Equatable {
    /// microphone, transcription, model, speech, config, protocol, settings or runtime.
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
    /// ZENO is about to do something on the Mac, in plain words (ADR-054).
    case computerStep(String)
    /// ZENO shows the user a place on screen: Wisp flies there and the bubble says what it is (ADR-054).
    case computerPoint(PointTarget)
    /// ZENO is waiting for the user to allow or decline an action.
    case approvalRequest(ApprovalRequest)
    /// That request is no longer waiting: answered, declined, timed out or cancelled.
    case approvalClosed(id: String)
    case info(ModelInfo)
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
        case .computerStep: "computer.step"
        case .computerPoint: "computer.point"
        case .approvalRequest: "approval.request"
        case .approvalClosed: "approval.closed"
        case .info: "info"
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
    case "computer.step":
        return .computerStep(try f.string("text"))
    case "computer.point":
        let w = try f.double("w"), h = try f.double("h")
        guard w > 0, h > 0 else { throw ProtocolError.invalidValue(event: "computer.point", field: w > 0 ? "h" : "w") }
        return .computerPoint(PointTarget(x: try f.double("x"), y: try f.double("y"), w: w, h: h, label: try f.string("label")))
    case "approval.request":
        return .approvalRequest(ApprovalRequest(id: try f.string("id"), summary: try f.string("summary"), reason: try f.string("reason")))
    case "approval.closed":
        return .approvalClosed(id: try f.string("id"))
    case "info":
        return .info(ModelInfo(
            provider: try f.string("provider"),
            model: try f.string("model"),
            providers: try f.providers()))
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

    /// The `providers` list of an `info` event; any malformed entry makes the whole list invalid.
    func providers() throws -> [ProviderOption] {
        guard let value = values["providers"] else { throw ProtocolError.missingField(event: event, field: "providers") }
        let invalid = ProtocolError.invalidValue(event: event, field: "providers")
        guard let entries = value as? [Any] else { throw invalid }
        return try entries.map { entry in
            guard let p = entry as? [String: Any],
                  let id = p["id"] as? String,
                  let name = p["name"] as? String,
                  let available = p["available"] as? NSNumber, CFGetTypeID(available) == CFBooleanGetTypeID(),
                  let models = p["models"] as? [Any]
            else { throw invalid }
            return ProviderOption(id: id, name: name, available: available.boolValue, models: try models.map { model in
                guard let m = model as? [String: Any], let id = m["id"] as? String, let name = m["name"] as? String
                else { throw invalid }
                return ModelOption(id: id, name: name)
            })
        }
    }

    func optionalBool(_ key: String) -> Bool? {
        guard let n = values[key] as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }
        return n.boolValue
    }
}
