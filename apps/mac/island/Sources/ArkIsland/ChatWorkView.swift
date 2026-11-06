import SwiftUI
import ArkIslandCore

/// What ARK does in a turn, live (2026-11-01, after T3 Code's work rows and the Claude app, MIT): open while it works, one row per tool call in plain
/// words ("Reading a file", a glyph while it runs); once the turn ends it folds into one line, "Worked for 22s · Read 3 files, ran 2 commands".
struct ChatWorkView: View {
    let work: ChatWorkSnapshot
    /// The computer step in progress, shown while the work runs (the island's detail line, which the window did not show).
    var step: String? = nil
    /// The newest turn: its steps stay open after the answer arrives (2026-11-06); older turns fold to one line.
    var keepOpen = false
    /// Nil follows the work: open while it runs, folded once it ends. A click keeps the reader's choice.
    @State private var opened: Bool?
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    private var working: Bool { work.state == "working" }
    /// Nothing to open for a turn that only thought: no tools, no questions.
    private var hasSteps: Bool { work.hasSteps }
    private var expanded: Bool { hasSteps && (opened ?? (working || keepOpen)) }
    /// While it runs, only the latest rows, so a long turn does not push the reply away.
    private static let liveRows = 6

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if working, !snapshot {
                TimelineView(.periodic(from: .now, by: 1)) { _ in toggle }
            } else { toggle }
            if expanded {
                let calls = working ? Array(work.calls.suffix(Self.liveRows)) : work.calls
                VStack(alignment: .leading, spacing: 4) {
                    if working, work.calls.count > calls.count {
                        Text("\(work.calls.count - calls.count) earlier steps").foregroundStyle(theme.text3.color)
                    }
                    // 2026-11-05 (after affectUI's Tool Call Card, MIT): the calls as one quiet card, a row each.
                    if !calls.isEmpty {
                        VStack(spacing: 0) {
                            ForEach(Array(calls.enumerated()), id: \.element.id) { index, call in
                                if index > 0 { Rectangle().fill(theme.separator.color).frame(height: 0.6).padding(.leading, 40) }
                                callRow(call)
                            }
                        }
                        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).fill(theme.fill1.color))
                        .overlay(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).strokeBorder(theme.separator.color, lineWidth: 0.6))
                    }
                    // While it works with no tool yet, the turn's own "Thinking" line below says so (2026-11-02: it showed twice).
                    if work.calls.isEmpty, !working { Text("No tools used").foregroundStyle(theme.text3.color) }
                    if work.omitted > 0 { Text("\(work.omitted) more steps not shown").foregroundStyle(theme.text3.color) }
                    ForEach(work.questions.filter { $0.state != "pending" }) { question in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(question.prompt).fontWeight(.medium)
                            Text(question.answer ?? (question.state == "expired" ? "No answer before the card expired." : "Question skipped or interrupted."))
                        }.foregroundStyle(theme.text2.color).textSelection(.enabled)
                    }
                }
                .appFont(.system(size: 12))
            }
        }
        .onAppear { noteRunning() }
        .onChange(of: work.calls) { _, _ in noteRunning() }
    }

    private func noteRunning() {
        for call in work.calls where call.state == "started" { ToolCallClock.note(call.id) }
    }

    /// One call: its tile, what it does in plain words, the tool's own name in mono, and its state at the right: a spinner with a live
    /// timer while it runs, a check with its time, "Failed", or "Unknown".
    private func callRow(_ call: ChatWorkSnapshot.Call) -> some View {
        let running = call.state == "started"
        let failed = call.state == "error"
        return HStack(spacing: 10) {
            Glyph(systemName: ChatWorkText.symbol(tool: call.tool)).appFont(.system(size: 11, weight: .medium))
                .foregroundStyle(failed ? theme.problem.color : theme.text2.color)
                .frame(width: 22, height: 22)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(theme.fill2.color))
                .accessibilityHidden(true) // decoration: the words carry the meaning
            Text(ChatWorkText.label(tool: call.tool, running: running))
                .foregroundStyle(running ? theme.text.color : theme.text2.color).lineLimit(1)
            Text(call.tool).appFont(.system(size: 10.5, design: .monospaced)).foregroundStyle(theme.text3.color).lineLimit(1).truncationMode(.middle)
            Spacer(minLength: 8)
            status(call)
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func status(_ call: ChatWorkSnapshot.Call) -> some View {
        switch call.state {
        case "started":
            HStack(spacing: 6) {
                RaySpinner(size: 10, color: theme.accent.color)
                if snapshot { Text("0s") } else {
                    TimelineView(.periodic(from: .now, by: 1)) { _ in
                        Text(ChatWorkText.duration(ms: ToolCallClock.running(call.id) * 1000))
                    }
                }
            }
            .monospacedDigit().foregroundStyle(theme.text2.color)
        case "ok":
            HStack(spacing: 4) {
                Glyph(systemName: "checkmark").appFont(.system(size: 9.5, weight: .bold)).foregroundStyle(theme.accent.color)
                if let ms = call.ms { Text(ms < 1000 ? "<1s" : ChatWorkText.duration(ms: ms)).monospacedDigit() }
            }
            .foregroundStyle(theme.text3.color)
        case "error":
            Label("Failed", systemImage: "exclamationmark.circle.fill").labelStyle(.titleAndIcon).foregroundStyle(theme.problem.color)
        default:
            Text("Unknown").foregroundStyle(theme.text3.color).help("The outcome is unknown: the turn ended before this call reported.")
        }
    }

    /// ADR-275 (after Ghostex's "Worked 9s" row, MIT): one header for the turn's work. The chevron, the time in bold, what it did
    /// in plain words, and at the right the counts as pills. The newest turn keeps its steps open under it (owner rule, 2026-11-06).
    private var toggle: some View {
        let label = ChatWorkText.headline(work, elapsedMs: work.elapsed())
        let chips = ChatWorkText.chips(work)
        return Button { if hasSteps { opened = !expanded } } label: {
            HStack(spacing: 8) {
                if hasSteps {
                    Glyph(systemName: "chevron.right").appFont(.system(size: 9, weight: .semibold))
                        .rotationEffect(.degrees(expanded ? 90 : 0)).foregroundStyle(theme.text3.color)
                }
                Text(label).fontWeight(.semibold).monospacedDigit().foregroundStyle(theme.text.color)
                Group {
                    if working, let step { Text("· \(step)") }
                    else if !working, !work.calls.isEmpty { Text("· \(ChatWorkText.summary(work.calls))") }
                }.lineLimit(1).truncationMode(.tail).layoutPriority(-1)
                Spacer(minLength: 8)
                ForEach(chips, id: \.self) { chip in
                    Text(chip).appFont(.system(size: 11)).monospacedDigit().foregroundStyle(theme.text2.color)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(Capsule(style: .continuous).fill(theme.fill2.color))
                }
            }.appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
            .contentShape(Rectangle())
        }.buttonStyle(.plain)
            .accessibilityLabel(([label, working ? step : work.calls.isEmpty ? nil : ChatWorkText.summary(work.calls)].compactMap { $0 } + chips).joined(separator: ", "))
            .accessibilityValue(hasSteps ? (expanded ? "Expanded" : "Collapsed") : "")
            .help("What ARK did in this turn. The time includes thinking, tools and waiting for your answers. A missing result means the outcome is unknown, not that nothing happened. This log is not kept in saved history.")
    }
}

struct ChatAccessContent: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Chat access").appFont(.headline)
            if let access = model.chatControls.snapshot?.info?.access {
                Text("Mode: " + (model.chats?.access?.title ?? "Saved permissions"))
                Text("Provider: \(access.provider)")
                Text(access.hostTools ? "Uses ARK's checked host tools." : "ARK host tools are unavailable in this mode.")
                Text(access.project ? "Associated with a project; project file policy applies." : "No project folder associated with this chat.")
                Text("Continuing edit permissions: \(access.fileGrants) exact files in this chat.")
                Text("Computer tools available in this mode: \(access.computer ? "on" : "off"). Web search setting: \(access.web ? "on" : "off").")
            } else { Text("Saved chat details are unavailable. Save a message or refresh to inspect them.") }
            Text("Change access beside the model selector. Chat only suspends tools and saved file grants. Ask before changes requires a fresh approval for each change-capable call. Saved permissions uses existing grants. Full access skips routine file, classified-command, site-opening and granted-plugin prompts for this chat; protected actions still ask or refuse. Protected files, tool availability and macOS permissions still apply in every mode.")
            Text("To inspect exact file grants, send ‘Show file permissions for this chat’. To revoke them, send ‘Forget file permissions for this chat’.")
            Button("Refresh", action: model.inspectSavedChat)
        }.appFont(.system(size: 12)).foregroundStyle(theme.text2.color).padding(16).frame(width: 340)
    }
}

/// When the window first saw each running call, for its live timer. The runtime sends a call's time only once it ends, and a row's
/// view is rebuilt when it scrolls back or the chat reopens; kept here, the timer keeps counting instead of starting again at 0s.
/// Bounded: the oldest stamps go past 200.
@MainActor
enum ToolCallClock {
    private static var seen: [String: Double] = [:]
    private static var order: [String] = []
    private static let limit = 200

    static func note(_ id: String) {
        guard seen[id] == nil else { return }
        seen[id] = ProcessInfo.processInfo.systemUptime
        order.append(id)
        if order.count > limit { seen[order.removeFirst()] = nil }
    }

    /// Seconds since the call was first seen; 0 if never.
    static func running(_ id: String) -> Double {
        seen[id].map { max(0, ProcessInfo.processInfo.systemUptime - $0) } ?? 0
    }
}
