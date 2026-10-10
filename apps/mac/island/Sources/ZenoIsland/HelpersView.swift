import AppKit
import SwiftUI
import ZenoIslandCore

/// The Helpers window's content (ADR-081): one card per helper on the left; the chosen helper's app, a task field and
/// its jobs on the right, or the report being read. The logic lives in `HelpersState`; these views only draw it.
struct HelpersView: View {
    let model: IslandModel

    var body: some View {
        let palette = model.settings.theme.palette
        HStack(spacing: 0) {
            HelperSidebar(model: model).frame(width: 220)
            Rectangle().fill(palette.separator.color).frame(width: 0.5)
            Group {
                if let helper = model.helpers.selectedHelper {
                    if model.helpers.openJobId != nil {
                        ReportPane(model: model)
                    } else {
                        HelperPane(model: model, helper: helper)
                    }
                } else {
                    Waiting(text: model.helpers.list == nil ? "Waiting for ZENO…" : "No helpers yet")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .background(palette.surfaceSolid.color)
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
        VStack(alignment: .leading, spacing: 6) {
            Text("Helpers")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(theme.text2.color)
                .padding(.leading, 6)
            ForEach(model.helpers.list?.helpers ?? []) { helper in
                Button { model.helpers.selectHelper(helper.id) } label: {
                    HelperCard(helper: helper, selected: helper.id == model.helpers.selectedHelperId)
                }
                .buttonStyle(.plain)
                .disabled(!helper.available)
            }
            Spacer(minLength: 0)
            if let list = model.helpers.list { AllowLargeSwitch(model: model, list: list) }
        }
        .padding(12)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(theme.fill1.color)
    }
}

/// "Allow the large model for helpers" (ADR-083): window-wide, so it sits under the helper list.
private struct AllowLargeSwitch: View {
    let model: IslandModel
    let list: HelpersList
    @Environment(\.theme) private var theme

    var body: some View {
        let enabled = !list.models.isEmpty
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top, spacing: 8) {
                Text("Allow the large model for helpers")
                    .font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text.color)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                ThemedSwitch(isOn: list.allowLarge, set: { model.sendHelpers(model.helpers.setAllowLarge($0)) },
                             label: "Allow the large model for helpers")
                    .disabled(!enabled)
            }
            Text(enabled ? "Off: jobs use at most the medium model, saving your plan." : "Needs the Claude plan")
                .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(9)
        .opacity(enabled ? 1 : 0.6)
    }
}

private struct HelperCard: View {
    let helper: Helper
    let selected: Bool
    @Environment(\.theme) private var theme

    var body: some View {
        let running = helper.jobs.contains { $0.state == .running }
        HStack(spacing: 10) {
            HelperBadge(size: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(helper.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color)
                if helper.available {
                    Text(helper.app ?? "No app").font(.system(size: 11)).foregroundStyle(theme.text2.color)
                    Text(helper.activity).font(.system(size: 11)).foregroundStyle(running ? theme.live.color : theme.text3.color)
                } else {
                    Text("Coming soon").font(.system(size: 11)).foregroundStyle(theme.text3.color)
                }
            }
            .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(9)
        .background {
            RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
                .fill(selected ? (theme.isDark ? theme.fill3.color : Color.white) : Color.clear)
                .shadow(color: .black.opacity(selected && !theme.isDark ? 0.08 : 0), radius: 1.5, y: 0.5)
        }
        .opacity(helper.available ? 1 : 0.5)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A plain, neutral mark for a helper. Each helper's own look comes later (Task 3.5).
private struct HelperBadge: View {
    let size: CGFloat
    @Environment(\.theme) private var theme

    var body: some View {
        Image(systemName: "person.fill")
            .font(.system(size: size * 0.45, weight: .medium))
            .foregroundStyle(theme.text2.color)
            .frame(width: size, height: size)
            .background(Circle().fill(theme.fill2.color))
            .accessibilityHidden(true)
    }
}

// MARK: - Right: one helper

private struct HelperPane: View {
    let model: IslandModel
    let helper: Helper
    @Environment(\.theme) private var theme

    var body: some View {
        Scrollable {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    HelperBadge(size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(helper.name).font(.system(size: 18, weight: .bold)).foregroundStyle(theme.text.color)
                        Text(helper.app.map { "Works in \($0)" } ?? "No app chosen")
                            .font(.system(size: 12)).foregroundStyle(theme.text2.color)
                    }
                }
                Card(footer: "Where \(helper.name) opens what it finds, and the model its jobs run on.") {
                    Row(title: "App") { AppPicker(model: model, helper: helper) }
                    RowDivider()
                    let models = model.helpers.list?.models ?? []
                    Row(title: "Model", detail: models.isEmpty ? "Needs the Claude plan" : nil) {
                        ModelPicker(model: model, helper: helper, models: models)
                    }
                }
                TaskField(model: model, helper: helper)
                if let problem = model.helpers.problem { ProblemLine(text: problem) }
                Card("Jobs") {
                    if helper.jobs.isEmpty {
                        Row(title: "No jobs yet", detail: "Give \(helper.name) a task above.") { EmptyView() }
                    }
                    ForEach(Array(helper.jobs.enumerated()), id: \.element.id) { index, job in
                        if index > 0 { RowDivider() }
                        JobRow(model: model, job: job)
                    }
                }
            }
            .padding(18)
        }
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
            MenuLabel(text: helper.app ?? "No app", dimmed: helper.app == nil)
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .accessibilityLabel("\(helper.name)'s app")
    }
}

/// "Chosen by Laya" or a pinned model (ADR-083).
private struct ModelPicker: View {
    let model: IslandModel
    let helper: Helper
    let models: [HelperModel]

    var body: some View {
        let pinned = models.first { $0.id == helper.pinnedModel }
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
            MenuLabel(text: pinned?.name ?? helper.pinnedModel ?? "Chosen by Laya", dimmed: helper.pinnedModel == nil || models.isEmpty)
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .disabled(models.isEmpty)
        .accessibilityLabel("\(helper.name)'s model")
    }
}

/// "Give Sid a task": Return or Add sends it.
private struct TaskField: View {
    let model: IslandModel
    let helper: Helper
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let draft = State(initialValue: "")
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
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
            PillButton(title: "Add", prominent: true, action: add)
                .disabled(draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.leading, 11)
        .padding(.trailing, 5)
        .padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).fill(theme.fill1.color))
        .overlay(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).strokeBorder(theme.separator.color, lineWidth: 0.5))
    }

    private func add() {
        guard let command = model.helpers.addJob(draft.wrappedValue) else { return }
        model.send(command)
        draft.wrappedValue = ""
    }
}

private struct JobRow: View {
    let model: IslandModel
    let job: HelperJob
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            StateBadge(job: job)
            VStack(alignment: .leading, spacing: 3) {
                Text(job.task).font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(2)
                if let line = model.helpers.list?.modelLine(job) {
                    Text(line).font(.system(size: 10.5)).foregroundStyle(theme.text2.color)
                }
                if let title = job.title {
                    Text(title).font(.system(size: 11.5, weight: .semibold)).foregroundStyle(theme.text.color)
                }
                if let summary = job.summary {
                    Text(summary).font(.system(size: 11)).foregroundStyle(theme.text2.color)
                }
                if job.state == .running, let step = job.step {
                    Text(step).font(.system(size: 11)).foregroundStyle(theme.live.color)
                }
                if job.state == .failed, let error = job.error { ProblemLine(text: error) }
                if let time = Self.time(job) {
                    Text(time).font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 6)
            HStack(spacing: 6) {
                if job.hasReport {
                    PillButton(title: "Read", symbol: "doc.text") { model.sendHelpers(model.helpers.openReport(job.id)) }
                }
                if job.state.isActive {
                    PillButton(title: "Stop", symbol: "stop.fill") { model.sendHelpers(model.helpers.stopJob(job.id)) }
                }
                IconButton(symbol: "trash", label: "Delete") { model.sendHelpers(model.helpers.deleteJob(job.id)) }
            }
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 9)
    }

    /// "Added 5 min. ago", and when it ended.
    private static func time(_ job: HelperJob) -> String? {
        let style = Date.RelativeFormatStyle(presentation: .named, unitsStyle: .abbreviated)
        guard let created = job.createdAt else { return nil }
        let added = "Added \(created.formatted(style))"
        guard let ended = job.endedAt, !job.state.isActive else { return added }
        return "\(added) · ended \(ended.formatted(style))"
    }
}

private struct StateBadge: View {
    let job: HelperJob
    @Environment(\.theme) private var theme

    var body: some View {
        let color: Color = switch job.state {
        case .queued: theme.text2.color
        case .running: theme.live.color
        case .done: job.partial ? theme.attention.color : theme.success.color
        case .failed: theme.problem.color
        case .stopped: theme.text3.color
        }
        Text(job.badge)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .frame(width: 62, height: 18)
            .background(Capsule().fill(color.opacity(0.14)))
    }
}

private struct ProblemLine: View {
    let text: String
    @Environment(\.theme) private var theme

    var body: some View {
        Label(text, systemImage: "exclamationmark.triangle.fill")
            .font(.system(size: 11))
            .foregroundStyle(theme.problem.color)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Right: a report

private struct ReportPane: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        Scrollable {
            VStack(alignment: .leading, spacing: 12) {
                PillButton(title: "Jobs", symbol: "chevron.left") { model.helpers.closeReport() }
                if let report = model.helpers.report {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(report.title).font(.system(size: 18, weight: .bold)).foregroundStyle(theme.text.color)
                        Text(report.summary).font(.system(size: 12.5)).foregroundStyle(theme.text2.color)
                    }
                    ForEach(Array(report.paragraphs.enumerated()), id: \.offset) { _, paragraph in
                        Text(paragraph).font(.system(size: 12.5)).foregroundStyle(theme.text.color).lineSpacing(2)
                    }
                    if !report.sources.isEmpty {
                        Card("Sources") {
                            ForEach(Array(report.sources.enumerated()), id: \.offset) { index, source in
                                if index > 0 { RowDivider() }
                                SourceRow(source: source)
                            }
                        }
                    }
                } else if let problem = model.helpers.problem {
                    ProblemLine(text: problem)
                } else {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Loading report…").font(.system(size: 12)).foregroundStyle(theme.text2.color)
                    }
                }
            }
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
        }
    }
}

private struct SourceRow: View {
    let source: ReportSource
    @Environment(\.theme) private var theme

    var body: some View {
        Button {
            // The decoder keeps http(s) sources only; checked again here, right before opening.
            if let url = ReportSource.webURL(source.url.absoluteString) { NSWorkspace.shared.open(url) }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "link").font(.system(size: 11, weight: .semibold)).foregroundStyle(theme.accent.color)
                VStack(alignment: .leading, spacing: 1) {
                    Text(source.title).font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                    Text(source.url.host ?? source.url.absoluteString).font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                }
                .lineLimit(1)
                Spacer(minLength: 6)
                Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(theme.text3.color)
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(source.url.absoluteString)
    }
}
