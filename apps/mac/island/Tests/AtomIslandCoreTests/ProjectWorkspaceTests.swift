import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Project workspace")
struct ProjectWorkspaceTests {
    private func response(_ request: WorkspaceRequest, ok: Bool = true) throws -> WorkspaceResponse {
        var fields = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as! [String: Any]
        fields["type"] = "workspace"; fields["ok"] = ok
        fields["entries"] = [["path": "readme.md", "name": "readme.md", "directory": false]]
        let data = try JSONSerialization.data(withJSONObject: fields)
        guard case .workspace(let response) = try decodeEvent(String(decoding: data, as: UTF8.self)) else { throw NSError(domain: "test", code: 1) }
        return response
    }
    @Test func commandCarriesSourceChatProjectAndExactReviewToken() throws {
        let request = WorkspaceRequest(chat: "cedar", project: "p", action: .undo, path: "src/main.ts", job: 7, token: String(repeating: "a", count: 64))
        let fields = try JSONSerialization.jsonObject(with: Data(IslandCommand.workspace(request).line.utf8)) as! [String: Any]
        #expect(fields["type"] as? String == "workspace")
        #expect(fields["chat"] as? String == "cedar"); #expect(fields["project"] as? String == "p")
        #expect(fields["job"] as? Int == 7); #expect(fields["token"] as? String == request.token)
        #expect(fields["request"] as? String == request.request)
    }
    @Test func staleAndCrossChatResultsCannotReplaceTheCurrentPreview() throws {
        let old = WorkspaceRequest(chat: "cedar", project: "p", action: .list)
        let current = WorkspaceRequest(chat: "juniper", project: "q", action: .list)
        var state = ProjectWorkspaceState(); state.begin(old); state.begin(current)
        state.accept(try response(old), chat: "juniper", project: "q")
        #expect(state.pending == current); #expect(state.response == nil)
        state.accept(try response(current), chat: "cedar", project: "p")
        #expect(state.pending == current); #expect(state.response == nil)
        state.accept(try response(current), chat: "juniper", project: "q")
        #expect(state.pending == nil); #expect(state.response?.entries?.first?.path == "readme.md")
        state.clear(); #expect(state.response == nil)
    }
    @Test func timedOutUndoRequiresAnExplicitRefreshAndDoesNotAcceptLateReceipt() throws {
        let request = WorkspaceRequest(chat: "c", project: "p", action: .undo, path: "readme.md", job: 1, token: "token")
        var state = ProjectWorkspaceState(); state.begin(request); state.expire(request.request)
        #expect(state.pending == nil); #expect(state.notice?.contains("may already have finished") == true)
        state.accept(try response(request), chat: "c", project: "p"); #expect(state.response == nil)
    }
    @Test func savingTheFirstChatDoesNotInvalidateTheWorkspaceButRootAndAccessChangesDo() throws {
        func chats(count: Int, folder: String = "~/Cedar", missing: Bool = false) throws -> ChatList {
            let json = "{\"type\":\"chats\",\"current\":\"c\",\"currentProjectId\":\"p\",\"chats\":[],\"projects\":[{\"id\":\"p\",\"name\":\"Cedar\",\"folderLabel\":\"\(folder)\",\"missing\":\(missing),\"archived\":false,\"chatCount\":\(count),\"web\":false}]}"
            guard case .chats(let result) = try decodeEvent(json) else { throw NSError(domain: "test", code: 2) }
            return result
        }
        let initial = ProjectWorkspaceState.identity(try chats(count: 0))
        #expect(initial == ProjectWorkspaceState.identity(try chats(count: 1)))
        #expect(initial != ProjectWorkspaceState.identity(try chats(count: 1, folder: "~/Other")))
        #expect(initial != ProjectWorkspaceState.identity(try chats(count: 1, missing: true)))
    }
    @Test func oversizedPreviewIsRejectedRatherThanTruncated() throws {
        let request = WorkspaceRequest(chat: "c", project: "p", action: .read, path: "readme.md")
        var fields = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as! [String: Any]
        fields["type"] = "workspace"; fields["ok"] = true; fields["text"] = String(repeating: "x", count: 32769)
        let data = try JSONSerialization.data(withJSONObject: fields)
        #expect(throws: (any Error).self) { try decodeEvent(String(decoding: data, as: UTF8.self)) }
    }
    @Test func gitRequestsCarryTheStageAndWhitespaceNormalizationNeverChangesLiteralSource() throws {
        let request = WorkspaceRequest(chat: "cedar", project: "p", action: .gitReview, path: "src/main.ts", section: "staged")
        let fields = try JSONSerialization.jsonObject(with: Data(IslandCommand.workspace(request).line.utf8)) as! [String: Any]
        #expect(fields["section"] as? String == "staged")
        let source = "  let  value = 1;  \n\treturn value;\n"
        #expect(WorkspaceGitText.comparing(source, ignoreWhitespace: false) == source)
        #expect(WorkspaceGitText.comparing(source, ignoreWhitespace: true) == "let value = 1;\nreturn value;\n")
        var state = ProjectWorkspaceState(); state.begin(request)
        var result = try response(request); result.section = "unstaged"
        state.accept(result, chat: "cedar", project: "p"); #expect(state.pending == request)
    }

}
