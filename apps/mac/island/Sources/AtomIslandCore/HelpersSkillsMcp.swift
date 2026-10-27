// Skills, soul proposals, Paperclip tasks and MCP servers as the runtime reports them (split out of Helpers.swift, 2026-10-16).
import Foundation

/// Task 3.12: one of the skills a worker can be given: Keshab's ("yours") or, ADR-094, made by ATOM ("zeno").
/// One skill's whole SKILL.md (front matter and steps) for the editor in Plugins → Skills.
public struct SkillFileData: Sendable, Equatable {
    public var name: String
    /// "yours" (~/.claude/skills) or "zeno" (ATOM's own folder).
    public var source: String
    public var text: String

    public init(name: String, source: String = "yours", text: String) {
        self.name = name
        self.source = source
        self.text = text
    }
}

public struct SkillInfo: Sendable, Equatable, Identifiable {
    public var name: String
    public var description: String
    public var source: String
    public var id: String { name }

    public init(name: String, description: String, source: String = "yours") {
        self.name = name
        self.description = description
        self.source = source
    }

    public var sourceTitle: String { source == "zeno" ? "ATOM library" : source == "hub" ? "Skills hub" : "Claude Code" }
}

/// ADR-094: Tinker's draft of a new skill from a task, waiting for Keshab's OK (or answered).
public struct SkillDraftItem: Sendable, Equatable, Identifiable {
    public var id: Int
    public var jobId: Int
    public var helper: String
    public var name: String
    public var description: String
    /// The start of its steps.
    public var preview: String
    /// "pending", "approved" or "rejected".
    public var state: String

    public init(id: Int, jobId: Int, helper: String, name: String, description: String, preview: String, state: String) {
        self.id = id
        self.jobId = jobId
        self.helper = helper
        self.name = name
        self.description = description
        self.preview = preview
        self.state = state
    }
}

/// ADR-094: Tinker's edit to one of ATOM's skills: why, and a compact before and after.
public struct SkillEditItem: Sendable, Equatable, Identifiable {
    public var id: Int
    public var skill: String
    public var jobId: Int
    public var reason: String
    public var before: String
    public var after: String
    /// "pending", "accepted", "rejected" or "undone".
    public var state: String
    /// ADR-098 item 8: its test run, when the skill has test cases.
    public var tests: TestRunSummary?

    public init(id: Int, skill: String, jobId: Int, reason: String, before: String, after: String, state: String, tests: TestRunSummary? = nil) {
        self.tests = tests
        self.id = id
        self.skill = skill
        self.jobId = jobId
        self.reason = reason
        self.before = before
        self.after = after
        self.state = state
    }
}

/// Task 3.13: Tinker's proposed change to a worker's soul.
public struct SoulProposal: Sendable, Equatable, Identifiable {
    public var id: Int
    /// "personality", "howItWorks", "rules" or "lessons".
    public var field: String
    /// The whole new text of that field.
    public var text: String
    public var reason: String
    public var jobId: Int
    /// "pending", "accepted", "rejected" or "undone".
    public var state: String
    /// ADR-098 item 8: its test run, when the agent has test cases.
    public var tests: TestRunSummary?

    public init(id: Int, field: String, text: String, reason: String, jobId: Int, state: String, tests: TestRunSummary? = nil) {
        self.tests = tests
        self.id = id
        self.field = field
        self.text = text
        self.reason = reason
        self.jobId = jobId
        self.state = state
    }

    public var fieldTitle: String {
        switch field {
        case "personality": "Personality"
        case "howItWorks": "How it works"
        case "rules": "Rules"
        default: "Lessons learned"
        }
    }
}

/// Task 3.16: a task ATOM handed to an agent in Keshab's own Paperclip.
public struct PaperclipTask: Sendable, Equatable, Identifiable {
    public var id: String
    public var identifier: String?
    public var title: String
    public var agent: String
    public var status: String
    /// The newest comment once it is done.
    public var result: String?

    public init(id: String, identifier: String? = nil, title: String, agent: String, status: String, result: String? = nil) {
        self.id = id
        self.identifier = identifier
        self.title = title
        self.agent = agent
        self.status = status
        self.result = result
    }

    public var isDone: Bool { ["done", "cancelled", "canceled"].contains(status) }
}

/// ADR-090: one of Keshab's MCP servers, as the window sees it (never a secret value).
public struct McpServerItem: Sendable, Equatable, Identifiable {
    public var id: Int
    public var name: String
    /// "command" or "url".
    public var kind: String
    public var command: String?
    public var args: [String]
    public var url: String?
    public var transport: String
    public var envKeys: [String]
    public var headerKeys: [String]
    public var enabled: Bool
    public var trusted: Bool
    public var workers: [String]
    public var tools: [String]
    public var tested: Bool
    public var problem: String?

    public init(id: Int, name: String, kind: String, command: String? = nil, args: [String] = [], url: String? = nil, transport: String = "http",
                envKeys: [String] = [], headerKeys: [String] = [], enabled: Bool = false, trusted: Bool = false, workers: [String] = [],
                tools: [String] = [], tested: Bool = false, problem: String? = nil) {
        self.id = id
        self.name = name
        self.kind = kind
        self.command = command
        self.args = args
        self.url = url
        self.transport = transport
        self.envKeys = envKeys
        self.headerKeys = headerKeys
        self.enabled = enabled
        self.trusted = trusted
        self.workers = workers
        self.tools = tools
        self.tested = tested
        self.problem = problem
    }

    /// Ready to turn on: a test listed its tools.
    public var canTurnOn: Bool { tested && problem == nil }
}

/// ADR-090: the Add server form.
public struct McpServerDraft: Sendable, Equatable {
    public var name = ""
    /// "command" or "url".
    public var kind = "command"
    public var command = ""
    /// One per line.
    public var args = ""
    public var env = ""
    public var url = ""
    public var transport = "http"
    public var headers = ""

    public init() {}
}
