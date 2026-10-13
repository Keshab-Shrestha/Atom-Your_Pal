import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Projects (ADR-107)")
struct ProjectsTests {
    private static let full = #"{"type":"chats","current":"c2","currentProjectId":"p1","currentProvider":"claude-plan","currentModel":"opus","chats":[{"id":"c1","title":"Plain","messages":2},{"id":"c2","title":"In Haat","messages":4,"projectId":"p1"},{"id":"c3","title":"Older in Haat","messages":4,"projectId":"p1"},{"id":"c4","title":"In gone","messages":1,"projectId":"p9"}],"projects":[{"id":"p1","name":"Haat","folderLabel":"~/Developer/haat","missing":false,"archived":false,"chatCount":2,"web":true,"agent":"haat-coder","provider":"claude-plan","model":"opus"},{"id":"p2","name":"Old","folderLabel":"~/Old","missing":true,"archived":true,"chatCount":0,"web":false}]}"#

    private func list(_ json: String) throws -> ChatList {
        guard case .chats(let list) = try decodeEvent(json) else { throw DecodeFailure() }
        return list
    }
    private struct DecodeFailure: Error {}

    @Test func decodesProjectsAndProjectIds() throws {
        let l = try list(Self.full)
        #expect(l.currentProjectId == "p1")
        #expect(l.projects?.count == 2)
        let p = try #require(l.projects?.first)
        #expect(p == ProjectInfo(id: "p1", name: "Haat", folderLabel: "~/Developer/haat", missing: false, archived: false, chatCount: 2, web: true, agent: "haat-coder", provider: "claude-plan", model: "opus"))
        #expect(l.projects?[1].missing == true && l.projects?[1].archived == true && l.projects?[1].agent == nil)
        #expect(l.chats.map(\.projectId) == [nil, "p1", "p1", "p9"])
    }

    @Test func anOlderRuntimeHasNoProjects() throws {
        let l = try list(#"{"type":"chats","current":"a","chats":[{"id":"a","title":"A","messages":1}]}"#)
        #expect(l.projects == nil && !l.projectsOn && l.currentProjectId == nil && l.currentProject == nil)
        #expect(l.plainChats.count == 1)
    }

    @Test func anEmptyProjectsListMeansProjectsAreOn() throws {
        let l = try list(#"{"type":"chats","current":"a","chats":[],"projects":[]}"#)
        #expect(l.projectsOn && l.projects?.isEmpty == true)
    }

    @Test func aProjectWithMissingFlagsDefaultsToFalseAndZero() throws {
        let l = try list(#"{"type":"chats","current":"","chats":[],"projects":[{"id":"p","name":"N"}]}"#)
        #expect(l.projects == [ProjectInfo(id: "p", name: "N")])
    }

    @Test func groupsChatsByProject() throws {
        let l = try list(Self.full)
        #expect(l.chats(in: "p1").map(\.id) == ["c2", "c3"])
        // A chat of a project the runtime no longer lists is shown as a plain chat.
        #expect(l.plainChats.map(\.id) == ["c1", "c4"])
        #expect(l.currentProject?.name == "Haat")
    }

    @Test func archivedProjectsAreHiddenUnlessAsked() throws {
        let l = try list(Self.full)
        #expect(l.visibleProjects(showArchived: false).map(\.id) == ["p1"])
        #expect(l.visibleProjects(showArchived: true).map(\.id) == ["p1", "p2"])
        #expect(l.archivedCount == 1)
    }

    @Test func showsTenChatsThenMore() {
        let chats = (0..<12).map { ChatInfo(id: "\($0)", title: "\($0)") }
        #expect(ProjectList.shown(chats, all: false).count == 10)
        #expect(ProjectList.shown(chats, all: true).count == 12)
    }

    @Test func chatOpenedCarriesProjectAndTrimmedWithDefaults() throws {
        guard case .chatOpened(let id, let lines, let project, let trimmed) = try decodeEvent(#"{"type":"chat.opened","id":"c","projectId":"p1","trimmed":true,"messages":[{"role":"user","text":"hi"}]}"#) else { Issue.record("no"); return }
        #expect(id == "c" && lines.count == 1 && project == "p1" && trimmed)
        guard case .chatOpened(_, _, let none, let notTrimmed) = try decodeEvent(#"{"type":"chat.opened","id":"c","messages":[]}"#) else { Issue.record("no"); return }
        #expect(none == nil && !notTrimmed)
    }

    @Test func folderHelpers() {
        #expect(ProjectInfo(id: "p", name: "N", folderLabel: "~/Developer/haat").folderPath == NSHomeDirectory() + "/Developer/haat")
        #expect(ProjectInfo(id: "p", name: "Haat", folderLabel: "~/Developer/haat").chipTitle == "Haat - ~/Developer/haat")
        #expect(ProjectList.label(forPath: NSHomeDirectory() + "/Developer/haat") == "~/Developer/haat")
        #expect(ProjectList.label(forPath: "/Volumes/Work/x") == "/Volumes/Work/x")
        #expect(ProjectList.suggestedName(forFolder: "/Users/me/Developer/haat") == "haat")
        #expect(ProjectList.isValidName("Haat") && !ProjectList.isValidName("  ") && !ProjectList.isValidName("a\nb") && !ProjectList.isValidName(String(repeating: "x", count: 61)))
        #expect(ProjectInfo(id: "p", name: "Haat", chatCount: 3).accessibilityLabel(expanded: false) == "Haat, project, 3 chats, collapsed")
        #expect(ProjectInfo(id: "p", name: "Haat", chatCount: 1).accessibilityLabel(expanded: true) == "Haat, project, 1 chat, expanded")
    }

    private func json(_ c: IslandCommand) throws -> NSDictionary {
        try #require(try JSONSerialization.jsonObject(with: Data(c.line.utf8)) as? NSDictionary)
    }

    @Test func encodesEveryNewCommand() throws {
        #expect(try json(.projectAdd(name: "Haat", path: "/Users/me/haat")) == ["type": "project.add", "name": "Haat", "path": "/Users/me/haat"])
        #expect(try json(.projectRename(id: "p1", name: "New")) == ["type": "project.rename", "id": "p1", "name": "New"])
        #expect(try json(.projectRemove(id: "p1", deleteChats: false)) == ["type": "project.remove", "id": "p1", "deleteChats": false])
        #expect(try json(.projectRemove(id: "p1", deleteChats: true))["deleteChats"] as? Bool == true)
        #expect(try json(.projectArchive(id: "p1", archived: true)) == ["type": "project.archive", "id": "p1", "archived": true])
        #expect(try json(.projectModel(id: "p1", provider: "", model: "")) == ["type": "project.model", "id": "p1", "provider": "", "model": ""])
        #expect(try json(.projectWeb(id: "p1", web: true)) == ["type": "project.web", "id": "p1", "web": true])
        #expect(try json(.chatNew(projectId: "p1")) == ["type": "chat.new", "projectId": "p1"])
        #expect(try json(.chatNew(projectId: nil)) == ["type": "chat.new"])
        #expect(try json(.chatRename(id: "c1", title: "Hi")) == ["type": "chat.rename", "id": "c1", "title": "Hi"])
        #expect(IslandCommand.conversationReset.line == "{\"type\":\"conversation.reset\"}\n")
    }
}
