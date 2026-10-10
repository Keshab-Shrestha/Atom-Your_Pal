import AppKit
import SwiftUI
import ZenoIslandCore

/// The Helpers window (ADR-081): a real Mac window. While it is open ZENO has a Dock icon and a menu bar (so ⌘W,
/// ⌘C and ⌘V work in it); closing it puts the app back the way it was (a background app).
@MainActor
final class HelpersWindowController: NSObject, NSWindowDelegate {
    private let model: IslandModel
    private var window: NSWindow?
    private var previousPolicy = NSApplication.ActivationPolicy.accessory
    private var previousMenu: NSMenu?

    init(model: IslandModel) {
        self.model = model
    }

    func show() {
        let window = self.window ?? makeWindow()
        self.window = window
        if !model.helpersWindowOpen {
            previousPolicy = NSApp.activationPolicy()
            previousMenu = NSApp.mainMenu
            NSApp.setActivationPolicy(.regular)
            NSApp.mainMenu = Self.mainMenu()
            model.helpersWindowOpen = true
            model.send(.helpersList)
        }
        let palette = model.settings.theme.palette
        window.appearance = NSAppearance(named: palette.isDark ? .darkAqua : .aqua)
        window.backgroundColor = palette.surfaceSolid.nsColor
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        model.helpersWindowOpen = false
        model.helpers.closeReport()
        NSApp.mainMenu = previousMenu
        NSApp.setActivationPolicy(previousPolicy)
    }

    private func makeWindow() -> NSWindow {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 720, height: 520),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.title = "Helpers"
        // ADR-084: the content runs under a clear title bar, so the sidebar reaches the top with the window's buttons on it.
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 600, height: 400)
        window.contentView = NSHostingView(rootView: HelpersView(model: model))
        window.delegate = self
        if !window.setFrameUsingName("ZenoHelpers") { window.center() }
        window.setFrameAutosaveName("ZenoHelpers")
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
