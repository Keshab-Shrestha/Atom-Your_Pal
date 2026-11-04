import SwiftUI
import ArkIslandCore

/// How dictation starts and what it shows and removes (ADR-050).
struct DictationSection: View {
    let model: IslandModel

    var body: some View {
        let settings = model.settings
        Card {
            ChoiceRow(title: "Start and stop", detail: settings.dictationMode.detail, selection: settings.dictationMode) { settings.dictationMode = $0 }
            RowDivider()
            Row(title: "Live preview", detail: "Show your words above ARK while you speak") {
                ThemedSwitch(isOn: settings.livePreview, set: { settings.livePreview = $0 }, label: "Live preview")
            }
            RowDivider()
            Row(title: "Remove “um” and “uh”", detail: "Leaves out hesitation sounds in the typed text") {
                ThemedSwitch(isOn: settings.removeFillers, set: { settings.removeFillers = $0 }, label: "Remove um and uh")
            }
            RowDivider()
            Row(title: "Quiet the Mac while I speak", detail: "Lowers the sound from other apps while ARK listens, then puts it back") {
                ThemedSwitch(isOn: settings.quietWhileListening, set: { settings.quietWhileListening = $0 }, label: "Quiet the Mac while I speak")
            }
            RowDivider()
            Row(title: "Tidy with ARK", detail: "Fixes punctuation and capitals with a short model call. ARK keeps your words as spoken unless the tidy text keeps every number and name. Adds about a second.") {
                ThemedSwitch(isOn: settings.dictationTidy, set: { settings.dictationTidy = $0 }, label: "Tidy with ARK")
            }
        }
        ResetPageCard(footer: "Start and stop, live preview and “um” removal go back to their defaults.") { settings.resetDictation() }
    }
}
