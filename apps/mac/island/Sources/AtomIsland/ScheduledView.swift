import SwiftUI
import AtomIslandCore

// ADR-094: the Scheduled page (everything that runs by itself). The logic lives in `ScheduledPage` and `HelpersState`;
// these views only draw it. ADR-110 N5: no team tasks and no wake-ups.

/// The sidebar row's second line.
enum ScheduledRow {
    static func detail(_ list: HelpersList) -> String? {
        let page = ScheduledPage(list: list)
        let running = page.entries.filter { !$0.paused }.count
        if page.isEmpty { return "Nothing scheduled" }
        return running > 0 ? "\(running) on" : "All paused"
    }
}

/// Every worker's routines, with their next time, last run, Pause/Resume and Delete.
struct ScheduledPane: View {
    let model: IslandModel
    /// ADR-097: the open New schedule or Edit form. `State` without the macro (no SwiftUI macro plugin here).
    private let form = State<ScheduleForm?>(initialValue: nil)
    @Environment(\.theme) private var theme

    init(model: IslandModel) { self.model = model }

    var body: some View {
        let page = model.helpers.list.map(ScheduledPage.init(list:))
        Scrollable {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Scheduled").font(.system(size: 18, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                        Text("What runs by itself: routines.")
                            .font(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    if form.wrappedValue == nil, let first = model.helpers.list?.helpers.first(where: \.takesTasks) {
                        QuietButton(title: "New schedule", symbol: "plus") {
                            let start = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
                            form.wrappedValue = ScheduleForm(id: nil, draft: RoutineDraft(helper: first.id, startAt: start))
                        }
                    }
                }
                if let problem = model.helpers.problem { ProblemLine(text: problem) }
                if form.wrappedValue != nil { ScheduleFormCard(model: model, form: form.projectedValue) }
                if page?.isEmpty ?? true {
                    Text("Nothing is scheduled. Give a worker a routine (\"Sid, every morning at 8, …\") or use New schedule.")
                        .font(.system(size: 12.5)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true).padding(.top, 6)
                }
                if let page {
                    ForEach(page.entries) { entry in
                        ScheduledCard(model: model, entry: entry) { routine, helper in
                            form.wrappedValue = ScheduleForm(id: routine.id, draft: RoutineDraft(routine: routine, helper: helper))
                        }
                    }
                }
            }
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.panel)
            .padding(.top, 28)
            .padding(.bottom, Spacing.panel)
        }
    }
}

/// The card style of the Issues page: a hairline outline, the worker and what it does, the times, the buttons.
private struct ScheduledCard: View {
    let model: IslandModel
    let entry: ScheduledPage.Entry
    /// ADR-097: opens the Edit form for a routine.
    let edit: (HelperRoutine, String) -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: entry.kind == .wakeUp ? "alarm" : "repeat").font(.system(size: 10.5, weight: .semibold)).foregroundStyle(theme.text3.color)
                Text(entry.helperName).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.idColor(theme.text2))
                Text(entry.schedule).font(.system(size: 11)).foregroundStyle(theme.text3.color)
                Spacer(minLength: 0)
                Text(ScheduledPage.nextText(entry)).font(theme.idFont(.system(size: 11), size: 10.5))
                    .foregroundStyle(entry.paused ? theme.attention.color : theme.text2.color)
            }
            Text(entry.title).font(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(2)
            Text(ScheduledPage.lastText(entry)).font(.system(size: 11)).foregroundStyle(theme.text3.color)
            HStack(spacing: 8) {
                if case .routine(let id) = entry.kind, let routine = model.helpers.list?.helpers.first(where: { $0.id == entry.helperId })?.routines.first(where: { $0.id == id }) {
                    QuietButton(title: "Edit", symbol: "pencil") { edit(routine, entry.helperId) }
                }
                QuietButton(title: entry.paused ? "Resume" : "Pause", symbol: entry.paused ? "play.fill" : "pause.fill") { pause(!entry.paused) }
                QuietButton(title: entry.kind == .wakeUp ? "Turn off" : "Delete") { delete() }
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }

    private func pause(_ paused: Bool) {
        switch entry.kind {
        case .routine(let id): model.sendHelpers(model.helpers.pauseRoutine(id, paused: paused))
        case .wakeUp: model.sendHelpers(model.helpers.pauseWakeUp(entry.helperId, paused: paused))
        }
    }

    private func delete() {
        switch entry.kind {
        case .routine(let id): model.sendHelpers(model.helpers.deleteAnyRoutine(id))
        case .wakeUp: model.sendHelpers(model.helpers.setWakeUp(entry.helperId, every: "off"))
        }
    }
}

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
/// hourly one). It closes when ATOM answers without a problem.
private struct ScheduleFormCard: View {
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
                Text(value.id == nil ? "New schedule" : "Edit schedule").font(.system(size: 14, weight: .semibold)).foregroundStyle(theme.text.color)
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
            SoulField(label: "Task (what to do each time)", text: draft.task, limit: 1000, lines: 3)
            HStack(spacing: 10) {
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
                        .font(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize()
                    DatePicker("First run", selection: draft.startAt, displayedComponents: [.date, .hourAndMinute])
                        .font(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize()
                }
            }
            // ADR-098: each result goes to Keshab's phone.
            HStack(spacing: 8) {
                Text(model.telegramConnected ? "Send result to Telegram" : "Send result to Telegram (set up Telegram in Settings → General)")
                    .font(.system(size: 12)).foregroundStyle(theme.text2.color)
                Spacer(minLength: 8)
                ThemedSwitch(isOn: value.draft.notifyTelegram, set: { draft.wrappedValue.notifyTelegram = $0 }, label: "Send result to Telegram")
            }
            // ADR-098 item 5: another tool may start it through the local API (Settings → General → Local API).
            HStack(spacing: 8) {
                Text(value.draft.webhook ? value.id.map { "Can be started by webhook: POST /v1/hooks/\($0)" } ?? "Can be started by webhook" : "Can be started by webhook")
                    .font(.system(size: 12)).foregroundStyle(theme.text2.color)
                    .textSelection(.enabled)
                Spacer(minLength: 8)
                ThemedSwitch(isOn: value.draft.webhook, set: { draft.wrappedValue.webhook = $0 }, label: "Can be started by webhook")
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.accent.color.opacity(0.6), lineWidth: 1))
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
            .font(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize()
    }

    private func save() {
        guard let value = form.wrappedValue else { return }
        let command = model.helpers.saveRoutine(value.id, value.draft)
        if command != nil { form.wrappedValue?.sent = true }
        model.sendHelpers(command)
    }
}

