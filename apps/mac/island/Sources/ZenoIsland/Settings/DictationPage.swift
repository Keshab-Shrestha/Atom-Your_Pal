import SwiftUI
import ZenoIslandCore

/// How dictation starts and what it shows and removes (ADR-050).
struct DictationSection: View {
    let model: IslandModel

    var body: some View {
        let settings = model.settings
        Card {
            ChoiceRow(title: "Start and stop", detail: settings.dictationMode.detail, selection: settings.dictationMode) { settings.dictationMode = $0 }
            RowDivider()
            Row(title: "Live preview", detail: "Show your words above ATOM while you speak") {
                ThemedSwitch(isOn: settings.livePreview, set: { settings.livePreview = $0 }, label: "Live preview")
            }
            RowDivider()
            Row(title: "Remove “um” and “uh”", detail: "Leaves out hesitation sounds in the typed text") {
                ThemedSwitch(isOn: settings.removeFillers, set: { settings.removeFillers = $0 }, label: "Remove um and uh")
            }
        }
        ResetPageCard(footer: "Start and stop, live preview and “um” removal go back to their defaults.") { settings.resetDictation() }
    }
}
