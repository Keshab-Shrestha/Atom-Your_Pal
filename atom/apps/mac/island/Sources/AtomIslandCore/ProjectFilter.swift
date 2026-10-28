import Foundation

public struct ProjectFilterChoice: Sendable, Equatable, Identifiable {
    public var project: ProjectInfo?
    public var id: String { project.map { "project:" + $0.id } ?? "all" }
    public var title: String { project?.name ?? "All projects" }
}

/// A local sidebar scope. It never changes the selected chat or its project association.
public enum ProjectSidebarScope {
    /// An unloaded/older catalog cannot invalidate a saved preference. An authoritative empty list can.
    public static func resolved(_ id: String?, projects: [ProjectInfo]?) -> String? {
        guard let projects else { return id }
        return id.flatMap { candidate in projects.contains { $0.id == candidate } ? candidate : nil }
    }
    public static func choices(projects: [ProjectInfo], query: String) -> [ProjectFilterChoice] {
        let words = query.split(whereSeparator: \.isWhitespace).map(String.init)
        let choices = [ProjectFilterChoice(project: nil)] + projects.map { ProjectFilterChoice(project: $0) }
        return choices.filter { choice in
            let fields = [choice.title, choice.project?.folderLabel ?? "",
                          choice.project?.archived == true ? "Archived" : "", choice.project?.missing == true ? "Missing folder" : ""]
            return words.allSatisfy { word in fields.contains { $0.localizedStandardContains(word) } }
        }
    }
    public static func projects(_ projects: [ProjectInfo], selected: String?, showArchived: Bool) -> [ProjectInfo] {
        projects.filter { project in selected.map { $0 == project.id } ?? (showArchived || !project.archived) }
    }
    public static func activeChats(_ chats: [ChatInfo], projects: [ProjectInfo], selected: String?) -> [ChatInfo] {
        let archived = Set(projects.filter(\.archived).map(\.id))
        return chats.filter { chat in
            !chat.archived && includes(chat, selected: selected)
                && (selected != nil || chat.projectId.map { !archived.contains($0) } != false)
        }.sorted { $0.pinned != $1.pinned ? $0.pinned : ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }
    }
    public static func includes(_ chat: ChatInfo, selected: String?) -> Bool {
        selected == nil || chat.projectId == selected
    }
}
