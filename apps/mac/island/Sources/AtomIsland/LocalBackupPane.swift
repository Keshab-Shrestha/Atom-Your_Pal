import AppKit
import SwiftUI
import Observation
import AtomIslandCore

@MainActor @Observable
final class LocalBackupModel {
    var session = ""
    var pending: LocalBackupRequest?
    var response: LocalBackupResponse?
    var error: String?
    var submittedText: String?
    var completedAction: String?
    var needsReload = false
    func perform(_ action: String, config: LocalBackupConfig? = nil, text: String? = nil, send: @escaping (IslandCommand) -> Void) {
        guard pending == nil || action == "cancel" || action == "close" else { return }
        guard !needsReload || ["get", "close", "cancel"].contains(action) else { return }
        let target = pending?.request
        let request = LocalBackupRequest(session: session, action: action, revision: response?.revision, config: config, text: text, target: target)
        error = nil
        if action == "close" { pending = nil; response = nil; submittedText = nil; session = ""; send(.localBackup(request)); return }
        pending = request
        if action == "send" { submittedText = text }
        send(.localBackup(request))
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(action == "send" ? 72 : 15))
            guard let self, self.pending?.request == request.request else { return }
            self.pending = nil
            self.needsReload = true
            if action == "send" || action == "probe" {
                send(.localBackup(LocalBackupRequest(session: request.session, action: "cancel", target: request.request)))
            }
            self.error = "ATOM did not confirm this backup request. Reload its state before continuing; nothing was retried automatically."
        }
    }
    func receive(_ value: LocalBackupResponse) {
        guard value.session == session, value.request == pending?.request else { return }
        completedAction = pending?.action
        if completedAction == "get" { needsReload = false }
        pending = nil; response = value; error = value.error
    }
    func dropped(_ request: LocalBackupRequest) {
        guard pending?.request == request.request else { return }
        pending = nil; error = "ATOM is not running. Reconnect and reload local backup; no request was sent or retried."
        needsReload = true
    }
    func stopped() {
        pending = nil; response = nil
        needsReload = true
        error = "ATOM stopped. The temporary backup conversation was discarded. Reload to reconnect; nothing will be replayed."
    }
}

/// Explicit manual backup with its own volatile follow-up context. No cloud-chat or permission mutation.
struct LocalBackupPane: View {
    let model: IslandModel
    @State private var session = UUID().uuidString.lowercased()
    @State private var endpoint = ""
    @State private var modelID = ""
    @State private var input = ""
    @State private var confirmClear = false
    @State private var confirmForget = false
    @State private var configurationOpen = true
    @Environment(\.dismiss) private var dismiss
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    init(model: IslandModel) {
        self.model = model
        _endpoint = State(initialValue: model.localBackup.response?.config?.endpoint ?? "")
        _modelID = State(initialValue: model.localBackup.response?.config?.model ?? "")
        _configurationOpen = State(initialValue: model.localBackup.response?.config == nil)
    }
    private var client: LocalBackupModel { model.localBackup }
    private var busy: Bool { client.pending != nil }
    private var unavailable: Bool { busy || client.needsReload || !model.localBackupReady }
    private var changed: Bool { client.response?.config != LocalBackupConfig(endpoint: endpoint, model: modelID) }
    private func perform(_ action: String, config: LocalBackupConfig? = nil, text: String? = nil) {
        client.perform(action, config: config, text: text, send: model.send)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Local text backup").font(.system(size: 18, weight: .semibold))
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Scrollable {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Cloud models stay primary. This temporary text conversation is discarded when you close it; copy anything you need.")
                        .foregroundStyle(theme.text2.color)
                    DisclosureGroup("Server configuration", isExpanded: $configurationOpen) {
                    VStack(alignment: .leading, spacing: 10) {
                    SoulField(label: "Local API address (for example, http://127.0.0.1:1234/v1)", text: $endpoint, lines: 1)
                    SoulField(label: "Exact local model ID", text: $modelID, lines: 1)
                    HStack(spacing: 10) {
                        Button("Save configuration") { perform("save", config: LocalBackupConfig(endpoint: endpoint, model: modelID)) }
                            .disabled(unavailable || client.response == nil || endpoint.isEmpty || modelID.isEmpty || !changed)
                        Button("Check server") { perform("probe") }
                            .disabled(unavailable || changed || client.response?.config == nil)
                        Button("Reload") { perform("get") }.disabled(busy || !model.localBackupReady)
                        if busy { ProgressView().controlSize(.small) }
                    }
                    Text("Save stores the address/model and clears this temporary conversation without connecting. Check server sends a model-list request without your messages. A listed model is not proof it can answer. This backup offers text replies only; tools, vision and thinking controls are unavailable.")
                        .font(.system(size: 11)).foregroundStyle(theme.text3.color)
                    readiness
                    Button("Forget backup configuration…") { confirmForget = true }.disabled(unavailable || client.response == nil)
                    }.padding(.top, 6)
                    }
                    Divider()
                    Text("Temporary backup conversation").font(.system(size: 14, weight: .semibold))
                    Text("Only this panel's messages are included. Your server may retain or forward them. Cloud chats, notes, files and permissions stay separate.")
                        .font(.system(size: 11)).foregroundStyle(theme.text2.color)
                    ForEach(Array((client.response?.turns ?? []).enumerated()), id: \.offset) { _, turn in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(turn.role == "user" ? "You" : "Local backup · \(client.response?.config?.model ?? "")")
                                    .font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                                Spacer()
                                Button("Copy") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(turn.content, forType: .string) }
                                    .buttonStyle(.plain).font(.system(size: 11))
                            }
                            Text(turn.content).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(12).background(theme.fill1.color, in: RoundedRectangle(cornerRadius: 10))
                    }
                    if let usage = client.response?.usage {
                        Text("Last answer: \(String(format: "%.2f", Double(usage.durationMs) / 1000)) s total · server-reported tokens: \(usage.input.map(String.init) ?? "unknown") input / \(usage.output.map(String.init) ?? "unknown") output. Non-streaming; this is completion time, not first-token latency.")
                            .font(.system(size: 11)).foregroundStyle(theme.text3.color)
                        if usage.truncated { Text("The last answer reached its output budget and may be incomplete.").foregroundStyle(theme.attention.color) }
                    }
                }
                .font(.system(size: 12)).padding(.trailing, 4)
            }
                    SoulField(label: "Message to the local backup", text: $input, lines: 3)
                    HStack(spacing: 12) {
                        Button("Send to local backup") { perform("send", text: input) }
                            .disabled(unavailable || changed || input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || client.response?.readiness?.listed != true)
                        if client.pending?.action == "send" || client.pending?.action == "probe" {
                            Button("Stop") { perform("cancel") }
                        } else if client.response?.config != nil {
                            Button("Check server") { perform("probe") }.disabled(unavailable || changed)
                        }
                        Spacer()
                        Button("Clear conversation") { confirmClear = true }.disabled(unavailable || client.response == nil)
                    }
                    if changed && client.response?.config != nil {
                        Text("Save the changed address/model before checking or sending. Saving clears this temporary conversation.").foregroundStyle(theme.attention.color)
                    }
                    if let error = client.error {
                        Text(error).foregroundStyle(theme.problem.color).textSelection(.enabled)
                    }
        }
        .padding(20).frame(width: 680).frame(minHeight: 460, idealHeight: 680, maxHeight: 760).foregroundStyle(theme.text.color).background(theme.surfaceSolid.color)
        .onAppear { if !snapshot { client.session = session; client.response = nil; perform("get") } }
        .onDisappear { if !snapshot && client.session == session { perform("close") } }
        .onChange(of: client.response) { _, value in
            guard let value else { return }
            if value.completed == true && input == client.submittedText { input = "" }
            // Preserve unsaved configuration edits on ordinary send/probe/cancel responses.
            if client.completedAction == "get" || (value.error == nil && ["save", "forget"].contains(client.completedAction ?? "")) {
                endpoint = value.config?.endpoint ?? ""; modelID = value.config?.model ?? ""
                configurationOpen = value.config == nil
            }
        }
        .alert("Clear the temporary backup conversation?", isPresented: $confirmClear) {
            Button("Cancel", role: .cancel) { }
            Button("Clear", role: .destructive) { perform("clear") }
        } message: { Text("Copy anything you want to keep first. Your cloud chats and saved permissions remain available.") }
        .alert("Forget local backup configuration?", isPresented: $confirmForget) {
            Button("Cancel", role: .cancel) { }
            Button("Forget", role: .destructive) { perform("forget") }
        } message: { Text("Removes the saved address/model and this temporary conversation. It does not uninstall or change your server.") }
    }
    @ViewBuilder private var readiness: some View {
        if let value = client.response?.readiness {
            Text("Server checked at \(value.checkedAt) · \(value.durationMs) ms · \(value.listed ? "configured model listed" : "configured model missing") · \(value.textVerified ? "text reply verified this session" : "text generation not yet verified"). Check expires after five minutes.")
                .font(.system(size: 11)).foregroundStyle(theme.text2.color).textSelection(.enabled)
        } else { Text("Not checked. No automatic connection or fallback.").font(.system(size: 11)).foregroundStyle(theme.text3.color) }
    }
}
