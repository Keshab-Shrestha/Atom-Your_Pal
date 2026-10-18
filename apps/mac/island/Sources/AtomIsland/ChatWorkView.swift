import SwiftUI
import AtomIslandCore

struct ChatWorkView: View {
    let work: ChatWorkSnapshot
    @State private var expanded = false
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if work.state == "working", !snapshot {
                TimelineView(.periodic(from: .now, by: 1)) { _ in toggle }
            } else { toggle }
            if expanded {
                Text("Observed foreground tools only. Background agents have their own Board history. Missing results mean an unknown outcome; they do not prove nothing happened.")
                    .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                ForEach(work.calls) { call in
                    HStack(spacing: 7) {
                        Image(systemName: symbol(call.state)).accessibilityHidden(true)
                        Text(call.tool).textSelection(.enabled)
                        Spacer()
                        Text(call.state == "started" ? "Running" : call.state == "ok" ? "Finished" : call.state == "error" ? "Reported error" : "Outcome unknown")
                        if let ms = call.ms { Text(duration(ms)).monospacedDigit() }
                    }.font(.system(size: 11)).foregroundStyle(theme.text2.color)
                }
                if work.calls.isEmpty { Text("No tool calls observed.").font(.system(size: 11)).foregroundStyle(theme.text3.color) }
                if work.omitted > 0 { Text("\(work.omitted) additional call observations omitted.").font(.system(size: 11)).foregroundStyle(theme.text3.color) }
                ForEach(work.questions.filter { $0.state != "pending" }) { question in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(question.prompt).fontWeight(.medium)
                        Text(question.answer ?? (question.state == "expired" ? "No answer before the card expired." : "Question skipped or interrupted."))
                    }.font(.system(size: 11)).foregroundStyle(theme.text2.color).textSelection(.enabled)
                }
                Text("This work log is temporary and is not restored from saved history.").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            }
        }
    }
    private var toggle: some View {
        Button { expanded.toggle() } label: {
            HStack(spacing: 6) {
                Image(systemName: expanded ? "chevron.down" : "chevron.right")
                Text(label).monospacedDigit()
                Text("· \(work.calls.count) observed calls")
            }.font(.system(size: 11.5)).foregroundStyle(theme.text2.color)
        }.buttonStyle(.borderless).accessibilityValue(expanded ? "Expanded" : "Collapsed")
            .help("Elapsed foreground work time includes model setup, tool calls and waiting for answers; speech playback is separate")
    }
    private var label: String {
        let prefix = work.state == "working" ? "Working for" : work.state == "completed" ? "Worked for" : work.state == "failed" ? "Failed after" : work.state == "interrupted" ? "Interrupted after" : "Stopped after"
        return "\(prefix) \(duration(work.elapsed()))"
    }
    private func duration(_ ms: Double) -> String {
        let seconds = Int(ms / 1000)
        return seconds >= 60 ? "\(seconds / 60)m \(seconds % 60)s" : "\(seconds)s"
    }
    private func symbol(_ state: String) -> String { state == "ok" ? "checkmark.circle" : state == "error" ? "exclamationmark.circle" : state == "started" ? "clock" : "questionmark.circle" }
}

struct ChatQuestionCard: View {
    let model: IslandModel
    let work: ChatWorkSnapshot
    let question: ChatWorkSnapshot.Question
    @State private var answer = ""
    @State private var sent = false
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ATOM asks").font(.system(size: 11, weight: .semibold)).foregroundStyle(theme.text3.color)
            Text(question.prompt).font(.system(size: 12.5)).textSelection(.enabled)
            if let error = question.error { Text(error).font(.system(size: 11)).foregroundStyle(theme.attention.color) }
            ForEach(question.choices, id: \.self) { choice in
                Button(choice) { submit(choice) }.buttonStyle(.borderless).multilineTextAlignment(.leading)
            }
            TextField("Your answer", text: $answer, axis: .vertical).lineLimit(1...4).textFieldStyle(.roundedBorder)
                .accessibilityLabel("Answer to ATOM's question")
            HStack {
                Button("Send answer") { submit(answer) }.disabled(answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || answer.utf16.count > 2000)
                Button("Skip") { submit(nil) }
                if sent { Text("Waiting for confirmation…").font(.system(size: 11)).foregroundStyle(theme.text3.color) }
            }
            if answer.utf16.count > 2000 { Text("Shorten the answer to 2,000 characters before sending.").font(.system(size: 11)) }
            Text("Answering gives clarification, not file or system permission. Do not enter passwords or secrets. The message box queues a new message instead.")
                .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
        }
        .font(.system(size: 12)).foregroundStyle(theme.text.color)
        .padding(12).background(RoundedRectangle(cornerRadius: theme.radiusCard).fill(theme.fill1.color))
        .disabled(sent)
        .onChange(of: work) { _, _ in if question.error != nil { sent = false } }
    }
    private func submit(_ text: String?) {
        if model.answerChatQuestion(work: work, question: question, text: text) { sent = true }
    }
}

struct ChatAccessDetails: View {
    let model: IslandModel
    @State private var shown = false
    @Environment(\.theme) private var theme
    var body: some View {
        Button { shown = true; model.inspectSavedChat() } label: { Label("Access", systemImage: "lock.shield") }
            .buttonStyle(.borderless).font(.system(size: 11.5)).foregroundStyle(theme.text2.color)
            .popover(isPresented: $shown) {
                VStack(alignment: .leading, spacing: 9) {
                    Text("Chat access").font(.headline)
                    if let access = model.chatControls.snapshot?.info?.access {
                        Text("Provider: \(access.provider)")
                        Text(access.hostTools ? "Uses ATOM's checked host tools." : "This provider has no ATOM host tools.")
                        Text(access.project ? "Associated with a project; project file policy applies." : "No project folder associated with this chat.")
                        Text("Continuing edit permissions: \(access.fileGrants) exact files in this chat.")
                        Text("Computer tools configured: \(access.computer ? "on" : "off"). Web search setting: \(access.web ? "on" : "off").")
                    } else { Text("Saved chat details are unavailable. Save a message or refresh to inspect them.") }
                    Text("This is the last inspected configuration, not unrestricted access or a permissions switch. Attachments, tool availability, protected files, approval cards and macOS permissions still have their own checks.")
                    Text("To inspect exact file grants, send ‘Show file permissions for this chat’. To revoke them, send ‘Forget file permissions for this chat’.")
                    Button("Refresh", action: model.inspectSavedChat)
                }.font(.system(size: 12)).foregroundStyle(theme.text2.color).padding(16).frame(width: 340)
            }
    }
}
