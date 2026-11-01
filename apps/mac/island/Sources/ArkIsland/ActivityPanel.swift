import SwiftUI
import ArkIslandCore

// The window's right panel (2026-10-31, after the reference app Keshab chose): what runs in the background while he
// works, by agent. Working first, with what each is doing now; then Idle, with when it last worked. A row opens the
// running task, or the agent's page. It only reads: nothing here starts or stops work.

struct ActivityPanel: View {
    let model: IslandModel
    @State private var query = ""
    @State private var idleOpen = true
    @State private var workingOpen = true
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let rows = ActivityRows.make(model: model).filter { query.isEmpty || $0.matches(query) }
        let working = rows.filter(\.working)
        let idle = rows.filter { !$0.working }
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Label("Agents", systemImage: "person.2").appFont(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.text.color)
                    .padding(.horizontal, 10).frame(height: 28)
                    .background(theme.fill2.color, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                Spacer(minLength: 0)
                Button { model.activityShown = false } label: {
                    Image(systemName: "sidebar.right").appFont(.system(size: 12.5)).foregroundStyle(theme.text2.color).frame(width: 28, height: 28)
                }
                .buttonStyle(.pressable).help("Hide the Agents panel").accessibilityLabel("Hide the Agents panel")
            }
            search
            Scrollable {
                VStack(alignment: .leading, spacing: 4) {
                    group("Working", count: working.count, open: $workingOpen, rows: working)
                    group("Idle", count: idle.count, open: $idleOpen, rows: idle)
                    if rows.isEmpty {
                        Text(query.isEmpty ? "No agents yet." : "No agent matches “\(query)”.")
                            .appFont(.system(size: 12)).foregroundStyle(theme.text3.color).padding(10)
                    }
                }
            }
        }
        .padding(.horizontal, 10).padding(.top, 12).padding(.bottom, 10)
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private var search: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color)
            if snapshot {
                Text("Search").foregroundStyle(theme.text3.color).frame(maxWidth: .infinity, alignment: .leading)
            } else {
                TextField("Search", text: $query).textFieldStyle(.plain).foregroundStyle(theme.text.color)
                    .onExitCommand { query = "" }
            }
        }
        .appFont(.system(size: 12.5))
        .padding(.horizontal, 10).frame(height: 30)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.separator.color, lineWidth: 1))
    }

    @ViewBuilder private func group(_ title: String, count: Int, open: Binding<Bool>, rows: [ActivityRows.Row]) -> some View {
        if count > 0 {
            Button { open.wrappedValue.toggle() } label: {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.down").appFont(.system(size: 9, weight: .semibold)).foregroundStyle(theme.text3.color)
                        .rotationEffect(.degrees(open.wrappedValue ? 0 : -90))
                    Text(title).appFont(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.text.color)
                    Text("\(count)").appFont(.system(size: 11)).monospacedDigit().foregroundStyle(theme.text3.color)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 8).frame(height: 30)
                .background(theme.fill2.color.opacity(0.6), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(title), \(count)")
            .padding(.top, 4)
            if open.wrappedValue {
                ForEach(rows) { row in ActivityRowView(model: model, row: row) }
            }
        }
    }
}

/// The rows the panel lists, built from the team list and ARK's own status.
enum ActivityRows {
    struct Row: Identifiable {
        let id: String
        let name: String
        let status: String
        let working: Bool
        let at: Date?
        let helperId: String?
        let jobId: Int?

        func matches(_ query: String) -> Bool {
            name.localizedCaseInsensitiveContains(query) || status.localizedCaseInsensitiveContains(query)
        }
    }

    @MainActor static func make(model: IslandModel) -> [Row] {
        var rows: [Row] = []
        // ARK itself, while it thinks or acts in the chat.
        switch model.status.kind {
        case .thinking, .transcribing, .acting, .speaking:
            let status = model.status.currentStep ?? (model.status.kind == .acting ? "Acting" : model.status.kind == .speaking ? "Speaking" : "Thinking")
            rows.append(Row(id: "ark", name: "ARK", status: status, working: true, at: Date(), helperId: nil, jobId: nil))
        default: break
        }
        for helper in model.helpers.list?.helpers ?? [] {
            let running = helper.jobs.filter { $0.state == .running }
            let queued = helper.jobs.filter { $0.state == .queued }
            if let job = running.first {
                let more = running.count > 1 ? " · \(running.count) tasks" : ""
                rows.append(Row(id: helper.id, name: helper.name, status: (job.step ?? "Working") + more, working: true,
                                at: Date(), helperId: helper.id, jobId: job.id))
            } else if let job = queued.first {
                rows.append(Row(id: helper.id, name: helper.name, status: queued.count == 1 ? "Waiting to start" : "\(queued.count) waiting",
                                working: true, at: job.createdAt, helperId: helper.id, jobId: job.id))
            } else {
                let last = helper.jobs.compactMap { $0.endedAt ?? $0.createdAt }.max()
                rows.append(Row(id: helper.id, name: helper.name, status: helper.paused ? "Paused" : helper.roleTitle,
                                working: false, at: last, helperId: helper.id, jobId: nil))
            }
        }
        return rows
    }
}

/// One agent: a working glyph or a quiet dot, the name, what it does now, and the time.
private struct ActivityRowView: View {
    let model: IslandModel
    let row: ActivityRows.Row
    @State private var hovering = false
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: open) {
            HStack(spacing: 8) {
                if row.working { WorkingGlyph() } else { Circle().fill(theme.text3.color.opacity(0.5)).frame(width: 5, height: 5).frame(width: 12) }
                Text(row.name).appFont(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(1)
                Text(row.status).appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color).lineLimit(1).truncationMode(.tail)
                Spacer(minLength: 4)
                Text(SidebarChatRow.shortAge(row.at)).appFont(.system(size: 11)).monospacedDigit().foregroundStyle(theme.text3.color)
            }
            .padding(.horizontal, 8).frame(height: 32)
            .background(hovering ? theme.fill2.color : .clear, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressable)
        .onHover { hovering = $0 }
        .help(row.status)
        .accessibilityLabel("\(row.name), \(row.status)")
    }

    private func open() {
        model.navigate {
            if let job = row.jobId { model.windowPage = .agents; model.sendHelpers(model.helpers.openThread(job)) }
            else if let helper = row.helperId { model.windowPage = .agents; model.helpers.selectHelper(helper) }
            else { model.windowPage = .chat }
        }
    }
}

/// A small grid of dots that brightens in turn while an agent works. Still with Reduce Motion and in snapshots.
struct WorkingGlyph: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.12, paused: reduceMotion || snapshot)) { context in
            let step = reduceMotion || snapshot ? 0 : Int(context.date.timeIntervalSinceReferenceDate / 0.12) % 9
            Grid(horizontalSpacing: 1.5, verticalSpacing: 1.5) {
                ForEach(0..<3, id: \.self) { row in
                    GridRow {
                        ForEach(0..<3, id: \.self) { column in
                            let index = row * 3 + column
                            let lit = (index - step + 9) % 9 < 3
                            RoundedRectangle(cornerRadius: 0.6).fill(theme.text.color.opacity(lit ? 0.9 : 0.25)).frame(width: 2.5, height: 2.5)
                        }
                    }
                }
            }
            .frame(width: 12, height: 12)
        }
        .accessibilityHidden(true)
    }
}

/// The top bar's button that shows or hides the Agents panel; a dot says something is working.
struct ActivityToggleButton: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let busy = ActivityRows.make(model: model).contains(where: \.working)
        Button { model.activityShown.toggle() } label: {
            Image(systemName: "person.2.wave.2").appFont(.system(size: 12.5))
                .foregroundStyle(model.activityShown ? theme.text.color : theme.text2.color)
                .frame(width: 30, height: 30)
                .overlay(alignment: .topTrailing) {
                    if busy { Circle().fill(theme.live.color).frame(width: 6, height: 6).offset(x: -4, y: 5) }
                }
        }
        .buttonStyle(WorkspacePressStyle())
        .help(model.activityShown ? "Hide the Agents panel" : "Show what runs in the background")
        .accessibilityLabel(model.activityShown ? "Hide the Agents panel" : "Show the Agents panel")
    }
}
