import AppKit
import SwiftUI
import AtomIslandCore

struct ChatControlFeedback: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    var body: some View {
        if let notice = model.chatControls.notice {
            VStack(alignment: .leading, spacing: 4) {
                Text(notice).appFont(.system(size: 11)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
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
                }.buttonStyle(.borderless).appFont(.system(size: 11))
            }
        }
    }
}

struct ConversationControls: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    @State private var details = false
    @State private var access = false
    private struct BriefSheet: Identifiable {
        let id: String
        let brief: ChatBrief
    }
    @State private var editingBrief: BriefSheet?

    var body: some View {
        let recoveryCount = model.recovery.attempts.count + model.unconfirmedAnswers.count
        ChatActionsMenu(title: "Chat options", attention: recoveryCount > 0) {
            Button("Find in chat", action: model.openChatFind)
            Divider()
            Button("Saved history", action: model.openSavedHistory).disabled(model.savedChat == nil)
            Button("Chat brief") {
                if let chat = model.savedChat, let snapshot = model.chatControls.snapshot, snapshot.id == chat.id, let brief = snapshot.brief {
                    editingBrief = BriefSheet(id: chat.id, brief: brief)
                }
            }
            .disabled(model.chatControls.snapshot?.brief == nil || !model.chatBranchAvailable || model.chats?.currentReadOnlyNotice != nil)
            Button("Fork saved chat") { model.forkSavedChat() }
                .disabled(!model.chatBranchAvailable || (model.chatControls.snapshot?.info?.messages ?? 0) == 0)
            if let chat = model.savedChat {
                Divider()
                Button(chat.pinned ? "Unpin chat" : "Pin chat") { model.setChatFlags(chat, pinned: !chat.pinned) }
                    .disabled(model.chatControls.mutation != nil)
                if chat.canArchive {
                    Button(chat.archived ? "Unarchive chat" : "Archive chat") { model.setChatFlags(chat, archived: !chat.archived) }
                        .disabled(!model.chatBranchAvailable || model.chatControls.mutation != nil)
                }
            }
            if let project = model.chats?.currentProject {
                Menu("Project") {
                    Text(project.chipTitle)
                    Button("Reveal folder in Finder") {
                        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: project.folderPath)])
                    }.disabled(project.missing)
                }
            }
            Divider()
            Button("Chat access") { access = true; model.inspectSavedChat() }
            Button("What this chat remembers") { details = true; model.inspectSavedChat() }
            Button(recoveryCount > 0 ? "Recovery (\(recoveryCount))" : "Recovery") {
                model.recovery.shown = true; model.refreshForegroundRecovery()
            }
        }
        .accessibilityValue(recoveryCount > 0 ? "\(recoveryCount) recovery items" : "")
        .popover(isPresented: $details) { ScrollView { contextDetails.padding(16) }.frame(width: 360).frame(maxHeight: 580) }
        .popover(isPresented: $access) { ChatAccessContent(model: model) }
        .sheet(isPresented: Binding(get: { model.recovery.shown }, set: { model.recovery.shown = $0 })) {
            ForegroundRecoveryView(model: model)
        }
        .task(id: [model.chats?.current ?? "", model.savedChat?.updatedAt?.description ?? "", String(model.savedChat?.messages ?? 0)]) {
            if !snapshot { model.inspectSavedChat() }
        }
        .sheet(item: $editingBrief) { sheet in
            ChatBriefEditor(model: model, chat: sheet.id, initial: sheet.brief)
        }
        .sheet(isPresented: Binding(get: { model.chatControls.historyShown }, set: {
            model.chatControls.historyShown = $0
            if !$0 { model.chatControls.reading = nil }
        })) { SavedChatHistory(model: model) }
    }

    private func bytes(_ value: Int) -> String { String(format: "%.1f KB", Double(value) / 1000) }

    private var contextDetails: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("What this chat remembers").appFont(.headline)
            Text("Your messages stay saved. ATOM uses recent messages to continue this conversation, and can summarize older ones in long chats. Memory never grants file or tool access.")
            if let note = model.cacheExpiredNotice { Text(note) }
            if let info = model.chatControls.snapshot?.info {
                Text("\(info.messages) messages saved")
                DisclosureGroup("Replay and context details") {
                    VStack(alignment: .leading, spacing: 6) {
                        ProgressView(value: Double(max(0, info.replayBytes)), total: Double(max(1, info.replayBudget)))
                        Text("Fresh replay estimate: \(bytes(info.replayBytes)) of \(bytes(info.replayBudget)). \(info.omitted) earlier messages omitted from that estimate; the archive stays intact.")
                        Text("This byte estimate excludes system prompts, tools, in-flight input and SDK memory. It is not a provider token meter. ATOM manages replay automatically; manual Compact is unavailable.")
                    }.padding(.top, 6)
                }
            } else { Text("Send a message to save this chat, or refresh its details.") }
            if let continuity = model.chatControls.snapshot?.continuity {
                Divider()
                Text("Older-message summaries").fontWeight(.medium)
                Text(continuity.status)
                DisclosureGroup("How summaries work") {
                    Text("Uses the selected Claude/Codex model at low or its supported default effort in a separate tool-free request. This uses additional plan tokens. Current messages and your Chat brief take precedence; summaries never grant access. Clearing stops future inclusion, but copies already sent may remain in the provider session. Original messages stay saved.").padding(.top, 6)
                }
                if let summary = continuity.summary {
                    DisclosureGroup("Review derived summary") {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("m1–m\(summary.through) · \(summary.provider) / \(summary.model)").foregroundStyle(theme.text3.color)
                            ForEach(Array(summary.items.enumerated()), id: \.offset) { _, item in
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(item.text + " (" + item.refs.map { "m\($0)" }.joined(separator: ", ") + ")")
                                        .textSelection(.enabled)
                                    if let first = item.refs.first {
                                        Button("Read original m\(first)") {
                                            details = false
                                            model.openSavedHistoryMessage(first)
                                        }
                                    }
                                }
                            }
                        }.padding(.top, 6)
                    }
                }
                Button(continuity.enabled ? "Pause and clear automatic summary" : "Enable automatic summaries") {
                    model.setChatContinuity(enabled: !continuity.enabled, version: continuity.version)
                }.disabled(!model.chatBranchAvailable || model.chats?.currentReadOnlyNotice != nil)
            }
            if let usage = model.planUsage {
                DisclosureGroup("Provider limits and retry") {
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
            }
            Button("Refresh saved details", action: model.inspectSavedChat)
        }
        .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
    }
}

struct SavedChatHistory: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Saved history").appFont(.headline)
                Spacer()
                Button("Close") { model.chatControls.historyShown = false; model.chatControls.reading = nil }
                    .keyboardShortcut(.cancelAction)
            }
            Text("Read-only pages from the saved archive. Editing/retrying creates a new chat before that message; review it before sending. Existing file/network effects are not undone.")
                .appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color)
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
                                .appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                            Text(message.text).appFont(.system(size: 12.5)).textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            HStack {
                                ChatCopyControl(title: "Copy this part") { MarkdownCopy.Content(text: message.text) }
                                if message.role == "user" {
                                    Button("Edit in new chat") { branch("edit", message.seq) }
                                    Button("Retry in new chat") { branch("retry", message.seq) }
                                }
                                Button("Fork through here") { branch("fork", message.seq) }
                            }
                            .appFont(.system(size: 11.5)).buttonStyle(.borderless)
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
