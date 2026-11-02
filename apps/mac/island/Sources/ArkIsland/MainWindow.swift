import AppKit
import SwiftUI
import ArkIslandCore

/// The ARK window (ADR-089, ADR-081): chat, the board and the team, and Settings in one
/// real Mac window with a sidebar. While it is open ARK has a Dock icon and a menu bar (so ⌘W, ⌘C and ⌘V work in
/// it); closing it puts the app back the way it was (a background app).
@MainActor
final class MainWindowController: NSObject, NSWindowDelegate, NSMenuItemValidation {
    private let model: IslandModel
    private var window: NSWindow?
    private var previousPolicy = NSApplication.ActivationPolicy.accessory
    private var previousMenu: NSMenu?
    /// ADR-096: the mouse's back button goes Back in this window.
    private var mouseMonitor: Any?

    init(model: IslandModel) {
        self.model = model
    }

    var isVisible: Bool { window?.isVisible == true }
    /// Open and in front (ARK is the active app): a click on the menu-bar icon or Pal then closes it.
    var isInFront: Bool { isVisible && NSApp.isActive }

    /// Opens the window on `page` (nil keeps the page it shows).
    func show(page: WindowPage? = nil) {
        // Settings → Defaults (2026-11-02): a plain open (Chat, the default page) shows the start page instead.
        if !model.helpersWindowOpen, page == nil || page == .chat {
            model.navigate { [model] in model.goToStartPage() }
        } else if let page, page != model.windowPage { model.navigate { [model] in model.windowPage = page } }
        let window = self.window ?? makeWindow()
        self.window = window
        if !model.helpersWindowOpen {
            previousPolicy = NSApp.activationPolicy()
            previousMenu = NSApp.mainMenu
            NSApp.setActivationPolicy(.regular)
            NSApp.mainMenu = mainMenu()
            model.helpersWindowOpen = true
            model.send(.helpersList)
            model.send(.chatsList) // ADR-091
            model.send(.commandsList) // the "/" picker (ADR-117)
        }
        let palette = ChatAppearance.palette(theme: model.settings.theme)
        window.appearance = NSAppearance(named: palette.isDark ? .darkAqua : .aqua)
        window.backgroundColor = palette.surfaceSolid.nsColor
        window.hasShadow = palette.usesShadows // Void: a hairline, no drop shadow (ADR-086)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func close() { window?.performClose(nil) }

    /// ADR-096: closing with an edit not saved asks "Discard changes?" first.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard model.hasUnsavedEdits else { return true }
        model.navigate { [weak sender] in sender?.performClose(nil) }
        return false
    }

    private var canFind: Bool {
        guard let window else { return false }
        return NSApp.keyWindow === window && window.attachedSheet == nil && !model.recorder.isRecording
    }

    /// ADR-152: ⌘F searches this chat; ⇧⌘F retains global/sidebar search.
    @objc private func find(_ sender: Any?) {
        guard canFind else { return }
        if model.windowPage == .chat { model.openChatFind() } else { model.focusSearch() }
    }
    @objc private func searchAll(_ sender: Any?) { if canFind { model.focusSearch() } }
    /// ⌘J (2026-11-02): the agent panel.
    @objc private func toggleAgentPanel(_ sender: Any?) { if canFind { model.agentPanel = model.agentPanel == nil ? "" : nil } }
    /// ⌘K (2026-11-02): the command palette.
    @objc private func openPalette(_ sender: Any?) { if canFind { model.paletteShown.toggle() } }
    /// ⇧⌘A (2026-11-02): the chat as one selectable text view, everything selected.
    @objc private func selectChatText(_ sender: Any?) {
        if canFind, model.windowPage == .chat, !model.conversation.turns.isEmpty { model.chatSelecting = true }
    }
    /// ⌘N and ⇧⌘N (Keshab, 2026-11-02): window menu shortcuts, like the sidebar's buttons.
    @objc private func newChat(_ sender: Any?) { if canFind { model.startNewChat() } }
    @objc private func newProject(_ sender: Any?) { if canFind && model.canOpenProjectSources { model.openProjectSources() } }

    /// ADR-144: an ordinary window menu shortcut, never a global shortcut or a clipboard read.
    private var copyLastReplyText: String? {
        guard let window, window.isVisible, NSApp.isActive, NSApp.keyWindow === window,
              window.attachedSheet == nil, model.helpersWindowOpen, model.windowPage == .chat,
              !model.recorder.isRecording else { return nil }
        return model.conversation.lastFinishedReply
    }

    @objc private func copyLastReply(_ sender: Any?) {
        guard let reply = copyLastReplyText else { return }
        _ = ChatClipboard.write(MarkdownCopy.reply(reply))
    }

    /// ADR-128: View → Hide Sidebar / Show Sidebar (⌥⌘H).
    @objc private func toggleSidebar(_ sender: Any?) { model.toggleSidebar() }

    @objc private func toggleWorkspace(_ sender: Any?) {
        guard canFind, model.windowPage == .chat else { return }
        model.toggleWorkspace()
    }
    @objc private func openWorkspaceSurface(_ sender: NSMenuItem) {
        guard canFind, model.windowPage == .chat, WorkspaceSurface.allCases.indices.contains(sender.tag),
              model.workspaceSurfaceAvailable(WorkspaceSurface.allCases[sender.tag]) else { return }
        model.selectWorkspace(WorkspaceSurface.allCases[sender.tag])
    }

    /// The View item names what it does now: "Hide Sidebar" or "Show Sidebar".
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(find(_:)) {
            item.title = model.windowPage == .chat ? "Find in Chat" : "Search All"
            return canFind
        }
        if item.action == #selector(toggleWorkspace(_:)) {
            item.title = model.workspace.shown ? "Close Workspace" : "Open Workspace"
            return canFind && model.windowPage == .chat
        }
        if item.action == #selector(openWorkspaceSurface(_:)) {
            return canFind && model.windowPage == .chat && WorkspaceSurface.allCases.indices.contains(item.tag)
                && model.workspaceSurfaceAvailable(WorkspaceSurface.allCases[item.tag]) && model.workspace.pending?.action != .undo
        }
        if item.action == #selector(searchAll(_:)) { return canFind }
        if item.action == #selector(copyLastReply(_:)) { return copyLastReplyText != nil }
        if item.action == #selector(toggleSidebar(_:)) { item.title = WindowChrome.sidebarToggleTitle(hidden: model.settings.sidebarHidden) }
        return true
    }

    /// Go → Back (⌘[).
    @objc private func goBack(_ sender: Any?) { model.goBack() }

    func windowWillClose(_ notification: Notification) {
        model.cancelProjectSource()
        model.workspaceTerminal.reset()
        model.rememberWindowPage()
        model.helpersWindowOpen = false
        model.recorder.stop() // a shortcut recording left open keeps every global shortcut paused and takes ARK's keys (onDisappear does not fire here)
        model.permissions.stopPolling() // the window is closed, not destroyed, so Settings' onDisappear never fires: the 1.5 s permission checks ran for ever
        model.helpers.closeReport()
        NSApp.mainMenu = previousMenu
        NSApp.setActivationPolicy(previousPolicy)
    }

    private func makeWindow() -> NSWindow {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 920, height: 640),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.title = "ARK"
        // ADR-084: the content runs under a clear title bar, so the sidebar reaches the top with the window's buttons on it.
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 760, height: 500)
        let hosting = NSHostingView(rootView: HelpersView(model: model))
        // AppKit owns the user's window size. Content reflow must not restore a SwiftUI ideal size after zooming.
        hosting.sizingOptions = []
        window.contentView = hosting
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.delegate = self
        mouseMonitor = NSEvent.addLocalMonitorForEvents(matching: .otherMouseDown) { [weak self] event in
            guard event.buttonNumber == 3 else { return event }
            nonisolated(unsafe) let event = event
            let used = MainActor.assumeIsolated { () -> Bool in
                guard let self, event.window === self.window else { return false }
                self.model.goBack()
                return true
            }
            return used ? nil : event
        }
        if !window.setFrameUsingName("ArkMain") { window.center() }
        window.setFrameAutosaveName("ArkMain")
        return window
    }

    /// The menu bar while the window is open: Quit, New Chat and New Project, the standard Edit commands, Back, Close and Minimize.
    private func mainMenu() -> NSMenu {
        let main = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem]) {
            let menu = NSMenu(title: title)
            items.forEach(menu.addItem)
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            item.submenu = menu
            main.addItem(item)
        }
        func item(_ title: String, _ action: Selector, _ key: String, _ modifiers: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
            item.keyEquivalentModifierMask = modifiers
            return item
        }
        add("ARK", [item("Quit ARK", #selector(NSApplication.terminate(_:)), "q")])
        let newChat = item("New Chat", #selector(newChat(_:)), "n")
        newChat.target = self
        let newProject = item("New Project…", #selector(newProject(_:)), "n", [.command, .shift])
        newProject.target = self
        add("File", [newChat, newProject])
        let find = item("Find", #selector(find(_:)), "f")
        find.target = self
        let searchAll = item("Search All", #selector(searchAll(_:)), "f", [.command, .shift])
        searchAll.target = self
        let copyReply = item("Copy Last Reply", #selector(copyLastReply(_:)), "c", [.command, .shift])
        copyReply.target = self
        let selectChat = item("Select Text in Chat", #selector(selectChatText(_:)), "a", [.command, .shift])
        selectChat.target = self
        let palette = item("Command Palette…", #selector(openPalette(_:)), "k")
        palette.target = self
        let agentPanel = item("Ask an Agent", #selector(toggleAgentPanel(_:)), "j")
        agentPanel.target = self
        add("Edit", [
            item("Undo", Selector(("undo:")), "z"), item("Redo", Selector(("redo:")), "z", [.command, .shift]), .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"), item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"), item("Select All", #selector(NSText.selectAll(_:)), "a"), .separator(),
            copyReply, selectChat, find, searchAll, .separator(), palette, agentPanel,
        ])
        let sidebar = item(WindowChrome.sidebarToggleTitle(hidden: model.settings.sidebarHidden), #selector(toggleSidebar(_:)), "h", [.command, .option])
        sidebar.target = self
        let workspace = item("Open Workspace", #selector(toggleWorkspace(_:)), "r", [.command, .option])
        workspace.target = self
        let surfaces = WorkspaceSurface.allCases.enumerated().map { index, surface in
            let entry = item("Workspace: " + surface.title, #selector(openWorkspaceSurface(_:)), String(index + 1), [.command, .option])
            entry.tag = index; entry.target = self
            return entry
        }
        add("View", [sidebar, workspace, .separator()] + surfaces)
        let back = item("Back", #selector(goBack(_:)), "[")
        back.target = self
        add("Go", [back])
        add("Window", [
            item("Close", #selector(NSWindow.performClose(_:)), "w"), item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
        ])
        return main
    }
}
