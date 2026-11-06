import SwiftUI
import ArkIslandCore

/// ADR-090: what the workers can use beyond their kit: Keshab's skills (chosen per worker) and his MCP servers (added
/// here, saved off, tested, turned on per worker; every call asks on Pal's card unless the server is trusted).
struct PluginsPane: View {
    let model: IslandModel
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let adding = State(initialValue: false)
    private let draft = State(initialValue: McpServerDraft())
    /// Add server: false is the paste box (the Claude Desktop JSON), true is the by-hand form.
    private let byHand = State(initialValue: false)
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    init(model: IslandModel) { self.model = model }

    var body: some View {
        let list = model.helpers.list
        Scrollable {
            VStack(alignment: .leading, spacing: 24) {
                HStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Plugins").appFont(.system(size: 20, weight: .medium)).foregroundStyle(theme.text.color).accessibilityAddTraits(.isHeader)
                        Text("Skills and MCP servers your workers may use. Nothing is on until you turn it on.").appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                    }
                }
                if let problem = model.helpers.problem { ProblemLine(text: problem) }
                StudioCard(model: model)
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        PluginsSectionLabel(title: "MCP servers", count: list?.mcp.count)
                        Spacer()
                        if model.savedField == "mcp" && model.helpers.problem == nil { SavedMark() }
                        // With no servers the empty card offers Add server; one button, not two.
                        if adding.wrappedValue || !(list?.mcp ?? []).isEmpty {
                            QuietButton(title: adding.wrappedValue ? "Cancel" : "Add server", symbol: adding.wrappedValue ? "xmark" : "plus") {
                                adding.wrappedValue.toggle()
                                model.helpers.clearProblem()
                            }
                        }
                    }
                    if adding.wrappedValue { addPanel(existing: Set((list?.mcp ?? []).map(\.name))) }
                    if list == nil {
                        LoadingStateView(text: "Loading servers…", retry: { model.send(.helpersList) })
                    } else if (list?.mcp ?? []).isEmpty && !adding.wrappedValue {
                        EmptyStateView(title: "No MCP servers yet",
                                       detail: "An MCP server gives your workers more tools, such as files or a database. Paste one from Claude Desktop, or fill it in by hand.",
                                       action: (title: "Add server", symbol: "plus", run: { adding.wrappedValue = true }))
                    }
                    ForEach(list?.mcp ?? []) { server in ServerCard(model: model, server: server, team: list?.helpers ?? []) }
                }
                VStack(alignment: .leading, spacing: 8) {
                    PluginsSectionLabel(title: "Skills", count: list?.skills.count)
                    // ADR-094: Tinker's drafts and edits wait here; nothing is used or changed before you answer.
                    ForEach((list?.skillDrafts ?? []).filter { $0.state == "pending" }) { draft in SkillDraftCard(model: model, draft: draft) }
                    ForEach((list?.skillEdits ?? []).filter { $0.state == "pending" || $0.state == "accepted" }) { edit in SkillEditCard(model: model, edit: edit) }
                    // 2026-10-15: one dropdown for the long list, and an editor for the chosen skill (SkillsSection.swift).
                    SkillsSection(model: model, skills: list?.skills ?? [], loaded: list != nil) { name in
                        (list?.helpers ?? []).filter { $0.skills.contains(name) }.map(\.name)
                    }
                }
                HubSkillsSection(model: model, hub: list?.skillHub ?? .empty) // B3.5
            }
            // A readable measure, as on the Settings pages.
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.panel)
            .padding(.top, 28)
            .padding(.bottom, Spacing.panel)
        }
        .tracksEdits(model, "mcp", adding.wrappedValue && draft.wrappedValue != McpServerDraft())
    }

    /// Saves the new server (switched off) and closes the form; an incomplete one shows why.
    private func save() {
        guard let command = model.helpers.addMcp(draft.wrappedValue) else { return }
        model.sendHelpers(command)
        draft.wrappedValue = McpServerDraft()
        adding.wrappedValue = false
        model.showSaved("mcp")
    }

    /// Add server: paste the same JSON as Claude Desktop (the default), or fill the form in by hand.
    private func addPanel(existing: Set<String>) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("", selection: byHand.projectedValue) {
                Text("Paste config").tag(false)
                Text("By hand").tag(true)
            }
            .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 320)
            if byHand.wrappedValue {
                form
            } else {
                McpPasteForm(model: model, existing: existing) { adding.wrappedValue = false }
            }
        }
    }

    private var form: some View {
        let d = draft.projectedValue
        return VStack(alignment: .leading, spacing: 12) {
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
                Text("Saved switched off. Test it, then turn it on for the workers you choose.").appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                Spacer()
                SaveButton(enabled: draft.wrappedValue != McpServerDraft(), commandS: true, label: "Save server", action: save)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }

    private func field(_ label: String, text: Binding<String>, hint: String, lines: Int = 1) -> some View {
        SoulField(label: label, text: text, lines: lines, submit: { save() }, monospaced: true)
            .help(Text(hint))
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
            HStack(spacing: 12) {
                let state = server.enabled ? theme.success.color : server.problem != nil ? theme.problem.color : theme.text3.color
                Glyph(systemName: server.kind == "command" ? "terminal" : "globe").appFont(.system(size: 13, weight: .medium)).foregroundStyle(theme.text2.color)
                    .frame(width: 36, height: 36)
                    .background(theme.fill3.color, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text(server.name).appFont(theme.appIdentifierFont(.system(size: 13, weight: .semibold), size: 12.5)).foregroundStyle(theme.text.color)
                        Text(server.enabled ? "On" : server.problem != nil ? "Problem" : "Off").appFont(.system(size: 10, weight: .semibold))
                            .foregroundStyle(state).padding(.horizontal, 8).frame(height: 16).background(Capsule().fill(state.opacity(0.12)))
                    }
                    Text(server.kind == "command" ? (server.command ?? "") : (server.url ?? "")).appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5))
                        .foregroundStyle(theme.text3.color).lineLimit(1).truncationMode(.middle)
                }
                Spacer(minLength: 8)
                QuietButton(title: "Test", symbol: "bolt") { model.sendHelpers(model.helpers.mcpCommand(.mcpTest(id: server.id))) }
                IconButton(symbol: "trash", label: "Remove \(server.name)", diameter: ControlMetrics.buttonHeight) { model.sendHelpers(model.helpers.mcpCommand(.mcpRemove(id: server.id))) }
            }
            if let problem = server.problem { ProblemLine(text: problem) }
            else if server.tested { Text(server.tools.isEmpty ? "No tools." : "Tools: \(server.tools.joined(separator: ", "))").appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(2) }
            else { Text("Not tested yet.").appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color) }
            let secrets = server.envKeys + server.headerKeys
            if !secrets.isEmpty { Text("Private: \(secrets.joined(separator: ", "))").appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color) }
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
        .pluginCard()
    }

    private func toggle(_ label: String, _ on: Bool, enabled: Bool, set: @escaping (Bool) -> Void) -> some View {
        HStack(spacing: 8) {
            ThemedSwitch(isOn: on, set: set, label: label).disabled(!enabled)
            Text(label).appFont(.system(size: 12)).foregroundStyle(enabled ? theme.text.color : theme.text3.color)
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
                Text("New skill").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                Text(draft.name).appFont(theme.appIdentifierFont(.system(size: 13, weight: .semibold), size: 12.5)).foregroundStyle(theme.text.color)
                Spacer(minLength: 8)
                QuietButton(title: "Approve", symbol: "checkmark") { model.sendHelpers(model.helpers.answerSkillDraft(draft.id, approve: true)) }
                QuietButton(title: "Reject", symbol: "xmark") { model.sendHelpers(model.helpers.answerSkillDraft(draft.id, approve: false)) }
            }
            Text(draft.description).appFont(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
            Text(draft.preview).appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(6)
            Text("From task #\(draft.jobId). Nothing uses it until you approve it.").appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
        }
    }
}

/// ADR-094: Tinker's edit to one of ARK's skills: why, and a compact before and after; Accept, Reject or (once accepted) Undo.
private struct SkillEditCard: View {
    let model: IslandModel
    let edit: SkillEditItem
    @Environment(\.theme) private var theme

    var body: some View {
        SkillCard {
            HStack(spacing: 8) {
                Text(edit.state == "accepted" ? "Edited" : "Edit").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                Text(edit.skill).appFont(theme.appIdentifierFont(.system(size: 13, weight: .semibold), size: 12.5)).foregroundStyle(theme.text.color)
                Spacer(minLength: 8)
                if edit.state == "pending" {
                    QuietButton(title: "Accept", symbol: "checkmark") { model.sendHelpers(model.helpers.answerSkillEdit(edit.id, accept: true)) }
                    QuietButton(title: "Reject", symbol: "xmark") { model.sendHelpers(model.helpers.answerSkillEdit(edit.id, accept: false)) }
                } else {
                    QuietButton(title: "Undo", symbol: "arrow.uturn.backward") { model.sendHelpers(model.helpers.undoSkillEdit(edit.id)) }
                }
            }
            Text(edit.reason).appFont(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
            side("Before", edit.before)
            side("After", edit.after)
            // ADR-098 item 8: how the edit does on the skill's test cases.
            TestRunView(model: model, kind: "skill", id: edit.id, tests: edit.tests,
                        hasCases: !(model.helpers.list?.testCases(kind: "skill", target: edit.skill).isEmpty ?? true), pending: edit.state == "pending")
        }
    }

    private func side(_ label: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(label).appFont(.system(size: 10.5, weight: .medium)).foregroundStyle(theme.text3.color).frame(width: 44, alignment: .leading)
            Text(text.isEmpty ? "(nothing)" : text).appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text2.color).lineLimit(6)
        }
    }
}

/// The card frame the skill drafts and edits share with the server cards.
struct SkillCard<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) { content }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .pluginCard()
    }
}

/// A section label on the Plugins page: small tracked capitals and, once known, a count badge.
private struct PluginsSectionLabel: View {
    let title: String
    let count: Int?
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 8) {
            Text(title).appFont(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            if let count, count > 0 {
                Text("\(count)").appFont(.system(size: 10, weight: .semibold)).monospacedDigit().foregroundStyle(theme.text2.color)
                    .padding(.horizontal, 4).frame(minWidth: 18, minHeight: 16).background(Capsule().fill(theme.fill3.color))
            }
        }
        .accessibilityElement(children: .combine)
    }
}

extension View {
    /// The Plugins page's card: the card fill, a hairline, and hover depth.
    func pluginCard() -> some View { modifier(PluginCardModifier()) }
}

private struct PluginCardModifier: ViewModifier {
    @Environment(\.theme) private var theme
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
        content
            .background(theme.fill1.a > 0 ? theme.fill1.color : theme.fill2.color.opacity(0.5), in: shape)
            .overlay(shape.strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
            .hoverLift(radius: 14)
    }
}

/// ADR-267: Studio, ARK's own video maker and poster. What is set up, what is missing and how to add it, YouTube sign-in, and the
/// folder the videos go to. Keys are never shown or typed here: they live in ARK's .env, which Keshab edits himself.
struct StudioCard: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let s = model.studio
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                PluginsSectionLabel(title: "Studio", count: nil)
                Spacer()
                if let s, !s.folder.isEmpty { QuietButton(title: "Open folder", symbol: "folder") { model.send(.studioOpen) } }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("ARK makes short vertical videos (AI footage, its voice) and posts them to YouTube. You approve every video and every post first.")
                    .appFont(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
                if let s {
                    line(s.gemini, "AI footage", s.gemini ? "Gemini key is set" : "Add ARK_STUDIO_GEMINI_KEY to ARK's .env, then restart ARK")
                    line(s.ffmpeg, "Video editing", s.ffmpeg ? "ffmpeg found" : "Install ffmpeg: brew install ffmpeg")
                    HStack(spacing: 8) {
                        line(s.youtubeConnected, "YouTube",
                             s.youtubeConnected ? "Signed in as \(s.channel ?? "your channel")"
                             : s.youtubeConfigured ? "Not signed in" : "Add ARK_YOUTUBE_CLIENT_ID and ARK_YOUTUBE_CLIENT_SECRET to ARK's .env")
                        Spacer()
                        if s.youtubeConfigured {
                            if s.youtubeConnected { QuietButton(title: "Sign out") { model.send(.studioYouTubeSignOut) } }
                            else { QuietButton(title: "Sign in to YouTube", symbol: "person.badge.key") { model.send(.studioYouTubeSignIn) } }
                        }
                    }
                    if let problem = s.problem { ProblemLine(text: problem) }
                } else {
                    LoadingStateView(text: "Checking Studio…", retry: { model.send(.studioStatus) })
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).fill(theme.fill1.color))
            .overlay(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).strokeBorder(theme.border.color, lineWidth: 1))
        }
        .onAppear { model.send(.studioStatus) }
    }

    private func line(_ ok: Bool, _ title: String, _ detail: String) -> some View {
        HStack(spacing: 8) {
            Glyph(systemName: ok ? "checkmark.circle.fill" : "circle.dashed").appFont(.system(size: 12))
                .foregroundStyle(ok ? theme.success.color : theme.text3.color)
            Text(title).appFont(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color)
            Text(detail).appFont(.system(size: 12)).foregroundStyle(theme.text2.color).lineLimit(2)
        }
        .accessibilityElement(children: .combine)
    }
}
