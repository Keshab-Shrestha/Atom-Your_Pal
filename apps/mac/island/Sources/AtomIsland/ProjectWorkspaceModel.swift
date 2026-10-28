import AppKit
import UniformTypeIdentifiers
import AtomIslandCore

extension IslandModel {
    func openWorkspaceBranches() {
        navigate { self.windowPage = .dashboard }
        sendHelpers(helpers.gitCommand(.gitList))
    }
    var workspaceAvailable: Bool {
        guard let project = chats?.currentProject else { return false }
        return !project.missing && !project.archived && chats?.currentReadOnlyNotice == nil
            && chats?.current != "api" && chats?.current.hasPrefix("api-") != true
    }
    var workspaceTerminalAvailable: Bool { workspaceAvailable && ProjectFileNavigation.root(chats?.currentProject) != nil }
    func workspaceSurfaceAvailable(_ surface: WorkspaceSurface) -> Bool {
        surface == .browser || surface == .run || workspaceAvailable
    }
    func requestWorkspace(_ action: WorkspaceRequest.Action, path: String = "", job: Int? = nil, token: String? = nil, section: String? = nil) {
        guard workspaceAvailable, let chat = chats?.current, let project = chats?.currentProjectId else { workspace.clear(); return }
        let request = WorkspaceRequest(chat: chat, project: project, action: action, path: path, job: job, token: token, section: section)
        workspace.begin(request)
        send(.workspace(request))
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(12))
            self?.workspace.expire(request.request)
        }
    }
    func toggleWorkspace() {
        if workspace.shown { workspaceTerminal.stop() }
        workspace.shown.toggle()
    }
    func selectWorkspace(_ surface: WorkspaceSurface?) {
        guard workspace.select(surface) else { return }
        if surface != .terminal { workspaceTerminal.stop() }
        settings.workspaceSurface = workspace.tab
        workspace.shown = true
        loadWorkspaceIfNeeded()
    }
    func loadWorkspaceIfNeeded() {
        guard workspace.tab != "browser", workspace.tab != "terminal", workspace.tab != "run" else { return }
        if workspace.shown, workspaceAvailable, workspace.response?.action == .undo {
            workspace.selectedChange = nil
            requestWorkspace(.changes)
            return
        }
        guard workspace.shown, workspaceAvailable, workspace.tab != "browser", WorkspaceSurface(rawValue: workspace.tab) != nil,
              workspace.pending == nil, workspace.response == nil, workspace.notice == nil else { return }
        refreshWorkspace()
    }
    func refreshWorkspace() {
        guard WorkspaceSurface(rawValue: workspace.tab) != nil else { return }
        if workspace.tab == "terminal" || workspace.tab == "run" { return }
        if workspace.tab == "browser" { workspaceBrowser.reload() }
        else if workspace.tab == "git" { requestWorkspace(.git) }
        else if workspace.tab == "changes" { requestWorkspace(.changes) }
        else { requestWorkspace(.list, path: workspace.folder) }
    }
    func addWorkspaceFile(_ path: String) {
        guard workspaceAvailable, let file = ProjectFileNavigation.resolve(path, project: chats?.currentProject) else {
            workspace.notice = "That file is no longer available inside this project."; return
        }
        var draft = composerFiles
        draft.add([file.path])
        composerFiles = draft
        workspace.notice = draft.notice ?? "Added to this chat’s draft. Send when ready."
    }
    func openWorkspaceFile(_ path: String, finder: Bool) {
        guard workspaceAvailable, let file = ProjectFileNavigation.resolve(path, project: chats?.currentProject) else {
            workspace.notice = "That file is no longer available inside this project."; return
        }
        if finder { _ = ProjectFileNavigation.reveal(file, project: chats?.currentProject); return }
        let chat = chats?.current, project = chats?.currentProject
        let picker = NSOpenPanel()
        picker.title = "Choose an editor for \((path as NSString).lastPathComponent)"
        picker.prompt = "Open in editor"
        picker.allowedContentTypes = [.application]
        picker.directoryURL = URL(fileURLWithPath: "/Applications")
        picker.canChooseDirectories = false; picker.canChooseFiles = true; picker.allowsMultipleSelection = false
        guard picker.runModal() == .OK, let editor = picker.url, chat == chats?.current, project == chats?.currentProject,
              workspaceAvailable, let current = ProjectFileNavigation.resolve(path, project: project), current == file else { return }
        NSWorkspace.shared.open([URL(fileURLWithPath: file.path)], withApplicationAt: editor, configuration: NSWorkspace.OpenConfiguration()) { [weak self] _, error in
            if error != nil { Task { @MainActor [weak self] in self?.workspace.notice = "The editor could not open this file. Choose another editor." } }
        }
    }
}
