import SwiftUI
import AtomIslandCore

// ADR-129 (upgrades.md B1/U1): a proposed edit as a list of changes. Each change shows in its place, the words that go in red
// with a line through them and the words that come in green, with a check to accept and a cross to deny. Accepting applies at
// once: `onResult` gets the whole text to keep after every decision. No text editor is involved.

struct EditReviewView: View {
    private let review: State<EditReview>
    /// The text to keep, after every decision (and Undo).
    let onResult: (String) -> Void
    @Environment(\.theme) private var theme

    init(original: String, proposed: String, onResult: @escaping (String) -> Void) {
        review = State(initialValue: EditReview(original: original, proposed: proposed))
        self.onResult = onResult
    }

    var body: some View {
        let r = review.wrappedValue
        VStack(alignment: .leading, spacing: 10) {
            header(r)
            if r.isUnchanged {
                Text("ATOM changed nothing.").appFont(.system(size: 12.5)).foregroundStyle(theme.text2.color)
            } else {
                VStack(spacing: 0) {
                    ForEach(r.hunks) { hunk in
                        if hunk.id != r.hunks.first?.id { RowDivider(inset: 0) }
                        row(r, hunk)
                    }
                }
                .background(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous).fill(theme.fill1.color))
            }
        }
    }

    private func header(_ r: EditReview) -> some View {
        HStack(spacing: 8) {
            Text(r.isUnchanged ? "No changes" : r.isSettled ? "All \(r.hunks.count) answered" : "\(r.pending.count) of \(r.hunks.count) change\(r.hunks.count == 1 ? "" : "s") to answer")
                .appFont(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text.color)
            Spacer(minLength: 8)
            if r.canUndo {
                QuietButton(title: "Undo", symbol: "arrow.uturn.backward") { change { $0.undo() } }
            }
            if !r.isSettled {
                QuietButton(title: "Deny all", symbol: "xmark") { change { $0.denyAll() } }
                QuietButton(title: "Accept all", symbol: "checkmark") { change { $0.acceptAll() } }
                    .keyboardShortcut(.return, modifiers: .command)
            }
        }
    }

    private func row(_ r: EditReview, _ hunk: DiffHunk) -> some View {
        let c = r.context(for: hunk)
        let decision = r.decisions[hunk.id]
        return HStack(alignment: .top, spacing: 8) {
            (Text(c.before).foregroundColor(theme.text3.color)
                + Text(c.removed).foregroundColor(theme.problem.color).strikethrough()
                + Text(c.added).foregroundColor(theme.success.color)
                + Text(c.after).foregroundColor(theme.text3.color))
                .appFont(.system(size: 12.5))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
                .accessibilityLabel(Self.spoken(c))
            switch decision {
            case .accepted?: Text("Accepted").appFont(.system(size: 11)).foregroundStyle(theme.success.color)
            case .denied?: Text("Denied").appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
            case nil:
                HStack(spacing: 2) {
                    iconButton("xmark", "Deny this change") { change { $0.deny(hunk.id) } }
                    iconButton("checkmark", "Accept this change") { change { $0.accept(hunk.id) } }
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .opacity(decision == .denied ? 0.6 : 1)
        .accessibilityElement(children: .combine)
    }

    private func iconButton(_ symbol: String, _ label: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).appFont(.system(size: 11, weight: .semibold)).foregroundStyle(theme.text2.color)
                .frame(width: 26, height: 26).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(label)
        .accessibilityLabel(label)
    }

    /// Applies one decision and hands the owner the text to keep.
    private func change(_ decide: (inout EditReview) -> String?) {
        var r = review.wrappedValue
        guard let text = decide(&r) else { return }
        review.wrappedValue = r
        onResult(text)
    }

    /// For VoiceOver: "Removed …, added …".
    static func spoken(_ c: HunkContext) -> String {
        [c.removed.isEmpty ? nil : "Removed \(c.removed)", c.added.isEmpty ? nil : "added \(c.added)"].compactMap { $0 }.joined(separator: ", ")
    }
}
