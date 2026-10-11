import AppKit
import SwiftUI
import ZenoIslandCore

/// The ZENO window (ADR-089; it began as the ZENO window, ADR-081): chat, the board and the team, and Settings in one
/// real Mac window with a sidebar. While it is open ZENO has a Dock icon and a menu bar (so ⌘W, ⌘C and ⌘V work in
/// it); closing it puts the app back the way it was (a background app).
@MainActor
final class MainWindowController: NSObject, NSWindowDelegate {
    private let model: IslandModel
    private var window: NSWindow?
    private var previousPolicy = NSApplication.ActivationPolicy.accessory
    private var previousMenu: NSMenu?

    init(model: IslandModel) {
        self.model = model
    }

    var isVisible: Bool { window?.isVisible == true }

    /// Opens the window on `page` (nil keeps the page it shows).
    func show(page: WindowPage? = nil) {
        if let page { model.windowPage = page }
        let window = self.window ?? makeWindow()
        self.window = window
        if !model.helpersWindowOpen {
            previousPolicy = NSApp.activationPolicy()
            previousMenu = NSApp.mainMenu
            NSApp.setActivationPolicy(.regular)
            NSApp.mainMenu = Self.mainMenu()
            model.helpersWindowOpen = true
            model.send(.helpersList)
            model.send(.chatsList) // ADR-091
        }
        let palette = model.settings.theme.palette
        window.appearance = NSAppearance(named: palette.isDark ? .darkAqua : .aqua)
        window.backgroundColor = palette.surfaceSolid.nsColor
        window.hasShadow = palette.usesShadows // Void: a hairline, no drop shadow (ADR-086)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func close() { window?.performClose(nil) }

    func windowWillClose(_ notification: Notification) {
        model.helpersWindowOpen = false
        model.helpers.closeReport()
        NSApp.mainMenu = previousMenu
        NSApp.setActivationPolicy(previousPolicy)
    }

    private func makeWindow() -> NSWindow {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 920, height: 640),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.title = "ZENO"
        // ADR-084: the content runs under a clear title bar, so the sidebar reaches the top with the window's buttons on it.
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 760, height: 500)
        window.contentView = NSHostingView(rootView: HelpersView(model: model))
        window.delegate = self
        if !window.setFrameUsingName("ZenoMain") { window.center() }
        window.setFrameAutosaveName("ZenoMain")
        return window
    }

    /// The menu bar while the window is open: Quit, the standard Edit commands, Close and Minimize.
    private static func mainMenu() -> NSMenu {
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
        add("ZENO", [item("Quit ZENO", #selector(NSApplication.terminate(_:)), "q")])
        add("Edit", [
            item("Undo", Selector(("undo:")), "z"), item("Redo", Selector(("redo:")), "z", [.command, .shift]), .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"), item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"), item("Select All", #selector(NSText.selectAll(_:)), "a"),
        ])
        add("Window", [
            item("Close", #selector(NSWindow.performClose(_:)), "w"), item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
        ])
        return main
    }
}
