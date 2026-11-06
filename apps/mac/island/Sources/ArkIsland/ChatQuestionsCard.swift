import SwiftUI
import ArkIslandCore

// ADR-275 (design reference: Ghostex, MIT; redrawn in ARK's tokens): the questions ARK waits on, as one card above the composer.
// Each question has a numbered pill, its options as radio rows (a, b, c … pick them; ↑ ↓ move), an "Other / none of these"
// row and an optional note. One "Send answers" (⌘↩) sends every question; a blank one goes as unanswered.

struct ChatQuestionsCard: View {
    let model: IslandModel
    let work: ChatWorkSnapshot
    let questions: [ChatWorkSnapshot.Question]
    /// The gallery's picks; nil in use.
    var preset: [String: Int] = [:]
    @State private var picks: [String: Int] = [:]
    @State private var notes: [String: String] = [:]
    @State private var sent = false
    @FocusState private var focused: String?
    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            header
            ForEach(Array(questions.enumerated()), id: \.element.id) { index, question in
                RowDivider(inset: 0)
                block(index: index, question: question)
            }
            RowDivider(inset: 0)
            footer
        }
        .appFont(.system(size: 12)).foregroundStyle(theme.text.color)
        .background(shape.fill(theme.fill1.color))
        .overlay(shape.strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
        .clipShape(shape)
        .disabled(sent)
        .onAppear { if picks.isEmpty { picks = preset } }
        .onChange(of: work) { _, _ in if work.questions.contains(where: { $0.error != nil }) { sent = false } }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("ARK asks \(ChatQuestions.count(questions.count))")
    }

    private var header: some View {
        HStack(spacing: 8) {
            Glyph(systemName: "questionmark.bubble").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text2.color)
                .frame(width: 22, height: 22)
                .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(theme.fill2.color))
                .accessibilityHidden(true)
            Text("ARK asks").appFont(.system(size: 12, weight: .semibold))
            Spacer(minLength: 8)
            Text(ChatQuestions.count(questions.count)).appFont(.system(size: 11)).monospacedDigit().foregroundStyle(theme.text3.color)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private func block(index: Int, question: ChatWorkSnapshot.Question) -> some View {
        let options = ChatQuestions.options(question.choices)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Q\(index + 1)").appFont(.system(size: 11, weight: .semibold)).monospacedDigit().foregroundStyle(theme.accent.color)
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .background(Capsule(style: .continuous).fill(theme.accent.color.opacity(0.14)))
                Text(question.prompt).appFont(.system(size: 13, weight: .medium)).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let error = question.error { Text(error).appFont(.system(size: 11)).foregroundStyle(theme.attention.color) }
            if !options.isEmpty { optionList(question: question, options: options, number: index + 1) }
            SoulField(label: options.isEmpty ? "Your answer" : "Note (optional)", text: noteBinding(question.id), lines: 1, submit: send)
                .accessibilityLabel(options.isEmpty ? "Answer to question \(index + 1)" : "Note for question \(index + 1)")
        }
        .padding(.horizontal, 12).padding(.vertical, 12)
    }

    /// The radio rows. The list takes focus (Tab), so a letter picks a row and ↑ ↓ move without typing into the note.
    private func optionList(question: ChatWorkSnapshot.Question, options: [QuestionOption], number: Int) -> some View {
        let pick = picks[question.id]
        return VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(options.enumerated()), id: \.offset) { i, option in
                optionRow(label: option.label, detail: option.detail, recommended: option.recommended, key: option.key, selected: pick == i) {
                    choose(question.id, i)
                }
            }
            optionRow(label: ChatQuestions.otherLabel, detail: nil, recommended: false, key: ChatQuestions.otherKey(options), selected: pick == options.count) {
                choose(question.id, options.count)
            }
        }
        .padding(2)
        .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
            .strokeBorder(focused == question.id ? theme.accent.color.opacity(0.6) : .clear, lineWidth: 1))
        .focusable()
        .focusEffectDisabled()
        .focused($focused, equals: question.id)
        .onKeyPress(.downArrow) { move(question.id, 1, options) }
        .onKeyPress(.upArrow) { move(question.id, -1, options) }
        .onKeyPress(characters: .letters) { press in
            guard let key = press.characters.first, let row = ChatQuestions.pick(key: key, in: options) else { return .ignored }
            picks[question.id] = row
            return .handled
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Options for question \(number)")
    }

    private func optionRow(label: String, detail: String?, recommended: Bool, key: Character, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                ZStack {
                    Circle().strokeBorder(selected ? theme.accent.color : theme.text3.color, lineWidth: 1.2)
                    if selected { Circle().fill(theme.accent.color).padding(3) }
                }
                .frame(width: 12, height: 12)
                .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Text(label).appFont(.system(size: 12.5)).foregroundStyle(theme.text.color)
                        if recommended {
                            Text("Recommended").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.success.color)
                                .padding(.horizontal, 6).padding(.vertical, 1)
                                .background(Capsule(style: .continuous).fill(theme.success.color.opacity(0.14)))
                        }
                    }
                    if let detail { Text(detail).appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color) }
                }
                Spacer(minLength: 8)
                Text(String(key)).appFont(.system(size: 11, design: .monospaced)).foregroundStyle(theme.text3.color)
                    .frame(width: 18, height: 18)
                    .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(theme.fill2.color))
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 8).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(selected ? theme.accent.color.opacity(0.08) : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel([label, detail, recommended ? "recommended" : nil].compactMap { $0 }.joined(separator: ", "))
        .accessibilityHint("Key \(key)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Questions you leave blank are sent as unanswered.").appFont(.system(size: 11)).foregroundStyle(theme.text2.color)
                Spacer(minLength: 8)
                if sent { Text("Waiting for confirmation…").appFont(.system(size: 11)).foregroundStyle(theme.text3.color) }
                Text("⌘↩").appFont(.system(size: 11)).foregroundStyle(theme.text3.color).accessibilityHidden(true)
                PillButton(title: "Send answers", symbol: "paperplane", prominent: true, action: send)
                    .keyboardShortcut(.return, modifiers: .command)
                    .accessibilityHint("Command Return")
            }
            Text("Answers give clarification, not file or system permission. Do not enter passwords or secrets. The message box queues a new message instead.")
                .appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private func noteBinding(_ id: String) -> Binding<String> {
        Binding(get: { notes[id] ?? "" }, set: { notes[id] = $0 })
    }

    private func choose(_ id: String, _ row: Int) {
        picks[id] = picks[id] == row ? nil : row // a second click clears the pick
    }

    private func move(_ id: String, _ step: Int, _ options: [QuestionOption]) -> KeyPress.Result {
        picks[id] = ChatQuestions.move(picks[id], by: step, options: options)
        return .handled
    }

    /// Every question in order; a blank one is sent as skipped. Stops at the first answer that cannot be saved.
    private func send() {
        guard !sent else { return }
        for question in questions where work.questions.contains(where: { $0.id == question.id && $0.state == "pending" }) {
            let text = ChatQuestions.answer(options: ChatQuestions.options(question.choices), pick: picks[question.id], note: notes[question.id] ?? "")
            guard model.answerChatQuestion(work: work, question: question, text: text) else { return }
        }
        sent = true
    }
}
