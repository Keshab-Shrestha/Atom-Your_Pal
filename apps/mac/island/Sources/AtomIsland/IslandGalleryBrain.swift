import AppKit
import SwiftUI
import AtomIslandCore

extension IslandGallery {
    /// The Second brain page: a graph of about thirty notes in clusters (home, a trip, work, tools) with one note open.
    /// Sample data only.
    static func writeBrain(to directory: URL, theme: AppTheme = .void, name: String = "17-brain") {
        let suite = "atom.gallery.brain.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let palette = theme.palette

        // (id, title, kind, tags, ghost)
        let notes: [(Int, String, BrainKind, [String], Bool)] = [
            (1, "Mesh Wi-Fi", .note, ["home"], false), (2, "Router settings", .note, ["home"], false), (3, "ISP contract", .note, ["home"], false),
            (4, "Prefers short answers", .memory, [], false), (5, "Keshab", .entity, [], false), (6, "Kyoto trip", .project, ["travel"], false),
            (7, "Flights to Osaka", .note, ["travel"], false), (8, "Hotel shortlist", .note, ["travel"], false), (9, "Suica card", .note, ["travel"], false),
            (10, "Plan a weekend in Kyoto", .chat, ["travel"], false), (11, "Weekly report", .note, ["work"], false), (12, "Haat marketplace", .project, ["work"], false),
            (13, "Seller onboarding", .note, ["work"], false), (14, "eSewa payments", .note, ["work"], false), (15, "Khalti", .note, ["work"], true),
            (16, "Penny", .entity, [], false), (17, "Budget 2026", .note, ["money"], false), (18, "Talked about the trip", .episode, ["travel"], false),
            (19, "Mac mini prices", .chat, [], false), (20, "Home office", .note, ["home"], false), (21, "Standing desk", .note, ["home"], false),
            (22, "Parakeet dictation", .note, ["tools"], false), (23, "FluidVoice", .entity, ["tools"], false), (24, "ATOM roadmap", .project, ["work"], false),
            (25, "Browser automation", .note, ["work"], false), (26, "MCP servers", .note, ["tools"], false), (27, "Claude Desktop", .entity, ["tools"], true),
            (28, "Skills", .note, ["tools"], false),
        ]
        let links: [(Int, Int)] = [
            (1, 2), (1, 3), (1, 20), (20, 21), (5, 4), (5, 6), (6, 7), (6, 8), (6, 9), (10, 6), (18, 6), (7, 17), (8, 17), (5, 11), (11, 12), (12, 13),
            (12, 14), (14, 15), (5, 16), (16, 17), (19, 5), (5, 22), (22, 23), (24, 12), (24, 25), (25, 26), (26, 27), (28, 26), (28, 24), (5, 24), (11, 24),
        ]
        var degree = [Int: Int]()
        for (a, b) in links { degree[a, default: 0] += 1; degree[b, default: 0] += 1 }
        let graph = BrainGraphData(
            nodes: notes.map { BrainNode(id: $0.0, title: $0.1, kind: $0.2, ghost: $0.4, tags: $0.3, degree: degree[$0.0] ?? 0) },
            edges: links.enumerated().map { BrainEdge(a: $0.element.0, b: $0.element.1, auto: $0.offset % 7 == 3) },
            tags: [BrainTag(tag: "work", count: 8), BrainTag(tag: "travel", count: 6), BrainTag(tag: "home", count: 5), BrainTag(tag: "tools", count: 5)])

        let m = IslandModel(settings: IslandSettings(defaults: defaults))
        m.settings.theme = theme
        m.windowPage = .brain
        m.brain.setGraph(graph)
        m.brain.setNote(BrainNoteData(
            id: 6, title: "Kyoto trip", body: "Three days in April. Fly to Osaka, then the train.\n\nSee [[Flights to Osaka]], [[Hotel shortlist]] and [[Suica card]]. #travel",
            kind: .project, tags: ["travel"],
            links: [BrainLink(id: 7, title: "Flights to Osaka"), BrainLink(id: 8, title: "Hotel shortlist"), BrainLink(id: 9, title: "Suica card")],
            backlinks: [BrainLink(id: 10, title: "Plan a weekend in Kyoto"), BrainLink(id: 5, title: "Keshab")]))

        let shape = RoundedRectangle(cornerRadius: palette.isFlat ? 24 : 16, style: .continuous)
        let page = BrainPane(model: m)
            .environment(\.islandSnapshot, true)
            .frame(width: 1000, height: 640)
            .background(palette.surfaceSolid.color)
            .themed(palette)
            .clipShape(shape)
            .overlay(shape.strokeBorder(palette.border.color, lineWidth: 1))
        save(page.padding(20).background(Color(red: 0.36, green: 0.42, blue: 0.52)), name: name, to: directory)
    }

    /// Plugins → Add server → Paste config: a Claude Desktop config with three servers, one of them already added.
    static func writeMcpPaste(to directory: URL, theme: AppTheme = .void, name: String = "18-mcp-paste") {
        let suite = "atom.gallery.mcp.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let palette = theme.palette
        let m = IslandModel(settings: IslandSettings(defaults: defaults))
        m.settings.theme = theme
        let config = """
        {
          "mcpServers": {
            "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Documents"] },
            "GitHub Tools": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "ghp_example" } },
            "notes": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer example" } }
          }
        }
        """
        let page = McpPasteForm(model: m, existing: ["notes"], initialText: config) {}
            .environment(\.islandSnapshot, true)
            .frame(width: 640)
            .padding(24)
            .background(palette.surfaceSolid.color)
            .themed(palette)
        save(page, name: name, to: directory)
    }

    /// The states besides "full": Needs you and Issues while loading, empty and with an error, and the loading view when it
    /// is slow. A list that has not heard from ATOM must not look empty.
    static func writeStates(to directory: URL, theme: AppTheme = .void, name: String = "19-states") {
        let suite = "atom.gallery.states.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let palette = theme.palette
        let empty = #"{"type":"helpers","apps":[],"teamTasks":[],"helpers":[],"managers":[]}"#
        let failure = #"{"type":"error","stage":"settings","message":"ATOM did not answer. Nothing was changed."}"#

        func model(loaded: Bool, failed: Bool = false) -> IslandModel {
            let m = IslandModel(settings: IslandSettings(defaults: defaults))
            m.settings.theme = theme
            if loaded, let event = try? decodeEvent(empty) { m.apply(event) }
            if failed {
                _ = m.helpers.mcpCommand(.mcpRemove(id: 1)) // the window waits for an answer, so the refusal is shown
                if let event = try? decodeEvent(failure) { m.apply(event) }
            }
            return m
        }
        func cell<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.system(size: 10.5, weight: .semibold)).foregroundStyle(.white.opacity(0.75))
                content()
                    .environment(\.islandSnapshot, true)
                    .frame(width: 440, height: 210, alignment: .topLeading)
                    .background(palette.surfaceSolid.color)
                    .themed(palette)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(palette.border.color, lineWidth: 1))
            }
        }
        let sheet = VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 16) {
                cell("Needs you: loading") { NeedsYouPane(model: model(loaded: false)) }
                cell("Needs you: empty") { NeedsYouPane(model: model(loaded: true)) }
                cell("Needs you: error") { NeedsYouPane(model: model(loaded: true, failed: true)) }
            }
            HStack(alignment: .top, spacing: 16) {
                cell("Scheduled: loading") { ScheduledPane(model: model(loaded: false)) }
                cell("Scheduled: empty") { ScheduledPane(model: model(loaded: true)) }
                cell("Dashboard: loading") { DashboardPane(model: model(loaded: false)) }
            }
            HStack(alignment: .top, spacing: 16) {
                cell("Plugins: loading") { PluginsPane(model: model(loaded: false)) }
                cell("Plugins: empty") { PluginsPane(model: model(loaded: true)) }
                cell("Overview: loading") { OverviewPane(model: model(loaded: false)) }
            }
            HStack(alignment: .top, spacing: 16) {
                cell("Loading, slow") { LoadingStateView(text: "Loading chats…", retry: {}, slow: true).padding(16) }
                cell("Empty with an action") {
                    EmptyStateView(title: "No skills yet", detail: "Your skills come from ~/.claude/skills. ATOM's come from tasks you rate good.",
                                   action: (title: "Open the skills folder", symbol: "folder", run: {})).padding(16)
                }
                Color.clear.frame(width: 440, height: 210)
            }
        }
        .padding(24)
        .background(Color(red: 0.36, green: 0.42, blue: 0.52))
        save(sheet, name: name, to: directory)
    }

    /// Settings → AI model, with "Allow the large model for helpers" (it was the bottom block of the sidebar until 2026-10-15).
    static func writeModelPage(to directory: URL, theme: AppTheme = .void, name: String = "20-settings-model") {
        let suite = "atom.gallery.model.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let palette = theme.palette
        let info = #"{"type":"info","provider":"claude-plan","model":"claude-sonnet-5-5","providers":[{"id":"claude-plan","name":"Claude (my plan)","available":true,"models":[{"id":"claude-opus-5-5","name":"Claude Opus 5.5"},{"id":"claude-sonnet-5-5","name":"Claude Sonnet 5.5"},{"id":"claude-haiku-4-5-20251001","name":"Claude Haiku 4.5"}]}]}"#
        let helpers = #"{"type":"helpers","apps":[],"teamTasks":[],"helpers":[],"managers":[],"allowLarge":false,"models":[{"id":"claude-haiku-4-5","name":"Claude Haiku 4.5","tier":"small"},{"id":"claude-sonnet-4-5","name":"Claude Sonnet 4.5","tier":"medium"},{"id":"claude-opus-5-5","name":"Claude Opus 5.5","tier":"large"}]}"#
        let m = IslandModel(settings: IslandSettings(defaults: defaults))
        m.settings.theme = theme
        for line in [info, helpers] { if let event = try? decodeEvent(line) { m.apply(event) } }
        let page = ModelSection(model: m)
            .environment(\.islandSnapshot, true)
            .frame(width: 560)
            .padding(24)
            .background(palette.surfaceSolid.color)
            .themed(palette)
        save(page, name: name, to: directory)
    }

    /// The "/" picker over the message box: "/re" with ATOM's commands, a skill and Claude commands.
    static func writeSlashPicker(to directory: URL, theme: AppTheme = .void, name: String = "21-slash-picker") {
        let suite = "atom.gallery.slash.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let palette = theme.palette
        let m = IslandModel(settings: IslandSettings(defaults: defaults))
        m.settings.theme = theme
        if let event = try? decodeEvent(#"{"type":"commands","commands":[{"name":"review","description":"Review a file and list problems.","hint":"[file]"},{"name":"build-fix","description":"Fix build errors with minimal changes."},{"name":"checkpoint","description":"Create or verify a checkpoint."},{"name":"code-review","description":"Review the changes in this branch."}]}"#) { m.apply(event) }
        let page = VStack(spacing: 16) {
            Composer(model: m, initialDraft: "/re").frame(width: 560)
            Composer(model: m, initialDraft: "/").frame(width: 560)
        }
        .environment(\.islandSnapshot, true)
        .padding(24)
        .background(palette.surfaceSolid.color)
        .themed(palette)
        save(page, name: name, to: directory)
    }

    /// ADR-124: Settings → Design system, Showcase and Tokens, each in Void and Daylight.
    static func writeDesignPage(to directory: URL) {
        for (mode, preview, name) in [(DesignShowcaseMode.showcase, DesignPreviewTheme.void, "22-design-showcase"),
                                      (.showcase, .daylight, "22-design-showcase-daylight"),
                                      (.tokens, .void, "22-design-tokens"),
                                      (.tokens, .daylight, "22-design-tokens-daylight")] {
            let suite = "atom.gallery.design.\(name).\(ProcessInfo.processInfo.processIdentifier)"
            let defaults = UserDefaults(suiteName: suite)!
            defer { defaults.removePersistentDomain(forName: suite) }
            let palette = AppTheme.void.palette
            let m = IslandModel(settings: IslandSettings(defaults: defaults))
            m.settings.theme = .void
            let page = VStack(alignment: .leading, spacing: Spacing.wells) {
                DesignSection(model: m, mode: mode, preview: preview)
            }
            .environment(\.islandSnapshot, true)
            .frame(width: 560)
            .padding(24)
            .background(palette.surfaceSolid.color)
            .themed(palette)
            save(page, name: name, to: directory)
        }
    }
}

