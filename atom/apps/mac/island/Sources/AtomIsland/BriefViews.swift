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
                    Text("Making your brief…").appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
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
                Text("Your day").appFont(.system(size: 13, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                Spacer(minLength: 8)
                if running {
                    ProgressView().controlSize(.small)
                } else {
                    QuietButton(title: "Brief me", symbol: "arrow.clockwise") { model.briefMe() }
                        .help("Make a new brief now")
                }
            }
            ForEach(Array(entry.lines.enumerated()), id: \.offset) { _, line in
                Text(line).appFont(.system(size: 12.5)).foregroundStyle(theme.text.color).fixedSize(horizontal: false, vertical: true)
            }
            Text(footer(entry)).appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
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
        if let reason = entry.plainReason { parts.append("Plain version: \(reason)") }
        return parts.joined(separator: " · ")
    }

    static func isRecent(_ entry: BriefEntry, now: Date = Date()) -> Bool {
        guard let at = entry.createdAt else { return false }
        return now.timeIntervalSince(at) < 24 * 3600
    }
}

/// Saved briefs form a compact reading timeline; each entry expands in place.
struct BriefHistory: View {
    let model: IslandModel
    private let expanded: State<Set<Int>>
    private let historyExpanded: State<Bool>
    private let showAll = State(initialValue: false)
    let compact: Bool
    @Environment(\.theme) private var theme

    init(model: IslandModel, initiallyExpanded: Bool = false, openEntries: Set<Int> = [], compact: Bool = false) {
        self.model = model; self.compact = compact
        expanded = State(initialValue: openEntries)
        historyExpanded = State(initialValue: initiallyExpanded)
    }

    var body: some View {
        let older = Array(model.dailyBrief.history.dropFirst())
        let visible = compact && !showAll.wrappedValue ? Array(older.prefix(3)) : older
        if !older.isEmpty {
            DisclosureGroup(isExpanded: historyExpanded.projectedValue) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(visible.enumerated()), id: \.element.id) { index, entry in
                        HStack(alignment: .top, spacing: 12) {
                            VStack(spacing: 0) {
                                Circle().stroke(theme.text3.color, lineWidth: 1.5).frame(width: 8, height: 8).padding(.top, 7)
                                Rectangle().fill(theme.separator.color).frame(width: 1).frame(maxHeight: .infinity)
                            }.frame(width: 12)
                            VStack(alignment: .leading, spacing: 7) {
                                Button {
                                    if expanded.wrappedValue.contains(entry.id) { expanded.wrappedValue.remove(entry.id) }
                                    else { expanded.wrappedValue.insert(entry.id) }
                                } label: {
                                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                                        Text(entry.day).appFont(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text.color)
                                        if let at = entry.createdAt { Text(at.formatted(date: .omitted, time: .shortened)).appFont(.system(size: 11)).foregroundStyle(theme.text3.color) }
                                        Spacer(minLength: 0)
                                        Image(systemName: expanded.wrappedValue.contains(entry.id) ? "chevron.up" : "chevron.down")
                                            .appFont(.system(size: 9)).foregroundStyle(theme.text3.color)
                                    }.contentShape(Rectangle())
                                }.buttonStyle(.plain).accessibilityLabel("\(expanded.wrappedValue.contains(entry.id) ? "Collapse" : "Read") brief for \(entry.day)\(entry.createdAt.map { " at " + $0.formatted(date: .omitted, time: .shortened) } ?? "")")
                                Text(entry.lines.joined(separator: "\n"))
                                    .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                                    .lineLimit(expanded.wrappedValue.contains(entry.id) ? nil : 1)
                                    .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                                if expanded.wrappedValue.contains(entry.id), let reason = entry.plainReason {
                                    Text("Plain version: " + reason).appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
                                }
                            }.padding(.bottom, index == visible.count - 1 ? 0 : 18)
                        }.fixedSize(horizontal: false, vertical: true)
                    }
                    if compact && older.count > 3 {
                        Button(showAll.wrappedValue ? "Show fewer" : "View all \(older.count) briefs") { showAll.wrappedValue.toggle() }
                            .buttonStyle(SnapshotBorderlessButtonStyle()).appFont(.system(size: 11.5)).padding(.top, 12)
                    }
                }.padding(.top, 12)
            } label: {
                HStack(spacing: 8) {
                    Label("Earlier briefs", systemImage: "clock.arrow.circlepath").appFont(.system(size: 13, weight: .semibold))
                    Text("\(older.count) saved").appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
                }
            }.foregroundStyle(theme.text2.color)
        }
    }
}

/// Settings → General → Daily brief: on or off, the time, what to include, where to send it.
struct BriefSettingsCard: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let s = model.dailyBrief.settings
        Card("Daily brief", footer: "Once a day, ATOM gathers your day on this Mac and writes a few short lines. The brief uses only selected day categories. Optional prepared work can also use saved notes you explicitly choose. Off until you turn it on. Press Brief me for one now.") {
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
            if let budget = model.dailyBrief.preparationBudget {
                RowDivider()
                toggle("Prepare work for review", "Off by default. Adds up to three sourced draft/checklist cards on Dashboard. Uses selected day categories and notes you explicitly choose; pause here to stop active preparation.", s.preparation) { BriefSettingsChange(preparation: $0) }
                RowDivider()
                Row(title: "Preparation budget", detail: "\(budget.used) of \(budget.limit) attempts on \(budget.day). Failed/cancelled attempts count. One attempt may use two model requests when selected notes need private preparation.") {
                    Stepper("\(s.preparationDailyLimit) / day", value: Binding(get: { s.preparationDailyLimit }, set: { model.setBrief(BriefSettingsChange(preparationDailyLimit: $0)) }), in: 1...5)
                        .accessibilityLabel("Maximum preparation attempts per day")
                }
                RowDivider()
                Row(title: "Notes for suggestions", detail: "\(s.preparationNoteIds.count) selected. Choose Suggestions on a reviewed Second brain note. Missing/conflicting copies are skipped; no automatic note search.") {
                    if !s.preparationNoteIds.isEmpty {
                        PillButton(title: "Clear selection") { model.setBrief(BriefSettingsChange(preparationNoteIds: [])) }
                    }
                }
                RowDivider()
                Row(title: "Private preparation", detail: "Note excerpts stay in review cards, never in the spoken or delivered brief. Preparing notes separately can use an additional model request.") { EmptyView() }
                RowDivider()
                Row(title: "Preparation model", detail: "\(model.dailyBrief.preparationModel ?? "Selected chat model") at low or supported default effort. Claude/Codex only; no fallback. Cards stay on Dashboard and are never sent to Telegram or spoken.") { EmptyView() }
                RowDivider()
                Row(title: "Preparation timing", detail: "Runs with the daily brief when enabled, or with Brief me. No new background schedule, app reads or account permissions. Review cards and copy manually; nothing is executed.") { EmptyView() }
            }
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
            if let notice = model.dailyBrief.notice {
                RowDivider()
                Row(title: notice) { EmptyView() }
            }
        }
        .onAppear { model.send(.briefGet) }
    }

    private func toggle(_ title: String, _ detail: String, _ on: Bool, _ change: @escaping (Bool) -> BriefSettingsChange) -> some View {
        Row(title: title, detail: detail) {
            ThemedSwitch(isOn: on, set: { model.setBrief(change($0)) }, label: title)
        }
    }
}
