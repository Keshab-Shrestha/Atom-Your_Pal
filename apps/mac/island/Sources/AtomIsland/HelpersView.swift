import AppKit
import SwiftUI
import AtomIslandCore

/// Native four-lane workspace (ADR-201). All destinations keep their existing model/controller operations.
/// The logic lives in `HelpersState`; these views only draw it.
struct HelpersView: View {
    let model: IslandModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.islandSnapshot) private var snapshot

    /// Room at the top of the sidebar for the window's buttons (the title bar is transparent over the content).
    static let titleBarRoom: CGFloat = 40
    /// Space above the top bar of the main pane (2026-10-15): the bar's content sits level with the app name in the sidebar.
    static let topBarGap: CGFloat = 36

    var body: some View {
        let chat = model.windowPage == .chat
        let palette = ChatAppearance.palette(theme: model.settings.theme)
        let sidebarHidden = model.settings.sidebarHidden || (model.windowPage != .chat && model.windowPage != .settings)
        HStack(spacing: 8) {
            WorkspaceNavigationRail(model: model)
                .themed(WorkspaceColors.for(model.settings.theme).navigationPalette)
            if !sidebarHidden {
                HelperSidebar(model: model).frame(width: 236)
                    .themed(ChatAppearance.palette(theme: model.settings.theme, sidebar: true))
                    .workspaceLane(color: WorkspaceColors.for(model.settings.theme).panel)
                    .transition(reduceMotion ? .opacity : .move(edge: .leading).combined(with: .opacity))
            }
            if chat {
                ChatWorkspaceLayout(model: model) { topBar }
            } else {
                VStack(spacing: 0) {
                    topBar
                    pageContent.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                }
                .workspaceLane(color: palette.surfaceSolid)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding(8).padding(.top, 30)
        .background(WorkspaceColors.for(model.settings.theme).frame.color.ignoresSafeArea())
        .background { if !snapshot { WindowDragArea() } }
        .background(DesktopWindowAppearance(palette: palette))
        .animation(Motion.workspace(reduceMotion), value: sidebarHidden)
        .ignoresSafeArea(edges: .top)
        // ADR-096: every change of page or of what is open is a step Back returns to.
        .onChange(of: model.location, initial: true) { model.recordLocation() }
        .alert("Discard changes?", isPresented: Binding(get: { model.asksDiscard }, set: { if !$0 { model.keepEditing() } })) {
            Button("Keep editing", role: .cancel) { model.keepEditing() }
            Button("Discard", role: .destructive) { model.discardEdits() }
        } message: {
            Text("What you typed here is not saved.")
        }
        .sheet(item: Binding(get: { model.projectSettingsProject }, set: { model.projectSettingsProject = $0 })) { requested in
            ProjectSettingsSheet(model: model, initial: requested).themed(palette)
        }
        .sheet(isPresented: Binding(get: { model.showsProjectSources }, set: { model.showsProjectSources = $0 })) {
            ProjectSourceSheet(model: model).themed(palette)
        }
        .themed(palette)
        .environment(\.desktopDesign, true)
        .appFont(.system(size: 13))
        .environment(\.appTextSize, model.settings.textSize)
    }

    private var topBar: some View {
        let page = Self.page(model)
        let ownBack = model.windowPage == .agents && (model.helpers.isCreatingAgent || model.helpers.openJobId != nil
            || (!model.helpers.showsBoard && model.helpers.selectedHelper != nil && model.helpers.isSoulOpen))
        let settingsBack: (() -> Void)? = model.windowPage == .settings && model.settingsPage != nil
            ? { withAnimation(Motion.workspace(reduceMotion)) { model.settingsPage = nil } } : nil
        return WindowTopBar(title: page.title, symbol: page.symbol, compact: true,
            context: model.windowPage == .chat ? model.chats?.currentProject?.name : model.windowPage == .settings ? "Preferences" : "Workspace",
            showSidebar: model.settings.sidebarHidden && (model.windowPage == .chat || model.windowPage == .settings) ? { model.toggleSidebar() } : nil,
            back: model.windowPage == .dashboard ? nil : settingsBack ?? (model.history.canGoBack && !ownBack ? { model.goBack() } : nil)) {
                if model.windowPage == .chat {
                    Button { model.toggleWorkspace() } label: {
                        Image(systemName: "sidebar.right").frame(width: 30, height: 30)
                            .foregroundStyle(model.workspace.shown ? model.settings.theme.palette.accent.color : model.settings.theme.palette.text2.color)
                    }.buttonStyle(WorkspacePressStyle()).appFont(.system(size: 13))
                        .accessibilityLabel(model.workspace.shown ? "Close workspace" : "Open workspace")
                        .help("Toggle workspace (⌥⌘R)")
                    ConversationControls(model: model)
                }
            }
    }

    @ViewBuilder private var pageContent: some View {
        switch model.windowPage {
        case .dashboard: DashboardPane(model: model)
        case .scheduled: ScheduledPane(model: model)
        case .plugins: PluginsPane(model: model)
        case .brain: BrainPane(model: model)
        case .chat: EmptyView() // ChatWorkspaceLayout keeps the composer mounted through pane resizing.
        case .settings:
            SettingsTab(model: model).frame(maxWidth: .infinity).padding(.top, 8)
        case .agents:
            if model.helpers.isCreatingAgent { NewAgentPane(model: model) }
            else if model.helpers.openJobId != nil { ThreadPane(model: model) }
            else if model.helpers.showsBoard { BoardPane(model: model) }
            else if let helper = model.helpers.selectedHelper {
                if model.helpers.isSoulOpen, let soul = helper.soul {
                    SoulPane(model: model, helper: helper, soul: soul).id("\(helper.id)-\(helper.soulVersion)")
                } else { HelperPane(model: model, helper: helper) }
            } else { Waiting(text: model.helpers.list == nil ? "Waiting for ATOM…" : "No helpers yet") }
        }
    }

}

extension HelpersView {
    /// The open page's name and symbol, for the top bar.
    static func page(_ model: IslandModel) -> (title: String, symbol: String) {
        switch model.windowPage {
        case .dashboard: return ("Dashboard", "chart.bar.xaxis")
        case .chat:
            let chats = model.chats
            return (chats?.chats.first { $0.id == chats?.current }?.title ?? "New chat", "bubble.left.and.text.bubble.right")
        case .scheduled: return ("Scheduled", "clock")
        case .plugins: return ("Plugins", "puzzlepiece.extension")
        case .brain: return ("Second brain", "brain.head.profile")
        case .settings: return (model.settingsPage?.rawValue ?? "Settings", "gearshape")
        case .agents: break
        }
        if model.helpers.isCreatingAgent { return ("New agent", "person.badge.plus") }
        if model.helpers.openJobId != nil { return ("Task", "text.page") }
        if model.helpers.showsBoard {
            let view = model.boardView == .overview || model.boardView == .needsYou ? " · " + model.boardView.title : ""
            return ("Board" + view, "square.grid.2x2")
        }
        if let helper = model.helpers.selectedHelper {
            return (helper.roleTitle.isEmpty ? helper.name : "\(helper.name) · \(helper.roleTitle)", "person.crop.circle")
        }
        return ("ATOM", "sparkles")
    }
}

private struct Waiting: View {
    let text: String
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text(text).appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Left: the helpers

private struct HelperSidebar: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.desktopDesign) private var desktopDesign

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            WindowHeader(model: model)
            if model.windowPage == .settings {
                SettingsSidebar(model: model)
            } else {
                // ADR-098: one search over chats, tasks and reports; its results replace the pages while there are words.
                SidebarSearchField(model: model).padding(.bottom, 6)
                HStack(spacing: 4) {
                    ProjectFilterButton(model: model, expanded: true)
                    NewProjectButton(model: model)
                    Button {
                        model.navigate {
                            if let id = model.sidebarProjectFilter { model.newChat(inProject: id) }
                            else { model.newConversation() }
                            model.windowPage = .chat
                        }
                    } label: {
                        Image(systemName: "square.and.pencil").appFont(.system(size: 13)).foregroundStyle(theme.text2.color)
                            .frame(width: 28, height: 30).contentShape(Rectangle())
                    }.buttonStyle(.plain).help(model.sidebarProjectFilter == nil ? "Start a new chat" : "New chat in the selected project")
                        .accessibilityLabel("New chat")
                        .disabled(model.chats?.projects?.first(where: { $0.id == model.sidebarProjectFilter })?.archived == true)
                }.padding(.bottom, 8)
                if !model.searchQuery.isEmpty { ProjectFilterSummary(model: model) }
                if !model.searchQuery.isEmpty {
                    Scrollable { SidebarSearchResults(model: model) }
                } else {
                    // Destinations live in the rail; this list retains the existing project scope.
                    Scrollable {
                        ChatsList(model: model)
                    }
                        .frame(maxHeight: .infinity)
                }
                if !model.searchQuery.isEmpty { Spacer(minLength: 0) }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, desktopDesign ? 16 : HelpersView.titleBarRoom)
        .padding(.bottom, 10)
        .frame(maxHeight: .infinity, alignment: .top)
        // Darker than the window: the list sits back, the chosen helper comes forward. Void: one black, the hairline
        // between them is enough.
        .background((desktopDesign ? theme.surfaceSolid.color : theme.isFlat ? Color.clear : theme.isDark ? Color.black.opacity(0.2) : theme.fill1.color).ignoresSafeArea())
    }

}

/// A drag of a sidebar page over a row (or over the strip at the end of a group): the page moves there at once, so the
/// rows make room while it is held. Dropping ends the drag.
struct SidebarDrop: DropDelegate {
    /// The row dropped on; nil for the strip at the end of the group.
    let target: SidebarItem?
    let toBottom: Bool
    let dragging: Binding<SidebarItem?>
    let layout: Binding<SidebarLayout>

    func validateDrop(info: DropInfo) -> Bool { dragging.wrappedValue != nil }

    func dropEntered(info: DropInfo) {
        guard let item = dragging.wrappedValue else { return }
        withAnimation(.easeInOut(duration: 0.15)) {
            if let target { layout.wrappedValue.move(item, onto: target) } else { layout.wrappedValue.move(item, before: nil, toBottom: toBottom) }
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }

    func performDrop(info: DropInfo) -> Bool {
        dragging.wrappedValue = nil
        return true
    }
}

/// ADR-089: the top of the ATOM window's sidebar: Pal, its character playing ATOM's state, and the state in words.
private struct WindowHeader: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.desktopDesign) private var desktopDesign

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(model.windowPage == .settings ? "Settings" : "Chats")
                    .appFont(.system(size: 22, weight: .medium, design: .serif)).foregroundStyle(theme.text.color)
                HStack(spacing: 5) {
                    Circle().fill(statusColor).frame(width: 5, height: 5)
                    Text(model.status.title).appFont(.system(size: 11)).foregroundStyle(theme.text2.color).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            SidebarToggleButton(hidden: false) { model.toggleSidebar() }
        }
        .padding(.horizontal, 4).padding(.bottom, 12)
    }

    private var statusColor: Color {
        switch model.status.kind {
        case .ready: theme.success.color
        case .problem: theme.problem.color
        case .notice: theme.attention.color
        case .listening: theme.live.color
        default: theme.accent.color
        }
    }

}

/// ADR-089: a page of the ATOM window in the sidebar: Chat, Settings.
struct SidebarRow: View {
    let symbol: String
    let title: String
    let detail: String?
    let selected: Bool
    @Environment(\.theme) private var theme
    @Environment(\.desktopDesign) private var desktopDesign
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: symbol).appFont(.system(size: 12, weight: .medium)).foregroundStyle(theme.text2.color)
                .frame(width: 26, height: 26)
                .overlay { if theme.isFlat && !desktopDesign { Circle().strokeBorder(theme.border.color, lineWidth: 1) } }
            VStack(alignment: .leading, spacing: 1) {
                Text(title).appFont(.system(size: 13, weight: selected ? .medium : .regular)).foregroundStyle(theme.text.color)
                if let detail, !desktopDesign { Text(detail).appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(1) }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background {
            if desktopDesign {
                RoundedRectangle(cornerRadius: 8).fill(selected ? theme.fill2.color : hovering ? theme.fill1.color : .clear)
            } else if theme.isFlat {
                RoundedRectangle(cornerRadius: theme.radiusControl + 4, style: .continuous).strokeBorder(selected ? theme.border.color : .clear, lineWidth: 1)
            } else {
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(selected ? (theme.isDark ? theme.fill2.color : Color.white.opacity(0.85)) : Color.clear)
            }
        }
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(detail.map { title + ", " + $0 } ?? title)
        .help(detail.map { title + ", " + $0 } ?? title)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

/// A helper's mark: its own character (ADR-089), else its first letter, in a disc. While it works, an arc of
/// Pal's light runs round it (a still ring with Reduce Motion). Custom PNG avatars (ADR-085) were removed (ADR-093).
struct HelperBadge: View {
    let helper: Helper
    let size: CGFloat
    @Environment(\.theme) private var theme

    var body: some View {
        let working = helper.jobs.contains { $0.state == .running }
        Group {
            if let character = PalLibrary.character(for: helper.id) {
                // ADR-089: the worker's own character; it plays "working" while busy.
                if working {
                    TimelineView(.animation(minimumInterval: 1.0 / 20)) { context in
                        PalPortrait(character: character, animation: "working", time: context.date.timeIntervalSinceReferenceDate, size: size * 1.18, glow: theme.usesGlow)
                    }
                } else {
                    PalPortrait(character: character, animation: "idle", time: 0.6, size: size * 1.18, glow: theme.usesGlow)
                }
            } else {
                Text(helper.name.prefix(1).uppercased())
                    .appFont(.system(size: size * 0.42, weight: .semibold, design: .rounded))
                    .foregroundStyle(theme.text.color)
            }
        }
        .frame(width: size, height: size)
        .background(Circle().fill(theme.isFlat ? Color.clear : theme.fill2.color))
        .clipShape(Circle())
        .overlay { if theme.isFlat { Circle().strokeBorder(theme.border.color, lineWidth: 1) } } // Void: a hairline disc
        .overlay { if working { WorkingArc(lineWidth: size >= 36 ? 2.2 : 1.8).padding(-3.5) } }
        .accessibilityHidden(true)
    }
}

/// Pal's light running round a working helper's disc: a 70% arc that fades in from its tail and turns once every
/// 1.6 s. Still with Reduce Motion (a full, quiet ring) and in snapshots (the arc).
private struct WorkingArc: View {
    let lineWidth: CGFloat
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let light = theme.live.color
        if reduceMotion {
            Circle().stroke(light.opacity(0.75), lineWidth: lineWidth)
                .shadow(color: light.opacity(theme.usesGlow ? 0.4 : 0), radius: 4)
        } else if snapshot {
            arc(light)
        } else {
            TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
                let turn = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6) / 1.6
                arc(light).rotationEffect(.degrees(turn * 360))
            }
        }
    }

    private func arc(_ light: Color) -> some View {
        Circle()
            .trim(from: 0, to: 0.7)
            .stroke(AngularGradient(colors: [light.opacity(0), light], center: .center, startAngle: .degrees(0), endAngle: .degrees(252)),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
            .rotationEffect(.degrees(-90))
            .shadow(color: light.opacity(theme.usesGlow ? 0.5 : 0), radius: 4)
    }
}

// MARK: - Right: one helper

private struct HelperPane: View {
    let model: IslandModel
    let helper: Helper
    @Environment(\.theme) private var theme

    var body: some View {
        Scrollable {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 14) {
                    HelperBadge(helper: helper, size: 42)
                    VStack(alignment: .leading, spacing: 2) {
                        NameTitle(model: model, helper: helper).id(helper.id) // a rename in progress belongs to one agent
                        Text(Self.subtitle(helper)).appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    if helper.soul != nil {
                        QuietButton(title: "Soul", symbol: "sparkles") { model.navigate { model.helpers.openSoul() } }
                            .help("Who \(helper.name) is and how it works")
                    }
                    if helper.custom { RemoveAgentButton(model: model, helper: helper) }
                }
                if helper.proposals.contains(where: { $0.state == "pending" || $0.state == "accepted" }) {
                    ProposalsSection(model: model, proposals: helper.proposals, soul: helper.soul)
                }
                TestCasesList(model: model, kind: "soul", target: helper.id) // ADR-098 item 8
                if helper.available {
                    HStack(spacing: 8) {
                        AppPicker(model: model, helper: helper)
                        ModelPicker(model: model, helper: helper, models: model.helpers.list?.models ?? [])
                    }
                    CodexWorkerModelPicker(model: model, helper: helper)
                    SkillsPicker(model: model, helper: helper, skills: model.helpers.list?.skills ?? [])
                    PlanFirstRow(model: model, helper: helper)
                    if helper.takesTasks, helper.kit != "think" { BrowserRow(model: model, helper: helper) } // ADR-098
                    if helper.worksInFolders { FilesNote(helper: helper) }
                    VStack(alignment: .leading, spacing: 8) {
                        TaskField(model: model, helper: helper)
                        HStack(spacing: 8) {
                            WaitsForMenu(model: model)
                        }
                    }
                    if let problem = model.helpers.problem { ProblemLine(text: problem) }
                    JobList(model: model, helper: helper)
                    if !helper.routines.isEmpty { RoutinesSection(model: model, routines: helper.routines) }
                } else {
                    Text(helper.role == "improver"
                        ? "\(helper.name) reviews the tasks you rate as not good and suggests one change to that worker's soul. You accept or reject it on the worker's page. Its reviews are on the board."
                        : "\(helper.name) is not ready for jobs yet. You can shape its soul now.")
                        .appFont(.system(size: 12.5)).foregroundStyle(theme.text2.color)
                }
            }
            .padding(.horizontal, Spacing.panel)
            .padding(.top, 28)
            .padding(.bottom, Spacing.panel)
        }
    }

    /// Under the name: the role, then the job counts ("Researcher · 1 running, 1 done").
    static func subtitle(_ helper: Helper) -> String {
        let summary = helper.role == "improver" ? "Reviews the tasks you rate as not good" : helper.available ? Self.summary(helper) : "Coming soon"
        return helper.roleTitle.isEmpty ? summary : "\(helper.roleTitle) · \(summary)"
    }

    /// How many jobs are running, waiting and done ("1 running, 1 waiting, 1 done"). The step itself is in the sidebar
    /// and on the job.
    static func summary(_ helper: Helper) -> String {
        let counts: [(JobState, String)] = [(.running, "running"), (.queued, "waiting"), (.done, "done"), (.failed, "failed")]
        let parts = counts.compactMap { state, word in
            let n = helper.jobs.filter { $0.state == state }.count
            return n > 0 ? "\(n) \(word)" : nil
        }
        return parts.isEmpty ? "Ready for a task" : parts.joined(separator: ", ")
    }
}

/// A compact pill for a pop-up menu: a quiet label, the value and an up-down chevron, as in the mock.
struct PillMenuLabel: View {
    let label: String
    let value: String
    var dimmed = false
    var identifier = true
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 6) {
            Text(label).foregroundStyle(theme.text3.color)
            // The app or model is an identifier: SF Mono in Void (a sentence such as "Chosen by Laya" stays sans).
            Text(value).fontWeight(.medium).foregroundStyle(dimmed ? theme.text2.color : theme.text.color)
                .appFont(identifier ? theme.appIdentifierFont(.system(size: 11.5), size: 11) : .system(size: 11.5))
            Image(systemName: "chevron.up.chevron.down").appFont(.system(size: 8, weight: .bold)).foregroundStyle(theme.text3.color)
        }
        .appFont(.system(size: 11.5))
        .lineLimit(1)
        .padding(.horizontal, 12)
        .frame(height: 28)
        .background {
            if theme.isGhost {
                ControlFill(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous), fill: Color.clear)
            } else {
                Capsule().fill(theme.fill2.color)
            }
        }
        .contentShape(Capsule())
    }
}

private struct AppPicker: View {
    let model: IslandModel
    let helper: Helper

    var body: some View {
        Menu {
            Button { model.sendHelpers(model.helpers.setApp(nil)) } label: {
                if helper.app == nil { Label("No app", systemImage: "checkmark") } else { Text("No app") }
            }
            Divider()
            ForEach(model.helpers.list?.apps ?? [], id: \.self) { app in
                Button { model.sendHelpers(model.helpers.setApp(app)) } label: {
                    if app == helper.app { Label(app, systemImage: "checkmark") } else { Text(app) }
                }
            }
        } label: {
            PillMenuLabel(label: "Opens in", value: helper.app ?? "No app", dimmed: helper.app == nil, identifier: helper.app != nil)
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .help("Where \(helper.name) opens what it finds")
        .accessibilityLabel("\(helper.name)'s app")
    }
}

/// "Chosen by Laya" or a pinned model (ADR-083). Without the Claude plan the pill says so and is disabled.
private struct ModelPicker: View {
    let model: IslandModel
    let helper: Helper
    let models: [HelperModel]

    var body: some View {
        let pinned = models.first { $0.id == helper.pinnedModel }
        let value = models.isEmpty ? "Needs the Claude plan" : (pinned?.name ?? helper.pinnedModel ?? "Chosen by Laya")
        Menu {
            Button { model.sendHelpers(model.helpers.pinModel(nil)) } label: {
                if helper.pinnedModel == nil { Label("Chosen by Laya", systemImage: "checkmark") } else { Text("Chosen by Laya") }
            }
            Divider()
            ForEach(models) { option in
                Button { model.sendHelpers(model.helpers.pinModel(option.id)) } label: {
                    if option.id == helper.pinnedModel { Label(option.name, systemImage: "checkmark") } else { Text(option.name) }
                }
            }
        } label: {
            PillMenuLabel(label: "Claude", value: value, dimmed: models.isEmpty, identifier: helper.pinnedModel != nil && !models.isEmpty)
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .disabled(models.isEmpty)
        .help("The model used when \(helper.name)'s task runs on Claude")
        .accessibilityLabel("\(helper.name)'s Claude model")
    }
}

/// A Codex setting independent of the Claude pin and the foreground chat's provider/model.
private struct CodexWorkerModelPicker: View {
    let model: IslandModel
    let helper: Helper

    private var offered: [ModelOption] {
        guard let provider = model.modelInfo?.providers.first(where: { $0.id == "codex" }), provider.available else { return [] }
        return provider.models
    }

    var body: some View {
        let models = offered
        let pin = helper.codexPinnedModel
        let value = pin.map { id in models.first(where: { $0.id == id })?.name ?? id } ?? (models.isEmpty ? "Codex unavailable" : "Use chat's model")
        Menu {
            Button {
                model.sendHelpers(model.helpers.pinCodexModel(nil, for: helper.id, offered: models))
            } label: {
                if pin == nil { Label("Use chat's Codex model", systemImage: "checkmark") }
                else { Text("Use chat's Codex model") }
            }
            .disabled(pin == nil)
            if pin != nil && !models.contains(where: { $0.id == pin }) {
                Text("Saved model unavailable. Clear this pin or choose another model.")
            }
            Divider()
            ForEach(models) { option in
                Button {
                    model.sendHelpers(model.helpers.pinCodexModel(option.id, for: helper.id, offered: models))
                } label: {
                    if option.id == pin { Label(option.name, systemImage: "checkmark") }
                    else { Text(option.name) }
                }
            }
        } label: {
            PillMenuLabel(label: "Codex", value: value, dimmed: models.isEmpty, identifier: pin != nil)
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .disabled(models.isEmpty && pin == nil)
        .help("Applies to new Codex tasks for \(helper.name). It does not switch a chat's provider or change running tasks.")
        .accessibilityLabel("\(helper.name)'s Codex model")
    }
}

/// "Give Sid a task": a capsule with an arrow button, concentric with it (40 tall, the 28 pt button 6 from the
/// edge). Return or the arrow adds it.
private struct TaskField: View {
    let model: IslandModel
    let helper: Helper
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let draft = State(initialValue: "")
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let ready = !draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        HStack(spacing: 8) {
            if snapshot { // ImageRenderer cannot draw a text field
                Text(placeholder).appFont(.system(size: 12.5)).foregroundStyle(theme.text3.color)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                TextField(placeholder, text: draft.projectedValue)
                    .textFieldStyle(.plain)
                    .appFont(.system(size: 12.5))
                    .foregroundStyle(theme.text.color)
                    .onSubmit(add)
                    .accessibilityLabel("Task for \(helper.name)")
            }
            Button(action: add) {
                Image(systemName: "arrow.up")
                    .appFont(.system(size: 11, weight: .bold))
                    .foregroundStyle(ready ? (theme.isGhost ? theme.text.color : theme.onAccent.color) : theme.text3.color)
                    .frame(width: 28, height: 28)
                    .background(ControlFill(Circle(), fill: ready ? AnyShapeStyle(theme.accentFill) : AnyShapeStyle(theme.fill2.color), hovering: ready))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(!ready)
            .help("Add")
            .accessibilityLabel("Add")
        }
        .padding(.leading, 16)
        .padding(.trailing, 6)
        .frame(height: 40)
        .background {
            if theme.isFlat {
                // Void: the composer's shape (16), a 1 px hairline, no fill.
                RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).strokeBorder(theme.border.color, lineWidth: 1)
            } else {
                Capsule().fill(theme.fill1.color)
            }
        }
        .overlay { if !theme.isFlat { Capsule().strokeBorder(theme.separator.color, lineWidth: 0.6) } }
    }

    private var placeholder: String { "Give \(helper.name) a task" }

    private func add() {
        guard let command = model.helpers.addJob(draft.wrappedValue) else { return }
        model.send(command)
        draft.wrappedValue = ""
    }
}

/// Every job in one well, newest first; a hairline between rows.
private struct JobList: View {
    let model: IslandModel
    let helper: Helper
    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            if helper.jobs.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text("No jobs yet").appFont(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color)
                    Text("Give \(helper.name) a task above.").appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
            ForEach(Array(helper.jobs.enumerated()), id: \.element.id) { index, job in
                if index > 0 { Rectangle().fill(theme.separator.color).frame(height: theme.isFlat ? 1 : 0.5) }
                JobRow(model: model, job: job)
            }
        }
        .background(shape.fill(theme.fill1.color))
        .overlay(shape.strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
    }
}

private struct JobRow: View {
    let model: IslandModel
    let job: HelperJob
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            JobDot(job: job).padding(.top, 5)
            VStack(alignment: .leading, spacing: 4) {
                Button { model.navigate { model.sendHelpers(model.helpers.openThread(job.id)) } } label: {
                    Text(job.title ?? job.task)
                        .appFont(.system(size: 13, weight: job.hasReport ? .semibold : .medium))
                        .foregroundStyle(theme.text.color)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
                .help("Open the task")
                if job.isWaiting, let list = model.helpers.list { WaitingLine(job: job, list: list) }
                if let held = job.held { HeldLine(reason: held) }
                if let summary = job.summary {
                    Text(summary).appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color)
                }
                if job.state == .running, let step = job.step {
                    HStack(spacing: 8) {
                        if let progress = job.progress { ProgressLine(fraction: progress) }
                        Text(step).appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.statusDots ? theme.text2.color : theme.live.color).lineLimit(1)
                    }
                }
                if job.state == .failed, let error = job.error { ProblemLine(text: error, dot: false) }
                // The model and Laya's reason are identifiers: SF Mono in Void.
                if let meta = meta { Text(meta).appFont(theme.appIdentifierFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(2) }
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                if job.hasReport {
                    ReadReportButton { model.navigate { model.sendHelpers(model.helpers.openThread(job.id)) } }
                }
                if job.state.isActive {
                    QuietButton(title: "Stop") { model.sendHelpers(model.helpers.stopJob(job.id)) }
                }
                IconButton(symbol: "trash", label: "Delete", diameter: ControlMetrics.buttonHeight) { model.sendHelpers(model.helpers.deleteJob(job.id)) }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
        .help(help)
    }

    /// The quiet line: how a done job ended early, the model and Laya's reason, or when it was added.
    private var meta: String? {
        var parts: [String] = []
        if job.state == .done && job.partial { parts.append("Partial report") }
        if job.state == .stopped { parts.append("Stopped") }
        if let line = model.helpers.list?.modelLine(job) { parts.append(line) } else if let time = Self.time(job) { parts.append(time) }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    /// On hover: the task as given and when it ran.
    private var help: String {
        [job.hasReport ? job.task : nil, Self.time(job)].compactMap { $0 }.joined(separator: "\n")
    }

    /// "Added 5 min. ago", and when it ended.
    private static func time(_ job: HelperJob) -> String? {
        let style = Date.RelativeFormatStyle(presentation: .named, unitsStyle: .abbreviated)
        guard let created = job.createdAt else { return nil }
        let added = "Added \(created.formatted(style))"
        guard let ended = job.endedAt, !job.state.isActive else { return added }
        return "\(added), ended \(ended.formatted(style))"
    }
}

/// A job's state as a dot: lit and glowing while running, a ring while queued, solid grey when done, coral when it
/// failed, a faint grey when stopped. The state's word is its VoiceOver label.
struct JobDot: View {
    let job: HelperJob
    @Environment(\.theme) private var theme

    var body: some View {
        Group {
            switch job.state {
            case .running:
                Circle().fill(theme.live.color).shadow(color: theme.live.color.opacity(theme.usesGlow ? 0.9 : 0), radius: 4)
            case .queued:
                Circle().strokeBorder(theme.text3.color, lineWidth: 1.2)
            case .done:
                Circle().fill(theme.statusDots ? theme.success.color : theme.text2.color) // Void: done is green
            case .failed:
                Circle().fill(theme.problem.color).shadow(color: theme.problem.color.opacity(theme.usesGlow ? 0.6 : 0), radius: 3)
            case .stopped:
                Circle().fill(theme.text3.color.opacity(0.6))
            }
        }
        .frame(width: 7, height: 7)
        .accessibilityLabel(job.badge)
    }
}

/// A thin line of Pal's light under a running job, as far as its step's "n of m".
struct ProgressLine: View {
    let fraction: Double
    @Environment(\.theme) private var theme

    var body: some View {
        ZStack(alignment: .leading) {
            Capsule().fill(theme.fill3.color)
            Capsule().fill(theme.live.color)
                .frame(width: max(3, 120 * min(1, max(0, fraction))))
                .shadow(color: theme.live.color.opacity(theme.usesGlow ? 0.7 : 0), radius: 4)
        }
        .frame(width: 120, height: 3)
        .accessibilityHidden(true)
    }
}

/// "Read report": the window's one lit button, outlined in Pal's light.
struct ReadReportButton: View {
    let action: () -> Void
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if theme.isGhost { ghost } else { lit }
    }

    /// Void (ADR-086): a ghost button with a violet hairline and label, brightening on hover.
    private var ghost: some View {
        let violet = theme.idColor(theme.accent)
        return Button(action: action) {
            Text("Read report")
                .appFont(.system(size: 11.5, weight: .medium))
                .foregroundStyle(violet)
                .padding(.horizontal, 12)
                .frame(height: ControlMetrics.buttonHeight)
                .background(ControlFill(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous), fill: Color.clear,
                                        hovering: hovering.wrappedValue, tint: violet))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
        .animation(Motion.plain, value: hovering.wrappedValue)
    }

    private var lit: some View {
        Button(action: action) {
            Text("Read report")
                .appFont(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(theme.accent.color)
                .padding(.horizontal, 13)
                .frame(height: ControlMetrics.buttonHeight)
                .background(Capsule().fill(theme.accent.color.opacity(hovering.wrappedValue ? 0.12 : 0)))
                .overlay(Capsule().strokeBorder(theme.accent.color.opacity(0.45), lineWidth: 0.8))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
        .animation(Motion.snap(reduceMotion), value: hovering.wrappedValue)
    }
}

/// A quiet capsule button: Stop, Jobs.
struct QuietButton: View {
    let title: String
    var symbol: String? = nil
    let action: () -> Void
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let symbol { Image(systemName: symbol).appFont(.system(size: 10, weight: .semibold)) }
                Text(title).appFont(.system(size: 11.5, weight: .medium))
            }
            .foregroundStyle(hovering.wrappedValue ? theme.text.color : theme.text2.color)
            .padding(.horizontal, 12)
            .frame(height: ControlMetrics.buttonHeight)
            .background {
                if theme.isGhost {
                    ControlFill(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous), fill: Color.clear, hovering: hovering.wrappedValue)
                } else {
                    Capsule().fill(hovering.wrappedValue ? theme.fill3.color : theme.fill2.color)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
        .animation(Motion.hover(reduceMotion, ghost: theme.isGhost), value: hovering.wrappedValue)
    }
}

struct ProblemLine: View {
    let text: String
    /// Void: lead with a red dot; off where the row's own dot already says it failed.
    var dot = true
    @Environment(\.theme) private var theme

    var body: some View {
        if theme.statusDots {
            // Void (ADR-086): the colour is only the dot; the words stay quiet.
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                if dot { StatusDot(color: theme.problem.color, size: 6) }
                Text(text).appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color)
            }
            .fixedSize(horizontal: false, vertical: true)
        } else {
            Label(text, systemImage: "exclamationmark.triangle.fill")
                .appFont(.system(size: 11))
                .foregroundStyle(theme.problem.color)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}


/// ADR-091: a worker's name, with a pencil to rename it (a new soul version; the name is checked like any soul's).
private struct NameTitle: View {
    let model: IslandModel
    let helper: Helper
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let editing = State(initialValue: false)
    private let draft = State(initialValue: "")
    @Environment(\.theme) private var theme

    init(model: IslandModel, helper: Helper) {
        self.model = model
        self.helper = helper
    }

    var body: some View {
        let changed = editing.wrappedValue && draft.wrappedValue.trimmingCharacters(in: .whitespaces) != helper.name
        HStack(spacing: 6) {
            if editing.wrappedValue {
                TextField("Name", text: draft.projectedValue)
                    .textFieldStyle(.plain)
                    .appFont(.system(size: 18, weight: .semibold, design: theme.titleDesign))
                    .frame(maxWidth: 220)
                    .onSubmit(save)
                    .onExitCommand { editing.wrappedValue = false }
                QuietButton(title: "Cancel") { editing.wrappedValue = false }
                SaveButton(enabled: changed, label: "Save name", action: save)
            } else {
                Text(helper.name).appFont(.system(size: 18, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                if model.savedField == "agent-name" && model.helpers.problem == nil { SavedMark() }
                if helper.soul != nil {
                    Button {
                        draft.wrappedValue = helper.name
                        editing.wrappedValue = true
                    } label: {
                        Image(systemName: "pencil").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                    }
                    .buttonStyle(.plain)
                    .help("Rename \(helper.name)")
                    .accessibilityLabel("Rename \(helper.name)")
                }
            }
        }
        .tracksEdits(model, "agent-name", changed)
    }

    private func save() {
        let name = draft.wrappedValue.trimmingCharacters(in: .whitespaces)
        editing.wrappedValue = false
        guard name != helper.name, let command = model.helpers.rename(name) else { return }
        model.send(command)
        model.showSaved("agent-name")
    }
}

/// ADR-091: Keshab's chats in the sidebar, newest first: the one ATOM is in is marked; a click continues one (voice and
/// typing go to it), New chat starts fresh, and a chat's menu renames or deletes it. ADR-107: chats of a project are under
/// their project (see ProjectsSection), not here.
private struct ChatsList: View {
    let model: IslandModel
    @State private var showArchived = false
    @State private var showAll = false
    @Environment(\.theme) private var theme

    var body: some View {
        let list = model.chats
        Text("Chats").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
            .accessibilityAddTraits(.isHeader).padding(.horizontal, 10).padding(.top, 8)
        let active = ProjectSidebarScope.activeChats(list?.chats ?? [], projects: list?.projects ?? [], selected: model.sidebarProjectFilter)
        if !active.isEmpty {
            ForEach(showAll ? active : Array(active.prefix(40))) { chat in
                SidebarChatRow(model: model, chat: chat, current: chat.id == list?.current)
            }
            if !showAll && active.count > 40 {
                Button("Show all loaded chats") { showAll = true }.appFont(.system(size: 11)).buttonStyle(.borderless)
            }
        } else if list == nil {
            LoadingStateView(text: "Loading chats…", retry: { model.send(.chatsList) }).padding(.horizontal, 10)
        } else {
            Text("No active chats. Start one with New chat above.").appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color)
                .padding(.horizontal, 10).padding(.vertical, 4)
        }
        ChatControlFeedback(model: model).padding(.horizontal, 10).padding(.vertical, 4)
        if let list {
            let archived = list.chats.filter { $0.archived && ProjectSidebarScope.includes($0, selected: model.sidebarProjectFilter) }.sorted { ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }
            if !archived.isEmpty {
                DisclosureGroup("Archived chats (\(archived.count))", isExpanded: $showArchived) {
                    ForEach(archived) { chat in
                        SidebarChatRow(model: model, chat: chat, current: chat.id == list.current)
                    }
                }.appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color).padding(.horizontal, 10)
            }
        }
    }
}
