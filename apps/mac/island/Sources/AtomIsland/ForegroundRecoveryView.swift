import SwiftUI
import AtomIslandCore

struct ForegroundRecoveryView: View {
    let model: IslandModel
    @State private var dismissID: String?
    @State private var dismissAnswer: PendingQuestionAnswer?
    @Environment(\.theme) private var theme
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Recovery").font(.headline)
                Spacer()
                Button("Refresh", action: model.refreshForegroundRecovery)
                Button("Close") { model.recovery.shown = false }.keyboardShortcut(.cancelAction)
            }
            Text("A missing reply does not prove nothing happened. Review saved history and any file changes before retrying. Recovery restores an unsent draft; it never repeats work automatically.")
                .font(.system(size: 12)).foregroundStyle(theme.text2.color)
            if let notice = model.recovery.notice { Text(notice).font(.system(size: 12)).foregroundStyle(theme.attention.color).textSelection(.enabled) }
            if model.recovery.syncPending || model.recovery.reading != nil { ProgressView("Checking saved records…") }
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(model.unconfirmedAnswers) { answer in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Answer not confirmed · \(chatTitle(answer.chat))").font(.system(size: 12, weight: .medium))
                            Text(answer.question).textSelection(.enabled)
                            Text(answer.answer).textSelection(.enabled)
                            HStack {
                                ChatCopyControl(title: "Copy question and answer") { MarkdownCopy.Content(text: answer.question + "\n" + answer.answer) }
                                Button("Dismiss local copy…") { dismissAnswer = answer }
                            }.buttonStyle(.borderless)
                        }.padding(10).background(theme.fill1.color)
                    }
                    ForEach(model.recovery.attempts) { attempt in
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(chatTitle(attempt.chat)).fontWeight(.medium)
                                Text("\(attempt.state.capitalized) · \(attempt.createdAt) · \(attempt.answerCount) saved answers")
                                    .font(.system(size: 11)).foregroundStyle(theme.text3.color)
                                if attempt.archived { Text("Reply is linked to saved chat history.").font(.system(size: 11)) }
                            }
                            Spacer()
                            Button("Review") { model.readForeground(attempt.id) }
                                .disabled(model.recovery.reading != nil)
                        }
                    }
                    if let record = model.recovery.record {
                        Divider()
                        Text("\(record.state.capitalized) · \(chatTitle(record.chat))").font(.headline)
                        Text("Selected at acceptance: \(record.provider ?? "unknown") · \(record.model ?? "unknown")")
                            .font(.system(size: 11)).foregroundStyle(theme.text3.color)
                        Text(record.draftText).textSelection(.enabled)
                        ForEach(record.files, id: \.self) { Text("File reference: \($0)").font(.system(size: 11)).textSelection(.enabled) }
                        if !record.notes.isEmpty { Text("Saved note references: " + record.notes.map(String.init).joined(separator: ", ")).font(.system(size: 11)) }
                        HStack {
                            ChatCopyControl(title: "Copy prompt and answers") { MarkdownCopy.Content(text: record.draftText) }
                            Button("Open source chat") { model.send(.chatOpen(id: record.chat)) }
                                .disabled(!model.chatBranchAvailable || model.chats?.chats.contains(where: { $0.id == record.chat }) != true)
                            Button("Restore to current empty draft") { model.restoreForegroundDraft(record) }
                                .disabled(!model.composerEmpty || model.queue.running || ["prepared", "running"].contains(record.state))
                        }.buttonStyle(.borderless)
                        Text("Restoring uses the current chat's provider, project and permissions. File/note references are checked again on Send; source files or notes may have changed.")
                            .font(.system(size: 11)).foregroundStyle(theme.text3.color)
                        if !record.reply.isEmpty {
                            Text("Saved reply · text offset \(record.offset)").font(.system(size: 12, weight: .medium))
                            Text(record.reply).textSelection(.enabled)
                            HStack {
                                ChatCopyControl(title: "Copy reply part") { MarkdownCopy.Content(text: record.reply) }
                                Button("First reply part") { model.readForeground(record.id) }.disabled(record.offset == 0)
                                if let next = record.nextOffset { Button("Next reply part") { model.readForeground(record.id, offset: next) } }
                            }.buttonStyle(.borderless)
                        }
                        Button("Dismiss recovery copy…", role: .destructive) { dismissID = record.id }
                            .disabled(["prepared", "running"].contains(record.state) || model.recovery.dismissing != nil)
                    }
                    if model.recovery.attempts.isEmpty && model.unconfirmedAnswers.isEmpty && !model.recovery.syncPending {
                        Text("No retained host attempts or unconfirmed answers. Held composer input remains available in its chat.")
                            .foregroundStyle(theme.text3.color)
                    }
                }.font(.system(size: 12)).frame(maxWidth: .infinity, alignment: .leading).padding(4)
            }
        }
        .padding(18).frame(width: 720, height: 600).background(theme.surfaceSolid.color).foregroundStyle(theme.text.color)
        .alert("Dismiss this recovery copy?", isPresented: Binding(get: { dismissID != nil }, set: { if !$0 { dismissID = nil } })) {
            Button("Keep", role: .cancel) { dismissID = nil }
            Button("Dismiss", role: .destructive) { if let id = dismissID { model.dismissForeground(id) }; dismissID = nil }
        } message: { Text("This clears the recovery prompt, answers and reply. It does not undo file/network actions or delete the saved chat. The delivery receipt remains to prevent old requests from running again.") }
        .alert("Dismiss the local answer copy?", isPresented: Binding(get: { dismissAnswer != nil }, set: { if !$0 { dismissAnswer = nil } })) {
            Button("Keep", role: .cancel) { dismissAnswer = nil }
            Button("Dismiss", role: .destructive) { if let answer = dismissAnswer { model.dismissLocalAnswer(answer) }; dismissAnswer = nil }
        } message: { Text("Copy it first if needed. This does not cancel or reverse any answer already received by the host.") }
    }
    private func chatTitle(_ id: String) -> String { model.chats?.chats.first { $0.id == id }?.title ?? "Unfinished chat (\(String(id.prefix(12))))" }
}
