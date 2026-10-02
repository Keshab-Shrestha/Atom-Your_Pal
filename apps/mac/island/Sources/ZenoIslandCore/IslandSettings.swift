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
    static let petSpotKey = "zeno.petSpot"
    static let wispHideKey = "zeno.wispHideAfter"
    static let wispSizeKey = "zeno.wisp.size"
    static let wispGlowKey = "zeno.wisp.glow"
    static let wispWanderKey = "zeno.wisp.wander"
    static let wispNapKey = "zeno.wisp.nap"
    static let bubbleStayKey = "zeno.bubble.stay"
    static let bubbleSizeKey = "zeno.bubble.size"
    static let bubbleOpacityKey = "zeno.bubble.opacity"
    static let panelSizeKey = "zeno.panel.size"
    static let panelBackgroundKey = "zeno.panel.background"

    @ObservationIgnored private let defaults: UserDefaults
    /// Mirrors what is stored, so views observe changes.
    private var overrides: [ShortcutAction: Override] = [:]

    /// Shortcuts whose stored data could not be read at launch; their defaults apply. For the app to log.
    @ObservationIgnored public private(set) var unreadableShortcuts: [ShortcutAction] = []

    /// Increments on every change, so callers (e.g. the shortcut engine) can tell something changed.
    public private(set) var revision = 0

    /// Show the pet (ADR-042). Default on.
    public var petEnabled: Bool {
        didSet { save(petEnabled, Self.petKey) }
    }

    /// Where the user parked Wisp: the point on the ground under it, in screen coordinates (x centred).
    /// Nil = not parked; Wisp wanders the Dock walkway.
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

    /// How long Wisp sits idle before it tucks itself against a side edge (ADR-051). Default one minute.
    public var wispHideAfter: WispHideTimeout {
        didSet { defaults.set(wispHideAfter.rawValue, forKey: Self.wispHideKey); revision += 1 }
    }

    /// How big Wisp is. Default medium (the original size).
    public var wispSize: WispSize { didSet { store(wispSize.rawValue, Self.wispSizeKey) } }
    /// The halo's strength. Default normal.
    public var wispGlow: WispGlow { didSet { store(wispGlow.rawValue, Self.wispGlowKey) } }
    /// How much Wisp floats about. Default normal.
    public var wispWander: WispWander { didSet { store(wispWander.rawValue, Self.wispWanderKey) } }
    /// How long until Wisp naps. Default 3 minutes.
    public var wispNap: WispNap { didSet { store(wispNap.rawValue, Self.wispNapKey) } }
    /// How long the speech bubble stays after something finishes. Default 2 seconds.
    public var bubbleStay: BubbleStay { didSet { store(bubbleStay.rawValue, Self.bubbleStayKey) } }
    public var bubbleSize: BubbleSize { didSet { store(bubbleSize.rawValue, Self.bubbleSizeKey) } }
    public var bubbleOpacity: BubbleOpacity { didSet { store(bubbleOpacity.rawValue, Self.bubbleOpacityKey) } }
    public var panelSize: PanelSize { didSet { store(panelSize.rawValue, Self.panelSizeKey) } }
    public var panelBackground: PanelBackground { didSet { store(panelBackground.rawValue, Self.panelBackgroundKey) } }

    /// Start and stop sounds. Default on.
    public var soundsEnabled: Bool {
        didSet { save(soundsEnabled, Self.soundsKey) }
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

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        petEnabled = defaults.object(forKey: Self.petKey) as? Bool ?? true
        soundsEnabled = defaults.object(forKey: Self.soundsKey) as? Bool ?? true
        wispHideAfter = (defaults.object(forKey: Self.wispHideKey) as? Int).flatMap(WispHideTimeout.init(rawValue:)) ?? .minute1
        wispSize = Self.choice(defaults, Self.wispSizeKey, .medium)
        wispGlow = Self.choice(defaults, Self.wispGlowKey, .normal)
        wispWander = Self.choice(defaults, Self.wispWanderKey, .normal)
        wispNap = Self.choice(defaults, Self.wispNapKey, .minutes3)
        bubbleStay = Self.choice(defaults, Self.bubbleStayKey, .seconds2)
        bubbleSize = Self.choice(defaults, Self.bubbleSizeKey, .normal)
        bubbleOpacity = Self.choice(defaults, Self.bubbleOpacityKey, .normal)
        panelSize = Self.choice(defaults, Self.panelSizeKey, .normal)
        panelBackground = Self.choice(defaults, Self.panelBackgroundKey, .glass)
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

    /// Puts every look and behaviour setting (Wisp, bubble, panel) back to its default. Shortcuts, dictation,
    /// the model and the on/off switches are left alone.
    public func resetLook() {
        wispSize = .medium; wispGlow = .normal; wispWander = .normal; wispNap = .minutes3
        wispHideAfter = .minute1
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
