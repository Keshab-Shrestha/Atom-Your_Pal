import SwiftUI
import ZenoIslandCore

/// Type to ZENO: Return sends, the reply is spoken and shown like a voice turn.
struct Composer: View {
    let model: IslandModel
    private let draft = State(initialValue: "")
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 6) {
            TextField("Type to ZENO…", text: draft.projectedValue)
                .textFieldStyle(.plain)
                .font(.system(size: 12.5))
                .foregroundStyle(theme.text.color)
                .onSubmit(send)
                .accessibilityLabel("Message to ZENO")
            Button(action: send) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 10.5, weight: .bold))
                    .foregroundStyle(empty ? theme.text3.color : theme.onAccent.color)
                    .frame(width: 22, height: 22)
                    .background(Circle().fill(empty ? theme.fill2.color : theme.accent.color))
            }
            .buttonStyle(.plain)
            .disabled(empty)
            .accessibilityLabel("Send")
            .help("Send (Return)")
        }
        .padding(.leading, 11)
        .padding(.trailing, 5)
        .padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 15, style: .continuous).fill(theme.fill1.color))
        .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous).strokeBorder(theme.separator.color, lineWidth: 0.5))
    }

    private var empty: Bool { draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func send() {
        guard !empty else { return }
        model.ask(draft.wrappedValue)
        draft.wrappedValue = ""
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
                    Composer(model: model).padding(12)
                } else {
                    content
                }
            }
        } else {
            content
        }
    }

    @ViewBuilder private var content: some View {
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
                EmptyConversationExamples(model: model).padding(.top, 4)
                Spacer()
                Composer(model: model)
            }
            .padding(EdgeInsets(top: 24, leading: 12, bottom: 12, trailing: 12))
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
                Composer(model: model).padding(.horizontal, 12).padding(.top, 9)
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
        return "Hold \(combo.display), ask anything, then let go. Or type below."
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
