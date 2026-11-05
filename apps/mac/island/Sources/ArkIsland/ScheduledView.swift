import SwiftUI
import ArkIslandCore

// ADR-094: what runs by itself. 2026-11-06: the Scheduled page is part of Automations (WorkflowsPane); these are its routine form
// and its watch card. The logic lives in `ScheduledPage` and `HelpersState`.

/// ADR-097: the open form: which routine (nil: a new one), what it was, what Keshab has typed, and whether it was sent.
struct ScheduleForm: Equatable {
    var id: Int?
    var original: RoutineDraft
    var draft: RoutineDraft
    var sent = false

    init(id: Int?, draft: RoutineDraft) {
        self.id = id
        self.original = draft
        self.draft = draft
    }

    var edited: Bool { id == nil ? !draft.task.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty : draft != original }
}

/// ADR-097: the New schedule and Edit form: the agent, the task, the repeat and its time (or the first time of an
/// hourly one). It closes when ARK answers without a problem.
struct ScheduleFormCard: View {
    let model: IslandModel
    let form: Binding<ScheduleForm?>
    @Environment(\.theme) private var theme

    var body: some View {
        let value = form.wrappedValue ?? ScheduleForm(id: nil, draft: RoutineDraft(helper: "", startAt: Date()))
        let draft = Binding<RoutineDraft>(get: { form.wrappedValue?.draft ?? value.draft }, set: { form.wrappedValue?.draft = $0 })
        let agents = model.helpers.list?.helpers.filter(\.takesTasks) ?? []
        let schedule = value.draft.schedule
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(value.id == nil ? "New schedule" : "Edit schedule").appFont(.system(size: 14, weight: .semibold)).foregroundStyle(theme.text.color)
                Spacer(minLength: 8)
                QuietButton(title: "Cancel") { form.wrappedValue = nil }
                SaveButton(title: value.id == nil ? "Create" : "Save", enabled: value.edited && !value.sent, commandS: true,
                           label: value.id == nil ? "Create schedule" : "Save schedule", action: save)
            }
            HStack(spacing: 8) {
                Menu {
                    ForEach(agents) { agent in
                        Button { draft.wrappedValue.helper = agent.id } label: {
                            if agent.id == value.draft.helper { Label(agent.name, systemImage: "checkmark") } else { Text(agent.name) }
                        }
                    }
                } label: {
                    PillMenuLabel(label: "Agent", value: agents.first { $0.id == value.draft.helper }?.name ?? "Choose", identifier: false)
                }
                .menuStyle(.button).buttonStyle(.plain).fixedSize()
                Menu {
                    ForEach(RoutineSchedule.Kind.allCases, id: \.self) { kind in
                        Button { draft.wrappedValue.schedule.kind = kind } label: {
                            if kind == schedule.kind { Label(kind.title, systemImage: "checkmark") } else { Text(kind.title) }
                        }
                    }
                } label: {
                    PillMenuLabel(label: "Repeat", value: schedule.kind.title, identifier: false)
                }
                .menuStyle(.button).buttonStyle(.plain).fixedSize()
            }
            SoulField(label: "Task (what to do each time)", text: draft.task, lines: 5)
            HStack(spacing: 12) {
                switch schedule.kind {
                case .daily:
                    timePicker(draft)
                case .weekly:
                    Menu {
                        ForEach(0..<7, id: \.self) { day in
                            Button(RoutineSchedule.weekdays[day]) { draft.wrappedValue.schedule.weekday = day }
                        }
                    } label: {
                        PillMenuLabel(label: "On", value: RoutineSchedule.weekdays[min(max(schedule.weekday, 0), 6)], identifier: false)
                    }
                    .menuStyle(.button).buttonStyle(.plain).fixedSize()
                    timePicker(draft)
                case .hours:
                    Stepper("Every \(schedule.every) hour\(schedule.every == 1 ? "" : "s")", value: draft.schedule.every, in: 1...RoutineSchedule.maxEveryHours)
                        .appFont(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize()
                    DatePicker("First run", selection: draft.startAt, displayedComponents: [.date, .hourAndMinute])
                        .appFont(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize()
                }
            }
            // ADR-098: each result goes to Keshab's phone.
            HStack(spacing: 8) {
                Text(model.telegramConnected ? "Send result to Telegram" : "Send result to Telegram (set up Telegram in Settings → Notifications)")
                    .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                Spacer(minLength: 8)
                ThemedSwitch(isOn: value.draft.notifyTelegram, set: { draft.wrappedValue.notifyTelegram = $0 }, label: "Send result to Telegram")
            }
            // ADR-098 item 5: another tool may start it through the local API (Settings → Connections → Local API).
            HStack(spacing: 8) {
                Text(value.draft.webhook ? value.id.map { "Can be started by webhook: POST /v1/hooks/\($0)" } ?? "Can be started by webhook" : "Can be started by webhook")
                    .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                    .textSelection(.enabled)
                Spacer(minLength: 8)
                ThemedSwitch(isOn: value.draft.webhook, set: { draft.wrappedValue.webhook = $0 }, label: "Can be started by webhook")
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        // The open form: the card fill with a calm accent hairline.
        .background(theme.fill1.a > 0 ? theme.fill1.color : theme.fill2.color.opacity(0.5), in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(theme.accent.color.opacity(0.35), lineWidth: 1))
        .tracksEdits(model, "schedule-form", value.edited && !value.sent)
        .onChange(of: model.helpers.isWaiting) { _, waiting in
            guard !waiting, form.wrappedValue?.sent == true else { return }
            if model.helpers.problem == nil { form.wrappedValue = nil } else { form.wrappedValue?.sent = false }
        }
    }

    /// The time of day, as minutes after midnight.
    private func timePicker(_ draft: Binding<RoutineDraft>) -> some View {
        let time = Binding<Date>(
            get: {
                let minute = draft.wrappedValue.schedule.minute
                return Calendar.current.date(bySettingHour: minute / 60, minute: minute % 60, second: 0, of: Date()) ?? Date()
            },
            set: { date in
                let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
                draft.wrappedValue.schedule.minute = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
            })
        return DatePicker("At", selection: time, displayedComponents: .hourAndMinute)
            .appFont(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize()
    }

    private func save() {
        guard let value = form.wrappedValue else { return }
        let command = model.helpers.saveRoutine(value.id, value.draft)
        if command != nil { form.wrappedValue?.sent = true }
        model.sendHelpers(command)
    }
}

/// A page ARK watches for the user (2026-11-04): where, until what, how often, and Stop. ARK reads it with no model.
struct WatchCard: View {
    let model: IslandModel
    let watch: WatchItem
    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
        let color = watch.isWatching ? theme.success.color : watch.state == "fired" ? theme.accent.color : theme.attention.color
        HStack(alignment: .center, spacing: 16) {
            Glyph(systemName: "eye").appFont(.system(size: 13, weight: .medium)).foregroundStyle(theme.text2.color)
                .frame(width: 36, height: 36)
                .background(theme.fill3.color, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(watch.host).appFont(.system(size: 13.5, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(1)
                Text(watch.isWatching ? "\(watch.condition), \(watch.interval)" : (watch.message ?? watch.state.capitalized))
                    .appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(2)
                Text("ARK reads this page itself, with no model.").appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
            }
            Spacer(minLength: 8)
            HStack(spacing: 4) {
                StatusDot(color: color, size: 6)
                Text(watch.isWatching ? "Watching" : watch.state == "fired" ? "Found" : "Stopped").appFont(.system(size: 11, weight: .medium)).foregroundStyle(color)
            }
            .padding(.horizontal, 8).frame(height: 22)
            .background(Capsule().fill(color.opacity(0.1)))
            IconButton(symbol: "trash", label: "Remove the watch on \(watch.host)", diameter: ControlMetrics.buttonHeight) { model.send(.watchRemove(id: watch.id)) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.fill1.a > 0 ? theme.fill1.color : theme.fill2.color.opacity(0.5), in: shape)
        .overlay(shape.strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
        .accessibilityElement(children: .contain)
    }
}
