import CoreGraphics
import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Pal's home display (ADR-078)")
struct PalHomeDisplayTests {
    /// The menu-bar display first (NSScreen order), a second display to its right.
    private let displays = [
        HomeDisplay(uuid: "MAIN", frame: CGRect(x: 0, y: 0, width: 1440, height: 900), visibleFrame: CGRect(x: 0, y: 70, width: 1440, height: 805), isMain: true),
        HomeDisplay(uuid: "SIDE", frame: CGRect(x: 1440, y: 0, width: 1920, height: 1080), visibleFrame: CGRect(x: 1440, y: 0, width: 1920, height: 1055), isMain: false),
    ]

    private func resolve(_ choice: PalHomeDisplay, pointer: Int? = nil, dwell: Double = 0, current: Int? = nil,
                         in list: [HomeDisplay]? = nil) -> PalHomeResolution? {
        PalHomeResolver.resolve(choice, displays: list ?? displays, pointerIndex: pointer, pointerDwell: dwell, currentHome: current)
    }

    @Test func mainIsTheMenuBarDisplay() {
        #expect(resolve(.main) == PalHomeResolution(index: 0, chosenMissing: false))
        #expect(resolve(.main, pointer: 1, dwell: 60, current: 1)?.index == 0) // the pointer does not matter
    }

    @Test func aChosenDisplayIsUsedWhenConnected() {
        #expect(resolve(.display(uuid: "SIDE")) == PalHomeResolution(index: 1, chosenMissing: false))
        #expect(resolve(.display(uuid: "MAIN"))?.index == 0)
    }

    @Test func anUnpluggedChosenDisplayFallsBackToMainAndSaysSo() {
        #expect(resolve(.display(uuid: "GONE")) == PalHomeResolution(index: 0, chosenMissing: true))
        // Unplugged while Pal lived there: only the main display is left.
        #expect(resolve(.display(uuid: "SIDE"), current: 0, in: [displays[0]]) == PalHomeResolution(index: 0, chosenMissing: true))
    }

    @Test func pointerMovesHomeOnlyAfterThreeSeconds() {
        #expect(resolve(.pointer, pointer: 1, dwell: 2.9, current: 0)?.index == 0) // keeps the current home
        #expect(resolve(.pointer, pointer: 1, dwell: PalHomeResolver.pointerDwell, current: 0)?.index == 1)
        #expect(resolve(.pointer, pointer: 1, dwell: 10, current: 0)?.index == 1)
        // Back on the old display, but not for long yet: stays where it went.
        #expect(resolve(.pointer, pointer: 0, dwell: 1, current: 1)?.index == 1)
    }

    @Test func pointerWithoutAHomeYetStartsOnMain() {
        #expect(resolve(.pointer, pointer: 1, dwell: 0, current: nil)?.index == 0)
        #expect(resolve(.pointer, pointer: nil, current: 1)?.index == 1) // the pointer is off every display
        #expect(resolve(.pointer, pointer: 1, dwell: 1, current: 5)?.index == 0) // a current home that is gone
    }

    @Test func mainIsTheDisplayMarkedMainEvenIfNotFirst() {
        let swapped = [displays[1], displays[0]].map { HomeDisplay(uuid: $0.uuid, frame: $0.frame, visibleFrame: $0.visibleFrame, isMain: $0.uuid == "MAIN") }
        #expect(resolve(.main, in: swapped)?.index == 1)
    }

    @Test func noDisplaysNoHome() {
        #expect(resolve(.main, in: []) == nil)
    }

    @Test func storageRoundTrips() {
        for choice in [PalHomeDisplay.main, .pointer, .display(uuid: "37D8832A-2D66-02CA-B9F7-8F30A301B230")] {
            #expect(PalHomeDisplay(storageValue: choice.storageValue) == choice)
        }
        #expect(PalHomeDisplay(storageValue: "nonsense") == .main)
        #expect(PalHomeDisplay(storageValue: "display:") == .main)
    }

    @Test @MainActor func settingIsStoredAndDefaultsToMain() {
        let name = "atom.test.home.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        #expect(IslandSettings(defaults: defaults).palHomeDisplay == .main)
        IslandSettings(defaults: defaults).palHomeDisplay = .display(uuid: "SIDE")
        #expect(defaults.string(forKey: IslandSettings.palHomeDisplayKey) == "display:SIDE")
        #expect(IslandSettings(defaults: defaults).palHomeDisplay == .display(uuid: "SIDE"))
    }
}
