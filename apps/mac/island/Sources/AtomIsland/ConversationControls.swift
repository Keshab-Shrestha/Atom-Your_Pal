import SwiftUI
import AtomIslandCore

struct ChatControlFeedback: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    var body: some View {
        if let notice = model.chatControls.notice {
            VStack(alignment: .leading, spacing: 4) {
                Text(notice).font(.system(size: 11)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
                HStack {
                    if model.chatControls.undo != nil {
                        Button("Undo pin/archive", action: model.undoChatFlags).disabled(model.chatControls.mutation != nil)
                    }
                    if model.chatControls.waitingExpired {
                        Button("Check result", action: model.retryChatControlConfirmation)
                    }
                    if model.chatControls.mutation == nil {
                        Button("Dismiss") { model.chatControls.notice = nil }
                    }
                }.buttonStyle(.borderless).font(.system(size: 11))
            }
        }
    }
}

struct ConversationControls: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    @State private var details = false

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 10) {
                Button("Saved history", action: model.openSavedHistory).disabled(model.savedChat == nil)
                Button("Fork saved chat") { model.forkSavedChat() }
                    .disabled(!model.chatBranchAvailable || (model.chatControls.snapshot?.info?.messages ?? 0) == 0)
                    .help("Create a new chat from saved messages; no files, permissions or running work are copied")
                if let chat = model.savedChat {
                    if snapshot {
                        Image(systemName: "ellipsis.circle")
                    } else {
                        Menu {
                            Button(chat.pinned ? "Unpin" : "Pin") { model.setChatFlags(chat, pinned: !chat.pinned) }
                            if chat.canArchive {
                                Button(chat.archived ? "Unarchive" : "Archive") { model.setChatFlags(chat, archived: !chat.archived) }
                                    .disabled(!model.chatBranchAvailable)
                            }
                        } label: { Image(systemName: "ellipsis.circle") }
                        .disabled(model.chatControls.mutation != nil)
                        .accessibilityLabel("Chat organization")
                    }
                }
                Spacer(minLength: 0)
                Button {
                    details = true
                } label: {
                    Text(model.chatControls.snapshot?.info.map { "Replay estimate \(bytes($0.replayBytes))/\(bytes($0.replayBudget))" } ?? "Saved context")
                }
                .popover(isPresented: $details) { contextDetails.padding(16).frame(width: 340) }
            }
            .font(.system(size: 11.5)).buttonStyle(SnapshotBorderlessButtonStyle()).foregroundStyle(theme.text2.color)
            ChatControlFeedback(model: model)
            HStack(spacing: 14) {
                ChatAccessDetails(model: model)
                ForegroundRecoveryButton(model: model)
            }
        }
        .padding(.horizontal, Spacing.conversation).padding(.vertical, 7)
        .task(id: [model.chats?.current ?? "", model.savedChat?.updatedAt?.description ?? "", String(model.savedChat?.messages ?? 0)]) {
            if !snapshot { model.inspectSavedChat() }
        }
        .sheet(isPresented: Binding(get: { model.chatControls.historyShown }, set: {
            model.chatControls.historyShown = $0
            if !$0 { model.chatControls.reading = nil }
        })) { SavedChatHistory(model: model) }
    }

    private func bytes(_ value: Int) -> String { String(format: "%.1f KB", Double(value) / 1000) }

    private var contextDetails: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Saved conversation replay").font(.headline)
            if let info = model.chatControls.snapshot?.info {
                Text("\(info.messages) saved messages · \(bytes(info.archiveBytes)) archived")
                ProgressView(value: Double(max(0, info.replayBytes)), total: Double(max(1, info.replayBudget)))
                Text("Fresh replay estimate: \(bytes(info.replayBytes)) of \(bytes(info.replayBudget)). \(info.omitted) earlier messages omitted from that estimate; the archive stays intact.")
            } else { Text("Send a message to save this chat, or refresh its details.") }
            Text("This is a byte estimate for saved conversation replay, not a provider token/context meter. It excludes system prompts, tools, in-flight input and SDK memory.")
            Text("ATOM bounds replay automatically. Manual Compact is unavailable in the current gateway.")
            if let usage = model.planUsage {
                Text(usage.limited == true ? "Claude plan: limit reported" : "Claude plan: last reported usage")
                    .fontWeight(.medium)
                if let reset = usage.resetAt {
                    Text("Reported reset: \(Date(timeIntervalSince1970: reset).formatted(date: .abbreviated, time: .shortened))")
                } else { Text("The provider has not supplied a reset time.") }
                if let last = model.chatControls.snapshot?.info?.lastUser {
                    Button("Prepare last prompt for later") {
                        details = false
                        model.forkSavedChat(kind: "retry", through: last)
                    }.disabled(!model.chatBranchAvailable)
                }
                Text("A retry creates an unsent draft in a new chat. Nothing is scheduled or sent when a reset time passes.")
            }
            Button("Refresh saved details", action: model.inspectSavedChat)
        }
        .font(.system(size: 12)).foregroundStyle(theme.text2.color)
    }
}

struct SavedChatHistory: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Saved history").font(.headline)
                Spacer()
                Button("Close") { model.chatControls.historyShown = false; model.chatControls.reading = nil }
                    .keyboardShortcut(.cancelAction)
            }
            Text("Read-only pages from the saved archive. Editing/retrying creates a new chat before that message; review it before sending. Existing file/network effects are not undone.")
                .font(.system(size: 11.5)).foregroundStyle(theme.text3.color)
            HStack {
                Button("First / Reload", action: model.refreshSavedHistory)
                Button("Previous", action: model.previousSavedHistory).disabled(model.chatControls.previous.isEmpty)
                Button("Next", action: model.nextSavedHistory).disabled(model.chatControls.history?.page?.next == nil)
                Button("Latest saved", action: model.latestSavedHistory)
            }
            .disabled(model.chatControls.reading != nil)
            if model.chatControls.reading != nil { ProgressView("Loading saved messages…") }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(model.chatControls.history?.page?.messages ?? []) { message in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("m\(message.seq) · \(message.role == "user" ? "You" : "ATOM") · text offset \(message.offset)")
                                .font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                            Text(message.text).font(.system(size: 12.5)).textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            HStack {
                                ChatCopyControl(title: "Copy this part") { MarkdownCopy.Content(text: message.text) }
                                if message.role == "user" {
                                    Button("Edit in new chat") { branch("edit", message.seq) }
                                    Button("Retry in new chat") { branch("retry", message.seq) }
                                }
                                Button("Fork through here") { branch("fork", message.seq) }
                            }
                            .font(.system(size: 11.5)).buttonStyle(.borderless)
                            .disabled(!model.chatBranchAvailable)
                        }
                    }
                }.padding(6)
            }
            ChatControlFeedback(model: model)
        }
        .padding(18).frame(width: 700, height: 520)
        .background(theme.surfaceSolid.color).foregroundStyle(theme.text.color)
    }

    private func branch(_ kind: String, _ seq: Int) {
        guard let revision = model.chatControls.history?.revision else { return }
        model.forkSavedChat(kind: kind, through: seq, revision: revision)
    }
}
