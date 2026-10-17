import AppKit
import SwiftUI
import AtomIslandCore

// The rows of a worker's page in the ATOM window (ADR-110 N4: the budget rows are gone).

/// Why a runnable task waits for Keshab (an interrupted run), on the board and in its thread.
struct HeldLine: View {
    let reason: String
    @Environment(\.theme) private var theme

    var body: some View {
        if theme.statusDots {
            // Void (ADR-086): the colour is only the dot; the words stay quiet.
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                StatusDot(color: theme.attention.color, size: 6)
                Text(reason).font(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(2)
            }
        } else {
            Label(reason, systemImage: "pause.circle").font(.system(size: 11.5)).foregroundStyle(theme.attention.color).lineLimit(2)
        }
    }
}

/// Task 3.8: a worker's new tasks plan first: the first run writes a plan and waits for Keshab's OK.
struct PlanFirstRow: View {
    let model: IslandModel
    let helper: Helper
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Plan first").font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                Text("New tasks start with a plan for your OK.").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            }
            Spacer(minLength: 4)
            ThemedSwitch(isOn: helper.planFirst, set: { model.sendHelpers(model.helpers.setPlanFirst($0)) }, label: "Plan first")
        }
        .frame(maxWidth: 320, alignment: .leading)
    }
}

/// ADR-098: the worker's runs get ATOM's browser. New sites, typing and submits still ask Keshab first.
struct BrowserRow: View {
    let model: IslandModel
    let helper: Helper
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Browser").font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                Text("Opens pages in ATOM's own browser. Each new site and each form asks you first.").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            }
            Spacer(minLength: 4)
            ThemedSwitch(isOn: helper.browser, set: { model.sendHelpers(model.helpers.setBrowser($0)) }, label: "Browser")
        }
        .frame(maxWidth: 320, alignment: .leading)
    }
}

/// Task 3.9: the worker's routines: when, what, and how the last one went; each can be removed.
struct RoutinesSection: View {
    let model: IslandModel
    let routines: [HelperRoutine]
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Routines").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            ForEach(routines) { routine in
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(routine.task).font(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(2)
                        Text(Self.detail(routine)).font(.system(size: 11)).foregroundStyle(theme.text2.color)
                    }
                    Spacer(minLength: 8)
                    QuietButton(title: "Remove") { model.sendHelpers(model.helpers.deleteRoutine(routine.id)) }
                }
            }
        }
    }

    static func detail(_ routine: HelperRoutine) -> String {
        guard let at = routine.lastAt else { return routine.when }
        let when = at.formatted(date: .abbreviated, time: .shortened)
        return "\(routine.when) · \(routine.lastSkipped ? "skipped \(when): the last one was still going" : "last \(when)")"
    }
}

/// ADR-122, ADR-123: there are no per-agent folders. This note says what the agent may do with files; the rules are in code.
struct FilesNote: View {
    let helper: Helper
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Files").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            Text("\(helper.name) can read and write in your home folder and on external drives. A new file is saved at once. Changing a file that exists asks you first. It never deletes, and never opens secrets, hidden folders, ~/Library or identity, bank and tax documents.")
                .font(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
            Text("In a git repository, \(helper.name) works on its own branch. It never pushes: you can push its branch from the Dashboard.")
                .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
        }
    }
}

/// Task 3.12: which of Keshab's skills (from ~/.claude/skills) this worker may use. Only these load for its runs.
struct SkillsPicker: View {
    let model: IslandModel
    let helper: Helper
    let skills: [SkillInfo]

    var body: some View {
        Menu {
            if skills.isEmpty { Text("No skills yet") }
            ForEach(skills) { skill in
                let title = skill.source == "zeno" ? "\(skill.name) (made by ATOM)" : skill.name
                Button { model.sendHelpers(model.helpers.toggleSkill(skill.name)) } label: {
                    if helper.skills.contains(skill.name) { Label(title, systemImage: "checkmark") } else { Text(title) }
                }
                .help(skill.description)
            }
        } label: {
            PillMenuLabel(label: "Skills", value: helper.skills.isEmpty ? "None" : helper.skills.count == 1 ? helper.skills[0] : "\(helper.skills.count) chosen",
                          dimmed: helper.skills.isEmpty, identifier: helper.skills.count == 1)
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .help("Skills \(helper.name) may use. Only these are loaded for its tasks.")
    }
}

/// Task 3.13: Tinker's suggestions for this worker's soul: accept or reject; an accepted one can be undone.
struct ProposalsSection: View {
    let model: IslandModel
    let proposals: [SoulProposal]
    /// The soul as it is now: a waiting proposal is shown as the change it makes to it (upgrades.md B4).
    var soul: HelperSoul? = nil
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Tinker suggests").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            ForEach(proposals.filter { $0.state == "pending" || $0.state == "accepted" }) { p in
                VStack(alignment: .leading, spacing: 4) {
                    if p.state == "pending", let pieces = p.segments(against: soul), pieces.contains(where: { $0.kind != .same }) {
                        Text(p.fieldTitle).font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                        InlineDiffText(pieces: pieces)
                    } else {
                        Text("\(p.fieldTitle): \(p.text)").font(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Text(p.reason).font(.system(size: 11.5)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
                    // ADR-098 item 8: how the change does on this agent's test cases.
                    TestRunView(model: model, kind: "soul", id: p.id, tests: p.tests,
                                hasCases: !(model.helpers.list?.testCases(kind: "soul", target: model.helpers.selectedHelper?.id ?? "").isEmpty ?? true),
                                pending: p.state == "pending")
                    HStack(spacing: 8) {
                        if p.state == "pending" {
                            QuietButton(title: "Accept", symbol: "checkmark") { model.sendHelpers(model.helpers.answerProposal(p.id, accept: true)) }
                            QuietButton(title: "Reject", symbol: "xmark") { model.sendHelpers(model.helpers.answerProposal(p.id, accept: false)) }
                        } else {
                            Text("Accepted").font(.system(size: 11)).foregroundStyle(theme.text3.color)
                            QuietButton(title: "Undo", symbol: "arrow.uturn.backward") { model.sendHelpers(model.helpers.undoProposal(p.id)) }
                        }
                    }
                }
            }
        }
    }
}

/// Task 3.13: how a finished task went: good, or not (with what was wrong), which asks Tinker to review it.
struct RateSection: View {
    let model: IslandModel
    let job: HelperJob
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let comment = State(initialValue: "")
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    init(model: IslandModel, job: HelperJob) {
        self.model = model
        self.job = job
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("How did it go?").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            if let rating = job.rating {
                Text(rating != "good" ? "You rated it not good; Tinker reviews it." : job.canBecomeSkill ? "You rated it good; Tinker drafts a skill from it." : "You rated it good.")
                    .font(.system(size: 12)).foregroundStyle(theme.text2.color)
            } else {
                if snapshot {
                    Text("What was wrong? (optional)").font(.system(size: 12.5)).foregroundStyle(theme.text3.color)
                } else {
                    TextField("What was wrong? (optional)", text: comment.projectedValue)
                        .textFieldStyle(.plain).font(.system(size: 12.5)).foregroundStyle(theme.text.color)
                        .accessibilityLabel("What was wrong")
                }
                HStack(spacing: 8) {
                    QuietButton(title: "Good", symbol: "hand.thumbsup") { model.sendHelpers(model.helpers.rate(good: true)) }
                    QuietButton(title: "Not good", symbol: "hand.thumbsdown") {
                        model.sendHelpers(model.helpers.rate(good: false, comment: comment.wrappedValue))
                        comment.wrappedValue = ""
                    }
                }
            }
            // ADR-094: a done task can become a skill; Tinker drafts it and it waits for your OK on the Plugins page.
            if job.canBecomeSkill {
                if let draft = model.helpers.list?.skillDrafts.first(where: { $0.jobId == job.id }) {
                    Text("Skill draft \(draft.name): \(draft.state == "pending" ? "waits for you on the Plugins page" : draft.state).")
                        .font(.system(size: 12)).foregroundStyle(theme.text2.color)
                } else if job.rating != "good" {
                    QuietButton(title: "Make a skill", symbol: "wand.and.stars") { model.sendHelpers(model.helpers.makeSkill()) }
                }
            }
            SaveTestCaseSection(model: model, job: job) // ADR-098 item 8
        }
    }
}

/// Task 3.16: the tasks handed to Keshab's own Paperclip, marked as such, with what that means.
struct PaperclipSection: View {
    let tasks: [PaperclipTask]
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Paperclip · \(tasks.count)").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color).padding(.leading, 4)
            Text("Paperclip's agents run outside ATOM's checks: Paperclip decides their tools and folders. Its telemetry is on unless PAPERCLIP_TELEMETRY_DISABLED=1 is set where it runs.")
                .font(.system(size: 10.5)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true).padding(.leading, 4)
            if tasks.isEmpty {
                Text("No tasks yet. Ask ATOM to hand one to a Paperclip agent.").font(.system(size: 12)).foregroundStyle(theme.text2.color).padding(.leading, 4)
            }
            ForEach(tasks) { task in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text("Paperclip").font(theme.idFont(.system(size: 10.5), size: 10)).foregroundStyle(theme.idColor(theme.text2))
                        if let identifier = task.identifier { Text(identifier).font(theme.idFont(.system(size: 10.5), size: 10)).foregroundStyle(theme.text3.color) }
                        Text(task.status).font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                    }
                    Text(task.title).font(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(2)
                    Text(task.agent).font(.system(size: 11)).foregroundStyle(theme.text2.color)
                    if let result = task.result { Text(result).font(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(4) }
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
            }
        }
    }
}

/// ADR-088: removes an agent Keshab added, after asking. Its folder moves to data/agents-removed/; nothing is deleted.
struct RemoveAgentButton: View {
    let model: IslandModel
    let helper: Helper
    private let asking = State(initialValue: false)

    init(model: IslandModel, helper: Helper) {
        self.model = model
        self.helper = helper
    }

    var body: some View {
        QuietButton(title: "Remove") { asking.wrappedValue = true }
            .help("Take \(helper.name) out of the team")
            .confirmationDialog("Remove \(helper.name) from the team?", isPresented: asking.projectedValue) {
                Button("Remove \(helper.name)", role: .destructive) { model.sendHelpers(model.helpers.removeAgent()) }
            } message: {
                Text("Its soul.md moves to data/agents-removed/ and is not deleted. Its tasks stay in the history; any not finished are stopped.")
            }
    }
}

/// A text with the words that go in red under a line and the words that come in green (upgrades.md B4). Reading only.
struct InlineDiffText: View {
    let pieces: [DiffSegment]
    @Environment(\.theme) private var theme

    var body: some View {
        pieces.reduce(Text("")) { text, piece in
            switch piece.kind {
            case .same: return text + Text(piece.text).foregroundColor(theme.text.color)
            case .removed: return text + Text(piece.text).foregroundColor(theme.problem.color).strikethrough()
            case .added: return text + Text(piece.text).foregroundColor(theme.success.color)
            }
        }
        .font(.system(size: 12.5))
        .fixedSize(horizontal: false, vertical: true)
        .textSelection(.enabled)
        .accessibilityLabel(pieces.compactMap { p in p.kind == .same ? p.text : p.kind == .removed ? "removed \(p.text)" : "added \(p.text)" }.joined(separator: " "))
    }
}
