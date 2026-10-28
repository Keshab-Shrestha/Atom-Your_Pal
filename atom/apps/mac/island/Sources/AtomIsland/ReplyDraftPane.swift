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
    var inserting = false
    private var insertTask: Task<Void, Never>?
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
        guard draftID == nil, !inserting, let input else { return }
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
    func insertDraft(using operation: @escaping (String) async -> String) {
        guard !inserting, draftID == nil, hasDraft, !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        inserting = true
        let text = draft
        insertTask = Task { @MainActor [weak self] in
            let message = await operation(text)
            guard !Task.isCancelled, let self else { return }
            self.message = message; self.inserting = false; self.insertTask = nil
        }
    }
    func close() {
        insertTask?.cancel(); insertTask = nil; inserting = false
        if let id = contextID { model.discardReplyContext(id); contextID = nil }
        if let id = draftID { model.cancelReply(id); draftID = nil }
    }
}

struct ReplyDraftPane: View {
    let session: ReplyDraftSession
    let source: QuickText
    let close: () -> Void
    /// Insert into the app the draft came from; absent where there is no captured app (the gallery).
    var insertTarget: String? = nil
    var insertRunning: () -> Bool = { false }
    var insert: ((String) async -> String)? = nil
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    private func binding(_ path: ReferenceWritableKeyPath<ReplyDraftSession, String>) -> Binding<String> {
        Binding(get: { session[keyPath: path] }, set: { session[keyPath: path] = $0 })
    }
    /// Gallery coverage for the expanded section; real panels always start with it closed.
    var previewDetails = false
    @State private var detailsExpanded = false
    private var detailsBinding: Binding<Bool> {
        Binding(get: { snapshot ? previewDetails : detailsExpanded }, set: { detailsExpanded = $0 })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Draft a reply").appFont(.system(size: 16, weight: .semibold)).foregroundStyle(theme.text.color)
                Spacer()
                QuietButton(title: "Close", symbol: "xmark", action: close)
            }
            HStack(spacing: 8) {
                Text(session.profile.map { "\($0.model) · \($0.effort) effort" } ?? "Drafting model unavailable")
                    .appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color).textSelection(.enabled)
                Spacer(minLength: 0)
                QuietButton(title: "Reload model", symbol: "arrow.clockwise") { session.find() }
                    .disabled(session.contextID != nil || session.draftID != nil || session.inserting)
            }
            Scrollable {
                VStack(alignment: .leading, spacing: 10) {
                    if let message = session.message { ProblemLine(text: message) }
                    if session.hasDraft {
                        SoulField(label: "Your reply — edit before using", text: binding(\.draft), lines: 5)
                            .disabled(session.draftID != nil || session.inserting)
                        if session.input != session.generatedInput {
                            Text("Inputs changed. Generate again to use the updated context.")
                                .appFont(.system(size: 11)).foregroundStyle(theme.text2.color)
                        }
                        RowDivider(inset: 0)
                    }
                    Text(source.source.label + (source.truncated ? " was shortened. Add missing text before drafting." : " — review the conversation below."))
                        .appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
                    SoulField(label: "Conversation", text: binding(\.conversation), lines: 3)
                    SoulField(label: "What should the reply say? (optional)", text: binding(\.intent), lines: 2)
                    DisclosureGroup(isExpanded: detailsBinding) {
                        VStack(alignment: .leading, spacing: 12) {
                            SoulField(label: "Additional facts or context (optional)", text: binding(\.background), lines: 3)
                            savedContext
                            writingExamples
                            Text("Uses the shown model in a separate tool-free request. Only this conversation, your instructions, checked context and opted-in examples go to it. No screenshot, whole chat history or automatic search. Chat settings and permissions stay unchanged. Closing discards this panel's draft.")
                                .appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                        }.padding(.top, 8)
                    } label: {
                        Text("Context & writing style").appFont(.system(size: 12, weight: .medium))
                    }
                    if !session.included.isEmpty || session.useExamples || !session.background.isEmpty {
                        Text(includedSummary).appFont(.system(size: 11)).foregroundStyle(theme.text2.color)
                    }
                }.padding(.trailing, 5)
            }
            Text("Draft stays unsent. Review it, then Copy or Insert when ready.")
                .appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            HStack(spacing: 8) {
                if session.draftID != nil {
                    ProgressView().controlSize(.small)
                    Text("Drafting…").appFont(.system(size: 12))
                    QuietButton(title: "Cancel", symbol: "xmark") { session.cancel() }
                } else {
                    PillButton(title: session.hasDraft ? "Generate again" : "Generate draft", symbol: "sparkles", prominent: true) { session.generate() }
                        .disabled(session.inserting || session.profile == nil || session.contextID != nil || session.conversation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                Spacer(minLength: 0)
                PillButton(title: "Copy draft", symbol: "doc.on.doc") {
                    NSPasteboard.general.clearContents()
                    session.message = NSPasteboard.general.setString(session.draft, forType: .string) ? "Copied. Paste and send it yourself when ready." : "The clipboard could not be updated. Select and copy the draft manually."
                }.disabled(!session.hasDraft || session.draft.isEmpty || session.draftID != nil || session.inserting)
                if let insert, let insertTarget {
                    let rule = ReplyInsertRule.button(appName: insertTarget, appRunning: insertRunning(), draft: session.draft, ready: session.hasDraft && session.draftID == nil && !session.inserting)
                    PillButton(title: rule.title, symbol: "text.insert") {
                        session.insertDraft(using: insert)
                    }.disabled(!rule.enabled)
                }
            }
        }
        .padding(16).frame(width: 560, height: 580)
        .onAppear { if !snapshot { session.find() } }
        .onChange(of: session.contextID.flatMap { session.model.replyContexts[$0] }) { _, value in if let value { session.receiveContext(value) } }
        .onChange(of: session.draftID.flatMap { session.model.replyAnswers[$0] }) { _, value in if let value { session.receiveDraft(value) } }
    }

    private var includedSummary: String {
        var parts: [String] = []
        if !session.background.isEmpty { parts.append("Additional context included") }
        if !session.included.isEmpty { parts.append("\(session.included.count) saved item(s) included") }
        if session.useExamples { parts.append("Writing examples included") }
        return parts.joined(separator: " · ")
    }

    private var writingExamples: some View {
        VStack(alignment: .leading, spacing: 8) {
            SoulField(label: "Examples of your own writing", text: binding(\.examples), lines: 3)
            Toggle("Include these examples in this draft", isOn: Binding(get: { session.useExamples }, set: { session.useExamples = $0 }))
                .appFont(.system(size: 12))
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
            Text("Only explicitly included examples go to the model. They guide style, not personal facts or commitments.")
                .appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
        }
    }

    private var savedContext: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if snapshot {
                    // ImageRenderer cannot draw native text fields; keep their visible label and layout in fixtures.
                    Text(session.query.isEmpty ? "Find saved facts or notes…" : session.query)
                        .appFont(.system(size: 12)).foregroundStyle(theme.text3.color)
                        .padding(.horizontal, 7).frame(maxWidth: .infinity, minHeight: 22, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 4).fill(theme.fill1.color))
                        .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(theme.separator.color, lineWidth: 1))
                } else {
                    TextField("Find saved facts or notes…", text: binding(\.query)).textFieldStyle(.roundedBorder)
                        .onSubmit { if session.draftID == nil { session.find() } }
                }
                PillButton(title: session.contextID == nil ? "Find" : "Finding…") { session.find() }
                    .disabled(session.contextID != nil || session.draftID != nil)
            }
            Text("Lookup stays local. Check an item to include its displayed excerpt; nothing is selected automatically.")
                .appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            ForEach(session.candidates) { item in
                Toggle(isOn: Binding(get: { session.selected[item.id] != nil }, set: { on in session.selected[item.id] = on ? item : nil })) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.title).appFont(.system(size: 12, weight: .medium))
                        Text(item.text).appFont(.system(size: 11)).foregroundStyle(theme.text2.color).lineLimit(3)
                    }
                }.disabled(session.selected.count >= 12 && session.selected[item.id] == nil)
            }
            if !session.included.isEmpty {
                DisclosureGroup("Included context (\(session.included.count)) — review exact excerpts") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(session.included) { item in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(item.title + (item.truncated ? " (excerpt)" : "")).appFont(.system(size: 12, weight: .medium))
                                    Spacer()
                                    QuietButton(title: "Remove", symbol: "xmark") { session.selected[item.id] = nil }
                                }
                                if let source = item.source {
                                    Text("\(source.state) · \(source.path)/\(source.relativePath) · checked \(source.checkedAt)")
                                        .appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color).textSelection(.enabled)
                                }
                                Text(item.text).appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color).textSelection(.enabled)
                            }
                        }
                    }.padding(.top, 5)
                }
            }
        }
    }
}
