import AppKit
import ApplicationServices
import ZenoIslandCore

/// Puts dictated text into the app and field the user was in (ADR-041, ADR-047).
///
/// What FluidVoice taught (docs/dictation-research.md): remember the target when dictation starts, wait for the
/// shortcut's own keys to be physically released before sending anything (otherwise ⌘ still down turns the paste
/// into a different shortcut), write straight into the field where the app allows it, and check that it worked.
@MainActor
final class TextInserter {
    /// Where the text will go: the app that was in front when dictation started.
    struct Target {
        let app: NSRunningApplication?
        var name: String { app?.localizedName ?? "the app in front" }
    }

    enum Result: Equatable {
        case typed
        /// The text is on the clipboard instead.
        case copied(reason: String)
    }

    /// Whether ZENO may post key presses (Accessibility).
    var canType: Bool { AXIsProcessTrusted() }

    func currentTarget() -> Target {
        Target(app: NSWorkspace.shared.frontmostApplication)
    }

    /// Asks macOS for Accessibility (adds ZENO to the list and opens the pane).
    func requestAccessibility() {
        // The value of kAXTrustedCheckOptionPrompt, which Swift 6 refuses to read as a global.
        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }

    func insert(_ text: String, into target: Target) async -> Result {
        guard canType else {
            copy(text)
            requestAccessibility()
            return .copied(reason: "Allow ZENO under Privacy & Security → Accessibility so it can type for you")
        }

        await waitForModifiersUp()
        await bringToFront(target)

        let element = focusedElement(of: target.app)
        if let element, isPassword(element) {
            copy(text)
            return .copied(reason: "A password field is focused. Paste it yourself")
        }
        if let element, insertDirectly(text, into: element) { return .typed }
        paste(text)
        return .typed
    }

    // MARK: - Waiting for the user's hands

    /// Waits until ⌘ ⌥ ⌃ ⇧ are physically up, at most `limit` seconds, so a held modifier cannot change the paste.
    private func waitForModifiersUp(limit: Double = 0.8) async {
        let mask: CGEventFlags = [.maskCommand, .maskAlternate, .maskControl, .maskShift]
        let deadline = ProcessInfo.processInfo.systemUptime + limit
        while !CGEventSource.flagsState(.combinedSessionState).intersection(mask).isEmpty,
              ProcessInfo.processInfo.systemUptime < deadline {
            try? await Task.sleep(for: .milliseconds(15))
        }
    }

    /// Back to the app the user was in, if they switched while the text was being prepared.
    private func bringToFront(_ target: Target) async {
        guard let app = target.app, !app.isTerminated,
              NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier else { return }
        app.activate()
        let deadline = ProcessInfo.processInfo.systemUptime + 0.5
        while NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier,
              ProcessInfo.processInfo.systemUptime < deadline {
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    // MARK: - Writing into the field (Accessibility)

    private func focusedElement(of app: NSRunningApplication?) -> AXUIElement? {
        guard let app else { return nil }
        var value: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(AXUIElementCreateApplication(app.processIdentifier),
                                                   kAXFocusedUIElementAttribute as CFString, &value)
        guard status == .success, let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement) // checked by CFGetTypeID above
    }

    private func string(_ attribute: String, of element: AXUIElement) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value as? String
    }

    private func isPassword(_ element: AXUIElement) -> Bool {
        string(kAXSubroleAttribute, of: element) == "AXSecureTextField"
    }

    /// Replaces the selection (or inserts at the caret) through Accessibility, and checks the field really changed:
    /// some apps (browsers, Electron) accept the call and do nothing. Returns false to let the paste fallback run.
    private func insertDirectly(_ text: String, into element: AXUIElement) -> Bool {
        let editable: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]
        guard let role = string(kAXRoleAttribute, of: element), editable.contains(role),
              let before = string(kAXValueAttribute, of: element) else { return false }
        guard AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFTypeRef) == .success
        else { return false }
        return string(kAXValueAttribute, of: element) != before
    }

    // MARK: - Pasting

    /// Puts `text` on the clipboard and presses ⌘V. The old clipboard goes back half a second later, in the
    /// background (the app reads the clipboard a moment after the key press), unless something else changed it
    /// meanwhile. The text is marked transient so clipboard managers ignore it. Dictation does not wait for the restore.
    private func paste(_ text: String) {
        let board = NSPasteboard.general
        let saved = Self.snapshot(board)
        place(text, on: board)
        let ours = board.changeCount

        pressCommandV()

        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(500))
            if board.changeCount == ours { Self.restore(saved, to: board) }
        }
    }

    private func copy(_ text: String) {
        place(text, on: .general, transient: false)
    }

    private func place(_ text: String, on board: NSPasteboard, transient: Bool = true) {
        board.clearContents()
        board.setString(text, forType: .string)
        if transient {
            board.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.TransientType"))
            board.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType"))
        }
    }

    private func pressCommandV() {
        let source = CGEventSource(stateID: .hidSystemState)
        let vKey: CGKeyCode = 9
        for down in [true, false] {
            let event = CGEvent(keyboardEventSource: source, virtualKey: vKey, keyDown: down)
            event?.flags = .maskCommand
            event?.post(tap: .cghidEventTap)
        }
    }

    private static func snapshot(_ board: NSPasteboard) -> [[NSPasteboard.PasteboardType: Data]] {
        (board.pasteboardItems ?? []).map { item in
            var contents: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types { if let data = item.data(forType: type) { contents[type] = data } }
            return contents
        }
    }

    private static func restore(_ items: [[NSPasteboard.PasteboardType: Data]], to board: NSPasteboard) {
        board.clearContents()
        guard !items.isEmpty else { return }
        let restored = items.map { contents -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (type, data) in contents { item.setData(data, forType: type) }
            return item
        }
        board.writeObjects(restored)
    }
}
