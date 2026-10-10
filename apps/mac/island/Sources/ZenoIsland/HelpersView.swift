import AppKit
import SwiftUI
import ZenoIslandCore

/// The Helpers window's content (ADR-081), in Lantern (ADR-084): a darker sidebar of helpers as discs; the chosen
/// helper with its "Opens in" and "Model" pills, a task field and one list of jobs, or the report being read.
/// The logic lives in `HelpersState`; these views only draw it.
struct HelpersView: View {
    let model: IslandModel

    /// Room at the top of the sidebar for the window's buttons (the title bar is transparent over the content).
    static let titleBarRoom: CGFloat = 40

    var body: some View {
        let palette = model.settings.theme.palette
        HStack(spacing: 0) {
            HelperSidebar(model: model).frame(width: 224)
            Rectangle().fill(palette.separator.color).frame(width: palette.isFlat ? 1 : 0.5)
            Group {
                if model.helpers.openJobId != nil {
                    ThreadPane(model: model)
                } else if model.helpers.showsBoard {
                    BoardPane(model: model)
                } else if let helper = model.helpers.selectedHelper {
                    if model.helpers.isSoulOpen, let soul = helper.soul {
                        // A new version (a save or a restore) starts the form again from what is now current.
                        SoulPane(model: model, helper: helper, soul: soul).id("\(helper.id)-\(helper.soulVersion)")
                    } else {
                        HelperPane(model: model, helper: helper)
                    }
                } else {
                    Waiting(text: model.helpers.list == nil ? "Waiting for ZENO…" : "No helpers yet")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .background(Rectangle().fill(palette.surfaceFill(solid: true)).ignoresSafeArea())
        .ignoresSafeArea(edges: .top)
        .themed(palette)
    }
}

private struct Waiting: View {
    let text: String
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text(text).font(.system(size: 12)).foregroundStyle(theme.text2.color)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Left: the helpers

private struct HelperSidebar: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button { model.helpers.selectBoard() } label: { BoardRow(model: model, selected: model.helpers.showsBoard) }
                .buttonStyle(.plain)
            ForEach(model.helpers.list?.helpers ?? []) { helper in
                Button { model.helpers.selectHelper(helper.id) } label: {
                    HelperCard(helper: helper, selected: !model.helpers.showsBoard && helper.id == model.helpers.selectedHelperId)
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
            if let list = model.helpers.list { AllowLargeSwitch(model: model, list: list) }
        }
        .padding(.horizontal, 14)
        .padding(.top, HelpersView.titleBarRoom)
        .padding(.bottom, 18)
        .frame(maxHeight: .infinity, alignment: .top)
        // Darker than the window: the list sits back, the chosen helper comes forward. Void: one black, the hairline
        // between them is enough.
        .background((theme.isFlat ? Color.clear : theme.isDark ? Color.black.opacity(0.2) : theme.fill1.color).ignoresSafeArea())
    }
}

/// "Allow the large model for helpers" (ADR-083): window-wide, so it sits at the bottom of the sidebar.
private struct AllowLargeSwitch: View {
    let model: IslandModel
    let list: HelpersList
    @Environment(\.theme) private var theme

    var body: some View {
        let enabled = !list.models.isEmpty
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Allow the large model for helpers")
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                Text(enabled ? "Off: jobs use at most the medium model, saving your plan." : "Needs the Claude plan")
                    .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            ThemedSwitch(isOn: list.allowLarge, set: { model.sendHelpers(model.helpers.setAllowLarge($0)) },
                         label: "Allow the large model for helpers")
                .shadow(color: theme.accent.color.opacity(list.allowLarge && enabled && theme.isDark && theme.usesGlow ? 0.5 : 0), radius: 6)
                .disabled(!enabled)
        }
        .padding(.horizontal, 8)
        .opacity(enabled ? 1 : 0.6)
    }
}

private struct HelperCard: View {
    let helper: Helper
    let selected: Bool
    @Environment(\.theme) private var theme

    var body: some View {
        let running = helper.jobs.contains { $0.state == .running }
        HStack(spacing: 11) {
            HelperBadge(helper: helper, size: 32)
            VStack(alignment: .leading, spacing: 1) {
                Text(helper.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color)
                Group {
                    if !helper.available {
                        Text("Coming soon").foregroundStyle(theme.text3.color)
                    } else if running {
                        Text(helper.activity).foregroundStyle(theme.statusDots ? theme.text2.color : theme.live.color)
                    } else {
                        // The app is an identifier: SF Mono in Void.
                        Text(helper.app ?? "No app").foregroundStyle(theme.text3.color)
                            .font(helper.app == nil ? .system(size: 11) : theme.idFont(.system(size: 11), size: 10.5))
                    }
                }
                .font(.system(size: 11))
            }
            .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 8)
        .background {
            if theme.isFlat {
                // Void: the chosen helper is outlined with a hairline, not filled.
                RoundedRectangle(cornerRadius: theme.radiusControl + 4, style: .continuous)
                    .strokeBorder(selected ? theme.border.color : .clear, lineWidth: 1)
            } else {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(selected ? (theme.isDark ? theme.fill2.color : Color.white.opacity(0.85)) : Color.clear)
                    .shadow(color: .black.opacity(selected && !theme.isDark ? 0.06 : 0), radius: 1.5, y: 0.5)
            }
        }
        .opacity(helper.available ? 1 : 0.5)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A helper's mark (ADR-085): its avatar image for what it is doing, else its first letter, in a disc. While it
/// works, an arc of Wisp's light runs round it (a still ring with Reduce Motion).
struct HelperBadge: View {
    let helper: Helper
    let size: CGFloat
    @Environment(\.theme) private var theme

    var body: some View {
        let working = helper.jobs.contains { $0.state == .running }
        Group {
            if let image = AvatarImages.image(helper.id, AvatarExpression.helper(helper)) {
                // Exports leave room around the character: a little larger, so it fills the disc.
                Image(nsImage: image).resizable().scaledToFit().scaleEffect(1.15)
            } else {
                Text(helper.name.prefix(1).uppercased())
                    .font(.system(size: size * 0.42, weight: .semibold, design: .rounded))
                    .foregroundStyle(theme.text.color)
            }
        }
        .frame(width: size, height: size)
        .background(Circle().fill(theme.isFlat ? Color.clear : theme.fill2.color))
        .clipShape(Circle())
        .overlay { if theme.isFlat { Circle().strokeBorder(theme.border.color, lineWidth: 1) } } // Void: a hairline disc
        .overlay { if working { WorkingArc(lineWidth: size >= 36 ? 2.2 : 1.8).padding(-3.5) } }
        .accessibilityHidden(true)
    }
}

/// Wisp's light running round a working helper's disc: a 70% arc that fades in from its tail and turns once every
/// 1.6 s. Still with Reduce Motion (a full, quiet ring) and in snapshots (the arc).
private struct WorkingArc: View {
    let lineWidth: CGFloat
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let light = theme.live.color
        if reduceMotion {
            Circle().stroke(light.opacity(0.75), lineWidth: lineWidth)
                .shadow(color: light.opacity(theme.usesGlow ? 0.4 : 0), radius: 4)
        } else if snapshot {
            arc(light)
        } else {
            TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
                let turn = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6) / 1.6
                arc(light).rotationEffect(.degrees(turn * 360))
            }
        }
    }

    private func arc(_ light: Color) -> some View {
        Circle()
            .trim(from: 0, to: 0.7)
            .stroke(AngularGradient(colors: [light.opacity(0), light], center: .center, startAngle: .degrees(0), endAngle: .degrees(252)),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
            .rotationEffect(.degrees(-90))
            .shadow(color: light.opacity(theme.usesGlow ? 0.5 : 0), radius: 4)
    }
}

// MARK: - Right: one helper

private struct HelperPane: View {
    let model: IslandModel
    let helper: Helper
    @Environment(\.theme) private var theme

    var body: some View {
        Scrollable {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 14) {
                    HelperBadge(helper: helper, size: 42)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(helper.name).font(.system(size: 18, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                        Text(Self.subtitle(helper)).font(.system(size: 12)).foregroundStyle(theme.text2.color)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    if helper.soul != nil {
                        QuietButton(title: "Soul", symbol: "sparkles") { model.helpers.openSoul() }
                            .help("Who \(helper.name) is and how it works")
                    }
                }
                if helper.available {
                    HStack(spacing: 8) {
                        AppPicker(model: model, helper: helper)
                        ModelPicker(model: model, helper: helper, models: model.helpers.list?.models ?? [])
                    }
                    if let budget = helper.budget { BudgetPicker(model: model, helper: helper, budget: budget) }
                    VStack(alignment: .leading, spacing: 8) {
                        TaskField(model: model, helper: helper)
                        WaitsForMenu(model: model)
                    }
                    if let problem = model.helpers.problem { ProblemLine(text: problem) }
                    JobList(model: model, helper: helper)
                } else {
                    Text("\(helper.name) is not ready for jobs yet. You can shape its soul now.")
                        .font(.system(size: 12.5)).foregroundStyle(theme.text2.color)
                }
            }
            .padding(.horizontal, Spacing.panel)
            .padding(.top, 28)
            .padding(.bottom, Spacing.panel)
        }
    }

    /// Under the name: the role, then the job counts ("Researcher · 1 running, 1 done").
    static func subtitle(_ helper: Helper) -> String {
        let summary = helper.available ? Self.summary(helper) : "Coming soon"
        return helper.roleTitle.isEmpty ? summary : "\(helper.roleTitle) · \(summary)"
    }

    /// How many jobs are running, waiting and done ("1 running, 1 waiting, 1 done"). The step itself is in the sidebar
    /// and on the job.
    static func summary(_ helper: Helper) -> String {
        let counts: [(JobState, String)] = [(.running, "running"), (.queued, "waiting"), (.done, "done"), (.failed, "failed")]
        let parts = counts.compactMap { state, word in
            let n = helper.jobs.filter { $0.state == state }.count
            return n > 0 ? "\(n) \(word)" : nil
        }
        return parts.isEmpty ? "Ready for a task" : parts.joined(separator: ", ")
    }
}

/// A compact pill for a pop-up menu: a quiet label, the value and an up-down chevron, as in the mock.
struct PillMenuLabel: View {
    let label: String
    let value: String
    var dimmed = false
    var identifier = true
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 6) {
            Text(label).foregroundStyle(theme.text3.color)
            // The app or model is an identifier: SF Mono in Void (a sentence such as "Chosen by Laya" stays sans).
            Text(value).fontWeight(.medium).foregroundStyle(dimmed ? theme.text2.color : theme.text.color)
                .font(identifier ? theme.idFont(.system(size: 11.5), size: 11) : .system(size: 11.5))
            Image(systemName: "chevron.up.chevron.down").font(.system(size: 8, weight: .bold)).foregroundStyle(theme.text3.color)
        }
        .font(.system(size: 11.5))
        .lineLimit(1)
        .padding(.horizontal, 12)
        .frame(height: 28)
        .background {
            if theme.isGhost {
                ControlFill(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous), fill: Color.clear)
            } else {
                Capsule().fill(theme.fill2.color)
            }
        }
        .contentShape(Capsule())
    }
}

private struct AppPicker: View {
    let model: IslandModel
    let helper: Helper

    var body: some View {
        Menu {
            Button { model.sendHelpers(model.helpers.setApp(nil)) } label: {
                if helper.app == nil { Label("No app", systemImage: "checkmark") } else { Text("No app") }
            }
            Divider()
            ForEach(model.helpers.list?.apps ?? [], id: \.self) { app in
                Button { model.sendHelpers(model.helpers.setApp(app)) } label: {
                    if app == helper.app { Label(app, systemImage: "checkmark") } else { Text(app) }
                }
            }
        } label: {
            PillMenuLabel(label: "Opens in", value: helper.app ?? "No app", dimmed: helper.app == nil, identifier: helper.app != nil)
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .help("Where \(helper.name) opens what it finds")
        .accessibilityLabel("\(helper.name)'s app")
    }
}

/// "Chosen by Laya" or a pinned model (ADR-083). Without the Claude plan the pill says so and is disabled.
private struct ModelPicker: View {
    let model: IslandModel
    let helper: Helper
    let models: [HelperModel]

    var body: some View {
        let pinned = models.first { $0.id == helper.pinnedModel }
        let value = models.isEmpty ? "Needs the Claude plan" : (pinned?.name ?? helper.pinnedModel ?? "Chosen by Laya")
        Menu {
            Button { model.sendHelpers(model.helpers.pinModel(nil)) } label: {
                if helper.pinnedModel == nil { Label("Chosen by Laya", systemImage: "checkmark") } else { Text("Chosen by Laya") }
            }
            Divider()
            ForEach(models) { option in
                Button { model.sendHelpers(model.helpers.pinModel(option.id)) } label: {
                    if option.id == helper.pinnedModel { Label(option.name, systemImage: "checkmark") } else { Text(option.name) }
                }
            }
        } label: {
            PillMenuLabel(label: "Model", value: value, dimmed: models.isEmpty, identifier: helper.pinnedModel != nil && !models.isEmpty)
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .disabled(models.isEmpty)
        .help("The model \(helper.name)'s jobs run on")
        .accessibilityLabel("\(helper.name)'s model")
    }
}

/// "Give Sid a task": a capsule with an arrow button, concentric with it (40 tall, the 28 pt button 6 from the
/// edge). Return or the arrow adds it.
private struct TaskField: View {
    let model: IslandModel
    let helper: Helper
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let draft = State(initialValue: "")
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let ready = !draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        HStack(spacing: 8) {
            if snapshot { // ImageRenderer cannot draw a text field
                Text("Give \(helper.name) a task").font(.system(size: 12.5)).foregroundStyle(theme.text3.color)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                TextField("Give \(helper.name) a task", text: draft.projectedValue)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12.5))
                    .foregroundStyle(theme.text.color)
                    .onSubmit(add)
                    .accessibilityLabel("Task for \(helper.name)")
            }
            Button(action: add) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(ready ? (theme.isGhost ? theme.text.color : theme.onAccent.color) : theme.text3.color)
                    .frame(width: 28, height: 28)
                    .background(ControlFill(Circle(), fill: ready ? AnyShapeStyle(theme.accentFill) : AnyShapeStyle(theme.fill2.color), hovering: ready))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(!ready)
            .help("Add")
            .accessibilityLabel("Add")
        }
        .padding(.leading, 16)
        .padding(.trailing, 6)
        .frame(height: 40)
        .background {
            if theme.isFlat {
                // Void: the composer's shape (16), a 1 px hairline, no fill.
                RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).strokeBorder(theme.border.color, lineWidth: 1)
            } else {
                Capsule().fill(theme.fill1.color)
            }
        }
        .overlay { if !theme.isFlat { Capsule().strokeBorder(theme.separator.color, lineWidth: 0.6) } }
    }

    private func add() {
        guard let command = model.helpers.addJob(draft.wrappedValue) else { return }
        model.send(command)
        draft.wrappedValue = ""
    }
}

/// Every job in one well, newest first; a hairline between rows.
private struct JobList: View {
    let model: IslandModel
    let helper: Helper
    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            if helper.jobs.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text("No jobs yet").font(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color)
                    Text("Give \(helper.name) a task above.").font(.system(size: 11.5)).foregroundStyle(theme.text3.color)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
            ForEach(Array(helper.jobs.enumerated()), id: \.element.id) { index, job in
                if index > 0 { Rectangle().fill(theme.separator.color).frame(height: theme.isFlat ? 1 : 0.5) }
                JobRow(model: model, job: job)
            }
        }
        .background(shape.fill(theme.fill1.color))
        .overlay(shape.strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
    }
}

private struct JobRow: View {
    let model: IslandModel
    let job: HelperJob
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            JobDot(job: job).padding(.top, 5)
            VStack(alignment: .leading, spacing: 4) {
                Button { model.sendHelpers(model.helpers.openThread(job.id)) } label: {
                    Text(job.title ?? job.task)
                        .font(.system(size: 13, weight: job.hasReport ? .semibold : .medium))
                        .foregroundStyle(theme.text.color)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
                .help("Open the task")
                if job.isWaiting, let list = model.helpers.list { WaitingLine(job: job, list: list) }
                if let held = job.held { HeldLine(reason: held) }
                if let summary = job.summary {
                    Text(summary).font(.system(size: 11.5)).foregroundStyle(theme.text2.color)
                }
                if job.state == .running, let step = job.step {
                    HStack(spacing: 8) {
                        if let progress = job.progress { ProgressLine(fraction: progress) }
                        Text(step).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.statusDots ? theme.text2.color : theme.live.color).lineLimit(1)
                    }
                }
                if job.state == .failed, let error = job.error { ProblemLine(text: error, dot: false) }
                // The model and Laya's reason are identifiers: SF Mono in Void.
                if let meta = meta { Text(meta).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(2) }
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                if job.hasReport {
                    ReadReportButton { model.sendHelpers(model.helpers.openThread(job.id)) }
                }
                if job.state.isActive {
                    QuietButton(title: "Stop") { model.sendHelpers(model.helpers.stopJob(job.id)) }
                }
                IconButton(symbol: "trash", label: "Delete") { model.sendHelpers(model.helpers.deleteJob(job.id)) }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
        .help(help)
    }

    /// The quiet line: how a done job ended early, the model and Laya's reason, or when it was added.
    private var meta: String? {
        var parts: [String] = []
        if job.state == .done && job.partial { parts.append("Partial report") }
        if job.state == .stopped { parts.append("Stopped") }
        if let line = model.helpers.list?.modelLine(job) { parts.append(line) } else if let time = Self.time(job) { parts.append(time) }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    /// On hover: the task as given and when it ran.
    private var help: String {
        [job.hasReport ? job.task : nil, Self.time(job)].compactMap { $0 }.joined(separator: "\n")
    }

    /// "Added 5 min. ago", and when it ended.
    private static func time(_ job: HelperJob) -> String? {
        let style = Date.RelativeFormatStyle(presentation: .named, unitsStyle: .abbreviated)
        guard let created = job.createdAt else { return nil }
        let added = "Added \(created.formatted(style))"
        guard let ended = job.endedAt, !job.state.isActive else { return added }
        return "\(added), ended \(ended.formatted(style))"
    }
}

/// A job's state as a dot: lit and glowing while running, a ring while queued, solid grey when done, coral when it
/// failed, a faint grey when stopped. The state's word is its VoiceOver label.
struct JobDot: View {
    let job: HelperJob
    @Environment(\.theme) private var theme

    var body: some View {
        Group {
            switch job.state {
            case .running:
                Circle().fill(theme.live.color).shadow(color: theme.live.color.opacity(theme.usesGlow ? 0.9 : 0), radius: 4)
            case .queued:
                Circle().strokeBorder(theme.text3.color, lineWidth: 1.2)
            case .done:
                Circle().fill(theme.statusDots ? theme.success.color : theme.text2.color) // Void: done is green
            case .failed:
                Circle().fill(theme.problem.color).shadow(color: theme.problem.color.opacity(theme.usesGlow ? 0.6 : 0), radius: 3)
            case .stopped:
                Circle().fill(theme.text3.color.opacity(0.6))
            }
        }
        .frame(width: 7, height: 7)
        .accessibilityLabel(job.badge)
    }
}

/// A thin line of Wisp's light under a running job, as far as its step's "n of m".
struct ProgressLine: View {
    let fraction: Double
    @Environment(\.theme) private var theme

    var body: some View {
        ZStack(alignment: .leading) {
            Capsule().fill(theme.fill3.color)
            Capsule().fill(theme.live.color)
                .frame(width: max(3, 120 * min(1, max(0, fraction))))
                .shadow(color: theme.live.color.opacity(theme.usesGlow ? 0.7 : 0), radius: 4)
        }
        .frame(width: 120, height: 3)
        .accessibilityHidden(true)
    }
}

/// "Read report": the window's one lit button, outlined in Wisp's light.
struct ReadReportButton: View {
    let action: () -> Void
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if theme.isGhost { ghost } else { lit }
    }

    /// Void (ADR-086): a ghost button with a violet hairline and label, brightening on hover.
    private var ghost: some View {
        let violet = theme.idColor(theme.accent)
        return Button(action: action) {
            Text("Read report")
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(violet)
                .padding(.horizontal, 12)
                .frame(height: 26)
                .background(ControlFill(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous), fill: Color.clear,
                                        hovering: hovering.wrappedValue, tint: violet))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
        .animation(Motion.plain, value: hovering.wrappedValue)
    }

    private var lit: some View {
        Button(action: action) {
            Text("Read report")
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(theme.accent.color)
                .padding(.horizontal, 13)
                .frame(height: 26)
                .background(Capsule().fill(theme.accent.color.opacity(hovering.wrappedValue ? 0.12 : 0)))
                .overlay(Capsule().strokeBorder(theme.accent.color.opacity(0.45), lineWidth: 0.8))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
        .animation(Motion.snap(reduceMotion), value: hovering.wrappedValue)
    }
}

/// A quiet capsule button: Stop, Jobs.
struct QuietButton: View {
    let title: String
    var symbol: String? = nil
    let action: () -> Void
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let symbol { Image(systemName: symbol).font(.system(size: 10, weight: .semibold)) }
                Text(title).font(.system(size: 11.5, weight: .medium))
            }
            .foregroundStyle(hovering.wrappedValue ? theme.text.color : theme.text2.color)
            .padding(.horizontal, 12)
            .frame(height: 26)
            .background {
                if theme.isGhost {
                    ControlFill(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous), fill: Color.clear, hovering: hovering.wrappedValue)
                } else {
                    Capsule().fill(hovering.wrappedValue ? theme.fill3.color : theme.fill2.color)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
        .animation(Motion.hover(reduceMotion, ghost: theme.isGhost), value: hovering.wrappedValue)
    }
}

struct ProblemLine: View {
    let text: String
    /// Void: lead with a red dot; off where the row's own dot already says it failed.
    var dot = true
    @Environment(\.theme) private var theme

    var body: some View {
        if theme.statusDots {
            // Void (ADR-086): the colour is only the dot; the words stay quiet.
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                if dot { StatusDot(color: theme.problem.color, size: 6) }
                Text(text).font(.system(size: 11.5)).foregroundStyle(theme.text2.color)
            }
            .fixedSize(horizontal: false, vertical: true)
        } else {
            Label(text, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 11))
                .foregroundStyle(theme.problem.color)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

