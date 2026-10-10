import Foundation
import Testing
@testable import ZenoIslandCore

/// "Reset this page" (ADR-079): each reset puts its own page's settings back to the defaults a fresh install
/// shows, and leaves every other stored key exactly as it was.
@Suite("Reset this page")
@MainActor
struct ResetPageTests {
    static let appearanceKeys: Set = [IslandSettings.themeKey, IslandSettings.wispStyleKey]
    static let dictationKeys: Set = [IslandSettings.dictationModeKey, IslandSettings.livePreviewKey, IslandSettings.removeFillersKey]
    static let wispKeys: Set = [
        IslandSettings.wispSizeKey, IslandSettings.wispGlowKey, IslandSettings.wispWanderKey, IslandSettings.wispNapKey,
        IslandSettings.wispHideKey, IslandSettings.wispLeanKey, IslandSettings.wispReactsKey, IslandSettings.wispHomeDisplayKey,
        IslandSettings.bubbleSizeKey, IslandSettings.bubbleOpacityKey, IslandSettings.bubbleStayKey,
        IslandSettings.panelSizeKey, IslandSettings.panelBackgroundKey,
    ]
    static var shortcutKeys: Set<String> { Set(ShortcutAction.allCases.map { IslandSettings.shortcutKey($0) }) }

    private func other<C: CaseIterable & Equatable>(_ value: C) -> C { C.allCases.first { $0 != value }! }

    /// Settings in a throwaway suite with every setting changed from its default.
    private func everythingChanged() -> (IslandSettings, UserDefaults, String) {
        let name = "zeno.test.reset.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        let s = IslandSettings(defaults: defaults)
        s.theme = other(s.theme); s.wispStyle = other(s.wispStyle)
        s.dictationMode = other(s.dictationMode); s.livePreview.toggle(); s.removeFillers.toggle()
        s.wispSize = other(s.wispSize); s.wispGlow = other(s.wispGlow); s.wispWander = other(s.wispWander)
        s.wispNap = other(s.wispNap); s.wispHideAfter = other(s.wispHideAfter); s.wispLean = other(s.wispLean)
        s.wispReacts.toggle(); s.wispHomeDisplay = .display(uuid: "SIDE")
        s.bubbleSize = other(s.bubbleSize); s.bubbleOpacity = other(s.bubbleOpacity); s.bubbleStay = other(s.bubbleStay)
        s.panelSize = other(s.panelSize); s.panelBackground = other(s.panelBackground)
        s.petEnabled.toggle(); s.soundsEnabled.toggle(); s.followUpEnabled.toggle(); s.tourDone.toggle()
        s.petSpot = PetSpot(x: 10, y: 20)
        for action in ShortcutAction.allCases { s.setShortcut(nil, for: action) }
        return (s, defaults, name)
    }

    /// Runs `reset` on everything-changed settings; returns them, a fresh default instance and the stored keys it changed.
    private func run(_ reset: (IslandSettings) -> Void) -> (IslandSettings, IslandSettings, Set<String>) {
        let (s, defaults, name) = everythingChanged()
        defer { defaults.removePersistentDomain(forName: name) }
        let before = defaults.persistentDomain(forName: name) ?? [:]
        #expect(before.count >= Self.wispKeys.count, "the suite holds the changed settings")
        reset(s)
        let after = defaults.persistentDomain(forName: name) ?? [:]
        let changed = Set(before.keys).union(after.keys).filter { before[$0] as? NSObject != after[$0] as? NSObject }
        let freshName = "zeno.test.reset.fresh.\(UUID().uuidString)"
        defer { UserDefaults().removePersistentDomain(forName: freshName) }
        return (s, IslandSettings(defaults: UserDefaults(suiteName: freshName)!), changed)
    }

    @Test func appearanceResetTouchesOnlyThemeAndStyle() {
        let (s, fresh, changed) = run { $0.resetAppearance() }
        #expect(changed == Self.appearanceKeys)
        #expect(s.theme == fresh.theme && s.wispStyle == fresh.wispStyle)
        #expect(s.dictationMode != fresh.dictationMode && s.wispSize != fresh.wispSize)
    }

    @Test func dictationResetTouchesOnlyDictation() {
        let (s, fresh, changed) = run { $0.resetDictation() }
        #expect(changed == Self.dictationKeys)
        #expect(s.dictationMode == fresh.dictationMode && s.livePreview == fresh.livePreview && s.removeFillers == fresh.removeFillers)
        #expect(s.theme != fresh.theme)
    }

    @Test func wispResetTouchesOnlyWispBubbleAndPanel() {
        let (s, fresh, changed) = run { $0.resetWisp() }
        #expect(changed == Self.wispKeys)
        #expect(s.wispSize == fresh.wispSize && s.wispGlow == fresh.wispGlow && s.wispWander == fresh.wispWander)
        #expect(s.wispNap == fresh.wispNap && s.wispHideAfter == fresh.wispHideAfter && s.wispLean == fresh.wispLean)
        #expect(s.wispReacts == fresh.wispReacts && s.wispHomeDisplay == fresh.wispHomeDisplay)
        #expect(s.bubbleSize == fresh.bubbleSize && s.bubbleOpacity == fresh.bubbleOpacity && s.bubbleStay == fresh.bubbleStay)
        #expect(s.panelSize == fresh.panelSize && s.panelBackground == fresh.panelBackground)
        // Show Wisp and where it is parked are left alone.
        #expect(s.petEnabled != fresh.petEnabled && s.petSpot != nil)
    }

    @Test func shortcutsResetBringsBackEveryDefaultAndNothingElse() {
        let (s, _, changed) = run { $0.resetAllShortcuts() }
        #expect(changed == Self.shortcutKeys)
        for action in ShortcutAction.allCases { #expect(s.shortcut(for: action) == action.defaultCombo) }
    }

    @Test func pagesDoNotShareKeys() {
        let all = [Self.appearanceKeys, Self.dictationKeys, Self.wispKeys, Self.shortcutKeys]
        #expect(all.map(\.count).reduce(0, +) == all.reduce(Set<String>()) { $0.union($1) }.count)
    }
}
