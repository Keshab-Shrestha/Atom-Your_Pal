import SwiftUI
import ZenoIslandCore

/// The expanded island (ADR-038, ADR-040): the compact header on top, then tabs for the conversation,
/// ZENO's status and Settings. Opened by clicking the compact card.
struct ExpandedView: View {
    let model: IslandModel

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                StateGlyph(kind: model.status.kind)
                    .frame(width: 30, height: 30)
                VStack(alignment: .leading, spacing: 1) {
                    Text(model.status.title)
                        .font(.system(size: 13, weight: .semibold))
                    if !model.status.detail.isEmpty {
                        Text(model.status.detail)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                }
                .lineLimit(1)
                Spacer(minLength: 4)
                if model.status.showsLevel {
                    Waveform(levels: model.meter.history)
                        .frame(width: 46, height: 22)
                }
                IconButton(symbol: "chevron.up", label: "Collapse (Esc)") { model.setExpanded(false) }
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 10)

            TabBar(selection: Binding(get: { model.tab }, set: { model.tab = $0 }))
                .padding(.horizontal, 12)
                .padding(.bottom, 8)

            Divider().opacity(0.4)

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
            ScrollView { content }
        }
    }
}

struct IconButton: View {
    let symbol: String
    let label: String
    let action: () -> Void
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let hovering = State(initialValue: false)

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .semibold))
                .frame(width: 24, height: 24)
                .background(Circle().fill(.white.opacity(hovering.wrappedValue ? 0.16 : 0.08)))
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
        .help(label)
        .accessibilityLabel(label)
    }
}

struct TabBar: View {
    @Binding var selection: IslandModel.Tab
    @Namespace private var namespace

    var body: some View {
        HStack(spacing: 2) {
            ForEach(IslandModel.Tab.allCases) { tab in
                Button {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) { selection = tab }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: tab.symbol).font(.system(size: 10, weight: .semibold))
                        Text(tab.rawValue).font(.system(size: 11, weight: .medium))
                    }
                    .foregroundStyle(selection == tab ? .primary : .secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .background {
                        if selection == tab {
                            Capsule().fill(.white.opacity(0.14))
                                .matchedGeometryEffect(id: "tab", in: namespace)
                        }
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == tab ? .isSelected : [])
            }
        }
        .padding(3)
        .background(Capsule().fill(.white.opacity(0.06)))
    }
}

/// A rounded group of rows, like a System Settings section.
struct Card<Content: View>: View {
    let title: String?
    @ViewBuilder let content: Content

    init(_ title: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title {
                Text(title.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .padding(.leading, 4)
            }
            VStack(alignment: .leading, spacing: 0) { content }
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.white.opacity(0.06)))
        }
    }
}

struct Row<Trailing: View>: View {
    let title: String
    var detail: String? = nil
    @ViewBuilder let trailing: Trailing

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 12, weight: .medium))
                if let detail, !detail.isEmpty {
                    Text(detail).font(.system(size: 10.5)).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 6)
            trailing
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 8)
    }
}

struct RowDivider: View {
    var body: some View { Divider().opacity(0.35).padding(.leading, 11) }
}

// MARK: - Conversation

struct ConversationTab: View {
    let model: IslandModel

    var body: some View {
        if model.conversation.isEmpty {
            VStack(spacing: 8) {
                Spacer()
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.system(size: 26, weight: .light))
                    .foregroundStyle(.secondary)
                Text("No conversation yet")
                    .font(.system(size: 13, weight: .semibold))
                Text(talkHint)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Spacer()
            }
            .padding(24)
            .frame(maxWidth: .infinity)
        } else {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    Scrollable {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            ForEach(model.conversation.turns) { turn in
                                TurnView(turn: turn).id(turn.id)
                            }
                        }
                        .padding(12)
                    }
                    .onAppear { proxy.scrollTo(model.conversation.turns.last?.id, anchor: .bottom) }
                    .onChange(of: model.conversation.turns) { _, turns in
                        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(turns.last?.id, anchor: .bottom) }
                    }
                }
                Divider().opacity(0.4)
                HStack {
                    Text("\(model.conversation.turns.count) turn\(model.conversation.turns.count == 1 ? "" : "s") this session")
                        .font(.system(size: 10.5))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button {
                        model.newConversation()
                    } label: {
                        Label("New conversation", systemImage: "plus.bubble")
                            .font(.system(size: 11, weight: .medium))
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(.white.opacity(0.1)))
                }
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .padding(.bottom, 11)
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

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Spacer(minLength: 40)
                Text(turn.transcript)
                    .font(.system(size: 12))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.accentColor.opacity(0.35)))
                    .textSelection(.enabled)
            }
            switch turn.outcome {
            case .inProgress where turn.reply == nil:
                ThinkingDots().padding(.leading, 6)
            case .notice(let message):
                outcomeLine(message, symbol: "hand.raised", color: .yellow)
            case .failed(let message):
                if let reply = turn.reply { replyBubble(reply) }
                outcomeLine(message, symbol: "exclamationmark.triangle", color: .orange)
            default:
                if let reply = turn.reply { replyBubble(reply) }
            }
            if let timings = turn.timings {
                Text(StatusTab.timingSummary(timings))
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func replyBubble(_ text: String) -> some View {
        HStack {
            Text(text)
                .font(.system(size: 12))
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.white.opacity(0.09)))
                .textSelection(.enabled)
            Spacer(minLength: 40)
        }
    }

    private func outcomeLine(_ text: String, symbol: String, color: Color) -> some View {
        Label(text, systemImage: symbol)
            .font(.system(size: 11))
            .foregroundStyle(color.opacity(0.9))
    }
}

struct ThinkingDots: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 15)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<3) { i in
                    Circle()
                        .fill(.white)
                        .frame(width: 5, height: 5)
                        .opacity(0.3 + 0.7 * max(0, sin((t * 4) - Double(i) * 0.7)))
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.white.opacity(0.09)))
        }
        .accessibilityLabel("Thinking")
    }
}

// MARK: - Status

struct StatusTab: View {
    let model: IslandModel

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
                                .foregroundStyle(.orange)
                            Text(problem.message)
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
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
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .truncationMode(.middle)
    }

    static func seconds(_ ms: Int) -> String { String(format: "%.1f s", Double(ms) / 1000) }

    static func timingSummary(_ t: TurnTimings) -> String {
        var parts = ["heard \(seconds(t.transcriptionMs))", "AI \(seconds(t.modelMs))"]
        if let first = t.firstSoundMs { parts.append("first sound \(seconds(first))") }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Settings

struct SettingsTab: View {
    let model: IslandModel

    var body: some View {
        Scrollable {
            VStack(alignment: .leading, spacing: 14) {
                ModelSection(model: model)
                ShortcutSection(model: model)
                Card("Extras") {
                    Row(title: "Pet", detail: "Wisp floats along the bottom of the screen") {
                        Toggle("", isOn: Binding(get: { model.settings.petEnabled }, set: { model.settings.petEnabled = $0 }))
                            .labelsHidden().toggleStyle(.switch).controlSize(.mini)
                    }
                    RowDivider()
                    Row(title: "Sounds", detail: "A soft tone when listening starts and stops") {
                        Toggle("", isOn: Binding(get: { model.settings.soundsEnabled }, set: { model.settings.soundsEnabled = $0 }))
                            .labelsHidden().toggleStyle(.switch).controlSize(.mini)
                    }
                }
            }
            .padding(12)
        }
    }
}

struct ModelSection: View {
    let model: IslandModel

    var body: some View {
        Card("AI model") {
            if let info = model.modelInfo {
                ForEach(Array(info.providers.enumerated()), id: \.element.id) { index, provider in
                    if index > 0 { RowDivider() }
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(provider.name).font(.system(size: 12, weight: .semibold))
                            Spacer()
                            if !provider.available {
                                Text("No API key in .env")
                                    .font(.system(size: 10))
                                    .foregroundStyle(.secondary)
                            }
                        }
                        FlowLayout(spacing: 5) {
                            ForEach(provider.models) { option in
                                ModelChip(
                                    name: option.name,
                                    selected: info.provider == provider.id && info.model == option.id,
                                    pending: model.pendingModel == option.id,
                                    enabled: provider.available && model.pendingModel == nil
                                ) {
                                    model.chooseModel(provider: provider.id, model: option.id)
                                }
                            }
                        }
                        .opacity(provider.available ? 1 : 0.45)
                    }
                    .padding(.horizontal, 11)
                    .padding(.vertical, 9)
                }
                if let error = model.modelError {
                    RowDivider()
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(11)
                }
            } else {
                Row(title: "Waiting for ZENO to start…") { ProgressView().controlSize(.small) }
            }
        }
    }
}

struct ModelChip: View {
    let name: String
    let selected: Bool
    let pending: Bool
    let enabled: Bool
    let action: () -> Void
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let hovering = State(initialValue: false)

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if pending {
                    ProgressView().controlSize(.mini)
                } else if selected {
                    Image(systemName: "checkmark").font(.system(size: 9, weight: .bold))
                }
                Text(name).font(.system(size: 11, weight: selected ? .semibold : .regular))
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .foregroundStyle(.white)
            .background(Capsule().fill(selected ? Color.accentColor : .white.opacity(hovering.wrappedValue ? 0.14 : 0.08)))
            .overlay(Capsule().strokeBorder(.white.opacity(selected ? 0.35 : 0.08), lineWidth: 0.5))
        }
        .buttonStyle(.plain)
        // The selected chip stays at full strength; clicking it again does nothing (`chooseModel` ignores it).
        .disabled(!enabled && !selected)
        .onHover { hovering.wrappedValue = $0 }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct ShortcutSection: View {
    let model: IslandModel

    var body: some View {
        Card("Shortcuts") {
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
                            .foregroundStyle(.orange)
                            .padding(.horizontal, 11)
                            .padding(.bottom, 6)
                    }
                }
            }
            RowDivider()
            Text(footer)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(11)
        }
    }

    private var footer: String {
        if model.recorder.isRecording {
            return "Press the new keys. For a hold shortcut, hold the modifiers (e.g. ⌃⌥ or Right ⌥) and let go. Esc cancels, Delete turns it off."
        }
        return "Click a shortcut to change it. Shortcuts start working in other apps in the next update."
    }
}

struct RecorderButton: View {
    let model: IslandModel
    let action: ShortcutAction
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let hovering = State(initialValue: false)

    private var recording: Bool { model.recorder.action == action }

    var body: some View {
        Button {
            model.recorder.toggle(action)
        } label: {
            Text(label)
                .font(.system(size: 11.5, weight: .medium, design: recording ? .default : .rounded))
                .foregroundStyle(recording ? Color.accentColor : (model.settings.shortcut(for: action) == nil ? .secondary : .primary))
                .frame(minWidth: 64)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(.white.opacity(recording ? 0.14 : (hovering.wrappedValue ? 0.12 : 0.07))))
                .overlay(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .strokeBorder(recording ? Color.accentColor : .white.opacity(0.1), lineWidth: recording ? 1.2 : 0.5))
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
