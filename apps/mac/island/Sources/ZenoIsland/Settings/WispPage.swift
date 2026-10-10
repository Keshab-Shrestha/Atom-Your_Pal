import SwiftUI
import ZenoIslandCore

/// The Wisp page (ADR-079), in three sections: Wisp itself (whether it shows, how it looks, how it moves and
/// when it tucks away; ADR-042, ADR-051, ADR-052), its speech bubble (ADR-050, ADR-052) and the panel under the
/// menu-bar icon (ADR-051, ADR-052, ADR-056).
struct WispSection: View {
    let model: IslandModel

    var body: some View {
        let settings = model.settings
        Card("Wisp") {
            Row(title: "Show Wisp", detail: "Shows ZENO's state and opens this panel when clicked") {
                ThemedSwitch(isOn: settings.petEnabled, set: { model.setPet($0) }, label: "Show Wisp")
            }
        }
        if settings.petEnabled {
            Card("Look") {
                ChoiceRow(title: "Size", selection: settings.wispSize) { settings.wispSize = $0 }
                RowDivider()
                ChoiceRow(title: "Glow", selection: settings.wispGlow) { settings.wispGlow = $0 }
            }
            Card("Behaviour") {
                ChoiceRow(title: "Movement",
                          detail: settings.wispWander == .stayPut ? "Wisp rests where it stands" : "How fast Wisp floats along the Dock when idle",
                          selection: settings.wispWander) { settings.wispWander = $0 }
                RowDivider()
                ChoiceRow(title: "Naps after", selection: settings.wispNap) { settings.wispNap = $0 }
                RowDivider()
                ChoiceRow(title: "Tucks away after",
                          detail: settings.wispHideAfter == .never
                              ? "Wisp stays where you put it"
                              : "Slides to a side edge and peeks out. Comes back when you point at it or ZENO has something to show",
                          selection: settings.wispHideAfter) { settings.wispHideAfter = $0 }
                RowDivider()
                ChoiceRow(title: "Hiding lean", detail: "How far Wisp tips toward the screen at an edge (\(Int(settings.wispLean.degrees))°)",
                          selection: settings.wispLean) { settings.wispLean = $0 }
                RowDivider()
                Row(title: "Reacts to you", detail: "Eyes follow the pointer; a squish when clicked, dizzy after three quick clicks") {
                    ThemedSwitch(isOn: settings.wispReacts, set: { settings.wispReacts = $0 }, label: "Reacts to you")
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
        ResetPageCard(footer: "Wisp, the speech bubble and the panel go back to their defaults. Show Wisp stays as it is.") {
            settings.resetWisp()
        }
    }
}
