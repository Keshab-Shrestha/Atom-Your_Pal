import Foundation

/// B3.5: the skills hub: community skills to find, review and install. Nothing is given to an agent on install.
public struct HubSkillResult: Sendable, Equatable, Identifiable {
    public var id: String { "\(source)/\(path)" }
    public var name: String
    public var description: String
    public var repo: String
    public var path: String
    public var sha: String
    /// Which hub source found it; sent back to preview it.
    public var source: Int

    public init(name: String, description: String, repo: String, path: String, sha: String, source: Int) {
        self.name = name
        self.description = description
        self.repo = repo
        self.path = path
        self.sha = sha
        self.source = source
    }

    public var shortSha: String { String(sha.prefix(7)) }
}

/// One thing the runtime's scan noticed in a skill's text.
public struct HubFlag: Sendable, Equatable {
    public enum Severity: Sendable, Equatable { case warn, info }
    public var kind: String
    public var severity: Severity
    public var excerpt: String

    public init(kind: String, severity: Severity, excerpt: String) {
        self.kind = kind
        self.severity = severity
        self.excerpt = excerpt
    }
}

/// A skill fetched from the hub that waits for Keshab's OK (new, or an update of an installed one).
public struct HubSkillPending: Sendable, Equatable, Identifiable {
    public var id: Int
    public var isUpdate: Bool
    public var name: String
    public var description: String
    public var repo: String
    public var path: String
    public var sha: String
    /// The full text of the skill, never cut.
    public var text: String
    public var flags: [HubFlag]

    public init(id: Int, isUpdate: Bool, name: String, description: String, repo: String, path: String, sha: String, text: String, flags: [HubFlag]) {
        self.id = id
        self.isUpdate = isUpdate
        self.name = name
        self.description = description
        self.repo = repo
        self.path = path
        self.sha = sha
        self.text = text
        self.flags = flags
    }

    public var shortSha: String { String(sha.prefix(7)) }
    /// Warnings first; the runtime's order is kept inside each group.
    public var sortedFlags: [HubFlag] { flags.filter { $0.severity == .warn } + flags.filter { $0.severity == .info } }
}

public struct HubSkillInstalled: Sendable, Equatable, Identifiable {
    public var id: String { name }
    public var name: String
    public var repo: String
    public var path: String
    public var sha: String

    public init(name: String, repo: String, path: String, sha: String) {
        self.name = name
        self.repo = repo
        self.path = path
        self.sha = sha
    }

    public var shortSha: String { String(sha.prefix(7)) }
}

public struct HubState: Sendable, Equatable {
    public var results: [HubSkillResult]
    public var pending: [HubSkillPending]
    public var installed: [HubSkillInstalled]
    public var message: String?

    public init(results: [HubSkillResult] = [], pending: [HubSkillPending] = [], installed: [HubSkillInstalled] = [], message: String? = nil) {
        self.results = results
        self.pending = pending
        self.installed = installed
        self.message = message
    }

    public static let empty = HubState()
}
