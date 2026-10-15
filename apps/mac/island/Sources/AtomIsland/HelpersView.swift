import AppKit
import SwiftUI
import AtomIslandCore

/// The ATOM window's content (ADR-081), in Lantern (ADR-084): a darker sidebar of helpers as discs; the chosen
/// helper with its "Opens in" and "Model" pills, a task field and one list of jobs, or the report being read.
/// The logic lives in `HelpersState`; these views only draw it.
struct HelpersView: View {
    let model: IslandModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Room at the top of the sidebar for the window's buttons (the title bar is transparent over the content).
    static let titleBarRoom: CGFloat = 40

    var body: some View {
        let palette = model.settings.theme.palette
        HStack(spacing: 0) {
            HelperSidebar(model: model).frame(width: 224)
            Rectangle().fill(palette.separator.color).frame(width: palette.isFlat ? 1 : 0.5)
            VStack(spacing: 0) {
            // ADR-091: a top bar over every page, with the page's name; it moves the window.
            let page = Self.page(model)
            // These pages bring their own back button ("‹ Settings", "‹ Board", "Cancel"); two arrows said the same thing twice.
            let ownBack = model.windowPage == .agents && (model.helpers.isCreatingAgent || model.helpers.openJobId != nil
                || (!model.helpers.showsBoard && model.helpers.selectedHelper != nil && model.helpers.isSoulOpen))
            // A Settings page (Model, Voice...) goes back to the Settings list with this arrow, the one in the top bar.
            let settingsBack: (() -> Void)? = model.windowPage == .settings && model.settingsPage != nil
                ? { withAnimation(Motion.settle(reduceMotion)) { model.settingsPage = nil } } : nil
            WindowTopBar(title: page.title, symbol: page.symbol, back: settingsBack ?? (model.history.canGoBack && !ownBack ? { model.goBack() } : nil)) {
                if model.windowPage == .chat {
                    // New chat was only a small icon far down the sidebar; it belongs where the chat is.
                    PillButton(title: "New chat", symbol: "square.and.pencil") {
                        model.navigate {
                            model.newConversation()
                            model.windowPage = .chat
                        }
                    }
                    if let project = model.chats?.currentProject { ProjectChip(project: project) } // ADR-107
                    ChatSoundsMenu(model: model)
                    DeleteChatButton(model: model)
                }
            }
            Group {
                if model.windowPage == .dashboard {
                    DashboardPane(model: model)
                } else if model.windowPage == .inbox {
                    NeedsYouPane(model: model)
                } else if model.windowPage == .issues {
                    IssuesPane(model: model)
                } else if model.windowPage == .scheduled {
                    ScheduledPane(model: model)
                } else if model.windowPage == .plugins {
                    PluginsPane(model: model)
                } else if model.windowPage == .brain {
                    BrainPane(model: model)
                } else if model.windowPage == .chat {
                    // ADR-089: the conversation, as in the panel, a readable width in the middle of the window.
                    ConversationTab(model: model)
                        .frame(maxWidth: 680)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 8)
                } else if model.windowPage == .settings {
                    SettingsTab(model: model)
                        .frame(maxWidth: 640)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 8)
                } else if model.helpers.isCreatingAgent {
                    NewAgentPane(model: model)
                } else if model.helpers.openJobId != nil {
                    ThreadPane(model: model)
                } else if model.helpers.showsBoard {
                    BoardPane(model: model)
                } else if let helper = model.helpers.selectedHelper {
                    if model.helpers.isSoulOpen, let soul = helper.soul {
                        // A new version (a save or a restore) starts the form again from what is now current.
                        SoulPane(model: model, helper: helper, soul: soul).id("\(helper.id)-\(helper.soulVersion)")
                    } else {
                        HelperPane(model: model, helper: helper)
                    }
                } else {
                    Waiting(text: model.helpers.list == nil ? "Waiting for ATOM…" : "No helpers yet")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .background(Rectangle().fill(palette.surfaceFill(solid: true)).ignoresSafeArea())
        .ignoresSafeArea(edges: .top)
        // ADR-096: every change of page or of what is open is a step Back returns to.
        .onChange(of: model.location, initial: true) { model.recordLocation() }
        .alert("Discard changes?", isPresented: Binding(get: { model.asksDiscard }, set: { if !$0 { model.keepEditing() } })) {
            Button("Keep editing", role: .cancel) { model.keepEditing() }
            Button("Discard", role: .destructive) { model.discardEdits() }
        } message: {
            Text("What you typed here is not saved.")
        }
        .themed(palette)
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
        case .inbox: return ("Needs you", "tray")
        case .issues: return ("Issues", "exclamationmark.triangle")
        case .scheduled: return ("Scheduled", "clock")
        case .plugins: return ("Plugins", "puzzlepiece.extension")
        case .brain: return ("Second brain", "brain.head.profile")
        case .settings: return ("Settings", "gearshape")
        case .agents: break
        }
        if model.helpers.isCreatingAgent { return ("New agent", "person.badge.plus") }
        if model.helpers.openJobId != nil { return ("Task", "text.page") }
        if model.helpers.showsBoard { return (model.boardView == .overview ? "Board · Overview" : "Board", "square.grid.2x2") }
        if let helper = model.helpers.selectedHelper {
            return (helper.roleTitle.isEmpty ? helper.name : "\(helper.name) · \(helper.roleTitle)", "person.crop.circle")
        }
        return ("ATOM", "sparkles")
    }
}

/// Deletes the chat that is open, after asking. Only a saved chat can be deleted.
private struct DeleteChatButton: View {
    let model: IslandModel
    @State private var confirming = false

    var body: some View {
        if let list = model.chats, let chat = list.chats.first(where: { $0.id == list.current }) {
            IconButton(symbol: "trash", label: "Delete this chat") { confirming = true }
                .confirmationDialog("Delete “\(chat.title)”?", isPresented: $confirming, titleVisibility: .visible) {
                    Button("Delete chat", role: .destructive) { model.send(.chatDelete(id: chat.id)) }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("The chat and its messages are removed for good.")
                }
        }
    }
}

private struct Waiting: View {
    let text: String
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text(text).font(.system(size: 12)).foregroundStyle(theme.text2.color)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Left: the helpers

private struct HelperSidebar: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
          // ADR-088: the team can grow, so the list scrolls; the switch stays at the bottom.
          Scrollable {
           VStack(alignment: .leading, spacing: 4) {
            WindowHeader(model: model)
            // ADR-098: one search over chats, tasks and reports; its results replace the pages while there are words.
            SidebarSearchField(model: model).padding(.bottom, 4)
            if !model.searchQuery.isEmpty {
                SidebarSearchResults(model: model)
            } else {
            Button { model.navigate { model.windowPage = .dashboard } } label: {
                let today = model.helpers.list?.usage?.today.total ?? 0
                SidebarRow(symbol: "chart.bar.xaxis", title: "Dashboard", detail: today == 0 ? nil : "\(TokenTotals.short(today)) tokens today", selected: model.windowPage == .dashboard)
            }
            .buttonStyle(.plain)
            // ADR-091: no Chat row: the chats below open the chat (ATOM's state is under its name above).
            Button { model.navigate { model.windowPage = .inbox } } label: {
                let waiting = (model.helpers.list.map { NeedsYouItem.all(in: $0).count } ?? 0) + (model.approval.pending == nil ? 0 : 1)
                SidebarRow(symbol: "tray", title: "Needs you", detail: waiting == 0 ? "Nothing waits" : "\(waiting) waiting", selected: model.windowPage == .inbox)
                    .overlay(alignment: .trailing) { if waiting > 0 { StatusDot(color: theme.attention.color, size: 6).padding(.trailing, 14) } }
            }
            .buttonStyle(.plain)
            Button { model.navigate { model.windowPage = .issues } } label: {
                let issues = model.helpers.list.map { TeamIssues.all(in: $0).count } ?? 0
                SidebarRow(symbol: "exclamationmark.triangle", title: "Issues", detail: issues == 0 ? "None" : "\(issues) failed", selected: model.windowPage == .issues)
                    .overlay(alignment: .trailing) { if issues > 0 { StatusDot(color: theme.problem.color, size: 6).padding(.trailing, 14) } }
            }
            .buttonStyle(.plain)
            Button { model.navigate { model.windowPage = .agents; model.helpers.selectBoard() } } label: {
                BoardRow(model: model, selected: model.windowPage == .agents && model.helpers.showsBoard)
            }
            .buttonStyle(.plain)
            // ADR-094: everything that runs by itself, below Issues and Board.
            Button { model.navigate { model.windowPage = .scheduled } } label: {
                SidebarRow(symbol: "clock", title: "Scheduled", detail: model.helpers.list.map(ScheduledRow.detail) ?? nil, selected: model.windowPage == .scheduled)
            }
            .buttonStyle(.plain)
            // The second brain: notes that link to each other, as a graph.
            Button { model.navigate { model.windowPage = .brain } } label: {
                let notes = model.brain.graph?.noteCount
                SidebarRow(symbol: "brain.head.profile", title: "Second brain", detail: notes.map { $0 == 0 ? "Empty" : "\($0) notes" }, selected: model.windowPage == .brain)
            }
            .buttonStyle(.plain)
            // ADR-107: projects (a folder and its chats) above the plain chats.
            ProjectsSection(model: model)
            // ADR-091: Keshab's chats where the team was (the team is on the Board and each worker's page).
            ChatsList(model: model)
            }
           }
          }
            Spacer(minLength: 0)
            Button { model.navigate { model.windowPage = .plugins } } label: {
                let on = model.helpers.list?.mcp.filter(\.enabled).count ?? 0
                SidebarRow(symbol: "puzzlepiece.extension", title: "Plugins", detail: on == 0 ? nil : "\(on) on", selected: model.windowPage == .plugins)
            }
            .buttonStyle(.plain)
            Button { model.navigate { model.windowPage = .settings } } label: {
                SidebarRow(symbol: "gearshape", title: "Settings", detail: nil, selected: model.windowPage == .settings)
            }
            .buttonStyle(.plain)
            if let list = model.helpers.list, model.windowPage == .agents { AllowLargeSwitch(model: model, list: list) }
        }
        .padding(.horizontal, 14)
        .padding(.top, HelpersView.titleBarRoom)
        .padding(.bottom, 18)
        .frame(maxHeight: .infinity, alignment: .top)
        // Darker than the window: the list sits back, the chosen helper comes forward. Void: one black, the hairline
        // between them is enough.
        .background((theme.isFlat ? Color.clear : theme.isDark ? Color.black.opacity(0.2) : theme.fill1.color).ignoresSafeArea())
    }
}

/// ADR-089: the top of the ATOM window's sidebar: Pal, its character playing ATOM's state, and the state in words.
private struct WindowHeader: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 10) {
            if let pal = PalLibrary.pal {
                TimelineView(.animation(minimumInterval: 1.0 / 24)) { context in
                    PalPortrait(character: pal, animation: PalAnimation.name(mood: PetBrain.mood(for: model.status.kind) ?? .resting, reaction: nil),
                                time: context.date.timeIntervalSinceReferenceDate, size: 44, glow: theme.usesGlow)
                }
            }
            VStack(alignment: .leading, spacing: 1) {
                Text("ATOM").font(.system(size: 14, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                Text(model.status.title).font(.system(size: 11)).foregroundStyle(theme.text2.color).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6)
        .padding(.bottom, 8)
    }
}

/// ADR-089: a page of the ATOM window in the sidebar: Chat, Settings.
struct SidebarRow: View {
    let symbol: String
    let title: String
    let detail: String?
    let selected: Bool
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: symbol).font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text2.color)
                .frame(width: 26, height: 26)
                .overlay { if theme.isFlat { Circle().strokeBorder(theme.border.color, lineWidth: 1) } }
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.text.color)
                if let detail { Text(detail).font(.system(size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(1) }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background {
            if theme.isFlat {
                RoundedRectangle(cornerRadius: theme.radiusControl + 4, style: .continuous).strokeBorder(selected ? theme.border.color : .clear, lineWidth: 1)
            } else {
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(selected ? (theme.isDark ? theme.fill2.color : Color.white.opacity(0.85)) : Color.clear)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

/// "Allow the large model for helpers" (ADR-083): window-wide, so it sits at the bottom of the sidebar.
private struct AllowLargeSwitch: View {
    let model: IslandModel
    let list: HelpersList
    @Environment(\.theme) private var theme

    var body: some View {
        let enabled = !list.models.isEmpty
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Allow the large model for helpers")
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                Text(enabled ? "Off: jobs use at most the medium model, saving your plan." : "Needs the Claude plan")
                    .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            ThemedSwitch(isOn: list.allowLarge, set: { model.sendHelpers(model.helpers.setAllowLarge($0)) },
                         label: "Allow the large model for helpers")
                .shadow(color: theme.accent.color.opacity(list.allowLarge && enabled && theme.isDark && theme.usesGlow ? 0.5 : 0), radius: 6)
                .disabled(!enabled)
        }
        .padding(.horizontal, 8)
        .opacity(enabled ? 1 : 0.6)
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
                    .font(.system(size: size * 0.42, weight: .semibold, design: .rounded))
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
                        Text(Self.subtitle(helper)).font(.system(size: 12)).foregroundStyle(theme.text2.color)
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
                    ProposalsSection(model: model, proposals: helper.proposals)
                }
                TestCasesList(model: model, kind: "soul", target: helper.id) // ADR-098 item 8
                if helper.available {
                    HStack(spacing: 8) {
                        AppPicker(model: model, helper: helper)
                        ModelPicker(model: model, helper: helper, models: model.helpers.list?.models ?? [])
                    }
                    SkillsPicker(model: model, helper: helper, skills: model.helpers.list?.skills ?? [])
                    PlanFirstRow(model: model, helper: helper)
                    if helper.takesTasks, helper.kit != "think" { BrowserRow(model: model, helper: helper) } // ADR-098
                    if helper.worksInFolders { FoldersSection(model: model, helper: helper) }
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
                        .font(.system(size: 12.5)).foregroundStyle(theme.text2.color)
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
                .font(identifier ? theme.idFont(.system(size: 11.5), size: 11) : .system(size: 11.5))
            Image(systemName: "chevron.up.chevron.down").font(.system(size: 8, weight: .bold)).foregroundStyle(theme.text3.color)
        }
        .font(.system(size: 11.5))
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
            PillMenuLabel(label: "Model", value: value, dimmed: models.isEmpty, identifier: helper.pinnedModel != nil && !models.isEmpty)
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .disabled(models.isEmpty)
        .help("The model \(helper.name)'s jobs run on")
        .accessibilityLabel("\(helper.name)'s model")
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
                Text(placeholder).font(.system(size: 12.5)).foregroundStyle(theme.text3.color)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                TextField(placeholder, text: draft.projectedValue)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12.5))
                    .foregroundStyle(theme.text.color)
                    .onSubmit(add)
                    .accessibilityLabel("Task for \(helper.name)")
            }
            Button(action: add) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 11, weight: .bold))
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
                    Text("No jobs yet").font(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color)
                    Text("Give \(helper.name) a task above.").font(.system(size: 11.5)).foregroundStyle(theme.text3.color)
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
                        .font(.system(size: 13, weight: job.hasReport ? .semibold : .medium))
                        .foregroundStyle(theme.text.color)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
                .help("Open the task")
                if job.isWaiting, let list = model.helpers.list { WaitingLine(job: job, list: list) }
                if let held = job.held { HeldLine(reason: held) }
                if let summary = job.summary {
                    Text(summary).font(.system(size: 11.5)).foregroundStyle(theme.text2.color)
                }
                if job.state == .running, let step = job.step {
                    HStack(spacing: 8) {
                        if let progress = job.progress { ProgressLine(fraction: progress) }
                        Text(step).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.statusDots ? theme.text2.color : theme.live.color).lineLimit(1)
                    }
                }
                if job.state == .failed, let error = job.error { ProblemLine(text: error, dot: false) }
                // The model and Laya's reason are identifiers: SF Mono in Void.
                if let meta = meta { Text(meta).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(2) }
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
                IconButton(symbol: "trash", label: "Delete") { model.sendHelpers(model.helpers.deleteJob(job.id)) }
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
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(violet)
                .padding(.horizontal, 12)
                .frame(height: 26)
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
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(theme.accent.color)
                .padding(.horizontal, 13)
                .frame(height: 26)
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
                if let symbol { Image(systemName: symbol).font(.system(size: 10, weight: .semibold)) }
                Text(title).font(.system(size: 11.5, weight: .medium))
            }
            .foregroundStyle(hovering.wrappedValue ? theme.text.color : theme.text2.color)
            .padding(.horizontal, 12)
            .frame(height: 26)
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
                Text(text).font(.system(size: 11.5)).foregroundStyle(theme.text2.color)
            }
            .fixedSize(horizontal: false, vertical: true)
        } else {
            Label(text, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 11))
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
                    .font(.system(size: 18, weight: .semibold, design: theme.titleDesign))
                    .frame(maxWidth: 220)
                    .onSubmit(save)
                    .onExitCommand { editing.wrappedValue = false }
                QuietButton(title: "Cancel") { editing.wrappedValue = false }
                SaveButton(enabled: changed, label: "Save name", action: save)
            } else {
                Text(helper.name).font(.system(size: 18, weight: .semibold, design: theme.titleDesign)).foregroundStyle(theme.text.color)
                if model.savedField == "agent-name" && model.helpers.problem == nil { SavedMark() }
                if helper.soul != nil {
                    Button {
                        draft.wrappedValue = helper.name
                        editing.wrappedValue = true
                    } label: {
                        Image(systemName: "pencil").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
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
    @Environment(\.theme) private var theme

    var body: some View {
        let list = model.chats
        HStack {
            Text("Chats").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            Button {
                model.navigate {
                    model.newConversation()
                    model.windowPage = .chat
                }
            } label: {
                Label("New chat", systemImage: "square.and.pencil").labelStyle(.iconOnly)
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text2.color)
            }
            .buttonStyle(.plain)
            .help("Start a new chat")
            .accessibilityLabel("New chat")
        }
        .padding(.horizontal, 10).padding(.top, 8)
        if let list, !list.plainChats.isEmpty {
            ForEach(list.plainChats.prefix(40)) { chat in
                SidebarChatRow(model: model, chat: chat, current: chat.id == list.current)
            }
        } else {
            Text(list == nil ? "Loading…" : "No chats yet. Talk or type to ATOM.").font(.system(size: 11.5)).foregroundStyle(theme.text3.color)
                .padding(.horizontal, 10).padding(.vertical, 4)
        }
    }
}
