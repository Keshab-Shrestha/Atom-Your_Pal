import Foundation
import Testing
@testable import ArkIslandCore

/// Settings → Defaults (2026-11-02): where a new chat goes, what is stored, and what the runtime is told.
@Suite("New chat defaults")
@MainActor
struct NewChatDefaultsTests {
    private func project(_ id: String, archived: Bool = false) -> ProjectInfo {
        ProjectInfo(id: id, name: id, folderLabel: "~/\(id)", missing: false, archived: archived, chatCount: 1)
    }
    private func chat(_ id: String, project: String?, minutesAgo: Double) -> ChatInfo {
        ChatInfo(id: id, title: id, updatedAt: Date(timeIntervalSinceNow: -minutesAgo * 60), messages: 2, projectId: project)
    }

    @Test func placePicksTheProjectANewChatGoesIn() {
        let projects = [project("atom"), project("haat"), project("old", archived: true)]
        let chats = [chat("a", project: "atom", minutesAgo: 30), chat("b", project: "haat", minutesAgo: 5), chat("c", project: nil, minutesAgo: 1),
                     chat("d", project: "old", minutesAgo: 0)]
        #expect(NewChatPlace.selectedProject.project(filter: "atom", chats: chats, projects: projects) == "atom")
        #expect(NewChatPlace.selectedProject.project(filter: nil, chats: chats, projects: projects) == nil)
        #expect(NewChatPlace.selectedProject.project(filter: "old", chats: chats, projects: projects) == nil, "never an archived project")
        #expect(NewChatPlace.plain.project(filter: "atom", chats: chats, projects: projects) == nil)
        #expect(NewChatPlace.lastProject.project(filter: nil, chats: chats, projects: projects) == "haat", "the newest chat with an open project")
        #expect(NewChatPlace.lastProject.project(filter: nil, chats: [chat("c", project: nil, minutesAgo: 1)], projects: projects) == nil)
    }

    @Test func settingsStoreDefaultsAndIgnoreBadValues() {
        let name = "ark.test.defaults.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let fresh = IslandSettings(defaults: defaults)
        #expect(fresh.newChatAccess == .checked && fresh.newChatEffort == .model && fresh.newChatPlace == .selectedProject)
        #expect(fresh.startPage == .chat && fresh.dashboardRange == .week)
        fresh.newChatAccess = .askChanges; fresh.newChatEffort = .high; fresh.newChatPlace = .lastProject
        fresh.startPage = .last; fresh.lastWindowPage = .board; fresh.dashboardRange = .quarter
        let again = IslandSettings(defaults: defaults)
        #expect(again.newChatAccess == .askChanges && again.newChatEffort == .high && again.newChatPlace == .lastProject)
        #expect(again.startPage == .last && again.lastWindowPage == .board && again.dashboardRange == .quarter)
        defaults.set("everything", forKey: IslandSettings.newChatAccessKey); defaults.set("ultra", forKey: IslandSettings.newChatEffortKey)
        defaults.set(12, forKey: IslandSettings.dashboardRangeKey); defaults.set("last", forKey: IslandSettings.lastWindowPageKey)
        let edited = IslandSettings(defaults: defaults)
        #expect(edited.newChatAccess == .checked && edited.newChatEffort == .model && edited.dashboardRange == .week && edited.lastWindowPage == .chat)
    }

    @Test func runtimeIsToldAccessAndThinking() throws {
        let line = IslandCommand.chatDefaults(access: .askChanges, effort: "high").line
        let payload = try #require(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: String])
        #expect(payload == ["type": "chat.defaults", "access": "ask-changes", "effort": "high"])
    }
}
