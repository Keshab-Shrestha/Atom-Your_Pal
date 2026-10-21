import Foundation

public enum ProjectSource: String, CaseIterable, Codable, Sendable {
    case new, folder, git, github
    public var title: String {
        switch self { case .new: "New project"; case .folder: "Local folder"; case .git: "Git URL"; case .github: "GitHub repository" }
    }
    public var detail: String {
        switch self {
        case .new: "Create a folder and initialize Git"
        case .folder: "Use an existing folder on this Mac"
        case .git: "Clone a public HTTPS repository"
        case .github: "Clone GitHub owner/repository"
        }
    }
    public var symbol: String {
        switch self { case .new: "folder.badge.plus"; case .folder: "folder"; case .git: "link"; case .github: "arrow.triangle.branch" }
    }
}
public struct ProjectSourceRequest: Sendable, Equatable {
    public var request: String
    public var source: ProjectSource
    public var name: String
    public var path: String
    public var remote: String?
    public init(source: ProjectSource, name: String, path: String, remote: String? = nil, request: String = UUID().uuidString) {
        self.request = request; self.source = source; self.name = name; self.path = path; self.remote = remote
    }
}
public struct ProjectSourceResponse: Sendable, Equatable, Codable {
    public var request: String
    public var ok: Bool
    public var project: String?
    public var error: String?
    public var partial: Bool?
}
public struct ProjectSourceState: Sendable, Equatable {
    public var pending: ProjectSourceRequest?
    public var attempt: ProjectSourceRequest?
    public var response: ProjectSourceResponse?
    public var cancelling = false
    public var notice: String?
    public init() {}
    public mutating func begin(_ request: ProjectSourceRequest) { pending = request; attempt = request; response = nil; notice = nil; cancelling = false }
    public mutating func accept(_ response: ProjectSourceResponse) {
        guard response.request == pending?.request else { return }
        pending = nil; self.response = response; cancelling = false; notice = response.ok ? nil : response.error ?? "Project creation was not confirmed. Inspect the attempted folder before retrying."
    }
    public mutating func expire(_ id: String) {
        guard pending?.request == id else { return }
        pending = nil; cancelling = false
        notice = "Creation was not confirmed. Inspect the destination before retrying; a partial folder may remain."
    }
    public mutating func stopped() { if let id = pending?.request { expire(id) } }
    public static func validFolder(_ name: String) -> Bool {
        !name.isEmpty && !name.hasPrefix(".") && name == name.trimmingCharacters(in: .whitespacesAndNewlines)
            && !name.contains { $0 == "/" || $0 == "\\" || $0 == ":" || $0.isNewline || $0.asciiValue.map { $0 < 32 || $0 == 127 } == true }
    }
}
