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
    static func shortcutKey(_ action: ShortcutAction) -> String { "zeno.shortcut.\(action.rawValue)" }
    static let petKey = "zeno.petEnabled"
    static let soundsKey = "zeno.soundsEnabled"
    static let speakReportsKey = "zeno.speech.reports"
    static let speakUpdatesKey = "zeno.speech.updates"
    static let notifyOffKey = "zeno.notify.off"
    static let followUpKey = "zeno.followUp"
    static let petSpotKey = "zeno.petSpot"
    static let palHideKey = "zeno.wispHideAfter"
    static let palSizeKey = "zeno.wisp.size"
    static let palLeanKey = "zeno.wisp.lean"
    static let palGlowKey = "zeno.wisp.glow"
    static let palWanderKey = "zeno.wisp.wander"
    static let palNapKey = "zeno.wisp.nap"
    static let bubbleStayKey = "zeno.bubble.stay"
    static let bubbleSizeKey = "zeno.bubble.size"
    static let bubbleOpacityKey = "zeno.bubble.opacity"
    static let panelSizeKey = "zeno.panel.size"
    static let panelBackgroundKey = "zeno.panel.background"
    static let themeKey = "zeno.look.theme"
    /// Set once the ADR-084 move to Lantern has run, so a later choice of Quiet Native sticks.
    static let lanternMoveKey = "zeno.look.lanternDefault"
    /// Set once the ADR-086 move to Void has run, so a later choice of Lantern sticks.
    static let voidMoveKey = "zeno.look.voidDefault"
    static let palStyleKey = "zeno.wisp.style"
    static let avatarMoveKey = "zeno.wisp.avatarDefault"
    static let characterMoveKey = "zeno.pal.characterDefault"
    static let palReactsKey = "zeno.wisp.reacts"
    static let palHomeDisplayKey = "zeno.wisp.homeDisplay"
    static let tourDoneKey = "zeno.tourDone"

    @ObservationIgnored private let defaults: UserDefaults
    /// Mirrors what is stored, so views observe changes.
    private var overrides: [ShortcutAction: Override] = [:]

    /// Shortcuts whose stored data could not be read at launch; their defaults apply. For the app to log.
    @ObservationIgnored public private(set) var unreadableShortcuts: [ShortcutAction] = []

    /// Increments on every change, so callers (e.g. the shortcut engine) can tell something changed.
    public private(set) var revision = 0

    /// After ZENO asks a question, listen for the answer without the Talk keys (ADR-067). Default on.
    public var followUpEnabled: Bool {
        didSet { save(followUpEnabled, Self.followUpKey) }
    }

    /// Pal notices you while ZENO is idle: eyes follow the pointer, small reactions to clicks (ADR-073). Default on.
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

    /// How long Pal sits idle before it tucks itself against a side edge (ADR-051). Default one minute.
    public var palHideAfter: PalHideTimeout {
        didSet { defaults.set(palHideAfter.rawValue, forKey: Self.palHideKey); revision += 1 }
    }

    /// How big Pal is. Default medium (the original size).
    public var palSize: PalSize { didSet { store(palSize.rawValue, Self.palSizeKey) } }
    /// How far Pal leans while hiding at an edge. Default normal (42 degrees).
    public var palLean: PalLean { didSet { store(palLean.rawValue, Self.palLeanKey) } }
    /// The halo's strength. Default normal.
    public var palGlow: PalGlow { didSet { store(palGlow.rawValue, Self.palGlowKey) } }
    /// How much Pal floats about. Default normal.
    public var palWander: PalWander { didSet { store(palWander.rawValue, Self.palWanderKey) } }
    /// How long until Pal naps. Default 3 minutes.
    public var palNap: PalNap { didSet { store(palNap.rawValue, Self.palNapKey) } }
    /// How long the speech bubble stays after something finishes. Default 2 seconds.
    public var bubbleStay: BubbleStay { didSet { store(bubbleStay.rawValue, Self.bubbleStayKey) } }
    public var bubbleSize: BubbleSize { didSet { store(bubbleSize.rawValue, Self.bubbleSizeKey) } }
    public var bubbleOpacity: BubbleOpacity { didSet { store(bubbleOpacity.rawValue, Self.bubbleOpacityKey) } }
    public var panelSize: PanelSize { didSet { store(panelSize.rawValue, Self.panelSizeKey) } }
    public var panelBackground: PanelBackground { didSet { store(panelBackground.rawValue, Self.panelBackgroundKey) } }
    /// How ZENO's surfaces look (ADR-057). Default Void (ADR-086).
    public var theme: AppTheme { didSet { store(theme.rawValue, Self.themeKey) } }
    /// How Pal is drawn (ADR-057). Default Orb, or Avatar when Pal's avatar images exist (ADR-085).
    public var palStyle: PalStyle { didSet { store(palStyle.rawValue, Self.palStyleKey) } }

    /// Start and stop sounds. Default on.
    public var soundsEnabled: Bool {
        didSet { save(soundsEnabled, Self.soundsKey) }
    }

    /// ADR-091: ZENO says the team's reports aloud (with a chime). Off: they only show. Default on.
    public var speakReports: Bool {
        didSet { save(speakReports, Self.speakReportsKey) }
    }

    /// ADR-091: ZENO says timers and other updates aloud (with a chime). Off: they only show. Default on.
    public var speakUpdates: Bool {
        didSet { save(speakUpdates, Self.speakUpdatesKey) }
    }

    /// ADR-091: the kinds of notification turned off (all are on at first).
    public private(set) var notifyOff: Set<String> {
        didSet { defaults.set(notifyOff.sorted(), forKey: Self.notifyOffKey) }
    }

    public func notifies(_ kind: AppNotice.Kind) -> Bool { !notifyOff.contains(kind.rawValue) }

    public func setNotifies(_ kind: AppNotice.Kind, _ on: Bool) {
        if on { notifyOff.remove(kind.rawValue) } else { notifyOff.insert(kind.rawValue) }
    }

    static let dictationModeKey = "zeno.dictation.mode"
    static let livePreviewKey = "zeno.dictation.livePreview"
    static let removeFillersKey = "zeno.dictation.removeFillers"

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

    /// The default Pal style: its character (ADR-089).
    private let defaultPalStyle: PalStyle

    /// `palAvatar`: Pal's avatar images exist (the app checks for `pal/neutral.png`).
    public init(defaults: UserDefaults = .standard, palAvatar: Bool = false) {
        self.defaults = defaults
        defaultPalStyle = .character
        petEnabled = defaults.object(forKey: Self.petKey) as? Bool ?? true
        palReacts = defaults.object(forKey: Self.palReactsKey) as? Bool ?? true
        tourDone = defaults.bool(forKey: Self.tourDoneKey)
        palHomeDisplay = defaults.string(forKey: Self.palHomeDisplayKey).map(PalHomeDisplay.init(storageValue:)) ?? .main
        soundsEnabled = defaults.object(forKey: Self.soundsKey) as? Bool ?? true
        speakReports = defaults.object(forKey: Self.speakReportsKey) as? Bool ?? true
        speakUpdates = defaults.object(forKey: Self.speakUpdatesKey) as? Bool ?? true
        notifyOff = Set(defaults.stringArray(forKey: Self.notifyOffKey) ?? [])
        followUpEnabled = defaults.object(forKey: Self.followUpKey) as? Bool ?? true
        palHideAfter = (defaults.object(forKey: Self.palHideKey) as? Int).flatMap(PalHideTimeout.init(rawValue:)) ?? .minute1
        palSize = Self.choice(defaults, Self.palSizeKey, .medium)
        palLean = Self.choice(defaults, Self.palLeanKey, .normal)
        palGlow = Self.choice(defaults, Self.palGlowKey, .normal)
        palWander = Self.choice(defaults, Self.palWanderKey, .normal)
        palNap = Self.choice(defaults, Self.palNapKey, .minutes3)
        bubbleStay = Self.choice(defaults, Self.bubbleStayKey, .seconds2)
        bubbleSize = Self.choice(defaults, Self.bubbleSizeKey, .normal)
        bubbleOpacity = Self.choice(defaults, Self.bubbleOpacityKey, .normal)
        panelSize = Self.choice(defaults, Self.panelSizeKey, .normal)
        panelBackground = Self.choice(defaults, Self.panelBackgroundKey, .glass)
        Self.moveToLanternOnce(defaults)
        Self.moveToVoidOnce(defaults)
        theme = Self.choice(defaults, Self.themeKey, .void)
        if palAvatar { Self.moveToAvatarOnce(defaults) }
        Self.moveToCharacterOnce(defaults)
        palStyle = Self.choice(defaults, Self.palStyleKey, defaultPalStyle)
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

    /// Appearance: the theme and Pal's style.
    public func resetAppearance() {
        theme = .void; palStyle = defaultPalStyle
    }

    /// ADR-089: Pal takes its new character once, whatever style was stored; choosing another afterwards is kept.
    private static func moveToCharacterOnce(_ defaults: UserDefaults) {
        guard !defaults.bool(forKey: characterMoveKey) else { return }
        defaults.set(true, forKey: characterMoveKey)
        defaults.set(PalStyle.character.rawValue, forKey: palStyleKey)
    }

    /// ADR-085: the first launch with Pal's avatar images, a stored Orb (the old default, which "Reset this page"
    /// also stores) moves to Avatar once; choosing Orb again afterwards is kept. Ghost and Companion are kept.
    private static func moveToAvatarOnce(_ defaults: UserDefaults) {
        guard !defaults.bool(forKey: avatarMoveKey) else { return }
        defaults.set(true, forKey: avatarMoveKey)
        if defaults.object(forKey: palStyleKey) as? Int == PalStyle.orb.rawValue {
            defaults.set(PalStyle.avatar.rawValue, forKey: palStyleKey)
        }
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
        palSize = .medium; palGlow = .normal; palWander = .normal; palNap = .minutes3
        palHideAfter = .minute1; palLean = .normal; palReacts = true; palHomeDisplay = .main
        bubbleStay = .seconds2; bubbleSize = .normal; bubbleOpacity = .normal
        panelSize = .normal; panelBackground = .glass
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
