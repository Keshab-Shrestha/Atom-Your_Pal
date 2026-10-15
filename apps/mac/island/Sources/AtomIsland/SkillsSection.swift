import SwiftUI
import AtomIslandCore

/// Plugins → Skills (2026-10-15). The list of skills is long, so one dropdown picks a skill. The chosen skill shows what
/// it is for, which workers use it, and an editor for its whole SKILL.md. Save writes the file; the text it replaced
/// stays in SKILL.md.bak. Only this click writes a skill: no model does.
struct SkillsSection: View {
    let model: IslandModel
    let skills: [SkillInfo]
    /// The names of the workers that use a skill.
    let users: (String) -> [String]
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let selected = State<String?>(initialValue: nil)
    /// The words typed in the editor for each skill, kept until saved or reverted.
    private let edits = State(initialValue: [String: String]())
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    init(model: IslandModel, skills: [SkillInfo], users: @escaping (String) -> [String]) {
        self.model = model
        self.skills = skills
        self.users = users
    }

    private var openFile: SkillFileData? {
        guard let name = selected.wrappedValue, model.skillFile?.name == name else { return nil }
        return model.skillFile
    }

    /// The editor holds words that are not saved.
    private var dirty: Bool {
        guard let file = openFile, let typed = edits.wrappedValue[file.name] else { return false }
        return typed != file.text
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if skills.isEmpty {
                Text("No skills yet: yours come from ~/.claude/skills, and ATOM's from tasks you rate good.")
                    .font(.system(size: 12.5)).foregroundStyle(theme.text3.color)
            } else {
                picker
                if let name = selected.wrappedValue, let skill = skills.first(where: { $0.name == name }) { detail(skill) }
            }
            Text("Choose a worker's skills on its page. A skill file changes only when you press Save here; the old text is kept as SKILL.md.bak.")
                .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
        }
        .tracksEdits(model, "skill", dirty)
    }

    /// One dropdown for any number of skills: yours first, then ATOM's. macOS scrolls a long menu.
    private var picker: some View {
        Menu {
            let yours = skills.filter { $0.source == "yours" }, others = skills.filter { $0.source != "yours" }
            if !yours.isEmpty {
                Section("Yours") { ForEach(yours) { item in choice(item) } }
            }
            if !others.isEmpty {
                Section("Made by ATOM") { ForEach(others) { item in choice(item) } }
            }
        } label: {
            HStack(spacing: 8) {
                Text(selected.wrappedValue ?? "Choose a skill (\(skills.count))")
                    .font(theme.idFont(.system(size: 12.5, weight: .medium), size: 12))
                    .foregroundStyle(theme.text.color).lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(theme.text3.color)
            }
            .padding(.horizontal, 12).frame(height: 30).frame(maxWidth: 320, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous)
                .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .accessibilityLabel("Choose a skill")
    }

    private func choice(_ skill: SkillInfo) -> some View {
        Button(skill.name) {
            selected.wrappedValue = skill.name
            model.openSkill(skill.name)
        }
    }

    private func detail(_ skill: SkillInfo) -> some View {
        let workers = users(skill.name)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(skill.sourceTitle).font(.system(size: 10.5)).foregroundStyle(skill.source == "zeno" ? theme.accent.color : theme.text3.color)
                Spacer()
                Text(workers.isEmpty ? "No worker" : workers.joined(separator: ", "))
                    .font(.system(size: 11)).foregroundStyle(workers.isEmpty ? theme.text3.color : theme.text2.color)
            }
            if !skill.description.isEmpty {
                Text(skill.description).font(.system(size: 11.5)).foregroundStyle(theme.text3.color)
            }
            editor(skill)
            if skill.source == "zeno" { TestCasesList(model: model, kind: "skill", target: skill.name) } // ADR-098 item 8
        }
        .padding(.top, 4)
    }

    @ViewBuilder
    private func editor(_ skill: SkillInfo) -> some View {
        if let file = openFile {
            let text = Binding<String>(get: { edits.wrappedValue[skill.name] ?? file.text }, set: { edits.wrappedValue[skill.name] = $0 })
            Group {
                if snapshot {
                    Text(text.wrappedValue).frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    TextEditor(text: text).scrollContentBackground(.hidden).frame(height: 240)
                }
            }
            .font(.system(size: 11.5, design: .monospaced)).foregroundStyle(theme.text.color)
            .padding(8)
            .background(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous)
                .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: 1))
            HStack(spacing: 8) {
                QuietButton(title: "Save", symbol: "checkmark") {
                    model.saveSkill(skill.name, text: text.wrappedValue)
                }
                .opacity(dirty ? 1 : 0.45).allowsHitTesting(dirty)
                QuietButton(title: "Revert", symbol: "arrow.uturn.backward") { edits.wrappedValue[skill.name] = nil }
                    .opacity(dirty ? 1 : 0.45).allowsHitTesting(dirty)
                Spacer()
                Text("\(text.wrappedValue.count) characters").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            }
            if let problem = model.skillError { ProblemLine(text: problem) }
        } else if let problem = model.skillError {
            ProblemLine(text: problem)
        } else {
            Text("Opening…").font(.system(size: 12)).foregroundStyle(theme.text3.color)
        }
    }
}
