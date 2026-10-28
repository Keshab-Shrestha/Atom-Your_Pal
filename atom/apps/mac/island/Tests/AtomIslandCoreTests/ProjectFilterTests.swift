import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Project sidebar scope")
struct ProjectFilterTests {
    let projects = [ProjectInfo(id: "p", name: "Cedar", folderLabel: "~/Work/Cedar"),
                    ProjectInfo(id: "q", name: "Cédar", folderLabel: "~/Documents/Notes", missing: true),
                    ProjectInfo(id: "old", name: "Old notes", archived: true)]
    @Test func searchMatchesWordsAcrossNameFolderAndStatus() {
        #expect(ProjectSidebarScope.choices(projects: projects, query: "").map(\.id) == ["all", "project:p", "project:q", "project:old"])
        #expect(ProjectSidebarScope.choices(projects: projects, query: "Cedar work").map(\.id) == ["project:p"])
        #expect(ProjectSidebarScope.choices(projects: projects, query: "notes missing").map(\.id) == ["project:q"])
        #expect(ProjectSidebarScope.choices(projects: projects, query: "archived").map(\.id) == ["project:old"])
        #expect(ProjectSidebarScope.choices(projects: projects, query: "all projects").map(\.id) == ["all"])
        #expect(ProjectSidebarScope.choices(projects: projects, query: "not-found").isEmpty)
    }
    @Test func storedScopeSurvivesUnloadedCatalogRenameAndArchiveButNotRemoval() {
        #expect(ProjectSidebarScope.resolved("p", projects: nil) == "p")
        #expect(ProjectSidebarScope.resolved("p", projects: []) == nil)
        #expect(ProjectSidebarScope.resolved("old", projects: projects) == "old")
        var renamed = projects; renamed[0].name = "Juniper"
        #expect(ProjectSidebarScope.resolved("p", projects: renamed) == "p")
        #expect(ProjectSidebarScope.resolved("removed", projects: projects) == nil)
        #expect(ProjectSidebarScope.resolved(nil, projects: projects) == nil)
    }
    @Test func selectedArchivedProjectIsVisibleWithoutExposingUnrelatedProjectsOrChats() {
        #expect(ProjectSidebarScope.projects(projects, selected: nil, showArchived: false).map(\.id) == ["p", "q"])
        #expect(ProjectSidebarScope.projects(projects, selected: "old", showArchived: false).map(\.id) == ["old"])
        #expect(ProjectSidebarScope.projects(projects, selected: "p", showArchived: true).map(\.id) == ["p"])
        let chats = [ChatInfo(id: "plain", title: "Plain"), ChatInfo(id: "p-chat", title: "Cedar", projectId: "p"),
                     ChatInfo(id: "old-chat", title: "Archived", projectId: "old", archived: true)]
        #expect(chats.filter { ProjectSidebarScope.includes($0, selected: "p") }.map(\.id) == ["p-chat"])
        #expect(chats.filter { ProjectSidebarScope.includes($0, selected: "old") }.map(\.id) == ["old-chat"])
        #expect(chats.filter { ProjectSidebarScope.includes($0, selected: nil) }.count == 3)
        #expect(chats[0].projectId == nil); #expect(chats[1].projectId == "p")
    }
    @MainActor @Test func preferenceRestoresAndClearDoesNotChangeOtherDesktopSettings() {
        let suite = "atom.tests.project-filter.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let settings = IslandSettings(defaults: defaults)
        #expect(settings.projectFilter == nil)
        settings.projectFilter = "p"; settings.workspaceWidth = 512
        let restored = IslandSettings(defaults: defaults)
        #expect(restored.projectFilter == "p"); #expect(restored.workspaceWidth == 512)
        restored.projectFilter = nil
        let cleared = IslandSettings(defaults: defaults)
        #expect(cleared.projectFilter == nil); #expect(cleared.workspaceWidth == 512)
    }
}
