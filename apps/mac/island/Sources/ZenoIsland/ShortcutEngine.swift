import AppKit
import Carbon.HIToolbox
import Observation
import ZenoIslandCore

/// Listens for ZENO's shortcuts in every app (ADR-040) and reports them as `ShortcutTrigger`s.
///
/// - Chords with an ordinary key (⌃⌥Z, Esc): Carbon system hot keys. No permission needed, and the key does
///   not reach the app in front. Cancel (Esc) is registered only while ZENO is busy, so Esc works normally
///   everywhere else.
/// - Holds of modifiers alone (⌃⌥, Right ⌥) and anything with fn: a listen-only event tap feeding
///   `ShortcutMatcher`. It needs Input Monitoring and never blocks or changes a key.
///
/// Shortcuts follow Settings at once and are paused while the recorder is recording.
@MainActor @Observable
final class ShortcutEngine {
    /// Input Monitoring is granted, so holds work.
    private(set) var canTrackKeys = false

    @ObservationIgnored var onTrigger: (ShortcutTrigger) -> Void = { _ in }
    /// Development tracing (`ZENO_ISLAND_TRACE=1`): every key input the tap sees.
    @ObservationIgnored var trace: (String) -> Void = { _ in }
    @ObservationIgnored private let settings: IslandSettings
    @ObservationIgnored private let recorder: ShortcutRecorder
    @ObservationIgnored private let log: (String, [String: Any]) -> Void
    /// Dictation starts after 80 ms, not Talk's 200 ms: the first words must not be lost (ADR-047).
    @ObservationIgnored private var matcher = ShortcutMatcher(armDelays: [.dictate: 0.08])
    @ObservationIgnored private var tap: CFMachPort?
    @ObservationIgnored private var tapSource: CFRunLoopSource?
    @ObservationIgnored private var tick: Timer?
    @ObservationIgnored private var permissionCheck: Timer?
    @ObservationIgnored private var hotKeys: [EventHotKeyRef] = []
    @ObservationIgnored private var hotKeyHandler: EventHandlerRef?
    /// Hot key id → action, for the registered chords.
    @ObservationIgnored private var hotKeyActions: [UInt32: ShortcutAction] = [:]
    @ObservationIgnored private var registeredSignature = ""
    /// Cancel (Esc) is live only while ZENO is listening, thinking or speaking.
    @ObservationIgnored private var cancelActive = false

    /// "ZENO" as a four-character code, identifying ZENO's hot keys.
    private static let signature: OSType = 0x5A_45_4E_4F

    init(settings: IslandSettings, recorder: ShortcutRecorder, log: @escaping (String, [String: Any]) -> Void) {
        self.settings = settings
        self.recorder = recorder
        self.log = log
    }

    func start() {
        installHotKeyHandler()
        canTrackKeys = CGPreflightListenEventAccess()
        if canTrackKeys { installTap() } else { watchForPermission() }
        apply()
        observeChanges()
    }

    func stop() {
        unregisterHotKeys()
        removeTap()
        tick?.invalidate()
        permissionCheck?.invalidate()
    }

    /// Cancel is live only while ZENO is busy.
    func setBusy(_ busy: Bool) {
        guard busy != cancelActive else { return }
        cancelActive = busy
        apply()
    }

    /// Asks macOS for Input Monitoring (adds ZENO to the list), then opens the pane so it can be switched on.
    func requestKeyAccess() {
        if !CGRequestListenEventAccess() {
            let pane = "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ListenEvent"
            if let url = URL(string: pane) { NSWorkspace.shared.open(url) }
        }
        watchForPermission()
    }

    // MARK: - Following settings and the recorder

    private func observeChanges() {
        withObservationTracking {
            _ = settings.revision
            _ = recorder.isRecording
        } onChange: { [weak self] in
            // Called before the change lands; apply on the next turn of the run loop.
            onMain {
                self?.apply()
                self?.observeChanges()
            }
        }
    }

    /// Re-registers hot keys and updates the matcher from Settings.
    private func apply() {
        let paused = recorder.isRecording
        var active = paused ? [:] : settings.shortcuts
        if !cancelActive { active[.cancel] = nil }

        let tracked = active.filter { ShortcutMatcher.needsKeyTracking($0.value) }
        let chords = active.filter { !ShortcutMatcher.needsKeyTracking($0.value) }
        for trigger in matcher.setShortcuts(tracked) { onTrigger(trigger) }
        registerHotKeys(chords)
        scheduleTick()
    }

    // MARK: - System hot keys (chords)

    private func installHotKeyHandler() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let me = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let event, let context else { return OSStatus(eventNotHandledErr) }
            var id = EventHotKeyID()
            let status = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                                           nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
            guard status == noErr else { return status }
            let engine = Unmanaged<ShortcutEngine>.fromOpaque(context).takeUnretainedValue()
            let number = id.id
            MainActor.assumeIsolated { engine.hotKeyPressed(number) }
            return noErr
        }, 1, &spec, me, &hotKeyHandler)
    }

    private func hotKeyPressed(_ number: UInt32) {
        guard let action = hotKeyActions[number] else { return }
        // A chord while a modifier hold is in progress is "another key": it spoils the hold.
        for trigger in matcher.handle(.otherKey, at: ProcessInfo.processInfo.systemUptime) { onTrigger(trigger) }
        onTrigger(.pressed(action))
    }

    private func registerHotKeys(_ chords: [ShortcutAction: KeyCombo]) {
        let signature = chords.sorted { $0.key.rawValue < $1.key.rawValue }
            .map { "\($0.key.rawValue)=\($0.value.modifiers.rawValue):\($0.value.keyCode ?? 0)" }.joined(separator: ",")
        guard signature != registeredSignature else { return }
        unregisterHotKeys()
        registeredSignature = signature
        for (index, (action, combo)) in chords.sorted(by: { $0.key.rawValue < $1.key.rawValue }).enumerated() {
            guard let keyCode = combo.keyCode else { continue }
            let number = UInt32(index + 1)
            var ref: EventHotKeyRef?
            let status = RegisterEventHotKey(UInt32(keyCode), Self.carbonModifiers(combo.modifiers),
                                             EventHotKeyID(signature: Self.signature, id: number),
                                             GetApplicationEventTarget(), 0, &ref)
            if status == noErr, let ref {
                hotKeys.append(ref)
                hotKeyActions[number] = action
            } else {
                // Another app holds this chord.
                log("shortcut.register_failed", ["action": action.rawValue, "shortcut": combo.display, "status": Int(status)])
            }
        }
    }

    private func unregisterHotKeys() {
        for ref in hotKeys { UnregisterEventHotKey(ref) }
        hotKeys = []
        hotKeyActions = [:]
        registeredSignature = ""
    }

    private static func carbonModifiers(_ modifiers: Modifiers) -> UInt32 {
        var result = 0
        if modifiers.contains(.control) { result |= controlKey }
        if modifiers.contains(.option) { result |= optionKey }
        if modifiers.contains(.shift) { result |= shiftKey }
        if modifiers.contains(.command) { result |= cmdKey }
        return UInt32(result)
    }

    // MARK: - Event tap (holds)

    private func installTap() {
        guard tap == nil else { return }
        let mask = CGEventMask(1 << CGEventType.flagsChanged.rawValue)
            | CGEventMask(1 << CGEventType.keyDown.rawValue)
            | CGEventMask(1 << CGEventType.keyUp.rawValue)
        let me = Unmanaged.passUnretained(self).toOpaque()
        guard let port = CGEvent.tapCreate(
            tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask,
            callback: { _, type, event, context in
                guard let context else { return Unmanaged.passUnretained(event) }
                let engine = Unmanaged<ShortcutEngine>.fromOpaque(context).takeUnretainedValue()
                let input = ShortcutEngine.input(type, event)
                // The tap's run loop source is on the main run loop.
                MainActor.assumeIsolated { engine.received(input, type: type) }
                return Unmanaged.passUnretained(event)
            }, userInfo: me)
        else {
            log("shortcut.tap_failed", [:])
            canTrackKeys = false
            watchForPermission()
            return
        }
        tap = port
        let source = CFMachPortCreateRunLoopSource(nil, port, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        tapSource = source
        CGEvent.tapEnable(tap: port, enable: true)
        canTrackKeys = true
        log("shortcut.tap_started", [:])
    }

    private func removeTap() {
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        if let tapSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), tapSource, .commonModes) }
        tap = nil
        tapSource = nil
    }

    nonisolated private static func input(_ type: CGEventType, _ event: CGEvent) -> KeyInput? {
        let keyCode = UInt16(event.getIntegerValueField(.keyboardEventKeycode))
        let modifiers = modifiers(event.flags)
        switch type {
        case .flagsChanged: return .flagsChanged(keyCode: keyCode, modifiers: modifiers)
        case .keyDown: return .keyDown(keyCode: keyCode, modifiers: modifiers, isRepeat: event.getIntegerValueField(.keyboardEventAutorepeat) != 0)
        case .keyUp: return .keyUp(keyCode: keyCode)
        case .tapDisabledByTimeout, .tapDisabledByUserInput: return .reset
        default: return nil
        }
    }

    nonisolated private static func modifiers(_ flags: CGEventFlags) -> Modifiers {
        var result: Modifiers = []
        if flags.contains(.maskControl) { result.insert(.control) }
        if flags.contains(.maskAlternate) { result.insert(.option) }
        if flags.contains(.maskShift) { result.insert(.shift) }
        if flags.contains(.maskCommand) { result.insert(.command) }
        if flags.contains(.maskSecondaryFn) { result.insert(.function) }
        return result
    }

    private func received(_ input: KeyInput?, type: CGEventType) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            // macOS turned the tap off (it was slow, or secure input): turn it back on and forget held keys.
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            log("shortcut.tap_reenabled", [:])
        }
        guard let input else { return }
        trace("key \(input)")
        for trigger in matcher.handle(input, at: ProcessInfo.processInfo.systemUptime) { onTrigger(trigger) }
        scheduleTick()
    }

    /// Wakes up when a held shortcut is due to start.
    private func scheduleTick() {
        tick?.invalidate()
        tick = nil
        guard let deadline = matcher.nextDeadline else { return }
        let delay = max(0, deadline - ProcessInfo.processInfo.systemUptime) + 0.002
        let timer = Timer(timeInterval: delay, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                for trigger in self.matcher.tick(at: ProcessInfo.processInfo.systemUptime) { self.onTrigger(trigger) }
                self.scheduleTick()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        tick = timer
    }

    // MARK: - Permission

    /// Checks every 2 s until Input Monitoring is switched on, then starts the tap. No restart needed.
    private func watchForPermission() {
        guard permissionCheck == nil else { return }
        let timer = Timer(timeInterval: 2, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, CGPreflightListenEventAccess() else { return }
                self.permissionCheck?.invalidate()
                self.permissionCheck = nil
                self.log("shortcut.access_granted", [:])
                self.installTap()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        permissionCheck = timer
    }
}
