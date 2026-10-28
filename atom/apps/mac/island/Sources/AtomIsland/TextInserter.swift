import AppKit
import ApplicationServices
import AtomIslandCore

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

    /// Whether ATOM may post key presses (Accessibility).
    var canType: Bool { AXIsProcessTrusted() }

    func currentTarget() -> Target {
        Target(app: NSWorkspace.shared.frontmostApplication)
    }

    /// Asks macOS for Accessibility (adds ATOM to the list and opens the pane).
    func requestAccessibility() {
        // The value of kAXTrustedCheckOptionPrompt, which Swift 6 refuses to read as a global.
        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }

    func insert(_ text: String, into target: Target) async -> Result {
        guard canType else {
            copy(text)
            requestAccessibility()
            return .copied(reason: "Allow ATOM under Privacy & Security → Accessibility so it can type for you")
        }

        await waitForModifiersUp()
        await bringToFront(target)
        // Esc while the text was being prepared cancels the task: nothing is typed or pasted after that (the loops above ended early on a cancel).
        if Task.isCancelled { return .copied(reason: "Cancelled") }

        let element = focusedElement(of: target.app)
        if let element, isPassword(element) {
            copy(text)
            return .copied(reason: "A password field is focused. Paste it yourself")
        }
        if let element, insertDirectly(text, into: element) { return .typed }
        paste(text)
        return .typed
    }

    /// Reviewed replies require a known empty selection in the captured app. Dictation/Replace retain their existing behavior.
    /// All waits finish before destination validation; no async work separates the final checks from insertion.
    func insertReviewed(_ text: String, into target: Target) async -> String {
        guard canType else { return "Accessibility is unavailable. Nothing was inserted; use Copy draft." }
        await waitForModifiersUp()
        guard !Task.isCancelled else { return "Insertion cancelled." }
        await bringToFront(target)
        guard !Task.isCancelled else { return "Insertion cancelled." }
        let modifiers: CGEventFlags = [.maskCommand, .maskAlternate, .maskControl, .maskShift]
        guard CGEventSource.flagsState(.combinedSessionState).intersection(modifiers).isEmpty else {
            return "Release the modifier keys before inserting. Nothing was inserted."
        }
        let app = target.app
        guard let app, !app.isTerminated,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else {
            return "ATOM could not focus \(target.name). Nothing was inserted; use Copy draft."
        }
        let element = focusedElement(of: app)
        let role = element.flatMap { string(kAXRoleAttribute, of: $0) }
        let secure = element.map(isPassword) ?? false
        let editable = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"].contains(role ?? "")
        let range = !secure ? element.flatMap(selectedRange) : nil
        if let block = ReplyInsertRule.destinationBlock(appName: target.name,
            appRunning: !app.isTerminated,
            frontmost: NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
            editable: editable, secure: secure, selectionLength: range?.length) { return block }
        guard let element, let range else { return "The destination is unavailable. Nothing was inserted; use Copy draft." }
        var owner: pid_t = 0
        guard AXUIElementGetPid(element, &owner) == .success, owner == app.processIdentifier else {
            return "The focused field changed apps. Nothing was inserted; use Copy draft."
        }
        var settable = DarwinBoolean(false)
        if AXUIElementIsAttributeSettable(element, kAXSelectedTextAttribute as CFString, &settable) == .success, settable.boolValue {
            guard let before = string(kAXValueAttribute, of: element), range.location <= (before as NSString).length else {
                return "ATOM could not verify the reply field. Nothing was inserted; use Copy draft."
            }
            let expected = (before as NSString).replacingCharacters(in: range, with: text)
            let status = AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFTypeRef)
            guard status == .success, string(kAXValueAttribute, of: element) == expected else {
                return "ATOM could not confirm insertion. Inspect the reply field before trying again; nothing was sent."
            }
            return "Inserted into \(target.name) at its cursor. Nothing was sent; review it there before sending."
        }
        // Apps without a selected-text setter retain paste support, but only after focus and empty-selection validation.
        paste(text)
        return "Paste requested in \(target.name). Review the reply field to confirm it arrived. Nothing was sent."
    }

    private func selectedRange(_ element: AXUIElement) -> NSRange? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &value) == .success,
              let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        let axValue = value as! AXValue
        guard AXValueGetType(axValue) == .cfRange else { return nil }
        var range = CFRange()
        guard AXValueGetValue(axValue, .cfRange, &range), range.location >= 0, range.length >= 0 else { return nil }
        return NSRange(location: range.location, length: range.length)
    }

    // MARK: - Waiting for the user's hands

    /// Waits until ⌘ ⌥ ⌃ ⇧ are physically up, at most `limit` seconds, so a held modifier cannot change the paste.
    func waitForModifiersUp(limit: Double = 0.8) async {
        let mask: CGEventFlags = [.maskCommand, .maskAlternate, .maskControl, .maskShift]
        let deadline = ProcessInfo.processInfo.systemUptime + limit
        while !CGEventSource.flagsState(.combinedSessionState).intersection(mask).isEmpty,
              ProcessInfo.processInfo.systemUptime < deadline, !Task.isCancelled {
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
              ProcessInfo.processInfo.systemUptime < deadline, !Task.isCancelled {
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
        // 2026-10-16 (code check): a secret copied with "Copy token" is marked concealed. Writing it back here made a new clipboard change, so the 60 s
        // timer and the clear at quit (both compare the change count) no longer recognised it, and the token stayed on the clipboard for good. A
        // concealed clipboard is cleared instead of restored.
        let heldSecret = saved.contains { $0[SecretClipboard.concealed] != nil }
        place(text, on: board)
        let ours = board.changeCount

        pressCommandV()

        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(500))
            guard board.changeCount == ours else { return }
            if heldSecret { board.clearContents() } else { Self.restore(saved, to: board) }
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

    // MARK: - Reading the selection (quick actions)

    /// The selected text of the focused element in `app`, through Accessibility; nil when there is none or the app does not say.
    func selectedText(of app: NSRunningApplication?) -> String? {
        guard canType, let element = focusedElement(of: app) else { return nil }
        return string(kAXSelectedTextAttribute, of: element)
    }

    /// The focused element of `app` is a password field.
    func focusIsSecure(of app: NSRunningApplication?) -> Bool {
        guard let element = focusedElement(of: app) else { return false }
        return isPassword(element)
    }

    /// Presses ⌘C in the app in front, waits a moment for the clipboard to change, reads the text, and puts the old clipboard back
    /// (every type). Nil when the clipboard did not change, which means nothing was selected. Keys ⌃⌥ still held would change the
    /// shortcut, so it waits for them first.
    func copySelection() async -> String? {
        guard canType else { return nil }
        await waitForModifiersUp()
        let board = NSPasteboard.general
        let saved = Self.snapshot(board)
        let heldSecret = saved.contains { $0[SecretClipboard.concealed] != nil }
        let before = board.changeCount
        pressCommandC()
        var waited = 0
        while board.changeCount == before, waited < 20, !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(20))
            waited += 1
        }
        guard board.changeCount != before else { return nil }
        let text = board.string(forType: .string)
        if heldSecret { board.clearContents() } else { Self.restore(saved, to: board) }
        return text
    }

    private func pressCommandC() {
        let source = CGEventSource(stateID: .hidSystemState)
        let cKey: CGKeyCode = 8
        for down in [true, false] {
            let event = CGEvent(keyboardEventSource: source, virtualKey: cKey, keyDown: down)
            event?.flags = .maskCommand
            event?.post(tap: .cghidEventTap)
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
