// Value types of the runtime's events: models, memory, capabilities, plan usage, ready info, API status, timings, approvals, errors (split out of Protocol.swift, 2026-10-16).
import Foundation

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
    /// ADR-093: the AI tools found on this Mac.
    public var tools: [AiTool]

    public init(provider: String, model: String, providers: [ProviderOption], tools: [AiTool] = []) {
        self.provider = provider
        self.model = model
        self.providers = providers
        self.tools = tools
    }

    public var currentProvider: ProviderOption? { providers.first { $0.id == provider } }

    /// ADR-097: a model id typed as "Custom model…": 1 to 100 letters, digits, ".", "_", ":" or "-" (as the runtime checks).
    public static func isValidModelId(_ id: String) -> Bool {
        id.count <= 100 && id.range(of: "^[A-Za-z0-9._:-]+\\z", options: .regularExpression) != nil // \z: "$" also matches before a trailing newline
    }

    /// ADR-097: a model's name from its provider's list, else the id itself.
    public func modelName(provider: String, model: String) -> String {
        providers.first { $0.id == provider }?.models.first { $0.id == model }?.name ?? model
    }

    /// The model's name from the list, else one derived from its id.
    public var currentModelName: String {
        currentProvider?.models.first { $0.id == model }?.name
            ?? IslandStatus.displayName(provider: provider, model: model)
    }
}

/// One fact ATOM keeps (ADR-058), as listed in Settings. Never written to a log.
public struct MemoryItem: Sendable, Equatable, Identifiable {
    public var id: Int
    public var text: String
    public var createdAt: Date?
    /// "voice" or "text".
    public var source: String

    public init(id: Int, text: String, createdAt: Date?, source: String) {
        self.id = id
        self.text = text
        self.createdAt = createdAt
        self.source = source
    }
}

/// ATOM's note about one past conversation (ADR-059). Never written to a log.
public struct EpisodeItem: Sendable, Equatable, Identifiable {
    public var id: Int
    public var summary: String
    public var endedAt: Date?
    public var exchanges: Int

    public init(id: Int, summary: String, endedAt: Date?, exchanges: Int) {
        self.id = id
        self.summary = summary
        self.endedAt = endedAt
        self.exchanges = exchanges
    }
}

/// What ATOM keeps, from the `memory` event.
public struct MemoryList: Sendable, Equatable {
    /// False when memory is off in the runtime (`ATOM_MEMORY=0`, or the file could not be opened).
    public var enabled: Bool
    public var count: Int
    /// Newest first.
    public var memories: [MemoryItem]
    /// Notes from recent conversations, newest first. Empty from an older runtime.
    public var episodes: [EpisodeItem]
    /// ADR-097: recent chats (newest first), then kept chats no longer in the chat list. Empty from an older runtime.
    public var chats: [MemoryChatItem]

    public init(enabled: Bool, count: Int, memories: [MemoryItem], episodes: [EpisodeItem] = [], chats: [MemoryChatItem] = []) {
        self.enabled = enabled
        self.count = count
        self.memories = memories
        self.episodes = episodes
        self.chats = chats
    }
}

/// ADR-097: a recent or kept chat on the Memory page. Never written to a log.
public struct MemoryChatItem: Sendable, Equatable, Identifiable {
    public var id: String
    public var title: String
    public var updatedAt: Date?
    public var messages: Int
    public var kept: Bool
    /// True while ATOM writes the chat's summary and index.
    public var indexing: Bool
    public var keptAt: Date?

    public init(id: String, title: String, updatedAt: Date?, messages: Int, kept: Bool, indexing: Bool = false, keptAt: Date? = nil) {
        self.id = id
        self.title = title
        self.updatedAt = updatedAt
        self.messages = messages
        self.kept = kept
        self.indexing = indexing
        self.keptAt = keptAt
    }
}

/// One thing ATOM can do, with phrases to try (ADR-076), from the `capabilities` event. Only tools that are on are listed.
public struct CapabilityItem: Sendable, Equatable {
    public var title: String
    public var examples: [String]

    public init(title: String, examples: [String]) {
        self.title = title
        self.examples = examples
    }

    /// For the empty conversation: the first example of each capability, up to `limit`, so they show variety.
    public static func firstExamples(_ items: [CapabilityItem], limit: Int = 4) -> [String] {
        Array(items.compactMap(\.examples.first).prefix(limit))
    }
}

/// How much of the Claude plan is used (ADR-076), from the `plan.usage` event. Fractions: 0.42 is 42%.
/// Every field is optional: an event may report one window only.
public struct PlanUsage: Sendable, Equatable {
    public var resetAt: Double?
    public var limited: Bool?
    public var fiveHour: Double?
    public var sevenDay: Double?
    public var overage: Bool?

    public init(fiveHour: Double? = nil, sevenDay: Double? = nil, overage: Bool? = nil, resetAt: Double? = nil, limited: Bool? = nil) {
        self.resetAt = resetAt; self.limited = limited
        self.fiveHour = fiveHour
        self.sevenDay = sevenDay
        self.overage = overage
    }

    /// Values outside this range are ignored, as in Coucou.
    public static let validRange = 0.0...2.0

    /// Nothing usable arrived: the meters stay hidden.
    public var isEmpty: Bool { fiveHour == nil && sevenDay == nil }

    /// A newer report: its fields replace these, fields it does not carry are kept.
    public func merging(_ newer: PlanUsage) -> PlanUsage {
        PlanUsage(fiveHour: newer.fiveHour ?? fiveHour, sevenDay: newer.sevenDay ?? sevenDay, overage: newer.overage ?? overage, resetAt: newer.resetAt ?? resetAt, limited: newer.limited ?? limited)
    }

    public enum Level: Sendable, Equatable { case normal, attention, problem }

    /// The meter's colour: attention from 80%, problem from 95%.
    public static func level(_ fraction: Double) -> Level {
        fraction >= 0.95 ? .problem : fraction >= 0.8 ? .attention : .normal
    }

    /// What the meter shows, held to 0–100%.
    public static func percent(_ fraction: Double) -> Int { Int((min(max(fraction, 0), 1) * 100).rounded()) }
}

public struct ReadyInfo: Sendable, Equatable {
    public var protocolVersion: Int
    public var provider: String
    public var model: String
    public var microphone: String
    /// False if the voice failed to load; replies still arrive as text.
    public var voice: Bool
    /// ADR-098: ATOM's Telegram bot is set up in .env (false from an older runtime).
    public var telegram: Bool = false
    /// ADR-054: computer control is on in this run (false from an older runtime).
    public var computer: Bool = false
}

/// ADR-098 item 5: the local API's state. `tokenFile` is a path; the island reads the file only for "Copy token".
public struct ApiStatus: Sendable, Equatable {
    public var on: Bool
    public var port: Int
    public var tokenFile: String
    public var error: String?

    public init(on: Bool, port: Int, tokenFile: String, error: String? = nil) {
        self.on = on
        self.port = port
        self.tokenFile = tokenFile
        self.error = error
    }
}

public struct TurnTimings: Sendable, Equatable {
    public var speechMs: Int
    public var transcriptionMs: Int
    public var modelMs: Int
    public var firstSoundMs: Int?
}

/// Something ATOM will not do until the user says yes (ADR-054). Wording comes from the runtime and carries
/// the app and the action, never typed text or screen content.
public struct FileEditReview: Sendable, Equatable {
    public let path: String
    public let before: String
    public let after: String
    public let token: String
}

public struct ApprovalRequest: Sendable, Equatable {
    public var id: String
    /// What ATOM is about to do, e.g. `Click "Send" in Mail`.
    public var summary: String
    /// Why it asks.
    public var reason: String
    public var rememberFile: Bool
    public var fileReview: FileEditReview?

    public init(id: String, summary: String, reason: String, rememberFile: Bool = false, fileReview: FileEditReview? = nil) {
        self.id = id
        self.summary = summary
        self.reason = reason
        self.rememberFile = rememberFile
        self.fileReview = fileReview
    }
}

public struct RuntimeError: Sendable, Equatable {
    /// microphone, transcription, model, speech, config, protocol, settings or runtime.
    public var stage: String
    /// Plain language, free of credentials.
    public var message: String
    public var kind: String?

    /// Whether this error ends the turn that is running. A `settings` error (a model switch, a note, a skill save refused) and a `protocol` error answer
    /// another command and say nothing about the turn: they used to mark a running turn failed, drop its approval card, clear the pointing target and
    /// turn the work strip red (code check, 2026-10-16).
    public var endsTurn: Bool { stage != "settings" && stage != "protocol" }
}
