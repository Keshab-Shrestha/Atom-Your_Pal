import AppKit
import SwiftUI
import Observation
import AtomIslandCore

@MainActor @Observable
final class ReplyDraftSession {
    let model: IslandModel
    var conversation: String
    var intent = ""
    var background = ""
    var examples: String
    var useExamples = false
    var query = ""
    var profile: ReplyProfile?
    var candidates: [ReplyContextItem] = []
    var selected: [String: ReplyContextItem] = [:]
    var contextID: String?
    var draftID: String?
    var draft = ""
    var hasDraft = false
    var generatedInput: ReplyDraftInput?
    var runningInput: ReplyDraftInput?
    var message: String?
    init(model: IslandModel, conversation: String) {
        self.model = model; self.conversation = conversation; examples = model.settings.replyWritingExamples
    }
    var included: [ReplyContextItem] { selected.values.sorted { $0.id < $1.id } }
    var input: ReplyDraftInput? {
        guard let profile else { return nil }
        return ReplyDraftInput(profile: profile, conversation: conversation, intent: intent, background: background, examples: useExamples ? examples : "", context: included)
    }
    func find() {
        if let id = contextID { model.discardReplyContext(id) }
        let id = "reply-context-" + UUID().uuidString.lowercased()
        contextID = id; message = nil
        model.findReplyContext(id: id, query: query)
    }
    func receiveContext(_ result: ReplyContextResult) {
        guard contextID == result.id else { return }
        model.discardReplyContext(result.id); contextID = nil
        guard result.error == nil, let next = result.profile else { profile = nil; message = result.error ?? "The active drafting model is unavailable."; return }
        if let profile, profile != next { selected = [:]; message = "The active chat or model changed. Review the new model and select context again." }
        for item in result.items where selected[item.id] != nil && selected[item.id]?.revision != item.revision {
            selected[item.id] = nil; message = "A saved item changed. Review its updated preview and select it again."
        }
        profile = next; candidates = result.items
    }
    func generate() {
        guard draftID == nil, let input else { return }
        let id = "reply-draft-" + UUID().uuidString.lowercased()
        draftID = id; runningInput = input; message = nil
        model.generateReply(id: id, input: input)
    }
    func receiveDraft(_ result: ReplyDraftResult) {
        guard draftID == result.id else { return }
        model.replyAnswers[result.id] = nil; draftID = nil
        let completedInput = runningInput; runningInput = nil
        if let error = result.error { message = error; return }
        guard let text = result.text else { message = "No draft was returned."; return }
        draft = text; hasDraft = true; generatedInput = completedInput
    }
    func cancel() {
        if let id = draftID { model.cancelReply(id); draftID = nil }
        runningInput = nil
        message = "Drafting stopped. Nothing was pasted or sent."
    }
    func close() {
        if let id = contextID { model.discardReplyContext(id); contextID = nil }
        if let id = draftID { model.cancelReply(id); draftID = nil }
    }
}

struct ReplyDraftPane: View {
    let session: ReplyDraftSession
    let source: QuickText
    let close: () -> Void
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    private func binding(_ path: ReferenceWritableKeyPath<ReplyDraftSession, String>) -> Binding<String> {
        Binding(get: { session[keyPath: path] }, set: { session[keyPath: path] = $0 })
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Draft a reply").font(.system(size: 16, weight: .semibold)).foregroundStyle(theme.text.color)
                Spacer()
                QuietButton(title: "Close", symbol: "xmark", action: close)
            }
            Scrollable {
                VStack(alignment: .leading, spacing: 12) {
                    if let profile = session.profile {
                        Text("\(profile.provider) · \(profile.model) · draft effort: \(profile.effort)")
                            .font(.system(size: 11.5)).foregroundStyle(theme.text2.color).textSelection(.enabled)
                        Text("Uses the active chat's model in a separate tool-free request. Chat thinking settings and history stay unchanged.")
                            .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                    } else {
                        Text("Load the active drafting model before generating.").font(.system(size: 11.5)).foregroundStyle(theme.text2.color)
                    }
                    Text(source.source.label + (source.truncated ? " was shortened during capture. Paste the missing conversation below before drafting." : " — review or edit the conversation below."))
                        .font(.system(size: 11)).foregroundStyle(theme.text3.color)
                    SoulField(label: "Conversation to reply to", text: binding(\.conversation), lines: 5)
                    SoulField(label: "What should the reply say? (optional)", text: binding(\.intent), lines: 2)
                    SoulField(label: "Additional facts or context (optional)", text: binding(\.background), lines: 3)
                    savedContext
                    DisclosureGroup("Writing examples (optional)") {
                        VStack(alignment: .leading, spacing: 8) {
                            SoulField(label: "Examples of your own writing", text: binding(\.examples), lines: 4)
                            Toggle("Include these examples in this draft", isOn: Binding(get: { session.useExamples }, set: { session.useExamples = $0 }))
                                .font(.system(size: 12))
                            HStack(spacing: 8) {
                                PillButton(title: "Save examples on this Mac") {
                                    session.model.settings.replyWritingExamples = session.examples
                                    session.message = "Examples saved locally. Including them in a draft remains optional each time."
                                }
                                PillButton(title: "Forget saved examples") {
                                    session.model.settings.replyWritingExamples = ""; session.examples = ""; session.useExamples = false
                                    session.message = "Saved examples removed from this Mac's preferences."
                                }
                            }
                            Text("No message harvesting. Only explicitly included examples go to the selected model. Examples guide style, not personal facts or commitments.")
                                .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                        }.padding(.top, 6)
                    }
                    if let message = session.message { ProblemLine(text: message) }
                    if session.hasDraft {
                        RowDivider(inset: 0)
                        SoulField(label: "Unsent draft — edit before copying", text: binding(\.draft), lines: 7)
                            .disabled(session.draftID != nil)
                        if session.input != session.generatedInput {
                            Text("Inputs changed since this draft was generated. Generate again to use the updated context.")
                                .font(.system(size: 11)).foregroundStyle(theme.text2.color)
                        }
                    }
                    Text("Generate sends the conversation, your instructions, checked context and any opted-in examples to the model shown above. No screenshot, whole chat history, automatic search, paste or send. Closing discards this panel's draft.")
                        .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                }.padding(.trailing, 5)
            }
            HStack(spacing: 8) {
                if session.draftID != nil {
                    ProgressView().controlSize(.small)
                    Text("Drafting…").font(.system(size: 12))
                    QuietButton(title: "Cancel", symbol: "xmark") { session.cancel() }
                } else {
                    PillButton(title: session.hasDraft ? "Generate again" : "Generate draft", symbol: "sparkles", prominent: true) { session.generate() }
                        .disabled(session.profile == nil || session.contextID != nil || session.conversation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                Spacer(minLength: 0)
                PillButton(title: "Copy draft", symbol: "doc.on.doc") {
                    NSPasteboard.general.clearContents()
                    session.message = NSPasteboard.general.setString(session.draft, forType: .string) ? "Copied. Paste and send it yourself when ready." : "The clipboard could not be updated. Select and copy the draft manually."
                }.disabled(!session.hasDraft || session.draft.isEmpty || session.draftID != nil)
            }
        }
        .padding(16).frame(width: 560, height: 660)
        .onAppear { if !snapshot { session.find() } }
        .onChange(of: session.contextID.flatMap { session.model.replyContexts[$0] }) { _, value in if let value { session.receiveContext(value) } }
        .onChange(of: session.draftID.flatMap { session.model.replyAnswers[$0] }) { _, value in if let value { session.receiveDraft(value) } }
    }

    private var savedContext: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                TextField("Find saved facts or notes…", text: binding(\.query)).textFieldStyle(.roundedBorder)
                    .onSubmit { if session.draftID == nil { session.find() } }
                PillButton(title: session.contextID == nil ? "Find / reload model" : "Finding…") { session.find() }
                    .disabled(session.contextID != nil || session.draftID != nil)
            }
            Text("Lookup stays local. Check an item to include its displayed excerpt; nothing is selected automatically.")
                .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            ForEach(session.candidates) { item in
                Toggle(isOn: Binding(get: { session.selected[item.id] != nil }, set: { on in session.selected[item.id] = on ? item : nil })) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.title).font(.system(size: 12, weight: .medium))
                        Text(item.text).font(.system(size: 11)).foregroundStyle(theme.text2.color).lineLimit(3)
                    }
                }.disabled(session.selected.count >= 12 && session.selected[item.id] == nil)
            }
            if !session.included.isEmpty {
                DisclosureGroup("Included context (\(session.included.count)) — review exact excerpts") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(session.included) { item in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(item.title + (item.truncated ? " (excerpt)" : "")).font(.system(size: 12, weight: .medium))
                                    Spacer()
                                    QuietButton(title: "Remove", symbol: "xmark") { session.selected[item.id] = nil }
                                }
                                if let source = item.source {
                                    Text("\(source.state) · \(source.path)/\(source.relativePath) · checked \(source.checkedAt)")
                                        .font(.system(size: 10.5)).foregroundStyle(theme.text3.color).textSelection(.enabled)
                                }
                                Text(item.text).font(.system(size: 11.5)).foregroundStyle(theme.text2.color).textSelection(.enabled)
                            }
                        }
                    }.padding(.top, 5)
                }
            }
        }
    }
}
