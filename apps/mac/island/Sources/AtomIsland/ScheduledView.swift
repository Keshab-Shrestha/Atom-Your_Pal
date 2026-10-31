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
                HStack(alignment: .center, spacing: 14) {
                    Image(systemName: "calendar.badge.clock").appFont(.system(size: 17, weight: .medium)).foregroundStyle(theme.accent.color)
                        .frame(width: 42, height: 42)
                        .background(theme.accent.color.opacity(0.13), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Scheduled").appFont(.system(size: 20, weight: .semibold)).foregroundStyle(theme.text.color)
                            .accessibilityAddTraits(.isHeader)
                        Text("What runs by itself: routines.")
                            .appFont(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    if form.wrappedValue == nil, let first = model.helpers.list?.helpers.first(where: \.takesTasks) {
                        PillButton(title: "New schedule", symbol: "plus", prominent: true) {
                            let start = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
                            form.wrappedValue = ScheduleForm(id: nil, draft: RoutineDraft(helper: first.id, startAt: start))
                        }
                    }
                }
                if let problem = model.helpers.problem { ProblemLine(text: problem) }
                if form.wrappedValue != nil { ScheduleFormCard(model: model, form: form.projectedValue) }
                if page == nil {
                    LoadingStateView(text: "Loading what is scheduled…", retry: { model.send(.helpersList) })
                } else if page?.isEmpty == true {
                    EmptyStateView(title: "Nothing is scheduled",
                                   detail: "A routine runs a task for a worker by itself, for example \"Sid, every morning at 8, …\". Say one in chat, or use New schedule.")
                }
                if let page {
                    ForEach(page.entries) { entry in
                        ScheduledCard(model: model, entry: entry) { routine, helper in
                            form.wrappedValue = ScheduleForm(id: routine.id, draft: RoutineDraft(routine: routine, helper: helper))
                        }
                    }
                }
            }
            // A readable measure, as on the Settings pages.
            .frame(maxWidth: 760, alignment: .leading)
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
        let tint = entry.paused ? theme.attention.color : theme.accent.color
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        HStack(alignment: .center, spacing: 14) {
            // What kind of entry it is, in its state's colour: repeating, or paused.
            Image(systemName: entry.paused ? "pause.fill" : "repeat").appFont(.system(size: 14, weight: .semibold)).foregroundStyle(tint)
                .frame(width: 40, height: 40)
                .background(tint.opacity(0.13), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            VStack(alignment: .leading, spacing: 5) {
                Text(entry.title).appFont(.system(size: 13.5, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(2)
                HStack(spacing: 6) {
                    Text(entry.helperName).appFont(theme.appIdentifierFont(.system(size: 11, weight: .medium), size: 10.5))
                        .foregroundStyle(theme.idColor(theme.text))
                        .padding(.horizontal, 7).frame(height: 18)
                        .background(Capsule().fill(theme.fill3.color))
                    Text(entry.schedule).appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(1)
                }
                Text(ScheduledPage.lastText(entry)).appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 10) {
                HStack(spacing: 5) {
                    StatusDot(color: entry.paused ? theme.attention.color : theme.success.color, size: 6)
                    Text(ScheduledPage.nextText(entry)).appFont(.system(size: 11, weight: .medium)).monospacedDigit()
                        .foregroundStyle(entry.paused ? theme.attention.color : theme.text2.color)
                }
                .padding(.horizontal, 8).frame(height: 22)
                .background(Capsule().fill((entry.paused ? theme.attention.color : theme.success.color).opacity(0.1)))
                HStack(spacing: 6) {
                    if case .routine(let id) = entry.kind, let routine = model.helpers.list?.helpers.first(where: { $0.id == entry.helperId })?.routines.first(where: { $0.id == id }) {
                        IconButton(symbol: "pencil", label: "Edit \(entry.title)", diameter: ControlMetrics.buttonHeight) { edit(routine, entry.helperId) }
                    }
                    IconButton(symbol: entry.paused ? "play.fill" : "pause.fill", label: entry.paused ? "Resume" : "Pause",
                               diameter: ControlMetrics.buttonHeight) { pause(!entry.paused) }
                    IconButton(symbol: "trash", label: "Delete \(entry.title)", diameter: ControlMetrics.buttonHeight) { delete() }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.fill1.a > 0 ? theme.fill1.color : theme.fill2.color.opacity(0.5), in: shape)
        .overlay(shape.strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
        .hoverLift(radius: 14)
        .accessibilityElement(children: .contain)
    }

    private func pause(_ paused: Bool) {
        switch entry.kind {
        case .routine(let id): model.sendHelpers(model.helpers.pauseRoutine(id, paused: paused))
        }
    }

    private func delete() {
        switch entry.kind {
        case .routine(let id): model.sendHelpers(model.helpers.deleteAnyRoutine(id))
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
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        // The open form: the card fill with a calm accent hairline.
        .background(theme.fill1.a > 0 ? theme.fill1.color : theme.fill2.color.opacity(0.5), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(theme.accent.color.opacity(0.35), lineWidth: 1))
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

