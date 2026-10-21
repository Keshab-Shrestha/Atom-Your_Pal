import AppKit
import SwiftUI
import AtomIslandCore

/// The ATOM window (ADR-089, ADR-081): chat, the board and the team, and Settings in one
/// real Mac window with a sidebar. While it is open ATOM has a Dock icon and a menu bar (so ⌘W, ⌘C and ⌘V work in
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
    /// Open and in front (ATOM is the active app): a click on the menu-bar icon or Pal then closes it.
    var isInFront: Bool { isVisible && NSApp.isActive }

    /// Opens the window on `page` (nil keeps the page it shows).
    func show(page: WindowPage? = nil) {
        if let page, page != model.windowPage { model.navigate { [model] in model.windowPage = page } }
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

    /// The View item names what it does now: "Hide Sidebar" or "Show Sidebar".
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(find(_:)) {
            item.title = model.windowPage == .chat ? "Find in Chat" : "Search All"
            return canFind
        }
        if item.action == #selector(searchAll(_:)) { return canFind }
        if item.action == #selector(copyLastReply(_:)) { return copyLastReplyText != nil }
        if item.action == #selector(toggleSidebar(_:)) { item.title = WindowChrome.sidebarToggleTitle(hidden: model.settings.sidebarHidden) }
        return true
    }

    /// Go → Back (⌘[).
    @objc private func goBack(_ sender: Any?) { model.goBack() }

    func windowWillClose(_ notification: Notification) {
        model.helpersWindowOpen = false
        model.recorder.stop() // a shortcut recording left open keeps every global shortcut paused and takes ATOM's keys (onDisappear does not fire here)
        model.permissions.stopPolling() // the window is closed, not destroyed, so Settings' onDisappear never fires: the 1.5 s permission checks ran for ever
        model.helpers.closeReport()
        NSApp.mainMenu = previousMenu
        NSApp.setActivationPolicy(previousPolicy)
    }

    private func makeWindow() -> NSWindow {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 920, height: 640),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.title = "ATOM"
        // ADR-084: the content runs under a clear title bar, so the sidebar reaches the top with the window's buttons on it.
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 760, height: 500)
        window.contentView = NSHostingView(rootView: HelpersView(model: model))
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
        if !window.setFrameUsingName("AtomMain") { window.center() }
        window.setFrameAutosaveName("AtomMain")
        return window
    }

    /// The menu bar while the window is open: Quit, the standard Edit commands, Back, Close and Minimize.
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
        add("ATOM", [item("Quit ATOM", #selector(NSApplication.terminate(_:)), "q")])
        let find = item("Find", #selector(find(_:)), "f")
        find.target = self
        let searchAll = item("Search All", #selector(searchAll(_:)), "f", [.command, .shift])
        searchAll.target = self
        let copyReply = item("Copy Last Reply", #selector(copyLastReply(_:)), "c", [.command, .shift])
        copyReply.target = self
        add("Edit", [
            item("Undo", Selector(("undo:")), "z"), item("Redo", Selector(("redo:")), "z", [.command, .shift]), .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"), item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"), item("Select All", #selector(NSText.selectAll(_:)), "a"), .separator(),
            copyReply, find, searchAll,
        ])
        let sidebar = item(WindowChrome.sidebarToggleTitle(hidden: model.settings.sidebarHidden), #selector(toggleSidebar(_:)), "h", [.command, .option])
        sidebar.target = self
        add("View", [sidebar])
        let back = item("Back", #selector(goBack(_:)), "[")
        back.target = self
        add("Go", [back])
        add("Window", [
            item("Close", #selector(NSWindow.performClose(_:)), "w"), item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
        ])
        return main
    }
}
