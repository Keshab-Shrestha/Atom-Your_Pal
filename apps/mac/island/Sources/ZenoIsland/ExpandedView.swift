import SwiftUI
import ZenoIslandCore

/// The panel under the menu-bar icon (ADR-038, ADR-040, ADR-056, ADR-057): a header with ZENO's state, then tabs
/// for the conversation, ZENO's status and Settings. Every colour comes from the user's theme.
struct ExpandedView: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                StateGlyph(kind: model.status.kind)
                    .frame(width: 28, height: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text(model.status.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.text.color)
                    if !model.status.detail.isEmpty {
                        Text(model.status.detail)
                            .font(.system(size: 11))
                            .foregroundStyle(theme.text2.color)
                    }
                }
                .lineLimit(1)
                Spacer(minLength: 4)
                if model.status.showsLevel {
                    Waveform(levels: model.meter.history, color: theme.live.color)
                        .frame(width: 46, height: 20)
                }
                IconButton(symbol: "xmark", label: "Close (Esc)") { model.setExpanded(false) }
            }
            .padding(.horizontal, 12)
            .padding(.top, 11)
            .padding(.bottom, 9)

            TabBar(selection: Binding(get: { model.tab }, set: { model.tab = $0 }))
                .padding(.horizontal, 12)
                .padding(.bottom, 9)

            Rectangle().fill(theme.separator.color).frame(height: 0.5)

            Group {
                switch model.tab {
                case .conversation: ConversationTab(model: model)
                case .status: StatusTab(model: model)
                case .settings: SettingsTab(model: model)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }
}

// MARK: - Building blocks

private struct SnapshotKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// Rendering for a development snapshot: `ImageRenderer` cannot draw scroll views.
    var islandSnapshot: Bool {
        get { self[SnapshotKey.self] }
        set { self[SnapshotKey.self] = newValue }
    }
}

/// A vertical scroll view, laid out flat in development snapshots.
struct Scrollable<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        if snapshot {
            // Natural height, pinned to the top; anything taller is cut off at the bottom like an unscrolled
            // list. GeometryReader takes only the space offered, so tall content cannot push the header out.
            GeometryReader { proxy in
                content.fixedSize(horizontal: false, vertical: true)
                    .frame(width: proxy.size.width, alignment: .top)
            }
            .clipped()
        } else {
            ScrollView { content }.scrollIndicators(.automatic)
        }
    }
}

struct IconButton: View {
    let symbol: String
    let label: String
    let action: () -> Void
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(theme.text2.color)
                .frame(width: 22, height: 22)
                .background(Circle().fill(hovering.wrappedValue ? theme.fill3.color : theme.fill1.color))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
        .help(label)
        .accessibilityLabel(label)
    }
}

/// A segmented control in the theme: the selected segment is a raised pill.
struct TabBar: View {
    @Binding var selection: IslandModel.Tab
    @Namespace private var namespace
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 2) {
            ForEach(IslandModel.Tab.allCases) { tab in
                Button {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) { selection = tab }
                } label: {
                    Text(tab.rawValue)
                        .font(.system(size: 11.5, weight: selection == tab ? .semibold : .medium))
                        .foregroundStyle(selection == tab ? theme.text.color : theme.text2.color)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 5)
                        .background {
                            if selection == tab {
                                RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous)
                                    .fill(theme.isDark ? theme.fill3.color : Color.white)
                                    .shadow(color: .black.opacity(theme.isDark ? 0 : 0.08), radius: 1.5, y: 0.5)
                                    .matchedGeometryEffect(id: "tab", in: namespace)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == tab ? .isSelected : [])
            }
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous).fill(theme.fill1.color))
    }
}

/// A rounded group of rows, like a System Settings section.
struct Card<Content: View>: View {
    let title: String?
    var footer: String? = nil
    @ViewBuilder let content: Content
    @Environment(\.theme) private var theme

    init(_ title: String? = nil, footer: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.footer = footer
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title {
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.text2.color)
                    .padding(.leading, 4)
            }
            VStack(alignment: .leading, spacing: 0) { content }
                .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).fill(theme.fill1.color))
                .overlay(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).strokeBorder(theme.separator.color.opacity(0.6), lineWidth: 0.5))
            if let footer {
                Text(footer)
                    .font(.system(size: 10.5))
                    .foregroundStyle(theme.text3.color)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
            }
        }
    }
}

struct Row<Trailing: View>: View {
    let title: String
    var detail: String? = nil
    @ViewBuilder let trailing: Trailing
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                if let detail, !detail.isEmpty {
                    Text(detail).font(.system(size: 10.5)).foregroundStyle(theme.text2.color)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 6)
            trailing
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 8)
        .frame(minHeight: 36)
    }
}

struct RowDivider: View {
    @Environment(\.theme) private var theme
    var body: some View { Rectangle().fill(theme.separator.color).frame(height: 0.5).padding(.leading, 11) }
}

/// A switch drawn in the theme (the system's mini switch does not render in snapshots, and its colour is the
/// system accent rather than ZENO's).
struct ThemedSwitch: View {
    let isOn: Bool
    let set: (Bool) -> Void
    var label: String
    @Environment(\.theme) private var theme

    var body: some View {
        Button { set(!isOn) } label: {
            ZStack(alignment: isOn ? .trailing : .leading) {
                Capsule().fill(isOn ? theme.accentFill : AnyShapeStyle(theme.fill3.color))
                Circle()
                    .fill(Color.white)
                    .shadow(color: .black.opacity(0.22), radius: 1, y: 0.5)
                    .padding(2)
            }
            .frame(width: 30, height: 18)
            .animation(.spring(response: 0.22, dampingFraction: 0.8), value: isOn)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityValue(isOn ? "On" : "Off")
        .accessibilityAddTraits(.isButton)
    }
}

/// A small segmented picker for 2–4 short choices.
struct Segmented<Choice: SettingsChoice>: View {
    let selection: Choice
    let set: (Choice) -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 1) {
            ForEach(Array(Choice.allCases), id: \.self) { choice in
                let selected = choice == selection
                Button { set(choice) } label: {
                    Text(choice.title)
                        .font(.system(size: 11, weight: selected ? .semibold : .regular))
                        .foregroundStyle(selected ? theme.text.color : theme.text2.color)
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.horizontal, 8)
                        .frame(height: 22)
                        .background {
                            if selected {
                                RoundedRectangle(cornerRadius: theme.radiusControl - 1, style: .continuous)
                                    .fill(theme.isDark ? theme.fill3.color : Color.white)
                                    .shadow(color: .black.opacity(theme.isDark ? 0 : 0.08), radius: 1, y: 0.5)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl + 1, style: .continuous).fill(theme.fill2.color))
    }
}

/// A pop-up menu showing the current choice, for longer lists.
struct ThemedMenu<Choice: SettingsChoice>: View {
    let selection: Choice
    let set: (Choice) -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        Menu {
            ForEach(Array(Choice.allCases), id: \.self) { choice in
                Button { set(choice) } label: {
                    if choice == selection { Label(choice.title, systemImage: "checkmark") } else { Text(choice.title) }
                }
            }
        } label: {
            MenuLabel(text: selection.title)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .fixedSize()
    }
}

/// What a pop-up menu shows when closed: the value and an up-down chevron.
struct MenuLabel: View {
    let text: String
    var dimmed = false
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 5) {
            Text(text)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(dimmed ? theme.text2.color : theme.text.color)
                .lineLimit(1)
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(theme.text2.color)
        }
        .padding(.horizontal, 9)
        .frame(height: 24)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous).fill(theme.fill2.color))
        .contentShape(Rectangle())
    }
}

/// A small text button in the theme.
struct PillButton: View {
    let title: String
    var symbol: String? = nil
    var prominent = false
    let action: () -> Void
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let symbol { Image(systemName: symbol).font(.system(size: 10, weight: .semibold)) }
                Text(title).font(.system(size: 11.5, weight: .semibold))
            }
            .foregroundStyle(prominent ? theme.onAccent.color : theme.text.color)
            .padding(.horizontal, 10)
            .frame(height: 24)
            .background {
                RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous)
                    .fill(prominent ? theme.accentFill : AnyShapeStyle(hovering.wrappedValue ? theme.fill3.color : theme.fill2.color))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
    }
}

// MARK: - Conversation

struct ConversationTab: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        if model.conversation.isEmpty {
            VStack(spacing: 10) {
                Spacer()
                ZStack {
                    Circle().fill(theme.fill1.color)
                    WispView(mood: .resting, time: 0.3, size: 44, glow: 0.7, style: model.settings.wispStyle)
                }
                .frame(width: 76, height: 76)
                Text("Ask ZENO anything")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(theme.text.color)
                Text(talkHint)
                    .font(.system(size: 11.5))
                    .foregroundStyle(theme.text2.color)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
            }
            .padding(24)
            .frame(maxWidth: .infinity)
        } else {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    Scrollable {
                        LazyVStack(alignment: .leading, spacing: 14) {
                            ForEach(model.conversation.turns) { turn in
                                TurnView(turn: turn, wispStyle: model.settings.wispStyle).id(turn.id)
                            }
                        }
                        .padding(12)
                    }
                    .onAppear { proxy.scrollTo(model.conversation.turns.last?.id, anchor: .bottom) }
                    .onChange(of: model.conversation.turns) { _, turns in
                        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(turns.last?.id, anchor: .bottom) }
                    }
                }
                Rectangle().fill(theme.separator.color).frame(height: 0.5)
                HStack(spacing: 8) {
                    if let combo = model.settings.shortcut(for: .talk) {
                        HStack(spacing: 5) {
                            Text("Hold").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                            KeyHint(text: combo.display)
                            Text("to talk").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                        }
                    }
                    Spacer()
                    PillButton(title: "New conversation", symbol: "plus") { model.newConversation() }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
            }
        }
    }

    private var talkHint: String {
        guard let combo = model.settings.shortcut(for: .talk) else {
            return "Set a Talk shortcut in Settings to start talking."
        }
        return "Hold \(combo.display), ask anything, then let go."
    }
}

struct TurnView: View {
    let turn: Conversation.Turn
    var wispStyle: WispStyle = .orb
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Spacer(minLength: 44)
                Text(turn.transcript)
                    .font(.system(size: 12.5))
                    .foregroundStyle(theme.onUserBubble.color)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: theme.radiusCard + 2, style: .continuous).fill(theme.userBubble.color))
                    .textSelection(.enabled)
            }
            HStack(alignment: .top, spacing: 8) {
                // ZENO's side: a small Wisp, then the reply as plain text (no bubble), like a reading pane.
                WispView(mood: .resting, time: 0.3, size: 14, glow: 0.5, style: wispStyle)
                    .frame(width: 20, height: 20)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 5) {
                    switch turn.outcome {
                    case .inProgress where turn.reply == nil:
                        ThinkingDots().padding(.top, 5)
                    case .notice(let message):
                        outcomeLine(message, symbol: "hand.raised.fill", color: theme.attention.color)
                    case .failed(let message):
                        if let reply = turn.reply { replyText(reply) }
                        outcomeLine(message, symbol: "exclamationmark.triangle.fill", color: theme.problem.color)
                    default:
                        if let reply = turn.reply { replyText(reply) }
                    }
                    // Timings stay out of the way: shown only while the pointer is over the turn.
                    if let timings = turn.timings {
                        Text(StatusTab.timingSummary(timings))
                            .font(.system(size: 10, design: .rounded))
                            .foregroundStyle(theme.text3.color)
                            .opacity(hovering.wrappedValue ? 1 : 0)
                            .accessibilityHidden(!hovering.wrappedValue)
                    }
                }
                Spacer(minLength: 24)
            }
        }
        .contentShape(Rectangle())
        .onHover { hovering.wrappedValue = $0 }
        .animation(.easeOut(duration: 0.15), value: hovering.wrappedValue)
    }

    private func replyText(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12.5))
            .foregroundStyle(theme.text.color)
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }

    private func outcomeLine(_ text: String, symbol: String, color: Color) -> some View {
        Label(text, systemImage: symbol)
            .font(.system(size: 11.5, weight: .medium))
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct ThinkingDots: View {
    @Environment(\.theme) private var theme

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 15)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<3) { i in
                    Circle()
                        .fill(theme.text2.color)
                        .frame(width: 5, height: 5)
                        .opacity(0.3 + 0.7 * max(0, sin((t * 4) - Double(i) * 0.7)))
                }
            }
        }
        .accessibilityLabel("Thinking")
    }
}

// MARK: - Status

struct StatusTab: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        Scrollable {
            VStack(alignment: .leading, spacing: 14) {
                Card("ZENO") {
                    Row(title: "AI model") { value(model.modelInfo?.currentModelName ?? model.status.modelName) }
                    RowDivider()
                    Row(title: "Provider") { value(model.modelInfo?.currentProvider?.name ?? model.status.provider.capitalized) }
                    RowDivider()
                    Row(title: "Microphone") { value(model.status.microphone.isEmpty ? "—" : model.status.microphone) }
                    RowDivider()
                    Row(title: "Voice") { value(model.status.voiceLoaded ? "Loaded" : "Not loaded") }
                }

                Card("Last turn") {
                    if let t = model.status.lastTimings {
                        VStack(alignment: .leading, spacing: 5) {
                            TimingBar(timings: t)
                            HStack(spacing: 10) {
                                legend("Transcribing", theme.live.color)
                                legend("AI reply", theme.accentEnd.color)
                            }
                        }
                        .padding(.horizontal, 11)
                        .padding(.top, 10)
                        .padding(.bottom, 4)
                        Row(title: "You spoke") { value(Self.seconds(t.speechMs)) }
                        RowDivider()
                        Row(title: "Transcribing") { value(Self.seconds(t.transcriptionMs)) }
                        RowDivider()
                        Row(title: "AI reply") { value(Self.seconds(t.modelMs)) }
                        if let first = t.firstSoundMs {
                            RowDivider()
                            Row(title: "First sound", detail: "From letting go to hearing ZENO") { value(Self.seconds(first)) }
                        }
                    } else {
                        Row(title: "No turn yet") { EmptyView() }
                    }
                }

                if let problem = model.status.lastProblem {
                    Card("Last problem") {
                        VStack(alignment: .leading, spacing: 4) {
                            Label(problem.title, systemImage: "exclamationmark.triangle.fill")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(theme.problem.color)
                            Text(problem.message)
                                .font(.system(size: 11))
                                .foregroundStyle(theme.text2.color)
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                        }
                        .padding(11)
                    }
                }
            }
            .padding(12)
        }
    }

    private func value(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11.5))
            .foregroundStyle(theme.text2.color)
            .lineLimit(1)
            .truncationMode(.middle)
    }

    private func legend(_ title: String, _ color: Color) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(title).font(.system(size: 10)).foregroundStyle(theme.text2.color)
        }
    }

    static func seconds(_ ms: Int) -> String { String(format: "%.1f s", Double(ms) / 1000) }

    static func timingSummary(_ t: TurnTimings) -> String {
        var parts = ["heard \(seconds(t.transcriptionMs))", "AI \(seconds(t.modelMs))"]
        if let first = t.firstSoundMs { parts.append("first sound \(seconds(first))") }
        return parts.joined(separator: " · ")
    }
}

/// Where the last turn's time went, as one stacked bar: transcribing, then the AI.
private struct TimingBar: View {
    let timings: TurnTimings
    @Environment(\.theme) private var theme

    var body: some View {
        let parts: [(Double, Color)] = [
            (Double(timings.transcriptionMs), theme.live.color),
            (Double(timings.modelMs), theme.accentEnd.color),
        ]
        let total = max(1, parts.map(\.0).reduce(0, +))
        GeometryReader { proxy in
            HStack(spacing: 2) {
                ForEach(Array(parts.enumerated()), id: \.offset) { _, part in
                    Capsule().fill(part.1).frame(width: max(4, (proxy.size.width - 2) * part.0 / total))
                }
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

// MARK: - Settings

/// Settings as a short list of pages (ADR-057). Each page holds one area, with the right control per setting:
/// switches for on/off, segmented pickers for two to four short choices, pop-up menus for longer lists.
struct SettingsTab: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        if let page = model.settingsPage {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Button {
                        withAnimation(.easeOut(duration: 0.18)) { model.settingsPage = nil }
                    } label: {
                        HStack(spacing: 3) {
                            Image(systemName: "chevron.left").font(.system(size: 11, weight: .semibold))
                            Text("Settings").font(.system(size: 12, weight: .medium))
                        }
                        .foregroundStyle(theme.accent.color)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Back to Settings")
                    Spacer()
                    Text(page.rawValue).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.text.color)
                    Spacer()
                    Color.clear.frame(width: 64, height: 1)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                Scrollable {
                    VStack(alignment: .leading, spacing: 14) { pageContent(page) }
                        .padding(.horizontal, 12)
                        .padding(.bottom, 12)
                        .padding(.top, 2)
                }
            }
            .transition(.move(edge: .trailing).combined(with: .opacity))
        } else {
            Scrollable {
                VStack(alignment: .leading, spacing: 14) {
                    Card {
                        ForEach(Array(IslandModel.SettingsPage.allCases.enumerated()), id: \.element) { index, page in
                            if index > 0 { RowDivider() }
                            PageRow(page: page, summary: summary(page)) {
                                withAnimation(.easeOut(duration: 0.18)) { model.settingsPage = page }
                            }
                        }
                    }
                }
                .padding(12)
            }
            .transition(.opacity)
        }
    }

    /// The current value shown on a page's row, so the list answers "how is it set?" without opening anything.
    private func summary(_ page: IslandModel.SettingsPage) -> String {
        let s = model.settings
        switch page {
        case .appearance: return "\(s.theme.title) · \(s.wispStyle.title)"
        case .model: return model.modelInfo?.currentModelName ?? "—"
        case .shortcuts: return s.shortcut(for: .talk)?.display ?? "Off"
        case .dictation: return s.dictationMode.title
        case .wisp: return s.petEnabled ? s.wispSize.title : "Off"
        case .bubble: return s.bubbleSize.title
        case .panel: return s.panelSize.title
        case .general: return s.soundsEnabled ? "Sounds on" : "Sounds off"
        }
    }

    @ViewBuilder private func pageContent(_ page: IslandModel.SettingsPage) -> some View {
        switch page {
        case .appearance: AppearanceSection(model: model)
        case .model: ModelSection(model: model)
        case .shortcuts: ShortcutSection(model: model)
        case .dictation: DictationSection(model: model)
        case .wisp: WispSection(model: model)
        case .bubble: BubbleSection(model: model)
        case .panel: PanelSection(model: model)
        case .general: GeneralSection(model: model)
        }
    }
}

/// One row in the Settings list: a coloured icon tile, the page name, its current value and a chevron.
private struct PageRow: View {
    let page: IslandModel.SettingsPage
    let summary: String
    let action: () -> Void
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: page.symbol)
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(theme.onAccent.color)
                    .frame(width: 22, height: 22)
                    .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(theme.accentFill))
                Text(page.rawValue)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(theme.text.color)
                Spacer(minLength: 6)
                Text(summary)
                    .font(.system(size: 11.5))
                    .foregroundStyle(theme.text2.color)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Image(systemName: "chevron.right")
                    .font(.system(size: 9.5, weight: .bold))
                    .foregroundStyle(theme.text3.color)
            }
            .padding(.horizontal, 11)
            .frame(height: 38)
            .background(hovering.wrappedValue ? theme.fill1.color : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
        .accessibilityLabel("\(page.rawValue), \(summary)")
    }
}

/// Appearance (ADR-057): the theme for every surface and Wisp's look, chosen separately.
struct AppearanceSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let settings = model.settings
        Card("Theme", footer: settings.theme.detail) {
            HStack(spacing: 8) {
                ForEach(AppTheme.allCases) { option in
                    ThemeSwatch(option: option, selected: settings.theme == option) { settings.theme = option }
                }
            }
            .padding(10)
        }
        Card("Wisp", footer: wispDetail(settings.wispStyle)) {
            HStack(spacing: 8) {
                ForEach(WispStyle.allCases) { option in
                    WispSwatch(option: option, selected: settings.wispStyle == option) { settings.wispStyle = option }
                }
            }
            .padding(10)
        }
    }

    private func wispDetail(_ style: WispStyle) -> String {
        switch style {
        case .ghost: "The original ghost, refined: its eyes and glow show the mood"
        case .orb: "A floating marble of light: the light inside it shows the mood"
        case .companion: "A small character with a face: its pose and face show the mood"
        }
    }
}

/// A theme choice drawn as a tiny panel in that theme.
private struct ThemeSwatch: View {
    let option: AppTheme
    let selected: Bool
    let action: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        let p = option.palette
        Button(action: action) {
            VStack(spacing: 6) {
                ZStack(alignment: .topLeading) {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).fill(p.surfaceSolid.color)
                    VStack(alignment: .leading, spacing: 4) {
                        Capsule().fill(p.text.color.opacity(0.85)).frame(width: 30, height: 4)
                        Capsule().fill(p.text2.color).frame(width: 44, height: 3)
                        Spacer(minLength: 0)
                        HStack(spacing: 4) {
                            Capsule().fill(p.accentFill).frame(width: 22, height: 8)
                            Capsule().fill(p.fill3.color).frame(width: 14, height: 8)
                        }
                    }
                    .padding(7)
                }
                .frame(height: 54)
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(p.border.color, lineWidth: 0.5))
                Text(option.title)
                    .font(.system(size: 11, weight: selected ? .semibold : .regular))
                    .foregroundStyle(selected ? theme.text.color : theme.text2.color)
            }
            .padding(4)
            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(selected ? theme.accent.color : .clear, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .accessibilityLabel("Theme \(option.title)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A Wisp style choice, showing that Wisp.
private struct WispSwatch: View {
    let option: WispStyle
    let selected: Bool
    let action: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(LinearGradient(colors: [Color(red: 0.16, green: 0.2, blue: 0.29), Color(red: 0.25, green: 0.3, blue: 0.42)], startPoint: .top, endPoint: .bottom))
                    WispView(mood: .resting, time: 0.3, size: 40, glow: 0.9, style: option)
                }
                .frame(height: 62)
                Text(option.title)
                    .font(.system(size: 11, weight: selected ? .semibold : .regular))
                    .foregroundStyle(selected ? theme.text.color : theme.text2.color)
            }
            .padding(4)
            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(selected ? theme.accent.color : .clear, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .accessibilityLabel("Wisp style \(option.title)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A setting with a few named choices: a title, a segmented picker (or a menu for long lists) and an optional
/// one-line explanation below.
struct ChoiceRow<Choice: SettingsChoice>: View {
    let title: String
    var detail: String? = nil
    let selection: Choice
    let set: (Choice) -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(title).font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                Spacer(minLength: 6)
                if Choice.allCases.count <= 4 {
                    Segmented(selection: selection, set: set)
                } else {
                    ThemedMenu(selection: selection, set: set)
                }
            }
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.system(size: 10.5))
                    .foregroundStyle(theme.text2.color)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 11)
        .padding(.vertical, 8)
    }
}

/// Wisp: whether it shows, how it looks, how it moves and when it tucks away (ADR-042, ADR-051, ADR-052).
struct WispSection: View {
    let model: IslandModel

    var body: some View {
        let settings = model.settings
        Card {
            Row(title: "Show Wisp", detail: "Shows ZENO's state and opens this panel when clicked") {
                ThemedSwitch(isOn: settings.petEnabled, set: { model.setPet($0) }, label: "Show Wisp")
            }
        }
        if settings.petEnabled {
            Card("Look") {
                ChoiceRow(title: "Size", selection: settings.wispSize) { settings.wispSize = $0 }
                RowDivider()
                ChoiceRow(title: "Glow", selection: settings.wispGlow) { settings.wispGlow = $0 }
            }
            Card("Behaviour") {
                ChoiceRow(title: "Movement",
                          detail: settings.wispWander == .stayPut ? "Wisp rests where it stands" : "How fast Wisp floats along the Dock when idle",
                          selection: settings.wispWander) { settings.wispWander = $0 }
                RowDivider()
                ChoiceRow(title: "Naps after", selection: settings.wispNap) { settings.wispNap = $0 }
                RowDivider()
                ChoiceRow(title: "Tucks away after",
                          detail: settings.wispHideAfter == .never
                              ? "Wisp stays where you put it"
                              : "Slides to a side edge and peeks out. Comes back when you point at it or ZENO has something to show",
                          selection: settings.wispHideAfter) { settings.wispHideAfter = $0 }
                RowDivider()
                ChoiceRow(title: "Hiding lean", detail: "How far Wisp tips toward the screen at an edge (\(Int(settings.wispLean.degrees))°)",
                          selection: settings.wispLean) { settings.wispLean = $0 }
            }
        }
    }
}

/// The speech bubble over Wisp (ADR-050, ADR-052).
struct BubbleSection: View {
    let model: IslandModel

    var body: some View {
        let settings = model.settings
        Card {
            ChoiceRow(title: "Size", selection: settings.bubbleSize) { settings.bubbleSize = $0 }
            RowDivider()
            ChoiceRow(title: "Background", detail: "How much you see of what is behind the bubble",
                      selection: settings.bubbleOpacity) { settings.bubbleOpacity = $0 }
            RowDivider()
            ChoiceRow(title: "Stays for", detail: "After a dictation or an answer ends",
                      selection: settings.bubbleStay) { settings.bubbleStay = $0 }
        }
    }
}

/// The panel under the menu-bar icon (ADR-051, ADR-052, ADR-056).
struct PanelSection: View {
    let model: IslandModel

    var body: some View {
        let settings = model.settings
        Card(footer: "Glass shows a blur of what is behind; Solid is a plain fill in the theme's colour.") {
            ChoiceRow(title: "Size", selection: settings.panelSize) { settings.panelSize = $0 }
            RowDivider()
            ChoiceRow(title: "Background", selection: settings.panelBackground) { settings.panelBackground = $0 }
        }
    }
}

/// Sounds, and resetting the look.
struct GeneralSection: View {
    let model: IslandModel

    var body: some View {
        let settings = model.settings
        Card {
            Row(title: "Sounds", detail: "A soft tone when listening starts and stops") {
                ThemedSwitch(isOn: settings.soundsEnabled, set: { settings.soundsEnabled = $0 }, label: "Sounds")
            }
        }
        Card(footer: "Theme, Wisp, bubble and panel go back to their defaults. Shortcuts, dictation and the AI model stay.") {
            Row(title: "Reset look and behaviour") {
                PillButton(title: "Reset") { settings.resetLook() }
            }
        }
    }
}

/// How dictation starts and what it shows and removes (ADR-050).
struct DictationSection: View {
    let model: IslandModel

    var body: some View {
        let settings = model.settings
        Card {
            ChoiceRow(title: "Start and stop", detail: settings.dictationMode.detail, selection: settings.dictationMode) { settings.dictationMode = $0 }
            RowDivider()
            Row(title: "Live preview", detail: "Show your words above Wisp while you speak") {
                ThemedSwitch(isOn: settings.livePreview, set: { settings.livePreview = $0 }, label: "Live preview")
            }
            RowDivider()
            Row(title: "Remove “um” and “uh”", detail: "Leaves out hesitation sounds in the typed text") {
                ThemedSwitch(isOn: settings.removeFillers, set: { settings.removeFillers = $0 }, label: "Remove um and uh")
            }
        }
    }
}

/// The AI model: pick a provider, then one of its models, from two menus (replaces the wall of chips).
struct ModelSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        if let info = model.modelInfo {
            let current = info.currentProvider
            Card(footer: providerNote(current)) {
                Row(title: "Provider") {
                    Menu {
                        ForEach(info.providers) { provider in
                            Button {
                                // Switching provider picks its first model; the runtime confirms.
                                if let first = provider.models.first, provider.id != info.provider {
                                    model.chooseModel(provider: provider.id, model: first.id)
                                }
                            } label: {
                                if provider.id == info.provider { Label(provider.name, systemImage: "checkmark") } else { Text(provider.name) }
                            }
                            .disabled(!provider.available || model.pendingModel != nil)
                        }
                    } label: {
                        MenuLabel(text: current?.name ?? info.provider)
                    }
                    .menuStyle(.button).buttonStyle(.plain).fixedSize()
                }
                RowDivider()
                Row(title: "Model") {
                    HStack(spacing: 6) {
                        if model.pendingModel != nil { ProgressView().controlSize(.mini) }
                        Menu {
                            ForEach(current?.models ?? []) { option in
                                Button {
                                    model.chooseModel(provider: info.provider, model: option.id)
                                } label: {
                                    if option.id == info.model { Label(option.name, systemImage: "checkmark") } else { Text(option.name) }
                                }
                                .disabled(model.pendingModel != nil)
                            }
                        } label: {
                            MenuLabel(text: info.currentModelName)
                        }
                        .menuStyle(.button).buttonStyle(.plain).fixedSize()
                    }
                }
                if let error = model.modelError {
                    RowDivider()
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(theme.problem.color)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(11)
                }
            }
            let unavailable = info.providers.filter { !$0.available }
            if !unavailable.isEmpty {
                Card("Not set up") {
                    ForEach(Array(unavailable.enumerated()), id: \.element.id) { index, provider in
                        if index > 0 { RowDivider() }
                        Row(title: provider.name, detail: provider.id == "claude-plan" ? "Claude Code not found or not signed in" : "No API key in .env") { EmptyView() }
                    }
                }
            }
        } else {
            Card {
                Row(title: "Waiting for ZENO to start…") { ProgressView().controlSize(.small) }
            }
        }
    }

    private func providerNote(_ provider: ProviderOption?) -> String? {
        guard let provider else { return nil }
        if provider.id == "claude-plan" { return "Runs on your Claude plan, no API key needed." }
        return nil
    }
}

struct ShortcutSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        Card(footer: footer) {
            ForEach(Array(ShortcutAction.allCases.enumerated()), id: \.element) { index, action in
                if index > 0 { RowDivider() }
                VStack(alignment: .leading, spacing: 4) {
                    Row(title: action.title, detail: action.detail) {
                        HStack(spacing: 4) {
                            RecorderButton(model: model, action: action)
                            if model.settings.shortcut(for: action) != action.defaultCombo, !model.recorder.isRecording {
                                IconButton(symbol: "arrow.uturn.backward", label: "Reset to \(action.defaultCombo.display)") {
                                    model.settings.resetShortcut(for: action)
                                }
                            }
                        }
                    }
                    if let problem = model.recorder.problem, problem.action == action {
                        Label(problem.message, systemImage: "exclamationmark.circle.fill")
                            .font(.system(size: 10.5))
                            .foregroundStyle(theme.problem.color)
                            .padding(.horizontal, 11)
                            .padding(.bottom, 6)
                    }
                }
            }
            if let engine = model.shortcuts, !engine.canTrackKeys {
                RowDivider()
                VStack(alignment: .leading, spacing: 7) {
                    Label("Hold shortcuts need Input Monitoring", systemImage: "keyboard.badge.ellipsis")
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundStyle(theme.attention.color)
                    Text("macOS asks before an app can see which keys are held. ZENO only watches for its own shortcuts, never what you type.")
                        .font(.system(size: 10.5))
                        .foregroundStyle(theme.text2.color)
                        .fixedSize(horizontal: false, vertical: true)
                    PillButton(title: "Allow in System Settings…", prominent: true) { engine.requestKeyAccess() }
                }
                .padding(11)
            }
        }
    }

    private var footer: String {
        if model.recorder.isRecording {
            return "Press the new keys. For a hold shortcut, hold the modifiers (e.g. ⌃⌥ or Right ⌘⌥) and let go. Esc cancels, Delete turns it off."
        }
        return "Click a shortcut to change it. Shortcuts work in every app; Cancel only while ZENO listens, speaks or dictates."
    }
}

struct RecorderButton: View {
    let model: IslandModel
    let action: ShortcutAction
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme

    private var recording: Bool { model.recorder.action == action }

    var body: some View {
        Button {
            model.recorder.toggle(action)
        } label: {
            Text(label)
                .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                .foregroundStyle(recording ? theme.accent.color : (model.settings.shortcut(for: action) == nil ? theme.text2.color : theme.text.color))
                .frame(minWidth: 64)
                .padding(.horizontal, 8)
                .frame(height: 24)
                .background(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous)
                    .fill(recording ? theme.accent.color.opacity(0.14) : (hovering.wrappedValue ? theme.fill3.color : theme.fill2.color)))
                .overlay(
                    RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous)
                        .strokeBorder(recording ? theme.accent.color : .clear, lineWidth: 1.2))
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
        .accessibilityLabel("\(action.title) shortcut: \(model.settings.shortcut(for: action)?.spokenDescription ?? "off")")
        .accessibilityHint("Click, then press the new keys")
    }

    private var label: String {
        if recording {
            let held = model.recorder.held
            return held.isEmpty ? "Press keys…" : KeyCombo(modifiers: held).display
        }
        return model.settings.shortcut(for: action)?.display ?? "Off"
    }
}

/// Lays out children left to right, wrapping onto new lines.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Line { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Line] {
        var lines: [Line] = [Line()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = lines[lines.count - 1].indices.isEmpty ? size.width : lines[lines.count - 1].width + spacing + size.width
            if needed > width, !lines[lines.count - 1].indices.isEmpty {
                lines.append(Line())
            }
            var line = lines[lines.count - 1]
            line.width = line.indices.isEmpty ? size.width : line.width + spacing + size.width
            line.height = max(line.height, size.height)
            line.indices.append(index)
            lines[lines.count - 1] = line
        }
        return lines
    }
}
