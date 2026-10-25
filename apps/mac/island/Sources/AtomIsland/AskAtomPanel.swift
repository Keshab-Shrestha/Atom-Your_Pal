import SwiftUI
import AtomIslandCore

// Ask ATOM (upgrades.md B3/U3): under a text, the user says what to do to it ("make it shorter", "fix the spelling"). The
// text goes to the model only now, only because he asked. ATOM's answer comes back as a list of changes to accept or deny
// (`EditReviewView`); each accepted change goes into the text at once. The whole text is the target: this view has no selection.

struct AskAtomPanel: View {
    let model: IslandModel
    /// The text being edited. An accepted change is written here.
    let text: State<String>

    private enum Phase {
        case idle
        case running(id: String, request: EditRequest)
        case review(original: String, proposed: String, token: Int)
        case message(String)
    }

    private let phase = State(initialValue: Phase.idle)
    private let instruction = State(initialValue: "")
    private let reviews = State(initialValue: 0)
    @Environment(\.theme) private var theme

    init(model: IslandModel, text: State<String>) {
        self.model = model
        self.text = text
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch phase.wrappedValue {
            case .idle, .message:
                askRow
                if case .message(let words) = phase.wrappedValue {
                    Text(words).appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color)
                }
            case .running(let id, _):
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("ATOM is editing…").appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                    Spacer(minLength: 8)
                    QuietButton(title: "Cancel", symbol: "xmark") {
                        model.cancelAskAtom(id: id)
                        phase.wrappedValue = .idle
                    }
                    .keyboardShortcut(.cancelAction)
                }
            case .review(let original, let proposed, let token):
                EditReviewView(original: original, proposed: proposed) { text.wrappedValue = $0 }
                    .id(token)
                HStack {
                    Spacer(minLength: 0)
                    QuietButton(title: "Done", symbol: "checkmark") { phase.wrappedValue = .idle }
                }
            }
        }
        .onChange(of: pendingAnswer) { _, answer in
            if let answer { received(answer) }
        }
    }

    private var askRow: some View {
        HStack(spacing: 8) {
            Image(systemName: "sparkles").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
            TextField("Ask ATOM: make it shorter, fix the spelling…", text: instruction.projectedValue)
                .textFieldStyle(.plain).appFont(.system(size: 12.5)).foregroundStyle(theme.text.color)
                .onSubmit(send)
                .accessibilityLabel("Ask ATOM to change this text")
            QuietButton(title: "Ask", symbol: "arrow.up") { send() }
                .disabled(instruction.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.horizontal, 12).frame(height: 34)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous).fill(theme.fill1.color))
    }

    /// The answer to the request that runs, if it came.
    private var pendingAnswer: EditAnswer? {
        if case .running(let id, _) = phase.wrappedValue { return model.editAnswers[id] }
        return nil
    }

    private func send() {
        do {
            let request = try EditRequest(text: text.wrappedValue, instruction: instruction.wrappedValue)
            let id = "ask-" + UUID().uuidString.prefix(8).lowercased()
            phase.wrappedValue = .running(id: id, request: request)
            model.askAtom(id: id, request: request)
        } catch let error as EditRequestError {
            phase.wrappedValue = .message(error.words)
        } catch {
            phase.wrappedValue = .message("That did not work. Try again.")
        }
    }

    private func received(_ answer: EditAnswer) {
        guard case .running(let id, let request) = phase.wrappedValue else { return }
        _ = model.takeEditAnswer(id)
        switch answer {
        case .failed(let words):
            phase.wrappedValue = .message(words)
        case .answer(_, let changed) where !changed:
            phase.wrappedValue = .message("ATOM changed nothing.")
        case .answer(let new, _):
            reviews.wrappedValue += 1
            let review = request.review(answer: new)
            phase.wrappedValue = .review(original: review.original, proposed: review.proposed, token: reviews.wrappedValue)
            instruction.wrappedValue = ""
        }
    }
}
