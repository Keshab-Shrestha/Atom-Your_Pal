import AppKit
import SwiftUI
import ArkIslandCore

/// ⌘K (2026-11-02, after Keshab's "Agent CRM workspace" reference): one box for every action, page, chat, agent, project,
/// Settings page and theme. Type to filter; ↑ ↓ choose; Return runs; Esc or a click outside closes.
struct CommandPaletteView: View {
    let model: IslandModel
    @State private var query = ""
    @State private var cursor = 0
    @FocusState private var focused: Bool
    @Environment(\.theme) private var theme
    /// Development snapshots draw neither text fields nor scroll views: the placeholder and the first rows instead.
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let (entries, actions) = Self.catalog(model)
        let results = PaletteSearch.rank(entries, query)
        ZStack(alignment: .top) {
            Color.black.opacity(theme.isDark ? 0.35 : 0.18).ignoresSafeArea().onTapGesture { close() }.accessibilityHidden(true)
            VStack(spacing: 0) {
                field(results, actions)
                Divider()
                list(results, actions)
            }
            .frame(width: 580)
            .background(RoundedRectangle(cornerRadius: theme.radiusSurface, style: .continuous).fill(theme.surfaceSolid.color))
            .overlay(RoundedRectangle(cornerRadius: theme.radiusSurface, style: .continuous).strokeBorder(theme.border.color, lineWidth: 1))
            .shadow(color: .black.opacity(0.22), radius: 30, y: 12)
            .padding(.top, 90)
        }
        .onAppear { focused = true }
        .accessibilityAddTraits(.isModal)
    }

    private func field(_ results: [PaletteEntry], _ actions: [String: () -> Void]) -> some View {
        HStack(spacing: 10) {
            Glyph(systemName: "magnifyingglass").foregroundStyle(theme.text3.color)
            if snapshot {
                Text("Search or run a command…").appFont(.system(size: 15)).foregroundStyle(theme.text3.color).frame(maxWidth: .infinity, alignment: .leading)
            } else {
            TextField("Search or run a command…", text: $query)
                .textFieldStyle(.plain).appFont(.system(size: 15)).focused($focused)
                .onChange(of: query) { cursor = 0 }
                .onKeyPress(.downArrow) { cursor = min(cursor + 1, max(0, results.count - 1)); return .handled }
                .onKeyPress(.upArrow) { cursor = max(cursor - 1, 0); return .handled }
                .onKeyPress(.escape) { close(); return .handled }
                .onSubmit { if results.indices.contains(cursor) { run(results[cursor], actions) } }
                .accessibilityLabel("Command palette search")
            }
            Text("esc").appFont(.system(size: 11, design: .monospaced)).foregroundStyle(theme.text3.color)
        }
        .padding(.horizontal, 16).frame(height: 52)
    }

    @ViewBuilder private func list(_ results: [PaletteEntry], _ actions: [String: () -> Void]) -> some View {
        if snapshot {
            VStack(spacing: 2) { ForEach(Array(results.prefix(9).enumerated()), id: \.element.id) { index, entry in row(entry, selected: index == 0) } }.padding(6)
        } else {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(Array(results.enumerated()), id: \.element.id) { index, entry in
                        row(entry, selected: index == cursor).id(entry.id)
                            .onTapGesture { run(entry, actions) }
                            .onHover { if $0 { cursor = index } }
                    }
                    if results.isEmpty {
                        Text("Nothing matches “\(query)”.").appFont(.system(size: 13)).foregroundStyle(theme.text3.color).padding(20)
                    }
                }
                .padding(6)
            }
            .frame(maxHeight: 380)
            .onChange(of: cursor) { if results.indices.contains(cursor) { proxy.scrollTo(results[cursor].id) } }
        }
        }
    }

    private func row(_ entry: PaletteEntry, selected: Bool) -> some View {
        HStack(spacing: 10) {
            Glyph(systemName: entry.symbol).appFont(.system(size: 13)).foregroundStyle(theme.text2.color).frame(width: 20)
            Text(entry.title).appFont(.system(size: 13.5)).foregroundStyle(theme.text.color).lineLimit(1)
            if !entry.detail.isEmpty { Text(entry.detail).appFont(.system(size: 12)).foregroundStyle(theme.text3.color).lineLimit(1) }
            Spacer(minLength: 8)
            Text(entry.group).appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
        }
        .padding(.horizontal, 10).frame(height: 34)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl).fill(selected ? theme.fill2.color : .clear))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }

    private func run(_ entry: PaletteEntry, _ actions: [String: () -> Void]) {
        close()
        actions[entry.id]?()
    }

    private func close() { model.paletteShown = false }
}

extension CommandPaletteView {
    /// Every entry and what it does, from the model as it is now.
    static func catalog(_ model: IslandModel) -> ([PaletteEntry], [String: () -> Void]) {
        var entries: [PaletteEntry] = []
        var actions: [String: () -> Void] = [:]
        func add(_ entry: PaletteEntry, _ action: @escaping () -> Void) { entries.append(entry); actions[entry.id] = action }
        addActions(model, add)
        addPages(model, add)
        addItems(model, add)
        return (entries, actions)
    }

    private static func addActions(_ model: IslandModel, _ add: (PaletteEntry, @escaping () -> Void) -> Void) {
        if model.canStartNewChat { add(.init(id: "new-chat", title: "New chat", detail: "⌘N", symbol: "square.and.pencil", group: "Actions"), model.startNewChat) }
        if model.canOpenProjectSources { add(.init(id: "new-project", title: "New project", detail: "⇧⌘N", symbol: "folder.badge.plus", group: "Actions"), model.openProjectSources) }
        add(.init(id: "ask-agent", title: "Ask an agent", detail: "⌘J", symbol: "person.wave.2", group: "Actions", keywords: "task give"), { model.agentPanel = "" })
        add(.init(id: "new-agent", title: "New agent", symbol: "person.badge.plus", group: "Actions", keywords: "create make"), { model.navigate { model.helpers.openNewAgent() } })
        if !model.conversation.turns.isEmpty {
            add(.init(id: "select-text", title: "Select text in chat", detail: "⇧⌘A", symbol: "text.cursor", group: "Actions", keywords: "copy"), {
                model.navigate { model.windowPage = .chat }; model.chatSelecting = true
            })
            add(.init(id: "copy-chat", title: "Copy whole chat", symbol: "doc.on.doc", group: "Actions"), {
                _ = ChatClipboard.write(MarkdownCopy.Content(text: model.conversation.markdown))
            })
            add(.init(id: "find", title: "Find in chat", detail: "⌘F", symbol: "magnifyingglass", group: "Actions", keywords: "search"), {
                model.navigate { model.windowPage = .chat }; model.openChatFind()
            })
        }
        add(.init(id: "sidebar", title: model.settings.sidebarHidden ? "Show sidebar" : "Hide sidebar", symbol: "sidebar.left", group: "Actions"), model.toggleSidebar)
        add(.init(id: "lights", title: model.settings.studioLightsOn ? "Turn Studio lights off" : "Turn Studio lights on", symbol: "lightbulb", group: "Actions",
                  keywords: "board blueprint"), { model.settings.studioLightsOn.toggle() })
    }

    private static func addPages(_ model: IslandModel, _ add: (PaletteEntry, @escaping () -> Void) -> Void) {
        func go(_ page: WindowPage) -> () -> Void { { model.navigate { model.windowPage = page } } }
        add(.init(id: "go:chat", title: "Chat", symbol: "bubble.left.and.bubble.right", group: "Go to"), go(.chat))
        add(.init(id: "go:dashboard", title: "Dashboard", symbol: "chart.bar", group: "Go to", keywords: "tokens cost usage"), go(.dashboard))
        let boardSymbols: [BoardView: String] = [.floor: "building.2", .needsYou: "tray", .columns: "list.bullet", .team: "person.2", .overview: "chart.bar.xaxis"]
        for view in [BoardView.floor, .needsYou, .columns, .team, .overview] {
            add(.init(id: "board:\(view.rawValue)", title: view.title, detail: "Board", symbol: boardSymbols[view] ?? "square.grid.2x2", group: "Go to", keywords: "board"), {
                model.navigate { model.windowPage = .agents; model.helpers.selectBoard(); model.boardView = view }
            })
        }
        add(.init(id: "go:panels", title: "Panels", symbol: "square.grid.2x2", group: "Go to", keywords: "widgets lists counters morphs"), go(.panels))
        add(.init(id: "go:apps", title: "Apps", symbol: "app.dashed", group: "Go to", keywords: "plugins tools built run sandbox"), go(.apps))
        add(.init(id: "go:you", title: "You", symbol: "person.crop.circle", group: "Go to", keywords: "profile me memory account"), go(.you))
        add(.init(id: "go:workflows", title: "Workflows", symbol: "point.3.connected.trianglepath.dotted", group: "Go to", keywords: "automation trigger steps"), go(.workflows))
        add(.init(id: "go:scheduled", title: "Scheduled", symbol: "calendar", group: "Go to", keywords: "routines"), go(.scheduled))
        add(.init(id: "go:brain", title: "Brain", symbol: "brain.head.profile", group: "Go to", keywords: "notes memory"), go(.brain))
        add(.init(id: "go:plugins", title: "Plugins", symbol: "puzzlepiece.extension", group: "Go to", keywords: "skills mcp"), go(.plugins))
        add(.init(id: "go:settings", title: "Settings", symbol: "gearshape", group: "Go to"), { model.openSettings(nil) })
        for page in SettingsPage.allCases {
            add(.init(id: "settings:\(page.rawValue)", title: page.rawValue, detail: "Settings", symbol: page.symbol, group: "Settings"), { model.openSettings(page) })
        }
        for theme in AppTheme.allCases {
            add(.init(id: "theme:\(theme.rawValue)", title: theme.title, detail: "Theme", symbol: "paintpalette", group: "Themes", keywords: "appearance look"), {
                model.settings.theme = theme
            })
        }
    }

    private static func addItems(_ model: IslandModel, _ add: (PaletteEntry, @escaping () -> Void) -> Void) {
        let chats = (model.chats?.chats ?? []).filter { !$0.archived }.sorted { ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }
        for chat in chats.prefix(30) {
            add(.init(id: "chat:\(chat.id)", title: chat.title.isEmpty ? "Untitled chat" : chat.title, symbol: "bubble.left", group: "Chats"), {
                model.navigate { model.windowPage = .chat }; model.send(.chatOpen(id: chat.id))
            })
        }
        for helper in (model.helpers.list?.helpers ?? []) where helper.role != "improver" {
            add(.init(id: "agent:\(helper.id)", title: helper.name, detail: helper.roleTitle, symbol: "person.crop.circle", group: "Agents"), {
                model.navigate { model.windowPage = .agents; model.helpers.selectHelper(helper.id) }
            })
        }
        for project in (model.chats?.projects ?? []) where !project.archived {
            add(.init(id: "project:\(project.id)", title: project.name, detail: project.folderLabel, symbol: "folder", group: "Projects"), {
                model.navigate { model.windowPage = .chat }; model.settings.projectFilter = project.id
            })
        }
    }
}
