// Git branches, commits and diffs of the agents' work (split out of Helpers.swift, 2026-10-16).
import Foundation

/// ADR-091: one of ATOM's task branches, like a pull request.
public struct GitBranch: Sendable, Equatable, Identifiable {
    public enum Pushed: String, Sendable { case no, yes, changed }

    public var id: String { "\(repo)#\(branch)" }
    public var repo: String
    public var repoName: String
    public var branch: String
    public var task: Int
    public var title: String?
    public var base: String
    public var baseSHA: String?
    public var baseSource: String?
    public var baseWarning: String?
    public var pushAllowed: Bool
    public var behind: Int?
    public var commits: [GitCommit]
    public var files: [GitFile]
    /// `origin`'s address, without credentials; nil when there is none (then it cannot be pushed).
    public var remote: String?
    public var pushed: Pushed
    public var worktree: String?
    public var uncommitted: Bool

    public init(repo: String, repoName: String, branch: String, task: Int, title: String? = nil, base: String = "", commits: [GitCommit] = [],
                files: [GitFile] = [], remote: String? = nil, pushed: Pushed = .no, baseSHA: String? = nil, baseSource: String? = nil, baseWarning: String? = nil, behind: Int? = nil, pushAllowed: Bool = true, worktree: String? = nil, uncommitted: Bool = false) {
        self.repo = repo
        self.repoName = repoName
        self.branch = branch
        self.task = task
        self.title = title
        self.base = base
        self.baseSHA = baseSHA
        self.baseSource = baseSource
        self.baseWarning = baseWarning
        self.pushAllowed = pushAllowed
        self.behind = behind
        self.commits = commits
        self.files = files
        self.remote = remote
        self.pushed = pushed
        self.worktree = worktree
        self.uncommitted = uncommitted
    }

    /// It can be pushed: it has a remote and something the remote does not have.
    public var canPush: Bool { !uncommitted && pushAllowed && remote != nil && pushed != .yes && !commits.isEmpty && baseSource != "unavailable" }
    public var added: Int { files.compactMap(\.added).reduce(0, +) }
    public var removed: Int { files.compactMap(\.removed).reduce(0, +) }
}

public struct GitCommit: Sendable, Equatable {
    public var sha: String
    public var subject: String
    public var at: Date?

    public init(sha: String, subject: String, at: Date? = nil) {
        self.sha = sha
        self.subject = subject
        self.at = at
    }
}

public struct GitFile: Sendable, Equatable {
    public var path: String
    /// Nil for a binary file.
    public var added: Int?
    public var removed: Int?

    public init(path: String, added: Int?, removed: Int?) {
        self.path = path
        self.added = added
        self.removed = removed
    }
}

/// ADR-091: a branch's changes since its base, as a patch (cut when long).
public struct GitDiff: Sendable, Equatable {
    public var repo: String
    public var branch: String
    public var text: String
    public var truncated: Bool

    public init(repo: String, branch: String, text: String, truncated: Bool) {
        self.repo = repo
        self.branch = branch
        self.text = text
        self.truncated = truncated
    }
}
