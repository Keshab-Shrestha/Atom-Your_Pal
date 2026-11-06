import SwiftUI
import ArkIslandCore

/// Complete local review. Content is plain text, never Markdown, a web view, or executable code.
struct FileEditReviewCard: View {
    let model: IslandModel
    let request: ApprovalRequest
    let review: FileEditReview
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    @State private var mode = "changes"
    @State private var diff: UnifiedDiff?

    private var current: Bool {
        model.approval.pending?.id == request.id && model.approval.pending?.fileReview?.token == review.token
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Review file change")
                .appFont(.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.text.color)
            Text("Only this file will be replaced. ARK must keep an undo copy before applying.")
                .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
            Picker("File review", selection: $mode) {
                Text("Changes").tag("changes")
                Text("Before").tag("before")
                Text("After").tag("after")
            }
            .pickerStyle(.segmented)
            // ADR-275: the changes as the diff card; Before and After stay whole texts with the path above them.
            if mode == "changes" {
                ArkScrollView(.vertical) {
                    if let diff = diff ?? (snapshot ? UnifiedDiff.make(old: review.before, new: review.after) : nil) {
                        FileDiffCard(files: [.init(path: review.path, diff: diff)])
                    }
                    else { ProgressView("Preparing changes…").padding(12) }
                }
                .frame(height: 360)
            } else {
                Text(verbatim: review.path)
                    .appFont(.system(size: 12, design: .monospaced))
                    .foregroundStyle(theme.text2.color)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                ArkScrollView([.horizontal, .vertical]) {
                    Text(verbatim: mode == "before" ? review.before : review.after)
                        .appFont(.system(size: 12, design: .monospaced))
                        .foregroundStyle(theme.text.color)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: true, vertical: true)
                        .accessibilityLabel(mode == "before" ? "Full original text" : "Full proposed text")
                        .accessibilityValue(mode == "before" ? review.before : review.after)
                        .frame(minWidth: 260, alignment: .topLeading)
                        .padding(12)
                }
                .frame(height: 320)
                .background(theme.fill2.color.opacity(0.6), in: RoundedRectangle(cornerRadius: Radius.card))
                .accessibilityElement(children: .contain)
                .accessibilityLabel("File change review")
            }
            HStack {
                QuietButton(title: "Decline", symbol: "xmark") {
                    model.answerFileReview(id: request.id, token: review.token, approved: false)
                }
                Spacer()
                QuietButton(title: "Apply change", symbol: "checkmark") {
                    model.answerFileReview(id: request.id, token: review.token, approved: true)
                }
                .disabled(diff == nil || !current)
            }
        }
        .padding(16)
        .background(theme.fill1.color, in: RoundedRectangle(cornerRadius: Radius.card))
        .task(id: request.id) {
            let before = review.before, after = review.after
            let result = await Task.detached(priority: .userInitiated) { UnifiedDiff.make(old: before, new: after) }.value
            if !Task.isCancelled, current { diff = result }
        }
    }
}
