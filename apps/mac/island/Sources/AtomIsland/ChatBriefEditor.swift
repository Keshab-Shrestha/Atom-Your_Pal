import SwiftUI
import AtomIslandCore

struct ChatBriefEditor: View {
    let model: IslandModel
    let chat: String
    @State private var draft: String
    @State private var saved: ChatBrief
    @State private var pending: String?
    @State private var reloadRequest: String?
    @State private var status: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.theme) private var theme

    init(model: IslandModel, chat: String, initial: ChatBrief) {
        self.model = model; self.chat = chat
        _draft = State(initialValue: initial.text); _saved = State(initialValue: initial)
    }

    private var current: Bool { model.chats?.current == chat }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Chat brief").font(.headline)
                Spacer()
                Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Text("Keep the project, decisions and next step here. Your saved brief accompanies each request in this chat, including after restarting or changing models.")
            SoulField(label: "Brief for this chat", text: $draft, lines: 8)
            Text("Shared with this chat’s model when you send. It does not grant file access or become global memory. Other chats and forks start without this brief. Clear the text and save to stop including it in future requests. Earlier versions may remain in the model’s session.")
                .foregroundStyle(theme.text2.color)
            if !current { Text("Return to the original chat before saving. Your draft is still here.").foregroundStyle(theme.attention.color) }
            if let status { Text(status).foregroundStyle(theme.text2.color).textSelection(.enabled) }
            HStack {
                Button("Replace draft with saved") {
                    model.inspectSavedChat(); reloadRequest = model.chatControls.inspecting?.request
                }.disabled(!current || pending != nil || reloadRequest != nil)
                Spacer()
                Button(pending == nil ? "Save for this chat" : "Saving…") {
                    pending = model.saveChatBrief(chat: chat, text: draft, version: saved.version)
                    status = pending == nil ? "Save could not start. Finish current work and refresh this chat." : nil
                }
                .disabled(!current || !ChatBrief.valid(draft) || draft == saved.text || pending != nil || reloadRequest != nil || !model.chatBranchAvailable)
                .keyboardShortcut("s", modifiers: .command)
            }
            if model.chatControls.waitingExpired, pending != nil {
                Button("Check save result", action: model.retryChatControlConfirmation)
                Text("The save is not confirmed. Your draft stays here; checking cannot overwrite a newer brief.")
            }
        }
        .font(.system(size: 12)).padding(20).frame(width: 560)
        .background(theme.surfaceSolid.color).foregroundStyle(theme.text.color)
        .onChange(of: model.chatControls.briefReceipt?.request) { _, request in
            guard request == pending, let response = model.chatControls.briefReceipt, response.id == chat else { return }
            pending = nil
            if response.ok, let brief = response.brief {
                saved = brief
                status = draft == brief.text ? "Saved for this chat." : "Saved the submitted version. Your newer draft has not been saved."
            } else { status = response.error ?? "Save was not confirmed. Your draft is unchanged." }
        }
        .onChange(of: model.chatControls.inspecting?.request) { _, request in
            guard request == nil, let expected = reloadRequest else { return }
            reloadRequest = nil
            if let snapshot = model.chatControls.snapshot, snapshot.request == expected, snapshot.id == chat, let brief = snapshot.brief {
                saved = brief; draft = brief.text; status = "Loaded the saved brief."
            } else { status = "Could not reload the brief. Your draft is unchanged." }
        }
    }
}
