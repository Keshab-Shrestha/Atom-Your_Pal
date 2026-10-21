import AppKit
import SwiftUI
import SwiftTerm
import AtomIslandCore

struct WorkspaceTerminalView: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    private var session: WorkspaceTerminalSession { model.workspaceTerminal }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Label(session.running ? "Running" : session.stopping ? "Stopping…" : "Shell stopped", systemImage: "terminal")
                    .font(.system(size: 12, weight: .medium))
                Spacer(minLength: 0)
                if session.running {
                    Button("Stop", action: session.stop).accessibilityLabel("Stop workspace terminal")
                        .help("End the shell and its session jobs immediately")
                } else {
                    Button(session.started ? "Start again" : "Start shell") {
                        guard !snapshot, model.workspaceAvailable, let root = ProjectFileNavigation.root(model.chats?.currentProject) else { return }
                        session.start(directory: root)
                    }.disabled(session.stopping || (!snapshot && !model.workspaceTerminalAvailable))
                        .accessibilityLabel("Start workspace terminal")
                }
            }
            Text(verbatim: session.directory.isEmpty ? model.chats?.currentProject?.folderPath ?? "Project folder" : session.directory)
                .font(.system(size: 10.5, design: .monospaced)).foregroundStyle(theme.text3.color)
                .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
            if let notice = session.notice {
                Text(verbatim: notice).font(.system(size: 11)).foregroundStyle(theme.text2.color)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !snapshot && !model.workspaceTerminalAvailable {
                Text("The project folder is unavailable or has moved. Reopen it through Projects before starting a shell.")
                    .font(.system(size: 11)).foregroundStyle(theme.attention.color).fixedSize(horizontal: false, vertical: true)
            }
            if session.started && !snapshot {
                WorkspaceTerminalContent(session: session, foreground: NSColor(theme.text.color), background: NSColor(theme.surfaceSolid.color))
                    .id(session.generation).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    Spacer(minLength: 12)
                    Image(systemName: "terminal").font(.system(size: 24)).foregroundStyle(theme.text3.color)
                    Text("A shell for this project").font(.system(size: 14, weight: .medium))
                    Text("Start an interactive zsh in the project folder. It runs as your Mac user and can change files or use the network beyond this folder. ATOM’s agent approvals and Undo do not cover these commands.")
                        .font(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
                    Text("User shell startup files are skipped. Nothing runs until you choose Start shell.")
                        .font(.system(size: 11)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 12)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(12)
            }
            Text("User-operated · not sent to the model · ends when you leave this surface or change chats")
                .font(.system(size: 10)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
        }.onDisappear { if !snapshot { session.stop() } }
    }
}

private struct WorkspaceTerminalContent: NSViewRepresentable {
    let session: WorkspaceTerminalSession
    let foreground: NSColor
    let background: NSColor
    func makeNSView(context: Context) -> TerminalView { session.terminalView }
    func updateNSView(_ view: TerminalView, context: Context) {
        view.nativeForegroundColor = foreground; view.nativeBackgroundColor = background; view.caretColor = foreground
    }
}
