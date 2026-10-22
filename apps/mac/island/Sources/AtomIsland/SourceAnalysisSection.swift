import SwiftUI
import AtomIslandCore

struct SourceAnalysisSection: View {
    let model: IslandModel
    let openNote: (Int) -> Void
    @State private var clearing = false
    @State private var cursor: Int?
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    private var waiting: Bool { model.sourceAnalysisPending != nil }
    private var view: SourceAnalysisView? { model.sourceAnalysisView?.source == model.brainSources.folder?.id ? model.sourceAnalysisView : nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider()
            Text("Background analysis").font(.system(size: 14, weight: .semibold))
            Text("Analyze the imported copies in chunks with Claude or Codex. Progress is saved between chunks; source files, notes, chats and permissions stay unchanged. Refresh the folder separately when you want newer copies.")
            if let error = model.sourceAnalysisError { ProblemLine(text: error) }
            if let view, let record = view.record {
                let settings = record.settings
                let active = view.busy == true || record.job?.state == "running"
                Text("\(view.used) of \(settings.dailyLimit) model attempts on \(view.day). Failed/cancelled attempts count; clear/pause does not reset this budget.")
                    .foregroundStyle(theme.text2.color)
                if let profile = view.profile {
                    Text("Selected for a new job: \(profile.provider) / \(profile.model) · \(profile.effort)")
                        .textSelection(.enabled)
                } else { Text("Select Claude or Codex in chat before starting or enabling a schedule.").foregroundStyle(theme.text3.color) }
                HStack {
                    Text("Daily analysis while ATOM is running")
                    Spacer()
                    ThemedSwitch(isOn: settings.enabled, set: { model.requestSourceAnalysis("configure", enabled: $0) }, label: "Daily source analysis")
                        .disabled(waiting || active || (!settings.enabled && view.profile == nil))
                }
                HStack(spacing: 18) {
                    DatePicker("Local time", selection: Binding(get: {
                        var time = BriefSettings(); time.minute = settings.minute; return time.time(on: Date())
                    }, set: { model.requestSourceAnalysis("configure", minute: BriefSettings.minute(of: $0)) }), displayedComponents: .hourAndMinute)
                    Stepper("\(settings.dailyLimit) attempts / day", value: Binding(get: { settings.dailyLimit }, set: { model.requestSourceAnalysis("configure", dailyLimit: $0) }), in: 1...10)
                }.disabled(waiting || active)
                if let pinned = settings.profile, settings.enabled {
                    Text("Schedule model: \(pinned.provider) / \(pinned.model). No automatic provider switch, system wake or filesystem scan.").foregroundStyle(theme.text3.color)
                    Button("Use selected model for future scheduled jobs") { model.requestSourceAnalysis("configure", pinCurrent: true) }
                        .disabled(waiting || active || view.profile == nil)
                }
                if let job = record.job {
                    Text("\(job.state.capitalized)\(job.reason.map { " · " + $0 } ?? "") · \(job.index) / \(job.entries.count) notes · text offset \(job.offset)")
                        .fontWeight(.medium)
                    Text("\(job.chunks) chunks saved · \(job.reused) reused · \(job.calls) attempts in this job · \(job.skipped) notes skipped")
                    Text("Job model: \(job.profile.provider) / \(job.profile.model) · \(job.profile.effort)").foregroundStyle(theme.text3.color)
                    if let message = job.message { Text(message).foregroundStyle(theme.attention.color) }
                    if job.state == "paused" || job.state == "failed" {
                        Text("Resume keeps finished chunks and uses the job model shown above. An unfinished request may already have used tokens and can be sent again. Interrupted jobs wait for your resume; scheduled budget pauses can continue on a later day.")
                            .foregroundStyle(theme.text3.color)
                    }
                }
                HStack(spacing: 10) {
                    Button("Analyze imported copies") { cursor = nil; model.requestSourceAnalysis("start") }
                        .disabled(waiting || active || view.profile == nil || (record.job != nil && record.job?.state != "done"))
                    if let job = record.job {
                        if job.state == "running" {
                            Button("Pause and disable schedule") { model.requestSourceAnalysis("pause") }.disabled(waiting)
                        } else if job.state != "done" {
                            Button("Resume") { model.requestSourceAnalysis("resume") }.disabled(waiting || active)
                        }
                    }
                    Button("Clear analysis…") { clearing = true }.disabled(waiting)
                }
                Text("Analysis sends each imported chunk to the displayed model in a separate tool-free request. Up to 8 MiB/500 notes per job; unsafe, changed, missing or oversized copies are skipped. Reports are lossy reference data, never verified actions or permission.")
                    .foregroundStyle(theme.text3.color)
                reports(view)
            }
            if view?.record == nil, view?.source != nil {
                Button("Clear unreadable analysis…") { clearing = true }.disabled(waiting)
            }
            Button("Reload analysis status") { model.requestSourceAnalysis("get", before: cursor) }.disabled(waiting)
        }
        .font(.system(size: 12)).foregroundStyle(theme.text.color)
        .confirmationDialog("Clear saved analysis, progress and its schedule? Imported notes and original files stay untouched. Today's model budget is retained.", isPresented: $clearing) {
            Button("Clear derived analysis", role: .destructive) { cursor = nil; model.requestSourceAnalysis("clear") }
            Button("Cancel", role: .cancel) {}
        }
        .task(id: model.brainSources.folder?.id) {
            guard !snapshot else { return }
            cursor = nil
            while !Task.isCancelled {
                if model.sourceAnalysisPending == nil, model.sourceAnalysisReady,
                   model.sourceAnalysisError == nil || model.sourceAnalysisView != nil { model.requestSourceAnalysis("get", before: cursor) }
                do { try await Task.sleep(for: .seconds(2)) } catch { return }
            }
        }
    }

    private func reports(_ view: SourceAnalysisView) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(view.parts) { part in
                DisclosureGroup(part.title + (part.stale ? " · source changed or unavailable" : "")) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Note \(part.note), text offsets \(part.offset)–\(part.end). Source copy checked \(part.checkedAt).")
                            .foregroundStyle(theme.text3.color)
                        Text("\(part.profile.provider) / \(part.profile.model) · prepared \(part.createdAt)").foregroundStyle(theme.text3.color)
                        Text(part.text).textSelection(.enabled)
                        HStack {
                            ChatCopyControl(title: "Copy analysis") { MarkdownCopy.Content(text: part.text) }
                            Button("Read original note") { openNote(part.note) }
                        }
                    }.padding(.top, 6)
                }
            }
            HStack {
                Button("Newest reports") { cursor = nil; model.requestSourceAnalysis("get") }.disabled(waiting || cursor == nil)
                if let next = view.next {
                    Button("Older reports") { cursor = next; model.requestSourceAnalysis("get", before: next) }.disabled(waiting)
                }
            }
        }
    }
}
