import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Sentient adaptation protocol boundaries")
struct SentientAdaptationTests {
    @Test func backupCommandsHaveExplicitSessionRevisionAndNoInheritedContext() throws {
        let request = LocalBackupRequest(session: "cedar", action: "send", revision: "v1", text: "水曜日 🌲\nCedar?")
        let object = try #require(JSONSerialization.jsonObject(with: Data(IslandCommand.localBackup(request).line.utf8)) as? [String: Any])
        #expect(object["type"] as? String == "local.backup")
        #expect(object["session"] as? String == "cedar")
        #expect(object["revision"] as? String == "v1")
        #expect(object["text"] as? String == "水曜日 🌲\nCedar?")
        #expect(Set(object.keys) == ["type", "request", "session", "action", "revision", "text"])
        #expect(UUID(uuidString: request.request) != nil)
    }

    @Test func backupResponseKeepsUnknownUsageUnknownAndDoesNotRequireCloudCatalog() throws {
        let line = #"{"type":"local.backup","request":"r","session":"s","revision":"v","turns":[{"role":"assistant","content":"Cedar"}],"usage":{"durationMs":42,"truncated":true},"readiness":{"checkedAt":"2026-10-22T00:00:00Z","durationMs":2,"listed":true,"textVerified":false}}"#
        guard case .localBackup(let response) = try decodeEvent(line) else { Issue.record("Missing backup response"); return }
        #expect(response.turns.first?.content == "Cedar")
        #expect(response.usage?.input == nil && response.usage?.output == nil)
        #expect(response.usage?.truncated == true)
        #expect(response.readiness?.textVerified == false)
        #expect(throws: (any Error).self) { try decodeEvent(#"{"type":"local.backup","request":"r","session":"s","revision":"v","turns":{}}"#) }
    }

    @Test func sourcePreviewAndProvenanceRemainSeparateFromPermission() throws {
        let line = #"{"type":"brain.source","request":"r","state":{"notes":0,"corrected":0,"conflicts":0,"missing":0,"excluded":0},"preview":{"token":"t","path":"/fictional/Notes","files":["Cedar.md"],"count":1,"skipped":2}}"#
        guard case .brainSource(let response) = try decodeEvent(line) else { Issue.record("Missing source response"); return }
        #expect(response.state.folder == nil && response.state.notes == 0)
        #expect(response.preview?.token == "t")
        let command = IslandCommand.brainSource(request: "r", action: "connect", path: nil, token: "t", id: nil)
        let object = try #require(JSONSerialization.jsonObject(with: Data(command.line.utf8)) as? [String: Any])
        #expect(object["token"] as? String == "t")
        #expect(object["permissions"] == nil && object["access"] == nil)
    }

    @Test func contextualDraftRoundTripContainsOnlyReviewedPicksAndExplicitExamples() throws {
        let profile = ReplyProfile(chat: "cedar", provider: "codex", model: "fixture", effort: "low")
        let item = ReplyContextItem(id: "note:1", title: "Cedar", text: "Wednesday", revision: "hash", truncated: false, source: nil)
        let input = ReplyDraftInput(profile: profile, conversation: "When?", intent: "Answer briefly", background: "", examples: "Hello.", context: [item])
        let object = try #require(JSONSerialization.jsonObject(with: Data(IslandCommand.replyDraft(id: "draft", input: input).line.utf8)) as? [String: Any])
        let payload = try #require(object["input"] as? [String: Any])
        let picks = try #require(payload["context"] as? [[String: String]])
        #expect(picks == [["id": "note:1", "revision": "hash"]])
        #expect(payload["examples"] as? String == "Hello.")
        #expect(payload["tools"] == nil && payload["history"] == nil)
        guard case .replyResult(let result) = try decodeEvent(#"{"type":"reply.result","id":"draft","error":"Stopped"}"#) else { Issue.record("Missing cancellation result"); return }
        #expect(result.text == nil && result.error == "Stopped")
    }

    @Test func analysisCommandsKeepSchedulePinAndResumeJobIdentity() throws {
        let data = Data(#"{"source":"source","used":1,"day":"2026-10-22","parts":[],"profile":{"provider":"codex","model":"new","effort":"low"},"record":{"source":"source","version":7,"settings":{"enabled":true,"minute":120,"dailyLimit":3,"profile":{"provider":"codex","model":"pinned","effort":"low"}},"job":{"id":"job","state":"paused","reason":"interrupted","profile":{"provider":"codex","model":"old","effort":"low"},"entries":[{"id":1}],"index":0,"offset":4,"chunks":1,"reused":0,"calls":1,"skipped":0}}}"#.utf8)
        let view = try JSONDecoder().decode(SourceAnalysisView.self, from: data)
        let configure = SourceAnalysisRequest(action: "configure", view: view, dailyLimit: 4)
        #expect(configure.profile?.model == "pinned" && configure.version == 7)
        let resume = SourceAnalysisRequest(action: "resume", view: view)
        #expect(resume.job == "job" && resume.profile == nil && resume.version == nil)
        let clear = SourceAnalysisRequest(action: "clear", view: view)
        #expect(clear.source == "source" && clear.job == nil)
    }

    @Test func malformedPreparedCardsCannotHideAnOrdinaryBrief() throws {
        let invalid: [String: Any] = ["status": "ready", "cards": []]
        #expect(PreparedBriefWork.decode(invalid) == nil)
        let valid: [String: Any] = ["status": "ready", "cards": [["title": "Review", "body": "Cedar", "sources": [["id": "events:1", "label": "Calendar", "text": "Wednesday", "collectedAt": "2026-10-22T00:00:00Z"]]]]]
        #expect(PreparedBriefWork.decode(valid)?.cards.first?.sources.first?.text == "Wednesday")
        let line = #"{"type":"brief","settings":{"enabled":false,"minute":480,"events":true,"reminders":true,"weather":true,"tasks":true,"needsYou":true,"notify":true,"telegram":false,"spoken":false},"history":[{"id":1,"day":"2026-10-22","createdAt":"2026-10-22T00:00:00Z","lines":["Original brief"],"source":"template","preparation":{"status":"ready","cards":[]}}],"running":false}"#
        guard case .brief(let list) = try decodeEvent(line) else { Issue.record("Missing ordinary brief"); return }
        #expect(list.history.first?.lines == ["Original brief"])
        #expect(list.history.first?.preparation == nil)
    }

    @Test func aPlainBriefNamesItsRealReason() throws {
        func entry(_ source: String, _ status: String?) throws -> BriefEntry? {
            let preparation = status.map { #","preparation":{"status":"\#($0)","cards":[]}"# } ?? ""
            let line = #"{"type":"brief","settings":{},"history":[{"id":1,"day":"2026-10-22","lines":["Brief"],"source":"\#(source)"\#(preparation)}],"running":false}"#
            guard case .brief(let list) = try decodeEvent(line) else { return nil }
            return list.history.first
        }
        #expect(try entry("model", nil)?.plainReason == nil)
        #expect(try entry("template", "empty")?.plainReason == "no brief items or supported preparation")
        #expect(try entry("template", "budget")?.plainReason == "today's preparation budget is used")
        #expect(try entry("template", "failed")?.plainReason == "the model was not available")
        #expect(try entry("template", nil)?.plainReason == "the model was not available")
    }

    @Test func theInsertButtonNamesTheAppAndWaitsForAFinishedDraftWhileTheAppRuns() {
        #expect(ReplyInsertRule.button(appName: "Notes", appRunning: true, draft: "See you Friday.", ready: true) == ("Insert into Notes", true))
        #expect(ReplyInsertRule.button(appName: "Notes", appRunning: false, draft: "See you Friday.", ready: true).enabled == false)
        #expect(ReplyInsertRule.button(appName: "Notes", appRunning: true, draft: "  \n", ready: true).enabled == false)
        #expect(ReplyInsertRule.button(appName: "Notes", appRunning: true, draft: "See you Friday.", ready: false).enabled == false)
        #expect(ReplyInsertRule.button(appName: "", appRunning: true, draft: "Hi", ready: true).title == "Insert into the app")
    }

    @Test func insertRefusesToReplaceASelection() {
        #expect(ReplyInsertRule.selectionBlock(length: nil, appName: "TextEdit")?.contains("could not verify") == true)
        #expect(ReplyInsertRule.selectionBlock(length: 0, appName: "TextEdit") == nil)
        let block = ReplyInsertRule.selectionBlock(length: 13, appName: "TextEdit")
        #expect(block?.contains("would replace it") == true)
        #expect(block?.contains("Nothing was inserted") == true)
    }

    @Test func reviewedInsertRequiresAVerifiedEditableDestination() {
        func blocked(running: Bool = true, front: Bool = true, editable: Bool = true, secure: Bool = false, length: Int? = 0) -> Bool {
            ReplyInsertRule.destinationBlock(appName: "TextEdit", appRunning: running, frontmost: front, editable: editable, secure: secure, selectionLength: length) != nil
        }
        #expect(blocked() == false)
        #expect(blocked(running: false))
        #expect(blocked(front: false))
        #expect(blocked(editable: false))
        #expect(blocked(secure: true))
        #expect(blocked(length: nil))
        #expect(blocked(length: -1))
        #expect(blocked(length: 3))
    }


    @Test func preparationNoteOptInIsExplicitAndCanBeCleared() throws {
        let object = try #require(JSONSerialization.jsonObject(with: Data(IslandCommand.briefNote(id: 37, included: true).line.utf8)) as? [String: Any])
        #expect(object["type"] as? String == "brief.note")
        #expect(object["id"] as? Int == 37 && object["included"] as? Bool == true)
        #expect(Set(object.keys) == ["type", "id", "included"])
        #expect(BriefSettingsChange(preparationNoteIds: []).fields["preparationNoteIds"] as? [Int] == [])
        #expect(BriefSettingsChange(preparation: false).fields["preparationNoteIds"] == nil)
        func ids(_ text: String) throws -> [Int] {
            let line = #"{"type":"brief","settings":{"preparationNoteIds":\#(text)},"history":[],"running":false}"#
            guard case .brief(let value) = try decodeEvent(line) else { return [-1] }
            return value.settings.preparationNoteIds
        }
        #expect(try ids("[37,42]") == [37,42])
        for invalid in ["[true]", "[0]", "[37,37]", "null", "[1,2,3,4,5,6,7,8,9,10,11,12,13]"] {
            #expect(try ids(invalid).isEmpty)
        }
    }

}
