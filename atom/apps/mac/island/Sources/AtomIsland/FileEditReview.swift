import SwiftUI
import AtomIslandCore

/// Complete local review. Content is plain text, never Markdown, a web view, or executable code.
struct FileEditReviewCard: View {
    let model: IslandModel
    let request: ApprovalRequest
    let review: FileEditReview
    @Environment(\.theme) private var theme
    @State private var mode = "changes"
    @State private var pieces: [DiffSegment]?

    private var current: Bool {
        model.approval.pending?.id == request.id && model.approval.pending?.fileReview?.token == review.token
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Review file change")
                .appFont(.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.text.color)
            Text(verbatim: review.path)
                .appFont(.system(size: 12, design: .monospaced))
                .foregroundStyle(theme.text2.color)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            Text("Only this file will be replaced. ATOM must keep an undo copy before applying.")
                .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
            Picker("File review", selection: $mode) {
                Text("Changes").tag("changes")
                Text("Before").tag("before")
                Text("After").tag("after")
            }
            .pickerStyle(.segmented)
            if mode == "changes" {
                Text("Removed text is crossed out. Added text is green.")
                    .appFont(.system(size: 11)).foregroundStyle(theme.text2.color)
            }
            AtomScrollView([.horizontal, .vertical]) {
                Group {
                    if mode == "changes" {
                        if let pieces { InlineDiffText(pieces: pieces) }
                        else { ProgressView("Preparing changes…") }
                    } else {
                        Text(verbatim: mode == "before" ? review.before : review.after)
                            .appFont(.system(size: 12, design: .monospaced))
                            .foregroundStyle(theme.text.color)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: true, vertical: true)
                            .accessibilityLabel(mode == "before" ? "Full original text" : "Full proposed text")
                            .accessibilityValue(mode == "before" ? review.before : review.after)
                    }
                }
                .frame(minWidth: 260, alignment: .topLeading)
                .padding(12)
            }
            .frame(height: 320)
            .background(theme.fill2.color.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
            .accessibilityElement(children: .contain)
            .accessibilityLabel("File change review")
            HStack {
                QuietButton(title: "Decline", symbol: "xmark") {
                    model.answerFileReview(id: request.id, token: review.token, approved: false)
                }
                Spacer()
                QuietButton(title: "Apply change", symbol: "checkmark") {
                    model.answerFileReview(id: request.id, token: review.token, approved: true)
                }
                .disabled(pieces == nil || !current)
            }
        }
        .padding(16)
        .background(theme.fill1.color, in: RoundedRectangle(cornerRadius: 12))
        .task(id: request.id) {
            let before = review.before, after = review.after
            let result = await Task.detached(priority: .userInitiated) { InlineDiff.segments(old: before, new: after) }.value
            if !Task.isCancelled, current { pieces = result }
        }
    }
}
