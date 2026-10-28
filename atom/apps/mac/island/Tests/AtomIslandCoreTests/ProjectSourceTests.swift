import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Project sources")
struct ProjectSourceTests {
    @Test func wireContainsOnlyExplicitSourceAndDestinationAndCancellationIsCorrelated() throws {
        let request = ProjectSourceRequest(source: .github, name: "Cedar", path: "/Users/fictional/Developer/Cedar", remote: "owner/repo")
        let json = try JSONSerialization.jsonObject(with: Data(IslandCommand.projectCreate(request).line.utf8)) as! [String: Any]
        #expect(json["type"] as? String == "project.create"); #expect(json["request"] as? String == request.request)
        #expect(json["source"] as? String == "github"); #expect(json["remote"] as? String == "owner/repo")
        let cancel = try JSONSerialization.jsonObject(with: Data(IslandCommand.projectCreateCancel(request: request.request).line.utf8)) as! [String: Any]
        #expect(cancel["request"] as? String == request.request)
    }
    @Test func lateReceiptsCannotCompleteAnotherCreationAndRestartRequiresInspection() throws {
        let first = ProjectSourceRequest(source: .new, name: "Cedar", path: "/Users/fictional/Cedar")
        let second = ProjectSourceRequest(source: .folder, name: "Notes", path: "/Users/fictional/Notes")
        var state = ProjectSourceState(); state.begin(first); state.begin(second)
        let stale = ProjectSourceResponse(request: first.request, ok: true, project: "p", error: nil, partial: nil)
        state.accept(stale); #expect(state.pending == second); #expect(state.response == nil)
        state.stopped(); #expect(state.attempt == second); #expect(state.pending == nil); #expect(state.notice?.contains("partial folder") == true)
        state.accept(ProjectSourceResponse(request: second.request, ok: true, project: "q", error: nil, partial: nil))
        #expect(state.response == nil)
    }
    @Test func folderNameCannotBecomeAHiddenPathOrTraversal() {
        for name in ["", ".", "..", ".ssh", "a/b", "a\\b", "a:b", "a\nb", " a"] { #expect(!ProjectSourceState.validFolder(name)) }
        #expect(ProjectSourceState.validFolder("Cedar launch")); #expect(ProjectSourceState.validFolder("ケダル"))
    }
    @Test func unifiedListPreservesProjectAndPlainChatsWithoutShowingArchivedProjectsByDefault() {
        let projects = [ProjectInfo(id: "p", name: "Cedar"), ProjectInfo(id: "old", name: "Old", archived: true)]
        let chats = [ChatInfo(id: "plain", title: "Plain"), ChatInfo(id: "cedar", title: "Cedar", projectId: "p"),
                     ChatInfo(id: "old", title: "Old", projectId: "old"), ChatInfo(id: "archived", title: "Archived", archived: true)]
        #expect(ProjectSidebarScope.activeChats(chats, projects: projects, selected: nil).map(\.id) == ["plain", "cedar"])
        #expect(ProjectSidebarScope.activeChats(chats, projects: projects, selected: "p").map(\.id) == ["cedar"])
        #expect(ProjectSidebarScope.activeChats(chats, projects: projects, selected: "old").map(\.id) == ["old"])
        #expect(chats[0].projectId == nil); #expect(chats[1].projectId == "p")
    }
    @Test func malformedSuccessfulResponseRefusesInsteadOfCreatingAWorkingLookingProject() {
        #expect(throws: (any Error).self) { try decodeEvent(#"{"type":"project.created","request":"11111111-1111-4111-8111-111111111111","ok":true}"#) }
    }
}
