import Foundation

/// One of Keshab's Claude commands (~/.claude/commands/<name>.md) as the runtime lists it (ADR-117).
public struct SlashCommandInfo: Sendable, Equatable {
    public var name: String
    public var description: String
    /// The front matter's `argument-hint`, such as "[file]"; empty when there is none.
    public var hint: String

    public init(name: String, description: String = "", hint: String = "") {
        self.name = name
        self.description = description
        self.hint = hint
    }
}

/// What an ATOM command does. The window runs these itself; they never reach the model.
public enum SlashAction: String, Sendable, Equatable {
    case newChat, model, skills, memory, help
}

/// One row of the "/" picker.
public struct SlashItem: Sendable, Equatable, Identifiable {
    public enum Source: Int, Sendable { case atom = 0, skill, command }

    public var id: String { "\(source.rawValue)-\(name)" }
    public var name: String
    public var detail: String
    /// The argument hint ("[file]"), shown after the name.
    public var hint: String
    public var source: Source
    /// Set for ATOM's own commands.
    public var action: SlashAction?

    public init(name: String, detail: String, hint: String = "", source: Source, action: SlashAction? = nil) {
        self.name = name
        self.detail = detail
        self.hint = hint
        self.source = source
        self.action = action
    }

    public var title: String { "/" + name }
    /// "ATOM", "Skill" or "Command".
    public var sourceLabel: String {
        switch source {
        case .atom: "ATOM"
        case .skill: "Skill"
        case .command: "Command"
        }
    }
}

/// The "/" picker in the message box (ADR-117): ATOM's own commands, Keshab's skills and his Claude commands in one list.
/// Typing "/" opens it; more letters narrow it. Pure, so it is tested without a window.
public enum SlashMenu {
    public static let builtIns: [SlashItem] = [
        SlashItem(name: "new", detail: "Start a new chat", source: .atom, action: .newChat),
        SlashItem(name: "model", detail: "Choose the AI model (Settings)", source: .atom, action: .model),
        SlashItem(name: "skills", detail: "Open Plugins to see and edit your skills", source: .atom, action: .skills),
        SlashItem(name: "memory", detail: "Open the Second brain: what ATOM remembers", source: .atom, action: .memory),
        SlashItem(name: "help", detail: "Show every command", source: .atom, action: .help),
    ]

    /// The most rows the picker lists.
    public static let limit = 8

    /// The draft is a command name being typed: it starts with "/" and has no space yet.
    public static func isPicking(_ draft: String) -> Bool {
        draft.hasPrefix("/") && !draft.contains(where: \.isWhitespace)
    }

    /// Every command that can be run, once each. A name that ATOM itself uses is ATOM's; else a skill's; else a command's
    /// (the same order the runtime and the window use when the name is typed in full).
    public static func all(skills: [SkillInfo], commands: [SlashCommandInfo]) -> [SlashItem] {
        var taken = Set(builtIns.map(\.name))
        var items = builtIns
        for skill in skills where taken.insert(skill.name).inserted {
            items.append(SlashItem(name: skill.name, detail: skill.description, source: .skill))
        }
        for command in commands where taken.insert(command.name).inserted {
            items.append(SlashItem(name: command.name, detail: command.description, hint: command.hint, source: .command))
        }
        return items
    }

    /// The rows for what is typed: names that start with it first, then names that contain it, then descriptions that do.
    /// Within a group ATOM's commands come first, then skills, then commands, then by name. Empty unless the draft is a name
    /// being typed.
    public static func items(for draft: String, skills: [SkillInfo], commands: [SlashCommandInfo]) -> [SlashItem] {
        guard isPicking(draft) else { return [] }
        let query = draft.dropFirst().lowercased()
        let ranked: [(item: SlashItem, rank: Int)] = all(skills: skills, commands: commands).compactMap { item in
            let name = item.name.lowercased()
            if query.isEmpty || name.hasPrefix(query) { return (item, 0) }
            if name.contains(query) { return (item, 1) }
            if item.detail.lowercased().contains(query) { return (item, 2) }
            return nil
        }
        return ranked
            .sorted { ($0.rank, $0.item.source.rawValue, $0.item.name) < ($1.rank, $1.item.source.rawValue, $1.item.name) }
            .map(\.item)
    }

    /// What the draft becomes when Keshab picks a skill or a command: its name and a space, ready for the words.
    public static func completion(for item: SlashItem) -> String { "/" + item.name + " " }

    /// The ATOM command the draft names in full ("/new", "/memory"), with the words after it. Nil for anything else.
    public static func builtIn(in draft: String) -> (action: SlashAction, rest: String)? {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("/") else { return nil }
        let parts = trimmed.dropFirst().split(maxSplits: 1, whereSeparator: \.isWhitespace).map(String.init)
        guard let name = parts.first, let item = builtIns.first(where: { $0.name == name.lowercased() }), let action = item.action else { return nil }
        return (action, parts.count > 1 ? parts[1] : "")
    }
}
