import Foundation

/// ADR-098 item 8: a done task saved as a test case for an agent's soul ("soul", target its id) or a ZENO-made skill
/// ("skill", target its name). The task text is cut; the saved report stays in the runtime.
public struct TestCaseItem: Sendable, Equatable, Identifiable {
    public var id: Int
    public var kind: String
    public var target: String
    public var jobId: Int
    public var task: String

    public init(id: Int, kind: String, target: String, jobId: Int, task: String) {
        self.id = id
        self.kind = kind
        self.target = target
        self.jobId = jobId
        self.task = task
    }
}

/// ADR-098 item 8: one test case's outcome for a soul proposal or skill edit: the old and the new answer (cut) and the judge's reason.
public struct TestCaseResult: Sendable, Equatable, Identifiable {
    public var caseId: Int
    public var task: String
    /// "running", "done", "failed" or "skipped".
    public var state: String
    /// "old", "new" or "same", once judged.
    public var better: String?
    public var reason: String?
    public var oldAnswer: String?
    public var newAnswer: String?

    public var id: Int { caseId }

    public init(caseId: Int, task: String, state: String, better: String? = nil, reason: String? = nil, oldAnswer: String? = nil, newAnswer: String? = nil) {
        self.caseId = caseId
        self.task = task
        self.state = state
        self.better = better
        self.reason = reason
        self.oldAnswer = oldAnswer
        self.newAnswer = newAnswer
    }

    /// "New is better", "Old is better", "Same", "Running…", or why it did not run.
    public var verdict: String {
        switch state {
        case "running": "Running…"
        case "done": better == "new" ? "New is better" : better == "old" ? "Old is better" : "Same"
        case "skipped": reason ?? "Not run"
        default: "Failed"
        }
    }
}

/// ADR-098 item 8: a soul proposal's or skill edit's test run.
public struct TestRunSummary: Sendable, Equatable {
    public var better: Int
    public var same: Int
    public var worse: Int
    public var notRun: Int
    public var failed: Int
    public var running: Int
    public var results: [TestCaseResult]

    public init(better: Int = 0, same: Int = 0, worse: Int = 0, notRun: Int = 0, failed: Int = 0, running: Int = 0, results: [TestCaseResult] = []) {
        self.better = better
        self.same = same
        self.worse = worse
        self.notRun = notRun
        self.failed = failed
        self.running = running
        self.results = results
    }

    /// "Test cases: 2 better, 1 same", or "Test cases: running…" while any case runs.
    public var line: String {
        if running > 0 { return "Test cases: running…" }
        let parts = [(better, "better"), (same, "same"), (worse, "worse"), (failed, "failed")].filter { $0.0 > 0 }.map { "\($0.0) \($0.1)" }
        if parts.isEmpty, let reason = results.first(where: { $0.state == "skipped" })?.reason { return "Test cases: \(reason.prefix(1).lowercased() + reason.dropFirst())" }
        let notRunPart = notRun > 0 ? ["\(notRun) not run"] : []
        return "Test cases: " + (parts + notRunPart).joined(separator: ", ")
    }
}

extension HelpersList {
    /// ADR-098 item 8: the test cases saved for an agent ("soul") or a skill ("skill"), newest first.
    public func testCases(kind: String, target: String) -> [TestCaseItem] {
        testCases.filter { $0.kind == kind && $0.target == target }
    }
}
