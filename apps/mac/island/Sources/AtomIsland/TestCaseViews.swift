import SwiftUI
import AtomIslandCore

/// ADR-098 item 8: a soul proposal's or skill edit's test run: "Test cases: 2 better, 1 same", each case's old and new
/// answer side by side with the judge's reason (on demand), and Run tests while it waits. Nothing when the target has
/// no test cases and no run.
struct TestRunView: View {
    let model: IslandModel
    /// "soul" (a proposal) or "skill" (a skill edit).
    let kind: String
    let id: Int
    let tests: TestRunSummary?
    let hasCases: Bool
    let pending: Bool
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let expanded = State(initialValue: false)
    @Environment(\.theme) private var theme

    init(model: IslandModel, kind: String, id: Int, tests: TestRunSummary?, hasCases: Bool, pending: Bool) {
        self.model = model
        self.kind = kind
        self.id = id
        self.tests = tests
        self.hasCases = hasCases
        self.pending = pending
    }

    var body: some View {
        if tests != nil || hasCases {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(tests?.line ?? "Test cases: not run yet").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text2.color)
                    if let tests, !tests.results.isEmpty {
                        QuietButton(title: expanded.wrappedValue ? "Hide" : "Compare", symbol: expanded.wrappedValue ? "chevron.up" : "chevron.down") {
                            expanded.wrappedValue.toggle()
                        }
                    }
                    if pending && hasCases && tests?.running ?? 0 == 0 {
                        QuietButton(title: "Run tests", symbol: "play") { model.sendHelpers(model.helpers.runTests(kind: kind, id: id)) }
                    }
                }
                if expanded.wrappedValue, let tests {
                    ForEach(tests.results) { result in caseView(result) }
                }
            }
        }
    }

    private func caseView(_ result: TestCaseResult) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(result.task).font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(2)
            HStack(alignment: .top, spacing: 10) {
                side("Old", result.oldAnswer)
                side("New", result.newAnswer)
            }
            Text(result.reason.map { "\(result.verdict): \($0)" } ?? result.verdict)
                .font(.system(size: 11)).foregroundStyle(result.better == "new" ? theme.accent.color : theme.text2.color)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.separator.color, lineWidth: 0.6))
    }

    private func side(_ label: String, _ text: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 10.5, weight: .medium)).foregroundStyle(theme.text3.color)
            Text(text ?? "—").font(.system(size: 11)).foregroundStyle(theme.text2.color).lineLimit(10).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

/// ADR-098 item 8: the test cases saved for an agent ("soul") or a skill ("skill"), each with Delete.
struct TestCasesList: View {
    let model: IslandModel
    let kind: String
    let target: String
    @Environment(\.theme) private var theme

    var body: some View {
        let cases = model.helpers.list?.testCases(kind: kind, target: target) ?? []
        if !cases.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("Test cases · \(cases.count) of 10").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
                ForEach(cases) { c in
                    HStack(spacing: 8) {
                        Text("#\(c.jobId)").font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color)
                        Text(c.task).font(.system(size: 12)).foregroundStyle(theme.text2.color).lineLimit(1)
                        Spacer(minLength: 8)
                        QuietButton(title: "Delete", symbol: "trash") { model.sendHelpers(model.helpers.deleteTestCase(c.id)) }
                    }
                }
            }
        }
    }
}

/// ADR-098 item 8: on a done task: save it as a test case for its agent and, when the run used ZENO-made skills, for each.
struct SaveTestCaseSection: View {
    let model: IslandModel
    let job: HelperJob
    @Environment(\.theme) private var theme

    var body: some View {
        if job.state == .done, let helper = model.helpers.openItem?.helperId {
            let skills = model.helpers.thread?.id == job.id ? model.helpers.thread?.testSkills ?? [] : []
            VStack(alignment: .leading, spacing: 6) {
                Text("Test case").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
                HStack(spacing: 8) {
                    button(kind: "soul", target: helper, title: "Save as test case")
                    ForEach(skills, id: \.self) { skill in button(kind: "skill", target: skill, title: "Save for \(skill)") }
                }
                Text("Tinker's changes run against your test cases before you approve them.").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            }
        }
    }

    @ViewBuilder private func button(kind: String, target: String, title: String) -> some View {
        if model.helpers.list?.testCases.contains(where: { $0.jobId == job.id && $0.kind == kind && $0.target == target }) == true {
            Text(kind == "soul" ? "Saved as a test case" : "Saved for \(target)").font(.system(size: 11.5)).foregroundStyle(theme.text3.color)
        } else {
            QuietButton(title: title, symbol: "checklist") { model.sendHelpers(model.helpers.saveTestCase(kind: kind, target: target)) }
        }
    }
}
