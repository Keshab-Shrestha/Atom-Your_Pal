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

    /// Start and stop sounds. Default on.
    public var soundsEnabled: Bool {
        didSet { save(soundsEnabled, Self.soundsKey) }
    }

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        petEnabled = defaults.object(forKey: Self.petKey) as? Bool ?? true
        soundsEnabled = defaults.object(forKey: Self.soundsKey) as? Bool ?? true
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
