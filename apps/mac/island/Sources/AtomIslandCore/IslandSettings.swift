import Foundation
import Observation

/// The island's own settings (ADR-040): shortcuts, pet and sounds, stored in UserDefaults, one key per
/// setting. Runtime settings (provider, model) are kept by the runtime in `config/island.json`.
@MainActor @Observable
public final class IslandSettings {
    /// A shortcut the user changed: a new combo, or cleared (disabled). Absent = never set, so the default.
    private enum Override: Equatable {
        case combo(KeyCombo)
        case cleared
    }

    private static let clearedMarker = "cleared"
    static func shortcutKey(_ action: ShortcutAction) -> String { "atom.shortcut.\(action.rawValue)" }
    static let petKey = "atom.petEnabled"
    static let soundsKey = "atom.soundsEnabled"
    static let speakReportsKey = "atom.speech.reports"
    static let speakUpdatesKey = "atom.speech.updates"
    static let speechChimeKey = "atom.speech.chime"
    static let notifySoundKey = "atom.notify.sound"
    static let telegramPushKey = "atom.telegram.push"
    static let localApiKey = "atom.api.on"
    /// The user's choice for computer control. Absent: the runtime decides from .env (ATOM_COMPUTER).
    public static let computerOverrideKey = "atom.computer.override"
    static let notifyOffKey = "atom.notify.off"
    static let followUpKey = "atom.followUp"
    static let petSpotKey = "atom.petSpot"
    static let palSizeKey = "atom.wisp.size"
    static let palWanderKey = "atom.wisp.wander"
    static let palNapKey = "atom.wisp.nap"
    static let bubbleStayKey = "atom.bubble.stay"
    static let bubbleSizeKey = "atom.bubble.size"
    static let bubbleOpacityKey = "atom.bubble.opacity"
    static let themeKey = "atom.look.theme"
    static let sidebarKey = "atom.window.sidebar"
    static let sidebarHiddenKey = "atom.window.sidebarHidden"
    /// Set once the ADR-084 move to Lantern has run, so a later choice of Quiet Native sticks.
    static let lanternMoveKey = "atom.look.lanternDefault"
    /// Set once the ADR-086 move to Void has run, so a later choice of Lantern sticks.
    static let voidMoveKey = "atom.look.voidDefault"
    static let palReactsKey = "atom.wisp.reacts"
    static let palHomeDisplayKey = "atom.wisp.homeDisplay"
    static let tourDoneKey = "atom.tourDone"

    @ObservationIgnored private let defaults: UserDefaults
    /// Mirrors what is stored, so views observe changes.
    private var overrides: [ShortcutAction: Override] = [:]

    /// Shortcuts whose stored data could not be read at launch; their defaults apply. For the app to log.
    @ObservationIgnored public private(set) var unreadableShortcuts: [ShortcutAction] = []

    /// Increments on every change, so callers (e.g. the shortcut engine) can tell something changed.
    public private(set) var revision = 0

    /// After ATOM asks a question, listen for the answer without the Talk keys (ADR-067). Default off (ADR-106): one turn, then idle.
    public var followUpEnabled: Bool {
        didSet { save(followUpEnabled, Self.followUpKey) }
    }

    /// Pal notices you while ATOM is idle: eyes follow the pointer, small reactions to clicks (ADR-073). Default on.
    public var palReacts: Bool {
        didSet { save(palReacts, Self.palReactsKey) }
    }

    /// Which display Pal's walkway is on (ADR-078). Default the main display.
    public var palHomeDisplay: PalHomeDisplay {
        didSet { defaults.set(palHomeDisplay.storageValue, forKey: Self.palHomeDisplayKey); revision += 1 }
    }

    /// The first-run tour has run, or the user talked before it could (ADR-075). Default false.
    public var tourDone: Bool {
        didSet { save(tourDone, Self.tourDoneKey) }
    }

    /// Show the pet (ADR-042). Default on.
    public var petEnabled: Bool {
        didSet { save(petEnabled, Self.petKey) }
    }

    /// Where the user parked Pal: the point on the ground under it, in screen coordinates (x centred).
    /// Nil = not parked; Pal wanders the Dock walkway.
    public var petSpot: PetSpot? {
        didSet {
            if let petSpot {
                defaults.set([petSpot.x, petSpot.y], forKey: Self.petSpotKey)
            } else {
                defaults.removeObject(forKey: Self.petSpotKey)
            }
            revision += 1
        }
    }

    /// Where the window sidebar's pages sit (2026-10-15): Keshab drags them. Default is `SidebarLayout.standard`.
    public var sidebar: SidebarLayout { didSet { defaults.set(sidebar.storage, forKey: Self.sidebarKey) } }
    /// ADR-128: the window's left panel is hidden (⌥⌘H). Default shown.
    public var sidebarHidden: Bool { didSet { defaults.set(sidebarHidden, forKey: Self.sidebarHiddenKey) } }

    /// How big Pal is. Default medium (the original size).
    public var palSize: PalSize { didSet { store(palSize.rawValue, Self.palSizeKey) } }
    /// How much Pal floats about. Default normal.
    public var palWander: PalWander { didSet { store(palWander.rawValue, Self.palWanderKey) } }
    /// How long until Pal naps. Default 3 minutes.
    public var palNap: PalNap { didSet { store(palNap.rawValue, Self.palNapKey) } }
    /// How long the speech bubble stays after something finishes. Default 2 seconds.
    public var bubbleStay: BubbleStay { didSet { store(bubbleStay.rawValue, Self.bubbleStayKey) } }
    public var bubbleSize: BubbleSize { didSet { store(bubbleSize.rawValue, Self.bubbleSizeKey) } }
    public var bubbleOpacity: BubbleOpacity { didSet { store(bubbleOpacity.rawValue, Self.bubbleOpacityKey) } }
    /// How ATOM's surfaces look (ADR-057). Default Void (ADR-086).
    public var theme: AppTheme { didSet { store(theme.rawValue, Self.themeKey) } }

    /// Start and stop sounds. Default on.
    public var soundsEnabled: Bool {
        didSet { save(soundsEnabled, Self.soundsKey) }
    }

    /// ADR-091: ATOM says the team's reports aloud (with a chime). Off: they only show. Default on.
    public var speakReports: Bool {
        didSet { save(speakReports, Self.speakReportsKey) }
    }

    /// ADR-091: ATOM says timers and other updates aloud (with a chime). Off: they only show. Default on.
    public var speakUpdates: Bool {
        didSet { save(speakUpdates, Self.speakUpdatesKey) }
    }

    /// ADR-097: the chime before ATOM says a report, timer or update. Off: it only speaks. Default on.
    public var speechChime: Bool {
        didSet { save(speechChime, Self.speechChimeKey) }
    }

    /// ADR-097: ATOM's macOS notifications play the system sound. Off: they show without it. Default on.
    public var notificationSounds: Bool {
        didSet { save(notificationSounds, Self.notifySoundKey) }
    }

    /// ADR-098: ATOM sends Needs you, finished goals and schedule results to Telegram by itself. Default on.
    public var telegramPush: Bool {
        didSet { save(telegramPush, Self.telegramPushKey) }
    }

    /// ADR-098 item 5: the local HTTP API (127.0.0.1, token in data/api-token) listens. Default off.
    public var localApi: Bool {
        didSet { save(localApi, Self.localApiKey) }
    }

    /// ADR-054: the user's choice for computer control, from the switch in Settings → General. Nil until the user uses the
    /// switch; then the app starts the runtime with ATOM_COMPUTER set to it, which wins over .env.
    public var computerOverride: Bool? {
        didSet {
            if let value = computerOverride { defaults.set(value, forKey: Self.computerOverrideKey) } else { defaults.removeObject(forKey: Self.computerOverrideKey) }
        }
    }

    /// ADR-091: the kinds of notification turned off (all are on at first).
    public private(set) var notifyOff: Set<String> {
        didSet { defaults.set(notifyOff.sorted(), forKey: Self.notifyOffKey) }
    }

    public func notifies(_ kind: AppNotice.Kind) -> Bool { !notifyOff.contains(kind.rawValue) }

    public func setNotifies(_ kind: AppNotice.Kind, _ on: Bool) {
        if on { notifyOff.remove(kind.rawValue) } else { notifyOff.insert(kind.rawValue) }
    }

    static let dictationModeKey = "atom.dictation.mode"
    static let livePreviewKey = "atom.dictation.livePreview"
    static let removeFillersKey = "atom.dictation.removeFillers"

    /// How dictation starts and stops (ADR-050). Default: hold to talk, or tap to start and tap to finish.
    public var dictationMode: DictationMode {
        didSet { defaults.set(dictationMode.rawValue, forKey: Self.dictationModeKey); revision += 1 }
    }

    /// Show the words on screen while speaking. Default on.
    public var livePreview: Bool {
        didSet { save(livePreview, Self.livePreviewKey) }
    }

    /// Drop "um" and "uh" from dictated text. Default on.
    public var removeFillers: Bool {
        didSet { save(removeFillers, Self.removeFillersKey) }
    }

    /// The dictation settings as one value.
    public var dictationOptions: DictationOptions {
        DictationOptions(mode: dictationMode, livePreview: livePreview, removeFillers: removeFillers)
    }

    /// ADR-093: Pal is always the 2D pixel character, so there is no style, glow, lean or tucking away to choose.
    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        petEnabled = defaults.object(forKey: Self.petKey) as? Bool ?? true
        palReacts = defaults.object(forKey: Self.palReactsKey) as? Bool ?? true
        tourDone = defaults.bool(forKey: Self.tourDoneKey)
        palHomeDisplay = defaults.string(forKey: Self.palHomeDisplayKey).map(PalHomeDisplay.init(storageValue:)) ?? .main
        soundsEnabled = defaults.object(forKey: Self.soundsKey) as? Bool ?? true
        speakReports = defaults.object(forKey: Self.speakReportsKey) as? Bool ?? true
        speakUpdates = defaults.object(forKey: Self.speakUpdatesKey) as? Bool ?? true
        speechChime = defaults.object(forKey: Self.speechChimeKey) as? Bool ?? true
        notificationSounds = defaults.object(forKey: Self.notifySoundKey) as? Bool ?? true
        telegramPush = defaults.object(forKey: Self.telegramPushKey) as? Bool ?? true
        localApi = defaults.bool(forKey: Self.localApiKey)
        computerOverride = defaults.object(forKey: Self.computerOverrideKey) as? Bool
        notifyOff = Set(defaults.stringArray(forKey: Self.notifyOffKey) ?? [])
        followUpEnabled = defaults.object(forKey: Self.followUpKey) as? Bool ?? false
        palSize = Self.choice(defaults, Self.palSizeKey, .medium)
        palWander = Self.choice(defaults, Self.palWanderKey, .normal)
        palNap = Self.choice(defaults, Self.palNapKey, .minutes3)
        bubbleStay = Self.choice(defaults, Self.bubbleStayKey, .seconds2)
        bubbleSize = Self.choice(defaults, Self.bubbleSizeKey, .normal)
        bubbleOpacity = Self.choice(defaults, Self.bubbleOpacityKey, .normal)
        Self.moveToLanternOnce(defaults)
        Self.moveToVoidOnce(defaults)
        theme = Self.choice(defaults, Self.themeKey, .void)
        sidebar = SidebarLayout(storage: defaults.string(forKey: Self.sidebarKey))
        sidebarHidden = defaults.bool(forKey: Self.sidebarHiddenKey)
        dictationMode = (defaults.string(forKey: Self.dictationModeKey)).flatMap(DictationMode.init(rawValue:)) ?? .automatic
        livePreview = defaults.object(forKey: Self.livePreviewKey) as? Bool ?? true
        removeFillers = defaults.object(forKey: Self.removeFillersKey) as? Bool ?? true
        petSpot = Self.loadSpot(defaults)
        for action in ShortcutAction.allCases {
            switch Self.load(defaults, action) {
            case .some(.some(let override)): overrides[action] = override
            case .some(nil): unreadableShortcuts.append(action)
            case nil: break
            }
        }
        // `petSpot` is optional, so assigning it above counted as a change (its didSet ran): loading is not one.
        revision = 0
    }

    /// The shortcut for `action`: the user's choice, else the default. Nil = cleared by the user.
    public func shortcut(for action: ShortcutAction) -> KeyCombo? {
        switch overrides[action] {
        case .combo(let combo): combo
        case .cleared: nil
        case nil: action.defaultCombo
        }
    }

    /// Every action's current shortcut, without the cleared ones.
    public var shortcuts: [ShortcutAction: KeyCombo] {
        var all: [ShortcutAction: KeyCombo] = [:]
        for action in ShortcutAction.allCases {
            if let combo = shortcut(for: action) { all[action] = combo }
        }
        return all
    }

    /// Sets (or with nil, clears) a shortcut. Returns why it was refused; a refused shortcut is not stored.
    @discardableResult
    public func setShortcut(_ combo: KeyCombo?, for action: ShortcutAction) -> ShortcutProblem? {
        guard let combo else {
            defaults.set(Self.clearedMarker, forKey: Self.shortcutKey(action))
            overrides[action] = .cleared
            revision += 1
            return nil
        }
        var others = shortcuts
        others[action] = nil
        if let problem = validateShortcut(combo, for: action, others: others) { return problem }
        guard let data = try? JSONEncoder().encode(combo) else {
            preconditionFailure("KeyCombo could not be encoded") // plain values: cannot fail
        }
        defaults.set(data, forKey: Self.shortcutKey(action))
        overrides[action] = .combo(combo)
        revision += 1
        return nil
    }

    /// Back to the default shortcut.
    public func resetShortcut(for action: ShortcutAction) {
        defaults.removeObject(forKey: Self.shortcutKey(action))
        overrides[action] = nil
        revision += 1
    }

    public func resetAllShortcuts() {
        for action in ShortcutAction.allCases {
            defaults.removeObject(forKey: Self.shortcutKey(action))
        }
        overrides.removeAll()
        revision += 1
    }

    private func store(_ value: Int, _ key: String) {
        defaults.set(value, forKey: key)
        revision += 1
    }

    /// A stored choice, or `fallback` if there is none or it is not one of the cases (an older or edited value).
    private static func choice<C: RawRepresentable>(_ defaults: UserDefaults, _ key: String, _ fallback: C) -> C where C.RawValue == Int {
        (defaults.object(forKey: key) as? Int).flatMap(C.init(rawValue:)) ?? fallback
    }

    // "Reset this page" (ADR-079): each resets only the settings on its own Settings page. Shortcuts use
    // `resetAllShortcuts()`. The defaults here must match `init`; the tests compare against a fresh instance.

    /// Appearance: the theme.
    public func resetAppearance() {
        theme = .void
    }

    /// ADR-084: Lantern replaced Quiet Native as the default. A stored Quiet Native cannot be told apart from the
    /// old default (choosing it and "Reset this page" both stored it), so it moves to Lantern once; choosing
    /// Quiet Native again afterwards is kept. Other stored themes are left as they are.
    private static func moveToLanternOnce(_ defaults: UserDefaults) {
        guard !defaults.bool(forKey: lanternMoveKey) else { return }
        defaults.set(true, forKey: lanternMoveKey)
        if defaults.object(forKey: themeKey) as? Int == AppTheme.native.rawValue {
            defaults.set(AppTheme.lantern.rawValue, forKey: themeKey)
        }
    }

    /// ADR-086: Void replaced Lantern as the default. Lantern was only ever stored by the ADR-084 move above, by
    /// "Reset this page" or by picking it, and these cannot be told apart, so a stored Lantern moves to Void once (as
    /// Quiet Native moved to Lantern); picking Lantern again afterwards is kept. Lantern Day and the rest are kept.
    /// Runs after `moveToLanternOnce`, so a Quiet Native left from before both moves also lands on Void.
    private static func moveToVoidOnce(_ defaults: UserDefaults) {
        guard !defaults.bool(forKey: voidMoveKey) else { return }
        defaults.set(true, forKey: voidMoveKey)
        if defaults.object(forKey: themeKey) as? Int == AppTheme.lantern.rawValue {
            defaults.set(AppTheme.void.rawValue, forKey: themeKey)
        }
    }

    /// Dictation: how it starts and stops, the live preview and filler removal.
    public func resetDictation() {
        dictationMode = .automatic; livePreview = true; removeFillers = true
    }

    /// Pal, its speech bubble and the panel. "Show Pal" stays as it is: turning Pal on or off is the
    /// controller's job (`IslandModel.setPet`), and a reset should not make Pal appear or vanish.
    public func resetPal() {
        palSize = .medium; palWander = .normal; palNap = .minutes3
        palReacts = true; palHomeDisplay = .main
        bubbleStay = .seconds2; bubbleSize = .normal; bubbleOpacity = .normal
    }

    private func save(_ value: Bool, _ key: String) {
        defaults.set(value, forKey: key)
        revision += 1
    }

    /// A stored spot, or nil if there is none or it is unreadable (two finite numbers).
    private static func loadSpot(_ defaults: UserDefaults) -> PetSpot? {
        guard let values = defaults.array(forKey: petSpotKey) as? [Double], values.count == 2,
              values.allSatisfy(\.isFinite) else { return nil }
        return PetSpot(x: values[0], y: values[1])
    }

    /// The stored override: nil = never set; `.some(nil)` = unreadable, so the default applies.
    private static func load(_ defaults: UserDefaults, _ action: ShortcutAction) -> Override?? {
        guard let stored = defaults.object(forKey: shortcutKey(action)) else { return nil }
        if let marker = stored as? String, marker == clearedMarker { return .some(.cleared) }
        if let data = stored as? Data, let combo = try? JSONDecoder().decode(KeyCombo.self, from: data) {
            return .some(.combo(combo))
        }
        return .some(nil)
    }
}
