import SwiftUI
import ArkIslandCore

/// What ARK does in a turn, live (2026-11-01, after T3 Code's work rows and the Claude app, MIT): open while it works, one row per tool call in plain
/// words ("Reading a file", a glyph while it runs); once the turn ends it folds into one line, "Worked for 22s · Read 3 files, ran 2 commands".
struct ChatWorkView: View {
    let work: ChatWorkSnapshot
    /// The computer step in progress, shown while the work runs (the island's detail line, which the window did not show).
    var step: String? = nil
    /// Nil follows the work: open while it runs, folded once it ends. A click keeps the reader's choice.
    @State private var opened: Bool?
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    private var working: Bool { work.state == "working" }
    private var expanded: Bool { opened ?? working }
    /// While it runs, only the latest rows, so a long turn does not push the reply away.
    private static let liveRows = 6

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if working, !snapshot {
                TimelineView(.periodic(from: .now, by: 1)) { _ in toggle }
            } else { toggle }
            if expanded {
                let calls = working ? Array(work.calls.suffix(Self.liveRows)) : work.calls
                VStack(alignment: .leading, spacing: 4) {
                    if working, work.calls.count > calls.count {
                        Text("\(work.calls.count - calls.count) earlier steps").foregroundStyle(theme.text3.color)
                    }
                    ForEach(calls) { call in callRow(call) }
                    if work.calls.isEmpty { Text(working ? "Thinking" : "No tools used").foregroundStyle(theme.text3.color) }
                    if work.omitted > 0 { Text("\(work.omitted) more steps not shown").foregroundStyle(theme.text3.color) }
                    ForEach(work.questions.filter { $0.state != "pending" }) { question in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(question.prompt).fontWeight(.medium)
                            Text(question.answer ?? (question.state == "expired" ? "No answer before the card expired." : "Question skipped or interrupted."))
                        }.foregroundStyle(theme.text2.color).textSelection(.enabled)
                    }
                }
                .appFont(.system(size: 12))
                .padding(.leading, 12)
                .overlay(alignment: .leading) { Rectangle().fill(theme.separator.color).frame(width: 1).padding(.leading, 4) }
            }
        }
    }

    private func callRow(_ call: ChatWorkSnapshot.Call) -> some View {
        let running = call.state == "started"
        return HStack(spacing: 8) {
            Group {
                if running { WorkingGlyph() }
                else { Glyph(systemName: symbol(call.state)).appFont(.system(size: 10, weight: .semibold)) }
            }
            .frame(width: 12).foregroundStyle(call.state == "error" ? theme.problem.color : theme.text3.color)
            Text(ChatWorkText.label(tool: call.tool, running: running))
                .foregroundStyle(running ? theme.text.color : theme.text2.color)
                .help(call.tool)
            if call.state == "error" { Text("reported an error").foregroundStyle(theme.problem.color) }
            if call.state == "unknown" { Text("outcome unknown").foregroundStyle(theme.text3.color) }
            Spacer(minLength: 8)
            if let ms = call.ms { Text(duration(ms)).monospacedDigit().foregroundStyle(theme.text3.color) }
        }
        .accessibilityElement(children: .combine)
    }

    private var toggle: some View {
        Button { opened = !expanded } label: {
            HStack(spacing: 8) {
                Glyph(systemName: "chevron.right").rotationEffect(.degrees(expanded ? 90 : 0))
                Text(label).monospacedDigit()
                if working, let step { Text("· \(step)").lineLimit(1).truncationMode(.tail) }
                else if !working, !work.calls.isEmpty { Text("· \(ChatWorkText.summary(work.calls))").lineLimit(1).truncationMode(.tail) }
            }.appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
            .contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityValue(expanded ? "Expanded" : "Collapsed")
            .help("What ARK did in this turn. The time includes thinking, tools and waiting for your answers. A missing result means the outcome is unknown, not that nothing happened. This log is not kept in saved history.")
    }
    private var label: String {
        let prefix = work.state == "working" ? "Working for" : work.state == "completed" ? "Worked for" : work.state == "failed" ? "Failed after" : work.state == "interrupted" ? "Interrupted after" : "Stopped after"
        return "\(prefix) \(duration(work.elapsed()))"
    }
    private func duration(_ ms: Double) -> String {
        let seconds = Int(ms / 1000)
        return seconds >= 60 ? "\(seconds / 60)m \(seconds % 60)s" : "\(seconds)s"
    }
    private func symbol(_ state: String) -> String { state == "ok" ? "checkmark" : state == "error" ? "exclamationmark" : "questionmark" }
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
            Text("ARK asks").appFont(.system(size: 11, weight: .semibold)).foregroundStyle(theme.text3.color)
            Text(question.prompt).appFont(.system(size: 12.5)).textSelection(.enabled)
            if let error = question.error { Text(error).appFont(.system(size: 11)).foregroundStyle(theme.attention.color) }
            ForEach(question.choices, id: \.self) { choice in
                Button(choice) { submit(choice) }.buttonStyle(.borderless).multilineTextAlignment(.leading)
            }
            SoulField(label: "Your answer", text: $answer, lines: 2)
                .accessibilityLabel("Answer to ARK's question")
            HStack {
                Button("Send answer") { submit(answer) }.disabled(answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("Skip") { submit(nil) }
                if sent { Text("Waiting for confirmation…").appFont(.system(size: 11)).foregroundStyle(theme.text3.color) }
            }
            Text("Answering gives clarification, not file or system permission. Do not enter passwords or secrets. The message box queues a new message instead.")
                .appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
        }
        .appFont(.system(size: 12)).foregroundStyle(theme.text.color)
        .padding(12).background(RoundedRectangle(cornerRadius: theme.radiusCard).fill(theme.fill1.color))
        .disabled(sent)
        .onChange(of: work) { _, _ in if question.error != nil { sent = false } }
    }
    private func submit(_ text: String?) {
        if model.answerChatQuestion(work: work, question: question, text: text) { sent = true }
    }
}

struct ChatAccessContent: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Chat access").appFont(.headline)
            if let access = model.chatControls.snapshot?.info?.access {
                Text("Mode: " + (model.chats?.access?.title ?? "Saved permissions"))
                Text("Provider: \(access.provider)")
                Text(access.hostTools ? "Uses ARK's checked host tools." : "ARK host tools are unavailable in this mode.")
                Text(access.project ? "Associated with a project; project file policy applies." : "No project folder associated with this chat.")
                Text("Continuing edit permissions: \(access.fileGrants) exact files in this chat.")
                Text("Computer tools available in this mode: \(access.computer ? "on" : "off"). Web search setting: \(access.web ? "on" : "off").")
            } else { Text("Saved chat details are unavailable. Save a message or refresh to inspect them.") }
            Text("Change access beside the model selector. Chat only suspends tools and saved file grants. Ask before changes requires a fresh approval for each change-capable call. Saved permissions uses existing grants. Full access skips routine file, classified-command, site-opening and granted-plugin prompts for this chat; protected actions still ask or refuse. Protected files, tool availability and macOS permissions still apply in every mode.")
            Text("To inspect exact file grants, send ‘Show file permissions for this chat’. To revoke them, send ‘Forget file permissions for this chat’.")
            Button("Refresh", action: model.inspectSavedChat)
        }.appFont(.system(size: 12)).foregroundStyle(theme.text2.color).padding(16).frame(width: 340)
    }
}
