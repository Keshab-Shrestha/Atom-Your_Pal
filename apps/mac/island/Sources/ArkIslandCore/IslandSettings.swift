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
    static func shortcutKey(_ action: ShortcutAction) -> String { "ark.shortcut.\(action.rawValue)" }
    static let petKey = "ark.petEnabled"
    static let newChatAccessKey = "ark.defaults.chatAccess"
    static let newChatEffortKey = "ark.defaults.chatEffort"
    static let newChatPlaceKey = "ark.defaults.chatPlace"
    static let startPageKey = "ark.defaults.startPage"
    static let lastWindowPageKey = "ark.defaults.lastPage"
    static let dashboardRangeKey = "ark.defaults.dashboardRange"
    static let studioLightsKey = "ark.board.studioLights"
    static let soundsKey = "ark.soundsEnabled"
    static let speakReportsKey = "ark.speech.reports"
    static let speakUpdatesKey = "ark.speech.updates"
    static let speechChimeKey = "ark.speech.chime"
    static let notifySoundKey = "ark.notify.sound"
    static let telegramPushKey = "ark.telegram.push"
    static let localApiKey = "ark.api.on"
    /// The user's choice for computer control. Absent: the runtime decides from .env (ARK_COMPUTER).
    public static let computerOverrideKey = "ark.computer.override"
    static let computerForegroundKey = "ark.computer.foreground"
    static let notifyOffKey = "ark.notify.off"
    static let followUpKey = "ark.followUp"
    static let petSpotKey = "ark.petSpot"
    static let palSizeKey = "ark.wisp.size"
    static let palWanderKey = "ark.wisp.wander"
    static let palNapKey = "ark.wisp.nap"
    static let bubbleStayKey = "ark.bubble.stay"
    static let bubbleSizeKey = "ark.bubble.size"
    static let bubbleOpacityKey = "ark.bubble.opacity"
    static let textSizeKey = "ark.look.textSize"
    static let typefaceKey = "ark.look.typeface"
    static let themeKey = "ark.look.theme"
    static let glassKey = "ark.look.glass"
    static let sidebarKey = "ark.window.sidebar"
    static let projectFilterKey = "ark.window.projectFilter"
    static let workspaceWidthKey = "ark.window.workspaceWidth"
    static let workspaceSurfaceKey = "ark.window.workspaceSurface"
    static let sidebarHiddenKey = "ark.window.sidebarHidden"
    static let favoriteModelsKey = "ark.models.favorites"
    static let replyExamplesKey = "ark.reply.writingExamples"
    static let palReactsKey = "ark.wisp.reacts"
    static let palHomeDisplayKey = "ark.wisp.homeDisplay"
    static let tourDoneKey = "ark.tourDone"
    static let ownerNameKey = "ark.owner.name"
    static let chatSeenKey = "ark.chat.seen"

    @ObservationIgnored private let defaults: UserDefaults
    /// Mirrors what is stored, so views observe changes.
    private var overrides: [ShortcutAction: Override] = [:]
    /// Only explicit Save persists examples. Reading them never opts a draft into sharing them.
    public var replyWritingExamples: String {
        didSet {
            if replyWritingExamples.isEmpty { defaults.removeObject(forKey: Self.replyExamplesKey) }
            else { defaults.set(replyWritingExamples, forKey: Self.replyExamplesKey) }
        }
    }

    /// Shortcuts whose stored data could not be read at launch; their defaults apply. For the app to log.
    @ObservationIgnored public private(set) var unreadableShortcuts: [ShortcutAction] = []

    /// Increments on every change, so callers (e.g. the shortcut engine) can tell something changed.
    public private(set) var revision = 0

    /// After ARK asks a question, listen for the answer without the Talk keys (ADR-067). Default off (ADR-106): one turn, then idle.
    public var followUpEnabled: Bool {
        didSet { save(followUpEnabled, Self.followUpKey) }
    }

    /// Pal notices you while ARK is idle: eyes follow the pointer, small reactions to clicks (ADR-073). Default on.
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

    /// ADR-271: the name ARK calls its owner. Nil until the first-run window saves one; the runtime gets it with `owner.set`.
    /// A set value is cleaned (`OwnerName.clean`); an empty one is not stored.
    public var ownerName: String? {
        didSet {
            let cleaned = ownerName.flatMap(OwnerName.clean)
            if cleaned != ownerName { ownerName = cleaned; return }
            if let cleaned { defaults.set(cleaned, forKey: Self.ownerNameKey) } else { defaults.removeObject(forKey: Self.ownerNameKey) }
            revision += 1
        }
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

    /// Sidebar visibility only; selecting a filter grants no project/file access.
    public var projectFilter: String? { didSet { defaults.set(projectFilter, forKey: Self.projectFilterKey) } }

    /// Presentation only: no paths, previews, grants or Undo tokens are stored here.
    public var workspaceWidth: Double { didSet { defaults.set(WorkspacePaneLayout.preference(workspaceWidth), forKey: Self.workspaceWidthKey) } }
    public var workspaceSurface: String { didSet { defaults.set(WorkspaceSurface(rawValue: workspaceSurface)?.rawValue ?? "home", forKey: Self.workspaceSurfaceKey) } }

    /// ADR-274: what each chat held when it was last on screen, for Catch me up. No message text; this Mac only.
    public var chatSeen: [String: ChatSeen] {
        didSet { if chatSeen != oldValue { defaults.set(try? JSONEncoder().encode(chatSeen), forKey: Self.chatSeenKey) } }
    }

    /// Local picker bookmarks only. They do not select a provider/model or grant access.
    public private(set) var favoriteModels: Set<String> {
        didSet { defaults.set(favoriteModels.sorted(), forKey: Self.favoriteModelsKey) }
    }

    public func toggleFavoriteModel(provider: String, model: String) {
        let key = ModelPickerEntry.key(provider: provider, model: model)
        guard key.count <= 256 else { return }
        if favoriteModels.contains(key) { favoriteModels.remove(key) }
        else if favoriteModels.count < 128 { favoriteModels.insert(key) }
    }

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
    /// How ARK's surfaces look (ADR-057). Default Void (ADR-086).
    public var textSize: AppTextSize { didSet { store(textSize.rawValue, Self.textSizeKey) } }
    /// The sans typeface for every surface. Default the system font (SF Pro): Keshab found Inter and Geist "off" in chat (2026-10-31).
    public var typeface: AppTypeface { didSet { store(typeface.rawValue, Self.typefaceKey) } }
    public var theme: AppTheme { didSet { store(theme.rawValue, Self.themeKey) } }
    /// Ambient glass (ADR-255): frosted panes over a soft, moving light. On by default; Flat when off.
    public var glass: Bool { didSet { defaults.set(glass, forKey: Self.glassKey) } }
    /// The system's Reduce Transparency, set by the app. Not stored: while it is on, ARK draws Flat whatever `glass` says.
    public var reduceTransparency = false
    /// Glass is drawn: chosen, and the system does not ask for less transparency.
    public var glassShown: Bool { glass && !reduceTransparency }
    /// The palette and the window's panes for the theme in the material that is shown.
    public var palette: ThemePalette { theme.palette(glass: glassShown) }
    public var lanes: WorkspaceColors { WorkspaceColors.for(theme, glass: glassShown) }

    // Settings → Defaults (2026-11-02). The runtime applies the first two to a chat started in the ARK window.
    public var newChatAccess: ChatAccessMode { didSet { saveText(newChatAccess.rawValue, Self.newChatAccessKey) } }
    public var newChatEffort: DefaultEffort { didSet { saveText(newChatEffort.rawValue, Self.newChatEffortKey) } }
    public var newChatPlace: NewChatPlace { didSet { saveText(newChatPlace.rawValue, Self.newChatPlaceKey) } }
    public var startPage: StartPage { didSet { saveText(startPage.rawValue, Self.startPageKey) } }
    /// For `StartPage.last`: chat, board or dashboard, kept when the window closes. Not a choice, so no revision.
    public var lastWindowPage: StartPage { didSet { defaults.set(lastWindowPage.rawValue, forKey: Self.lastWindowPageKey) } }
    public var dashboardRange: DashboardRange { didSet { store(dashboardRange.rawValue, Self.dashboardRangeKey) } }
    /// The bulb on the Board's Studio (2026-11-02): on draws the blueprint on pale paper, off on navy. Default off.
    public var studioLightsOn: Bool { didSet { defaults.set(studioLightsOn, forKey: Self.studioLightsKey) } }

    /// Start and stop sounds. Default on.
    public var soundsEnabled: Bool {
        didSet { save(soundsEnabled, Self.soundsKey) }
    }

    /// ADR-091: ARK says the team's reports aloud (with a chime). Off: they only show. Default on.
    public var speakReports: Bool {
        didSet { save(speakReports, Self.speakReportsKey) }
    }

    /// ADR-091: ARK says timers and other updates aloud (with a chime). Off: they only show. Default on.
    public var speakUpdates: Bool {
        didSet { save(speakUpdates, Self.speakUpdatesKey) }
    }

    /// ADR-097: the chime before ARK says a report, timer or update. Off: it only speaks. Default on.
    public var speechChime: Bool {
        didSet { save(speechChime, Self.speechChimeKey) }
    }

    /// ADR-097: ARK's macOS notifications play the system sound. Off: they show without it. Default on.
    public var notificationSounds: Bool {
        didSet { save(notificationSounds, Self.notifySoundKey) }
    }

    /// ADR-098: ARK sends Needs you, finished goals and schedule results to Telegram by itself. Default on.
    public var telegramPush: Bool {
        didSet { save(telegramPush, Self.telegramPushKey) }
    }

    /// ADR-098 item 5: the local HTTP API (127.0.0.1, token in data/api-token) listens. Default off.
    public var localApi: Bool {
        didSet { save(localApi, Self.localApiKey) }
    }

    /// Computer input fronts the target window for each action (foreground) instead of acting behind the user's work. Default off.
    public var computerForeground: Bool {
        didSet { save(computerForeground, Self.computerForegroundKey) }
    }

    /// ADR-054: the user's choice for computer control, from the switch in Settings → General. Nil until the user uses the
    /// switch; then the app starts the runtime with ARK_COMPUTER set to it, which wins over .env.
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

    static let dictationModeKey = "ark.dictation.mode"
    static let livePreviewKey = "ark.dictation.livePreview"
    static let removeFillersKey = "ark.dictation.removeFillers"
    static let tidyKey = "ark.dictation.tidy"
    static let wakeKey = "ark.wake.routines"
    static let quietKey = "ark.dictation.quiet"

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

    /// Lower the Mac's sound while ARK listens (dictation and voice). Default off.
    public var quietWhileListening: Bool {
        didSet { save(quietWhileListening, Self.quietKey) }
    }

    /// Open ARK in the background before a routine is due, when it is closed (a LaunchAgent). Default off.
    public var wakeForRoutines: Bool {
        didSet { save(wakeForRoutines, Self.wakeKey) }
    }

    /// Tidy dictated text with ARK (punctuation, capitals), checked by plain code. Default off: it adds a short wait.
    public var dictationTidy: Bool {
        didSet { save(dictationTidy, Self.tidyKey) }
    }

    /// The dictation settings as one value.
    public var dictationOptions: DictationOptions {
        DictationOptions(mode: dictationMode, livePreview: livePreview, removeFillers: removeFillers, tidy: dictationTidy)
    }

    /// ADR-093: Pal is always the 2D pixel character, so there is no style, glow, lean or tucking away to choose.
    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        replyWritingExamples = defaults.string(forKey: Self.replyExamplesKey) ?? ""
        petEnabled = defaults.object(forKey: Self.petKey) as? Bool ?? true
        palReacts = defaults.object(forKey: Self.palReactsKey) as? Bool ?? true
        tourDone = defaults.bool(forKey: Self.tourDoneKey)
        ownerName = defaults.string(forKey: Self.ownerNameKey).flatMap(OwnerName.clean)
        palHomeDisplay = defaults.string(forKey: Self.palHomeDisplayKey).map(PalHomeDisplay.init(storageValue:)) ?? .main
        soundsEnabled = defaults.object(forKey: Self.soundsKey) as? Bool ?? true
        speakReports = defaults.object(forKey: Self.speakReportsKey) as? Bool ?? true
        speakUpdates = defaults.object(forKey: Self.speakUpdatesKey) as? Bool ?? true
        speechChime = defaults.object(forKey: Self.speechChimeKey) as? Bool ?? true
        notificationSounds = defaults.object(forKey: Self.notifySoundKey) as? Bool ?? true
        telegramPush = defaults.object(forKey: Self.telegramPushKey) as? Bool ?? true
        localApi = defaults.bool(forKey: Self.localApiKey)
        computerOverride = defaults.object(forKey: Self.computerOverrideKey) as? Bool
        computerForeground = defaults.bool(forKey: Self.computerForegroundKey)
        notifyOff = Set(defaults.stringArray(forKey: Self.notifyOffKey) ?? [])
        followUpEnabled = defaults.object(forKey: Self.followUpKey) as? Bool ?? false
        palSize = Self.choice(defaults, Self.palSizeKey, .medium)
        palWander = Self.choice(defaults, Self.palWanderKey, .normal)
        palNap = Self.choice(defaults, Self.palNapKey, .minutes3)
        bubbleStay = Self.choice(defaults, Self.bubbleStayKey, .seconds2)
        bubbleSize = Self.choice(defaults, Self.bubbleSizeKey, .normal)
        bubbleOpacity = Self.choice(defaults, Self.bubbleOpacityKey, .normal)
        textSize = Self.choice(defaults, Self.textSizeKey, .standard)
        newChatAccess = defaults.string(forKey: Self.newChatAccessKey).flatMap(ChatAccessMode.init(rawValue:)) ?? .checked
        newChatEffort = defaults.string(forKey: Self.newChatEffortKey).flatMap(DefaultEffort.init(rawValue:)) ?? .model
        newChatPlace = defaults.string(forKey: Self.newChatPlaceKey).flatMap(NewChatPlace.init(rawValue:)) ?? .selectedProject
        startPage = defaults.string(forKey: Self.startPageKey).flatMap(StartPage.init(rawValue:)) ?? .chat
        lastWindowPage = defaults.string(forKey: Self.lastWindowPageKey).flatMap(StartPage.init(rawValue:)).flatMap { $0 == .last ? nil : $0 } ?? .chat
        dashboardRange = Self.choice(defaults, Self.dashboardRangeKey, .week)
        studioLightsOn = defaults.bool(forKey: Self.studioLightsKey)
        typeface = Self.choice(defaults, Self.typefaceKey, .system)
        theme = Self.choice(defaults, Self.themeKey, .void)
        glass = defaults.object(forKey: Self.glassKey) as? Bool ?? true
        sidebar = SidebarLayout(storage: defaults.string(forKey: Self.sidebarKey))
        sidebarHidden = defaults.bool(forKey: Self.sidebarHiddenKey)
        projectFilter = defaults.string(forKey: Self.projectFilterKey)
        workspaceWidth = WorkspacePaneLayout.preference(defaults.object(forKey: Self.workspaceWidthKey) as? Double ?? 420)
        workspaceSurface = defaults.string(forKey: Self.workspaceSurfaceKey).flatMap(WorkspaceSurface.init(rawValue:))?.rawValue ?? "home"
        chatSeen = defaults.data(forKey: Self.chatSeenKey).flatMap { try? JSONDecoder().decode([String: ChatSeen].self, from: $0) } ?? [:]
        favoriteModels = Set((defaults.stringArray(forKey: Self.favoriteModelsKey) ?? []).prefix(128).filter { $0.count <= 256 })
        dictationMode = (defaults.string(forKey: Self.dictationModeKey)).flatMap(DictationMode.init(rawValue:)) ?? .automatic
        livePreview = defaults.object(forKey: Self.livePreviewKey) as? Bool ?? true
        removeFillers = defaults.object(forKey: Self.removeFillersKey) as? Bool ?? true
        dictationTidy = defaults.object(forKey: Self.tidyKey) as? Bool ?? false
        wakeForRoutines = defaults.object(forKey: Self.wakeKey) as? Bool ?? false
        quietWhileListening = defaults.object(forKey: Self.quietKey) as? Bool ?? false
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

    /// Appearance: the theme, the text size and the typeface.
    public func resetAppearance() {
        theme = .void
        glass = true
        textSize = .standard
        typeface = .system
    }

    /// Defaults: new chats, the start page and the Dashboard range.
    public func resetDefaults() {
        newChatAccess = .checked; newChatEffort = .model; newChatPlace = .selectedProject; startPage = .chat; dashboardRange = .week
    }

    /// Dictation: how it starts and stops, the live preview and filler removal.
    public func resetDictation() {
        dictationMode = .automatic; livePreview = true; removeFillers = true; dictationTidy = false; quietWhileListening = false
    }

    /// Pal, its speech bubble and the panel. "Show Pal" stays as it is: turning Pal on or off is the
    /// controller's job (`IslandModel.setPet`), and a reset should not make Pal appear or vanish.
    public func resetPal() {
        palSize = .medium; palWander = .normal; palNap = .minutes3
        palReacts = true; palHomeDisplay = .main
        bubbleStay = .seconds2; bubbleSize = .normal; bubbleOpacity = .normal
    }

    private func saveText(_ value: String, _ key: String) {
        defaults.set(value, forKey: key)
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
