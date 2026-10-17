import SwiftUI
import AtomIslandCore

// Daily brief (upgrades.md C3): the card at the top of a new chat, the short history on the Dashboard, and the settings card.

/// Today's brief as a quiet card: the lines, when it was made, and "Brief me" to make a new one.
struct BriefCard: View {
    let model: IslandModel
    /// A card for a brief made in the last day shows in a new chat; the Dashboard shows the newest whatever its age.
    var onlyRecent = true
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous) }

    var body: some View {
        let state = model.dailyBrief
        VStack(alignment: .leading, spacing: 0) {
            if let entry = state.latest, !onlyRecent || Self.isRecent(entry) {
                card(entry, running: state.running)
            } else if state.running {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Making your brief…").font(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(shape.fill(theme.fill1.color))
            }
        }
        .onAppear { if !snapshot { model.loadBrief() } }
    }

    private func card(_ entry: BriefEntry, running: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("Your day").font(.system(size: 13, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                Spacer(minLength: 8)
                if running {
                    ProgressView().controlSize(.small)
                } else {
                    QuietButton(title: "Brief me", symbol: "arrow.clockwise") { model.briefMe() }
                        .help("Make a new brief now")
                }
            }
            ForEach(Array(entry.lines.enumerated()), id: \.offset) { _, line in
                Text(line).font(.system(size: 12.5)).foregroundStyle(theme.text.color).fixedSize(horizontal: false, vertical: true)
            }
            Text(footer(entry)).font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(shape.fill(theme.fill1.color))
        .overlay(shape.strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Your daily brief")
    }

    private func footer(_ entry: BriefEntry) -> String {
        var parts: [String] = []
        if let at = entry.createdAt { parts.append(at.formatted(date: .abbreviated, time: .shortened)) }
        if entry.isPlain { parts.append("Plain version: the model was not available") }
        return parts.joined(separator: " · ")
    }

    static func isRecent(_ entry: BriefEntry, now: Date = Date()) -> Bool {
        guard let at = entry.createdAt else { return false }
        return now.timeIntervalSince(at) < 24 * 3600
    }
}

/// The last briefs on the Dashboard, newest first, one day each.
struct BriefHistory: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let older = Array(model.dailyBrief.history.dropFirst().prefix(6))
        if !older.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Earlier briefs").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
                ForEach(older) { entry in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.day).font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text2.color)
                        Text(entry.lines.joined(separator: " ")).font(.system(size: 12)).foregroundStyle(theme.text.color).lineLimit(3)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }
}

/// Settings → General → Daily brief: on or off, the time, what to include, where to send it.
struct BriefSettingsCard: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let s = model.dailyBrief.settings
        Card("Daily brief", footer: "Once a day, ATOM gathers your day on this Mac and writes a few short lines. The model sees only that list, never your chats or memory. Off until you turn it on. Press Brief me for one now.") {
            Row(title: "Daily brief", detail: "A card at the top of a new chat, and on the Dashboard") {
                ThemedSwitch(isOn: s.enabled, set: { model.setBrief(BriefSettingsChange(enabled: $0)) }, label: "Daily brief")
            }
            RowDivider()
            Row(title: "Time", detail: "If the Mac is asleep, the brief is made when it wakes") {
                DatePicker("", selection: Binding(get: { s.time(on: Date()) }, set: { model.setBrief(BriefSettingsChange(minute: BriefSettings.minute(of: $0))) }), displayedComponents: .hourAndMinute)
                    .labelsHidden()
                    .accessibilityLabel("Time of the daily brief")
            }
            RowDivider()
            toggle("Today's events", "From Calendar", s.events) { BriefSettingsChange(events: $0) }
            RowDivider()
            toggle("Reminders", "Open ones, from Reminders", s.reminders) { BriefSettingsChange(reminders: $0) }
            RowDivider()
            toggle("Weather", "For where you are", s.weather) { BriefSettingsChange(weather: $0) }
            RowDivider()
            toggle("Finished tasks", "Done since the last brief", s.tasks) { BriefSettingsChange(tasks: $0) }
            RowDivider()
            toggle("What waits for you", "Plans, suggestions and drafts to review", s.needsYou) { BriefSettingsChange(needsYou: $0) }
            RowDivider()
            Row(title: "Send to Telegram", detail: model.telegramConnected ? "The brief goes to your Telegram chat" : "Telegram is not set up") {
                ThemedSwitch(isOn: s.telegram, set: { model.setBrief(BriefSettingsChange(telegram: $0)) }, label: "Send the brief to Telegram")
                    .disabled(!model.telegramConnected)
            }
            RowDivider()
            toggle("Say it aloud", "ATOM speaks the brief when it is made", s.spoken) { BriefSettingsChange(spoken: $0) }
            RowDivider()
            Row(title: "Make one now") {
                PillButton(title: model.dailyBrief.running ? "Making…" : "Brief me", symbol: "sparkles") { model.briefMe() }
                    .disabled(model.dailyBrief.running)
            }
            if let error = model.dailyBrief.error {
                RowDivider()
                Row(title: error) { EmptyView() }
            }
        }
        .onAppear { model.loadBrief() }
    }

    private func toggle(_ title: String, _ detail: String, _ on: Bool, _ change: @escaping (Bool) -> BriefSettingsChange) -> some View {
        Row(title: title, detail: detail) {
            ThemedSwitch(isOn: on, set: { model.setBrief(change($0)) }, label: title)
        }
    }
}
