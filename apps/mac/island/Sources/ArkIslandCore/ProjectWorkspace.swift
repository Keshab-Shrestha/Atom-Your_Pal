import Foundation

public struct WorkspaceRequest: Sendable, Equatable, Codable {
    public enum Action: String, Sendable, Codable { case list, read, changes, review, undo, git, gitReview }
    public var request: String
    public var chat: String
    public var project: String
    public var action: Action
    public var path: String
    public var job: Int?
    public var token: String?
    public var section: String?
    public init(chat: String, project: String, action: Action, path: String = "", job: Int? = nil, token: String? = nil, section: String? = nil) {
        request = UUID().uuidString; self.chat = chat; self.project = project; self.action = action
        self.path = path; self.job = job; self.token = token; self.section = section
    }
}
public struct WorkspaceEntry: Sendable, Equatable, Codable, Identifiable {
    public var path: String
    public var name: String
    public var directory: Bool
    public var id: String { path }
}
public struct WorkspaceChange: Sendable, Equatable, Codable, Identifiable {
    public var job: Int
    public var task: String
    public var jobState: String
    public var path: String
    public var absolute: String
    public var kind: String
    public var state: String
    public var reason: String?
    public var id: String { "\(job):\(absolute)" }
}
public struct WorkspaceReview: Sendable, Equatable, Codable {
    public var path: String
    public var absolute: String
    public var before: String
    public var after: String
    public var token: String?
    public var note: String
}
public struct WorkspaceResponse: Sendable, Equatable, Codable {
    public var request: String
    public var chat: String
    public var project: String
    public var action: WorkspaceRequest.Action
    public var path: String
    public var ok: Bool
    public var error: String?
    public var root: String?
    public var entries: [WorkspaceEntry]?
    public var limited: Bool?
    public var text: String?
    public var absolute: String?
    public var changes: [WorkspaceChange]?
    public var gitStatus: WorkspaceGitStatus?
    public var gitReview: WorkspaceGitReview?
    public var section: String?
    public var review: WorkspaceReview?
    public var notice: String?
}

/// One foreground request. Old results, chat switches and timed-out replies cannot repopulate another workspace.
public struct ProjectWorkspaceState: Sendable, Equatable {
    public var shown = false
    public var tab = "home"
    public var folder = ""
    public var pending: WorkspaceRequest?
    public var response: WorkspaceResponse?
    public var notice: String?
    public var filter = ""
    public var selectedChange: WorkspaceChange?
    public var reviewMode = "changes"
    public var gitMode = "changes"
    public var ignoreWhitespace = false
    private struct Place: Sendable, Equatable {
        var response: WorkspaceResponse?
        var notice: String?
        var folder: String
        var filter: String
        var selected: WorkspaceChange?
        var mode: String
        var gitMode: String
        var ignoreWhitespace: Bool
    }
    private var places: [String: Place] = [:]
    public init() {}
    /// Switching surfaces cancels only local read tracking. Late responses still fail the exact request check.
    /// An in-flight Undo must finish or time out before switching to avoid hiding an uncertain mutation.
    @discardableResult public mutating func select(_ surface: WorkspaceSurface?) -> Bool {
        guard pending?.action != .undo else { return false }
        let next = surface?.rawValue ?? "home"
        guard next != tab else { return true }
        places[tab] = Place(response: response, notice: notice, folder: folder, filter: filter,
                            selected: selectedChange, mode: reviewMode, gitMode: gitMode, ignoreWhitespace: ignoreWhitespace)
        pending = nil; tab = next
        let place = places.removeValue(forKey: next)
        response = place?.response; notice = place?.notice; folder = place?.folder ?? ""
        filter = place?.filter ?? ""; selectedChange = place?.selected
        reviewMode = place?.mode ?? "changes"; gitMode = place?.gitMode ?? "changes"
        ignoreWhitespace = place?.ignoreWhitespace ?? false
        return true
    }
    /// Presentation metadata (counts, names, models and recency) does not invalidate a local file preview.
    public static func identity(_ chats: ChatList?) -> [String] {
        let project = chats?.currentProject
        return [chats?.current ?? "", project?.id ?? "", project?.folderPath ?? "",
                String(project?.missing ?? true), String(project?.archived ?? true), chats?.currentReadOnlyNotice ?? ""]
    }
    public mutating func clear() {
        folder = ""; pending = nil; response = nil; notice = nil; filter = ""; selectedChange = nil
        reviewMode = "changes"; gitMode = "changes"; ignoreWhitespace = false; places.removeAll()
    }
    public mutating func begin(_ request: WorkspaceRequest) {
        // After a mutation, no other surface may restore a pre-mutation preview/token.
        if request.action == .undo { places.removeAll() }
        pending = request; response = nil; notice = nil
    }
    public mutating func accept(_ result: WorkspaceResponse, chat: String?, project: String?) {
        guard let pending, result.request == pending.request, result.chat == pending.chat,
              result.project == pending.project, result.action == pending.action, result.path == pending.path, result.section == pending.section,
              result.chat == chat, result.project == project else { return }
        self.pending = nil
        if result.ok { response = result; notice = result.notice }
        else { response = nil; notice = result.error ?? "Workspace request failed. Refresh to try again." }
    }
    public mutating func expire(_ request: String) {
        guard pending?.request == request else { return }
        let undo = pending?.action == .undo
        pending = nil; response = nil
        notice = undo ? "Undo was not confirmed. Refresh Changes before trying again; it may already have finished." : "The workspace did not answer. Refresh to try again."
    }
}


public struct WorkspaceGitFile: Sendable, Equatable, Codable, Identifiable {
    public var path: String
    public var section: String
    public var status: String
    public var original: String?
    public var id: String { "\(section):\(path)" }
}
public struct WorkspaceGitStatus: Sendable, Equatable, Codable {
    public var branch: String
    public var head: String
    public var upstream: String?
    public var ahead: Int?
    public var behind: Int?
    public var files: [WorkspaceGitFile]
    public var limited: Bool
    public var filtersDisabled: Bool
}
public struct WorkspaceGitReview: Sendable, Equatable, Codable {
    public var path: String
    public var section: String
    public var before: String
    public var after: String
    public var beforeLabel: String
    public var afterLabel: String
    public var base: String?
    public var note: String
}
public enum WorkspaceGitText {
    /// Only the comparison presentation is normalized. Literal source tabs retain exact whitespace.
    public static func comparing(_ text: String, ignoreWhitespace: Bool) -> String {
        guard ignoreWhitespace else { return text }
        return text.components(separatedBy: "\n").map {
            $0.components(separatedBy: .whitespaces).filter { !$0.isEmpty }.joined(separator: " ")
        }.joined(separator: "\n")
    }
}
