import Foundation
import AtomIslandCore

struct ForegroundRecoveryState {
    var shown = false
    var syncPending = false
    var listing: String?
    var reading: String?
    var dismissing: String?
    var notice: String?
    var attempts: [ForegroundRecoveryResponse.Summary] = []
    var record: ForegroundRecoveryResponse.Record?
}
extension IslandModel {
    var unconfirmedAnswers: [PendingQuestionAnswer] { input.entries.values.flatMap(\.questionAnswers) }
    func refreshForegroundRecovery() {
        let id = UUID().uuidString
        recovery.listing = id; recovery.syncPending = true
        send(.foregroundList(request: id, pending: input.entries.values.flatMap { $0.waiting.map(\.id) }, pendingAnswers: unconfirmedAnswers.map { QuestionAnswerReceipt(id: $0.id, answer: $0.answer) }))
        foregroundTimeout(id)
    }
    func readForeground(_ id: String, offset: Int = 0) {
        let request = UUID().uuidString; recovery.reading = request
        send(.foregroundRead(request: request, id: id, offset: offset)); foregroundTimeout(request)
    }
    func dismissForeground(_ id: String) {
        guard recovery.dismissing == nil else { return }
        let request = UUID().uuidString; recovery.dismissing = request
        send(.foregroundDismiss(request: request, id: id)); foregroundTimeout(request)
    }
    func acceptForegroundRecovery(_ response: ForegroundRecoveryResponse) {
        if recovery.listing == response.request {
            recovery.listing = nil; recovery.syncPending = false
            if response.ok {
                confirmForegroundInput(ids: response.known ?? [], answers: response.knownAnswers ?? [])
                recovery.attempts = response.attempts ?? []
                if let record = recovery.record, !recovery.attempts.contains(where: { $0.id == record.id }) { recovery.record = nil }
            } else { recovery.notice = response.error }
        } else if recovery.reading == response.request {
            recovery.reading = nil
            if response.ok { recovery.record = response.record } else { recovery.notice = response.error }
        } else if recovery.dismissing == response.request {
            recovery.dismissing = nil
            if response.ok { recovery.record = nil; refreshForegroundRecovery() } else { recovery.notice = response.error }
        }
    }
    func restoreForegroundDraft(_ record: ForegroundRecoveryResponse.Record) {
        guard composerEmpty, chats?.currentReadOnlyNotice == nil, !queue.running, chatControls.mutation == nil,
              !["prepared", "running"].contains(record.state), record.draftText.utf8.count <= 128 * 1024 else {
            recovery.notice = "Use an empty, writable, idle chat. Large input must be copied or shortened before restoring."
            return
        }
        var files = ComposerDraft(); files.add(record.files)
        for id in record.notes { files.add(note: DraftNote(id: id, title: "Saved note #\(id)")) }
        composerText = record.draftText; composerFiles = files; composerFocusTick += 1
        recovery.notice = "Draft restored to the current chat. Review its files, provider and permissions before Send; earlier external effects may already exist."
    }
    private func foregroundTimeout(_ request: String) {
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(10))
            guard let self else { return }
            if self.recovery.listing == request { self.recovery.listing = nil; self.recovery.syncPending = false }
            else if self.recovery.reading == request { self.recovery.reading = nil }
            else if self.recovery.dismissing == request { self.recovery.dismissing = nil }
            else { return }
            self.recovery.notice = "Recovery was not confirmed. Local copies remain held. Refresh and review saved history before retrying; nothing is resent automatically."
        }
    }
}
