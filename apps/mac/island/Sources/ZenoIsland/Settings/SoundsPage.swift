import SwiftUI
import ZenoIslandCore

/// ADR-097: every sound ZENO makes, one switch each. Each switch takes effect at once. The chat's Sounds menu uses the
/// same settings, so the two always agree.
struct SoundsSection: View {
    let model: IslandModel

    var body: some View {
        let settings = model.settings
        Card("Spoken", footer: "A muted line still shows: on the island, and in ATOM's speech bubble.") {
            Row(title: "Speak the team's reports", detail: "ZENO says a finished goal's report aloud") {
                ThemedSwitch(isOn: settings.speakReports, set: { settings.speakReports = $0; model.sendSpeech() }, label: "Speak the team's reports")
            }
            RowDivider()
            Row(title: "Speak timers and updates", detail: "ZENO says when a timer ends, and other updates") {
                ThemedSwitch(isOn: settings.speakUpdates, set: { settings.speakUpdates = $0; model.sendSpeech() }, label: "Speak timers and updates")
            }
            RowDivider()
            Row(title: "Chime before speaking", detail: "A short chime before ZENO says a report, timer or update") {
                ThemedSwitch(isOn: settings.speechChime, set: { settings.speechChime = $0; model.sendSpeech() }, label: "Chime before speaking")
            }
        }
        Card("Tones") {
            Row(title: "Start and stop sounds", detail: "A soft tone when listening starts and stops") {
                ThemedSwitch(isOn: settings.soundsEnabled, set: { settings.soundsEnabled = $0 }, label: "Start and stop sounds")
            }
            RowDivider()
            Row(title: "Notification sounds", detail: "The macOS sound with ZENO's notifications") {
                ThemedSwitch(isOn: settings.notificationSounds, set: { settings.notificationSounds = $0 }, label: "Notification sounds")
            }
        }
    }
}

extension IslandModel {
    /// ADR-091, ADR-097: tells the runtime what it may say aloud and whether it chimes first.
    func sendSpeech() {
        send(.speechSet(reports: settings.speakReports, updates: settings.speakUpdates, chime: settings.speechChime))
    }

    /// ADR-097: Settings → Sounds, from the chat's Sounds menu.
    func openSoundSettings() {
        windowPage = .settings
        tab = .settings
        settingsPage = .sounds
    }
}
