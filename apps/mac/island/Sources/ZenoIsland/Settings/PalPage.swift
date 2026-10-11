import AppKit
import SwiftUI
import ZenoIslandCore

/// The Pal page (ADR-079), in three sections: Pal itself (whether it shows, how it looks, how it moves and
/// when it tucks away; ADR-042, ADR-051, ADR-052), its speech bubble (ADR-050, ADR-052) and the panel under the
/// menu-bar icon (ADR-051, ADR-052, ADR-056).
struct PalSection: View {
    let model: IslandModel

    var body: some View {
        let settings = model.settings
        Card("Pal") {
            Row(title: "Show Pal", detail: "Shows ZENO's state and opens this panel when clicked") {
                ThemedSwitch(isOn: settings.petEnabled, set: { model.setPet($0) }, label: "Show Pal")
            }
        }
        if settings.petEnabled {
            Card("Look") {
                ChoiceRow(title: "Size", selection: settings.palSize) { settings.palSize = $0 }
                RowDivider()
                ChoiceRow(title: "Glow", selection: settings.palGlow) { settings.palGlow = $0 }
            }
            Card("Behaviour") {
                HomeDisplayRow(settings: settings)
                RowDivider()
                ChoiceRow(title: "Movement",
                          detail: settings.palWander == .stayPut ? "Pal rests where it stands" : "How fast Pal floats along the Dock when idle",
                          selection: settings.palWander) { settings.palWander = $0 }
                RowDivider()
                ChoiceRow(title: "Naps after", selection: settings.palNap) { settings.palNap = $0 }
                RowDivider()
                ChoiceRow(title: "Tucks away after",
                          detail: settings.palHideAfter == .never
                              ? "Pal stays where you put it"
                              : "Slides to a side edge and peeks out. Comes back when you point at it or ZENO has something to show",
                          selection: settings.palHideAfter) { settings.palHideAfter = $0 }
                RowDivider()
                ChoiceRow(title: "Hiding lean", detail: "How far Pal tips toward the screen at an edge (\(Int(settings.palLean.degrees))°)",
                          selection: settings.palLean) { settings.palLean = $0 }
                RowDivider()
                Row(title: "Reacts to you", detail: "Eyes follow the pointer; a squish when clicked, dizzy after three quick clicks") {
                    ThemedSwitch(isOn: settings.palReacts, set: { settings.palReacts = $0 }, label: "Reacts to you")
                }
            }
        }
        Card("Speech bubble") {
            ChoiceRow(title: "Size", selection: settings.bubbleSize) { settings.bubbleSize = $0 }
            RowDivider()
            ChoiceRow(title: "Background", detail: "How much you see of what is behind the bubble",
                      selection: settings.bubbleOpacity) { settings.bubbleOpacity = $0 }
            RowDivider()
            ChoiceRow(title: "Stays for", detail: "After a dictation or an answer ends",
                      selection: settings.bubbleStay) { settings.bubbleStay = $0 }
        }
        Card("Panel", footer: "Glass shows a blur of what is behind; Solid is a plain fill in the theme's colour.") {
            ChoiceRow(title: "Size", selection: settings.panelSize) { settings.panelSize = $0 }
            RowDivider()
            ChoiceRow(title: "Background", selection: settings.panelBackground) { settings.panelBackground = $0 }
        }
        ResetPageCard(footer: "Pal, the speech bubble and the panel go back to their defaults. Show Pal stays as it is.") {
            settings.resetPal()
        }
    }
}

/// ADR-078: which display Pal walks along: the main one, the one with the pointer, or a connected display by name.
/// A chosen display that is unplugged shows as "Saved display (not connected)" until it comes back or another is picked.
private struct HomeDisplayRow: View {
    let settings: IslandSettings

    var body: some View {
        let screens = NSScreen.screens
        let displays = NSScreen.homeDisplays()
        let choice = settings.palHomeDisplay
        let missing = PalHomeResolver.resolve(choice, displays: displays, pointerIndex: nil, pointerDwell: 0, currentHome: nil)?.chosenMissing
            ?? true // no displays at all: nothing chosen can be connected
        Row(title: "Home display", detail: detail(choice, missing: missing)) {
            Menu {
                item("Main display", .main)
                item("Display with the pointer", .pointer)
                Divider()
                ForEach(Array(zip(displays, screens)), id: \.0.uuid) { display, screen in
                    item(screen.localizedName, .display(uuid: display.uuid))
                }
            } label: {
                MenuLabel(text: label(choice, missing: missing, displays: displays, screens: screens))
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .fixedSize()
        }
    }

    private func item(_ title: String, _ value: PalHomeDisplay) -> some View {
        Button { settings.palHomeDisplay = value } label: {
            if settings.palHomeDisplay == value { Label(title, systemImage: "checkmark") } else { Text(title) }
        }
    }

    private func label(_ choice: PalHomeDisplay, missing: Bool, displays: [HomeDisplay], screens: [NSScreen]) -> String {
        switch choice {
        case .main: "Main display"
        case .pointer: "Display with the pointer"
        case .display(let uuid):
            missing ? "Saved display (not connected)" : displays.firstIndex { $0.uuid == uuid }.map { screens[$0].localizedName } ?? "Main display"
        }
    }

    private func detail(_ choice: PalHomeDisplay, missing: Bool) -> String {
        switch choice {
        case .main: "Where Pal walks along the Dock"
        case .pointer: "Pal moves to the display you are using after 3 seconds there"
        case .display: missing ? "On the main display until it is back" : "Where Pal walks along the Dock"
        }
    }
}
