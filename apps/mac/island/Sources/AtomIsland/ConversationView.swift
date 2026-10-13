import SwiftUI
import AtomIslandCore

// ADR-084 (Lantern, Task 4.5): your words are quiet slips, Pal's replies are plain full-width text, the light stays
// with the newest words (older turns recede) and glows at the caret while a reply is being spoken. The composer is
// a capsule with a lit microphone and the hold shortcut in its placeholder.

/// Type to ATOM: Return sends, the reply is spoken and shown like a voice turn. Empty, the button is the lit
/// microphone that names the hold shortcut; with words, it sends them.
struct Composer: View {
    let model: IslandModel
    private let draft = State(initialValue: "")
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    /// Concentric with the panel's bottom corners (the theme's `cornerGap`: 24 = 16 + 8 in Void).
    private var composerShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: max(10, theme.radiusSurface - theme.cornerGap), style: .continuous)
    }

    var body: some View {
        HStack(spacing: 8) {
            if let notice = model.chats?.currentReadOnlyNotice {
                // ADR-098: Telegram or the local API writes this chat. Reading, copying and search still work.
                Text(notice).font(.system(size: 12.5)).foregroundStyle(theme.text3.color).lineLimit(2)
                    .frame(maxWidth: .infinity, minHeight: 30, alignment: .leading)
                    .accessibilityLabel(notice)
            } else if snapshot {
                // `ImageRenderer` cannot draw a text field: show the placeholder as it would appear.
                Text(placeholder).font(.system(size: 12.5)).foregroundStyle(theme.text3.color).lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                TextField(placeholder, text: draft.projectedValue)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12.5))
                    .foregroundStyle(theme.text.color)
                    .onSubmit(send)
                    .accessibilityLabel("Message to ATOM")
            }
            if model.chats?.currentReadOnlyNotice == nil {
                ComposerButton(empty: empty, listening: model.status.kind == .listening, hint: talkHint, action: send)
            }
        }
        .padding(.leading, 18)
        .padding(.trailing, 5)
        .padding(.vertical, 5)
        .background(composerShape.fill(theme.fill1.color))
        .overlay(composerShape.strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
    }

    private var talkHint: String? { model.settings.shortcut(for: .talk).map { "Hold \($0.display) to talk" } }
    private var placeholder: String {
        model.settings.shortcut(for: .talk).map { "Ask ATOM, or hold \($0.display) to talk" } ?? "Ask ATOM…"
    }

    private var empty: Bool { draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func send() {
        guard !empty else { return }
        model.ask(draft.wrappedValue)
        draft.wrappedValue = ""
    }
}

/// The composer's round button, a lit object: the microphone while the field is empty (it names the hold shortcut;
/// talking is the shortcut itself), the send arrow once there is something to send. Brightest while listening.
private struct ComposerButton: View {
    let empty: Bool
    let listening: Bool
    let hint: String?
    let action: () -> Void
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if theme.isGhost { ghost } else { filled }
    }

    /// Void (ADR-086): a ghost circle, its hairline brightening once there is something to send, and blue (with the
    /// microphone) while listening. No glow.
    private var ghost: some View {
        let tint: Color? = listening ? theme.live.color : nil
        return Button(action: action) {
            Image(systemName: empty ? "mic" : "arrow.up")
                .font(.system(size: empty ? 12.5 : 11.5, weight: empty ? .regular : .semibold))
                .foregroundStyle(tint ?? (empty ? theme.text2.color : theme.text.color))
                .frame(width: 30, height: 30)
                .background(ControlFill(Circle(), fill: Color.clear, hovering: !empty, tint: tint))
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.plain)
        .allowsHitTesting(!empty)
        .accessibilityRemoveTraits(empty ? .isButton : [])
        .animation(Motion.plain, value: empty)
        .animation(Motion.plain, value: listening)
        .accessibilityLabel(empty ? (hint ?? "Microphone") : "Send")
        .help(empty ? (hint ?? "Set a Talk shortcut in Settings") : "Send (Return)")
    }

    private var filled: some View {
        let light = theme.glow.a > 0 ? theme.glow.with(alpha: 1).color : theme.accent.color
        let lit = !empty || listening || hint != nil
        return Button(action: action) {
            Image(systemName: empty ? "mic.fill" : "arrow.up")
                .font(.system(size: empty ? 12 : 11.5, weight: .bold))
                .foregroundStyle(lit ? theme.onAccent.color : theme.text3.color)
                .frame(width: 30, height: 30)
                .background(Circle().fill(lit ? theme.accentFill : AnyShapeStyle(theme.fill2.color)))
                .shadow(color: light.opacity(lit ? (listening ? 0.85 : 0.45) : 0), radius: listening ? 9 : 6)
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.plain)
        .allowsHitTesting(!empty) // not dimmed while empty: the lit microphone is a hint, the shortcut is the action
        .accessibilityRemoveTraits(empty ? .isButton : [])
        .animation(Motion.snap(reduceMotion), value: empty)
        .animation(Motion.glow(reduceMotion), value: listening)
        .accessibilityLabel(empty ? (hint ?? "Microphone") : "Send")
        .help(empty ? (hint ?? "Set a Talk shortcut in Settings") : "Send (Return)")
    }
}

struct ConversationTab: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        // ADR-075: setup and error cards come first. They scroll, and push the empty-state picture out, so the
        // composer always stays in the panel.
        if SetupCards.isShown(model) {
            VStack(spacing: 0) {
                Scrollable { SetupCards(model: model).padding(.bottom, 10) }
                    .frame(maxHeight: model.conversation.isEmpty ? .infinity : 210)
                if model.conversation.isEmpty {
                    composer
                } else {
                    content
                }
            }
        } else {
            content
        }
    }

    private var composer: some View {
        Composer(model: model)
            .padding(.horizontal, theme.cornerGap)
            .padding(.top, 8)
            .padding(.bottom, theme.cornerGap)
    }

    @ViewBuilder private var content: some View {
        if model.conversation.isEmpty {
            VStack(spacing: 0) {
                EmptyConversation(model: model)
                    .padding(.horizontal, Spacing.panel)
                    .frame(maxHeight: .infinity)
                composer
            }
            .frame(maxWidth: .infinity)
        } else {
            VStack(spacing: 0) {
                if let note = model.trimmedNotice { TrimmedNote(text: note) } // ADR-107
                else if let note = model.cacheExpiredNotice { TrimmedNote(text: note) } // token cost, job 4
                ScrollViewReader { proxy in
                    Scrollable {
                        LazyVStack(alignment: .leading, spacing: Spacing.turn) {
                            ForEach(model.conversation.turns) { turn in
                                TurnView(turn: turn, latest: model.conversation.isLatest(turn)).id(turn.id)
                            }
                        }
                        .padding(.horizontal, Spacing.conversation)
                        .padding(.vertical, 20)
                    }
                    .softEdges()
                    .onAppear { proxy.scrollTo(model.conversation.turns.last?.id, anchor: .bottom) }
                    .onChange(of: model.conversation.turns) { _, turns in
                        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(turns.last?.id, anchor: .bottom) }
                    }
                }
                composer
            }
        }
    }
}

/// Before the first turn: Pal in a pool of its own light, what to do, and a few phrases to try.
private struct EmptyConversation: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let light = theme.glow.with(alpha: 1).color
        VStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(RadialGradient(colors: [light.opacity(0.22), light.opacity(0)], center: .center, startRadius: 4, endRadius: 46))
                    .opacity(theme.glow.a > 0 ? 1 : 0)
                PalView(mood: .resting, time: 0.3, size: 44)
            }
            .frame(width: 92, height: 92)
            // Void's one display line, in New York (the system serif, ADR-086).
            Text("Ask ATOM anything")
                .font(theme.isFlat ? .system(size: 22, weight: .regular, design: .serif) : .system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(theme.isFlat ? Color.white : theme.text.color)
            Text(talkHint)
                .font(.system(size: 11.5))
                .foregroundStyle(theme.text2.color)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            EmptyConversationExamples(model: model).padding(.top, 6)
        }
    }

    private var talkHint: String {
        guard let combo = model.settings.shortcut(for: .talk) else {
            return "Set a Talk shortcut in Settings to start talking."
        }
        return "Hold \(combo.display), ask anything, then let go. Or type below."
    }
}

struct TurnView: View {
    let turn: Conversation.Turn
    /// The newest turn: full brightness. Older turns recede to secondary text.
    var latest = true
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !turn.transcript.isEmpty { // an answer ATOM posted by itself has no question (ADR-109)
            HStack {
                Spacer(minLength: 48)
                Text(turn.transcript)
                    .font(.system(size: 12.5))
                    .foregroundStyle(theme.text2.color)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).fill(theme.fill1.color))
                    .overlay(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
                        .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color.opacity(0.5), lineWidth: theme.isFlat ? 1 : 0.5))
                    .textSelection(.enabled)
            }
            }
            VStack(alignment: .leading, spacing: 6) {
                switch turn.outcome {
                case .inProgress where turn.reply == nil:
                    ThinkingDots().padding(.vertical, 4)
                case .notice(let message):
                    outcomeLine(message, symbol: "hand.raised.fill", color: theme.attention.color)
                case .failed(let message):
                    if let reply = turn.reply { ReplyText(text: reply, latest: latest, streaming: false) }
                    outcomeLine(message, symbol: "exclamationmark.triangle.fill", color: theme.problem.color)
                default:
                    if let reply = turn.reply { ReplyText(text: reply, latest: latest, streaming: turn.isStreaming) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            // Timings stay out of the way: shown in the gap under the reply only while the pointer is over the turn,
            // so they take no room between turns.
            .overlay(alignment: .bottomLeading) {
                if let timings = turn.timings {
                    Text(NowFacts.summary(timings))
                        .font(theme.idFont(.system(size: 10, design: .rounded), size: 10))
                        .foregroundStyle(theme.text3.color)
                        .fixedSize()
                        .offset(y: 16)
                        .opacity(hovering.wrappedValue ? 1 : 0)
                        .accessibilityHidden(!hovering.wrappedValue)
                }
            }
        }
        .contentShape(Rectangle())
        .onHover { hovering.wrappedValue = $0 }
        .animation(.easeOut(duration: 0.15), value: hovering.wrappedValue)
    }

    @ViewBuilder private func outcomeLine(_ text: String, symbol: String, color: Color) -> some View {
        if theme.statusDots {
            // Void: the colour is only the dot; the words stay quiet.
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                StatusDot(color: color).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 0.5 }
                Text(text).font(.system(size: 12)).foregroundStyle(theme.text2.color)
            }
            .fixedSize(horizontal: false, vertical: true)
        } else {
            Label(text, systemImage: symbol)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(color)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Pal's reply at reading size. While it is being spoken, a caret of Pal's light glows after the last word: the
/// same text is laid out twice, the lower copy invisible except for the caret's glow, so the glow sits exactly on it.
private struct ReplyText: View {
    let text: String
    let latest: Bool
    let streaming: Bool
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let light = theme.glow.a > 0 ? theme.glow.with(alpha: 1).color : theme.accent.color
        ZStack(alignment: .topLeading) {
            if streaming, theme.usesGlow {
                (Text(text).foregroundColor(.clear) + caret(theme.isDark ? light : theme.accent.color))
                    .shadow(color: light.opacity(0.9), radius: 5)
                    .modifier(Breathing(active: !snapshot && !reduceMotion))
                    .accessibilityHidden(true)
            }
            (Text(text).foregroundColor(latest ? theme.text.color : theme.text2.color)
                + (streaming ? caret(theme.isDark ? light : theme.accent.color) : Text("")))
                .textSelection(.enabled)
        }
        .font(.system(size: 13.5))
        .lineSpacing(3)
        .fixedSize(horizontal: false, vertical: true)
        .animation(Motion.glow(reduceMotion), value: latest)
    }

    private func caret(_ colour: Color) -> Text {
        Text(" \u{25CF}").font(.system(size: 8)).baselineOffset(1).foregroundColor(colour)
    }
}

/// The caret's glow dimming and brightening while the reply is spoken.
private struct Breathing: ViewModifier {
    let active: Bool

    func body(content: Content) -> some View {
        if active {
            content.phaseAnimator([1.0, 0.45]) { view, phase in view.opacity(phase) } animation: { _ in .easeInOut(duration: 0.9) }
        } else {
            content
        }
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
                        .fill(theme.statusDots ? theme.idColor(theme.text2) : theme.text2.color) // Void: thinking is violet
                        .frame(width: 5, height: 5)
                        .opacity(0.3 + 0.7 * max(0, sin((t * 4) - Double(i) * 0.7)))
                }
            }
        }
        .accessibilityLabel("Thinking")
    }
}
