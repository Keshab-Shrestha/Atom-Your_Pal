import SwiftUI
import AtomIslandCore

extension IslandGallery {
    static func writeAdaptation(to directory: URL) {
        let suite = "atom.gallery.adaptation.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = IslandModel(settings: IslandSettings(defaults: defaults))
        model.status.apply(.running(pid: 1))
        func apply(_ line: String) { if let event = try? decodeEvent(line) { model.apply(event) } }
        apply(#"{"type":"ready","protocol":1,"provider":"codex","model":"fixture","microphone":"fixture","voice":false}"#)
        let sourceLine = #"{"type":"brain.source","request":"sources","state":{"folder":{"id":"cedar","path":"/Users/fictional/Notes","identity":"fixture","checkedAt":"2026-10-22T10:00:00Z","skipped":2,"documents":true},"notes":12,"corrected":1,"conflicts":1,"missing":0,"excluded":1}}"#
        model.brainSourcePending = "sources"; apply(sourceLine)
        let analysisLine = #"{"type":"source.analysis","request":"analysis","view":{"source":"cedar","day":"2026-10-22","used":2,"parts":[],"profile":{"provider":"codex","model":"fixture","effort":"low"},"record":{"source":"cedar","version":8,"settings":{"enabled":false,"minute":120,"dailyLimit":3},"job":{"id":"cedar-job","state":"paused","reason":"interrupted","profile":{"provider":"codex","model":"fixture","effort":"low"},"entries":[{"id":1},{"id":2}],"index":1,"offset":0,"chunks":2,"reused":1,"calls":1,"skipped":0}}}}"#
        model.sourceAnalysisPending = "analysis"; apply(analysisLine)
        save(BrainSourcesPane(model: model).frame(width: 760, height: 760).background(AppTheme.daylight.palette.surfaceSolid.color).environment(\.islandSnapshot, true).themed(AppTheme.daylight.palette), name: "40-notes-source-analysis", to: directory)
        save(SourceAnalysisSection(model: model, openNote: { _ in }).padding(20).frame(width: 540).background(AppTheme.void.palette.surfaceSolid.color).environment(\.islandSnapshot, true).themed(AppTheme.void.palette), name: "40-analysis-recovery-dark", to: directory)

        let draft = ReplyDraftSession(model: model, conversation: "Can we hold the fictional Cedar launch on Wednesday?")
        draft.profile = try? JSONDecoder().decode(ReplyProfile.self, from: Data(#"{"chat":"cedar","provider":"codex","model":"fixture","effort":"low"}"#.utf8))
        draft.intent = "Accept, without promising a time."
        draft.draft = "Wednesday works for the Cedar launch. What time did you have in mind?"; draft.hasDraft = true
        draft.generatedInput = draft.input
        save(ReplyDraftPane(session: draft, source: QuickText(text: draft.conversation, source: .selection), close: {}).background(AppTheme.daylight.palette.surfaceSolid.color).environment(\.islandSnapshot, true).themed(AppTheme.daylight.palette), name: "40-contextual-reply", to: directory)
        let freshDraft = ReplyDraftSession(model: model, conversation: draft.conversation)
        freshDraft.profile = draft.profile
        save(ReplyDraftPane(session: freshDraft, source: QuickText(text: freshDraft.conversation, source: .selection), close: {}).background(AppTheme.void.palette.surfaceSolid.color).environment(\.islandSnapshot, true).themed(AppTheme.void.palette), name: "41-reply-simple-dark", to: directory)
        save(ReplyDraftPane(session: freshDraft, source: QuickText(text: freshDraft.conversation, source: .selection), close: {}, previewDetails: true).background(AppTheme.daylight.palette.surfaceSolid.color).environment(\.islandSnapshot, true).themed(AppTheme.daylight.palette), name: "41-reply-context-expanded", to: directory)


        apply(#"{"type":"brief","settings":{"enabled":false,"minute":480,"events":true,"reminders":true,"weather":false,"tasks":true,"needsYou":true,"notify":false,"telegram":false,"spoken":false,"preparation":true,"preparationDailyLimit":2},"history":[{"id":1,"day":"2026-10-22","createdAt":"2026-10-22T10:00:00Z","lines":["Cedar review Wednesday."],"source":"model","preparation":{"status":"ready","provider":"codex","model":"fixture","cards":[{"title":"Questions for the Cedar review","body":"Check whether Wednesday still works and confirm the venue before sharing an invitation.","sources":[{"id":"events:1","label":"Calendar","text":"Cedar review, Wednesday at noon","collectedAt":"2026-10-22T10:00:00Z"}]}]}}],"running":false,"preparationBudget":{"day":"2026-10-22","used":1,"limit":2}}"#)
        save(PreparedBriefCards(model: model).padding(20).frame(width: 520).background(AppTheme.daylight.palette.surfaceSolid.color).environment(\.islandSnapshot, true).themed(AppTheme.daylight.palette), name: "40-prepared-brief-cards", to: directory)

        let backup = #"{"type":"local.backup","request":"backup","session":"fixture","revision":"v1","config":{"endpoint":"http://127.0.0.1:1234/v1","model":"cedar/fixture:tiny"},"turns":[{"role":"user","content":"Which day is the fictional Cedar launch?"},{"role":"assistant","content":"You have not given a launch day in this backup conversation yet. Which day should I use?"}],"readiness":{"checkedAt":"2026-10-22T10:00:00Z","durationMs":4,"listed":true,"textVerified":true},"usage":{"input":112,"output":24,"durationMs":850,"truncated":false}}"#
        if case .localBackup(let response) = try? decodeEvent(backup) { model.localBackup.response = response }
        save(LocalBackupPane(model: model).frame(height: 680).environment(\.islandSnapshot, true).themed(AppTheme.daylight.palette), name: "40-local-backup", to: directory)
        save(LocalBackupPane(model: model).frame(height: 500).environment(\.islandSnapshot, true).themed(AppTheme.void.palette), name: "40-local-backup-compact-dark", to: directory)
    }
}
