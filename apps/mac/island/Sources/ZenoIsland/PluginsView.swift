import SwiftUI
import ZenoIslandCore

/// ADR-090: what the workers can use beyond their kit: Keshab's skills (chosen per worker) and his MCP servers (added
/// here, saved off, tested, turned on per worker; every call asks on Pal's card unless the server is trusted).
struct PluginsPane: View {
    let model: IslandModel
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let adding = State(initialValue: false)
    private let draft = State(initialValue: McpServerDraft())
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    init(model: IslandModel) { self.model = model }

    var body: some View {
        let list = model.helpers.list
        Scrollable {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Plugins").font(.system(size: 18, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                    Text("Skills and MCP servers your workers may use. Nothing is on until you turn it on.").font(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
                if let problem = model.helpers.problem { ProblemLine(text: problem) }
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("MCP servers").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
                        Spacer()
                        QuietButton(title: adding.wrappedValue ? "Cancel" : "Add server", symbol: adding.wrappedValue ? "xmark" : "plus") {
                            adding.wrappedValue.toggle()
                            model.helpers.clearProblem()
                        }
                    }
                    if adding.wrappedValue { form }
                    if (list?.mcp ?? []).isEmpty && !adding.wrappedValue {
                        Text("None yet. Add a server that runs a command or one you connect to by its address.")
                            .font(.system(size: 12.5)).foregroundStyle(theme.text3.color)
                    }
                    ForEach(list?.mcp ?? []) { server in ServerCard(model: model, server: server, team: list?.helpers ?? []) }
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Skills").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
                    // ADR-094: Tinker's drafts and edits wait here; nothing is used or changed before you answer.
                    ForEach((list?.skillDrafts ?? []).filter { $0.state == "pending" }) { draft in SkillDraftCard(model: model, draft: draft) }
                    ForEach((list?.skillEdits ?? []).filter { $0.state == "pending" || $0.state == "accepted" }) { edit in SkillEditCard(model: model, edit: edit) }
                    let skills = list?.skills ?? []
                    if skills.isEmpty { Text("No skills yet: yours come from ~/.claude/skills, and ZENO's from tasks you rate good.").font(.system(size: 12.5)).foregroundStyle(theme.text3.color) }
                    ForEach(skills) { skill in
                        let users = (list?.helpers ?? []).filter { $0.skills.contains(skill.name) }.map(\.name)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 8) {
                                Text(skill.name).font(theme.idFont(.system(size: 12.5, weight: .medium), size: 12)).foregroundStyle(theme.text.color)
                                Text(skill.sourceTitle).font(.system(size: 10.5)).foregroundStyle(skill.source == "zeno" ? theme.accent.color : theme.text3.color)
                                Spacer()
                                Text(users.isEmpty ? "No worker" : users.joined(separator: ", ")).font(.system(size: 11)).foregroundStyle(users.isEmpty ? theme.text3.color : theme.text2.color)
                            }
                            if !skill.description.isEmpty { Text(skill.description).font(.system(size: 11.5)).foregroundStyle(theme.text3.color).lineLimit(2) }
                        }
                        .padding(.vertical, 4)
                    }
                    Text("Choose a worker's skills on its page. ZENO writes only its own skills, never those in ~/.claude/skills.").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                }
            }
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.panel)
            .padding(.top, 28)
            .padding(.bottom, Spacing.panel)
        }
    }

    private var form: some View {
        let d = draft.projectedValue
        return VStack(alignment: .leading, spacing: 10) {
            Picker("", selection: d.kind) {
                Text("Run a command").tag("command")
                Text("Connect to a URL").tag("url")
            }
            .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 320)
            field("Name", text: d.name, hint: "notes")
            if draft.wrappedValue.kind == "command" {
                field("Command", text: d.command, hint: "/usr/local/bin/notes-mcp")
                field("Arguments, one per line", text: d.args, hint: "--stdio", lines: 3)
                field("Environment, KEY=value per line (kept private)", text: d.env, hint: "NOTES_TOKEN=…", lines: 3)
            } else {
                field("Address", text: d.url, hint: "https://example.com/mcp")
                Picker("", selection: d.transport) {
                    Text("Streamable HTTP").tag("http")
                    Text("SSE (older servers)").tag("sse")
                }
                .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 320)
                field("Headers, Name: value per line (kept private)", text: d.headers, hint: "Authorization: Bearer …", lines: 3)
            }
            HStack {
                Text("Saved switched off. Test it, then turn it on for the workers you choose.").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                Spacer()
                QuietButton(title: "Save", symbol: "checkmark") {
                    if let command = model.helpers.addMcp(draft.wrappedValue) {
                        model.sendHelpers(command)
                        draft.wrappedValue = McpServerDraft()
                        adding.wrappedValue = false
                    }
                }
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }

    private func field(_ label: String, text: Binding<String>, hint: String, lines: Int = 1) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 11)).foregroundStyle(theme.text3.color)
            Group {
                if snapshot {
                    Text(text.wrappedValue.isEmpty ? hint : text.wrappedValue).foregroundStyle(text.wrappedValue.isEmpty ? theme.text3.color : theme.text.color)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else if lines == 1 {
                    TextField(hint, text: text).textFieldStyle(.plain)
                } else {
                    TextEditor(text: text).scrollContentBackground(.hidden).frame(height: CGFloat(lines) * 17)
                }
            }
            .font(theme.idFont(.system(size: 12), size: 11.5))
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous)
                .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: 1))
        }
    }
}

/// One server: what it is, its tools, Test, On, Trusted, which workers may use it, Remove.
private struct ServerCard: View {
    let model: IslandModel
    let server: McpServerItem
    let team: [Helper]
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                StatusDot(color: server.enabled ? theme.success.color : server.problem != nil ? theme.problem.color : theme.text3.color, size: 6)
                Text(server.name).font(theme.idFont(.system(size: 13, weight: .semibold), size: 12.5)).foregroundStyle(theme.text.color)
                Text(server.kind == "command" ? (server.command ?? "") : (server.url ?? "")).font(theme.idFont(.system(size: 11), size: 10.5))
                    .foregroundStyle(theme.text3.color).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 8)
                QuietButton(title: "Test") { model.sendHelpers(model.helpers.mcpCommand(.mcpTest(id: server.id))) }
                QuietButton(title: "Remove") { model.sendHelpers(model.helpers.mcpCommand(.mcpRemove(id: server.id))) }
            }
            if let problem = server.problem { ProblemLine(text: problem) }
            else if server.tested { Text(server.tools.isEmpty ? "No tools." : "Tools: \(server.tools.joined(separator: ", "))").font(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(2) }
            else { Text("Not tested yet.").font(.system(size: 11.5)).foregroundStyle(theme.text3.color) }
            let secrets = server.envKeys + server.headerKeys
            if !secrets.isEmpty { Text("Private: \(secrets.joined(separator: ", "))").font(.system(size: 10.5)).foregroundStyle(theme.text3.color) }
            HStack(spacing: 16) {
                toggle("On", server.enabled, enabled: server.enabled || server.canTurnOn) { model.sendHelpers(model.helpers.mcpCommand(.mcpSet(id: server.id, enabled: $0, trusted: nil, workers: nil))) }
                toggle("Trusted", server.trusted, enabled: true) { model.sendHelpers(model.helpers.mcpCommand(.mcpSet(id: server.id, enabled: nil, trusted: $0, workers: nil))) }
                Spacer()
                Menu {
                    ForEach(team.filter(\.available)) { worker in
                        Button {
                            let next = server.workers.contains(worker.id) ? server.workers.filter { $0 != worker.id } : server.workers + [worker.id]
                            model.sendHelpers(model.helpers.mcpCommand(.mcpSet(id: server.id, enabled: nil, trusted: nil, workers: next)))
                        } label: {
                            if server.workers.contains(worker.id) { Label(worker.name, systemImage: "checkmark") } else { Text(worker.name) }
                        }
                    }
                } label: {
                    let names = team.filter { server.workers.contains($0.id) }.map(\.name)
                    PillMenuLabel(label: "Workers", value: names.isEmpty ? "None" : names.count <= 2 ? names.joined(separator: ", ") : "\(names.count) workers", dimmed: names.isEmpty, identifier: false)
                }
                .menuStyle(.button).buttonStyle(.plain).fixedSize()
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }

    private func toggle(_ label: String, _ on: Bool, enabled: Bool, set: @escaping (Bool) -> Void) -> some View {
        HStack(spacing: 8) {
            ThemedSwitch(isOn: on, set: set, label: label).disabled(!enabled)
            Text(label).font(.system(size: 12)).foregroundStyle(enabled ? theme.text.color : theme.text3.color)
        }
        .opacity(enabled ? 1 : 0.6)
    }
}

/// ADR-094: Tinker's draft of a new skill: its name, when to use it and the start of its steps; Approve or Reject.
private struct SkillDraftCard: View {
    let model: IslandModel
    let draft: SkillDraftItem
    @Environment(\.theme) private var theme

    var body: some View {
        SkillCard {
            HStack(spacing: 8) {
                Text("New skill").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                Text(draft.name).font(theme.idFont(.system(size: 13, weight: .semibold), size: 12.5)).foregroundStyle(theme.text.color)
                Spacer(minLength: 8)
                QuietButton(title: "Approve", symbol: "checkmark") { model.sendHelpers(model.helpers.answerSkillDraft(draft.id, approve: true)) }
                QuietButton(title: "Reject", symbol: "xmark") { model.sendHelpers(model.helpers.answerSkillDraft(draft.id, approve: false)) }
            }
            Text(draft.description).font(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
            Text(draft.preview).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(6)
            Text("From task #\(draft.jobId). Nothing uses it until you approve it.").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
        }
    }
}

/// ADR-094: Tinker's edit to one of ZENO's skills: why, and a compact before and after; Accept, Reject or (once accepted) Undo.
private struct SkillEditCard: View {
    let model: IslandModel
    let edit: SkillEditItem
    @Environment(\.theme) private var theme

    var body: some View {
        SkillCard {
            HStack(spacing: 8) {
                Text(edit.state == "accepted" ? "Edited" : "Edit").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                Text(edit.skill).font(theme.idFont(.system(size: 13, weight: .semibold), size: 12.5)).foregroundStyle(theme.text.color)
                Spacer(minLength: 8)
                if edit.state == "pending" {
                    QuietButton(title: "Accept", symbol: "checkmark") { model.sendHelpers(model.helpers.answerSkillEdit(edit.id, accept: true)) }
                    QuietButton(title: "Reject", symbol: "xmark") { model.sendHelpers(model.helpers.answerSkillEdit(edit.id, accept: false)) }
                } else {
                    QuietButton(title: "Undo", symbol: "arrow.uturn.backward") { model.sendHelpers(model.helpers.undoSkillEdit(edit.id)) }
                }
            }
            Text(edit.reason).font(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
            side("Before", edit.before)
            side("After", edit.after)
        }
    }

    private func side(_ label: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(label).font(.system(size: 10.5, weight: .medium)).foregroundStyle(theme.text3.color).frame(width: 44, alignment: .leading)
            Text(text.isEmpty ? "(nothing)" : text).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text2.color).lineLimit(6)
        }
    }
}

/// The card frame the skill drafts and edits share with the server cards.
private struct SkillCard<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) { content }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
                .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }
}
