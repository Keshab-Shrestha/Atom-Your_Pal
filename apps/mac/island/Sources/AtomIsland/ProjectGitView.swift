import SwiftUI
import AtomIslandCore

/// Raw local review only. No stage/commit/pull/push/merge/delete action is dispatched here.
struct ProjectGitView: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    private var mode: String { get { model.workspace.gitMode } nonmutating set { model.workspace.gitMode = newValue } }
    private var ignoreWhitespace: Bool { get { model.workspace.ignoreWhitespace } nonmutating set { model.workspace.ignoreWhitespace = newValue } }
    @State private var pieces: [DiffSegment]?
    private var response: WorkspaceResponse? { model.workspace.response }

    var body: some View {
        if let review = response?.gitReview { reviewPane(review) }
        else if let git = response?.gitStatus { statusPane(git) }
        else {
            Text("Refresh to read this project's Git working tree.").font(.system(size: 12)).foregroundStyle(theme.text2.color)
            Spacer()
        }
    }
    private func statusPane(_ git: WorkspaceGitStatus) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Label(git.branch, systemImage: "arrow.triangle.branch").font(.system(size: 12, weight: .semibold)).textSelection(.enabled)
            if let upstream = git.upstream {
                Text(verbatim: "\(upstream) · ahead \(git.ahead.map(String.init) ?? "?") · behind \(git.behind.map(String.init) ?? "?")")
                    .font(.system(size: 11)).foregroundStyle(theme.text2.color)
            } else { Text(git.head.isEmpty ? "No commits yet." : "No upstream configured.").font(.system(size: 11)).foregroundStyle(theme.text2.color) }
            Text("Local refs only; Refresh does not fetch. Review changes no files or Git state.")
                .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            if git.filtersDisabled {
                Text("Content filters are disabled for review. Raw bytes may differ from Git's normal filtered view.")
                    .font(.system(size: 11)).foregroundStyle(theme.text2.color)
            }
            Scrollable {
                WorkspaceRows(spacing: 8) {
                    if git.files.isEmpty { Text("No supported changes in this project folder.").font(.system(size: 12)).foregroundStyle(theme.text2.color) }
                    ForEach(["conflict", "staged", "unstaged", "untracked"], id: \.self) { section in
                        let files = git.files.filter { $0.section == section }
                        if !files.isEmpty {
                            Text(section == "conflict" ? "Conflicts" : section.capitalized).font(.system(size: 11, weight: .semibold)).padding(.top, 5)
                            ForEach(files) { file in
                                Button {
                                    mode = "changes"; pieces = nil
                                    model.requestWorkspace(.gitReview, path: file.path, section: file.section)
                                } label: {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(verbatim: file.path).font(.system(size: 12)).lineLimit(2)
                                        if let original = file.original { Text(verbatim: "From \(original)").font(.system(size: 10.5)).foregroundStyle(theme.text2.color) }
                                        Text(verbatim: file.status).font(.system(size: 10, design: .monospaced)).foregroundStyle(theme.text3.color)
                                    }.frame(maxWidth: .infinity, alignment: .leading).padding(9)
                                        .background(theme.fill2.color.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
                                }.buttonStyle(.plain).accessibilityLabel("Review \(file.section) \(file.path)")
                            }
                        }
                    }
                }
            }
            if git.limited { Text("Showing at most 200 file entries / 128 KiB. Open a smaller project folder for more.").font(.system(size: 10.5)).foregroundStyle(theme.text2.color) }
            Button("Open task branch review") { model.openWorkspaceBranches() }.font(.system(size: 11)).buttonStyle(SnapshotBorderlessButtonStyle())
        }
    }
    private func reviewPane(_ review: WorkspaceGitReview) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Button { model.requestWorkspace(.git) } label: { Label("Back to Git", systemImage: "chevron.left") }
                .buttonStyle(SnapshotBorderlessButtonStyle())
            Text(verbatim: review.path).font(.system(size: 12, weight: .medium, design: .monospaced)).textSelection(.enabled)
            Text(verbatim: "\(review.section.capitalized) · \(review.beforeLabel) → \(review.afterLabel)").font(.system(size: 11)).foregroundStyle(theme.text2.color)
            Text(verbatim: review.note).font(.system(size: 10.5)).foregroundStyle(theme.text2.color)
            if snapshot { Text("Changes   Before   After" + (review.base == nil ? "" : "   Base")).font(.system(size: 11)) }
            else {
                Picker("Git file view", selection: Binding(get: { mode }, set: { mode = $0 })) {
                    Text("Changes").tag("changes"); Text("Before").tag("before"); Text("After").tag("after")
                    if review.base != nil { Text("Base").tag("base") }
                }.pickerStyle(.segmented)
            }
            if mode == "changes" {
                if snapshot { Text("Ignore whitespace: off").font(.system(size: 11)) }
                else { Toggle("Ignore whitespace", isOn: Binding(get: { ignoreWhitespace }, set: { ignoreWhitespace = $0 })).toggleStyle(.checkbox).font(.system(size: 11)) }
                Text(ignoreWhitespace ? "Comparison normalizes spaces/indentation. Before/After show exact source." : "Removed text is crossed out; added text is green.")
                    .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                WorkspaceTextScroll {
                    Group {
                        if snapshot { InlineDiffText(pieces: InlineDiff.segments(old: review.before, new: review.after)) }
                        else if let pieces {
                            if pieces.allSatisfy({ $0.kind == .same }) { Text(ignoreWhitespace ? "No differences after whitespace normalization." : "No text differences.").font(.system(size: 12)) }
                            else { InlineDiffText(pieces: pieces) }
                        } else { ProgressView("Comparing file…") }
                    }.padding(10).frame(maxWidth: .infinity, alignment: .topLeading)
                }.background(theme.fill2.color.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
            } else {
                let text = mode == "before" ? review.before : mode == "base" ? (review.base ?? "") : review.after
                Text(mode == "before" ? review.beforeLabel : mode == "base" ? "Common base" : review.afterLabel).font(.system(size: 11)).foregroundStyle(theme.text2.color)
                WorkspaceTextScroll {
                    Text(verbatim: text.isEmpty ? "(Empty or absent file)" : text).font(.system(size: 11.5, design: .monospaced))
                        .textSelection(.enabled).fixedSize(horizontal: true, vertical: true).padding(10)
                }.background(theme.fill2.color.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
            }
            HStack(spacing: 12) {
                Button("Attach working file") { model.addWorkspaceFile(review.path) }
                Button("Reveal in Finder") { model.openWorkspaceFile(review.path, finder: true) }
            }.buttonStyle(SnapshotBorderlessButtonStyle()).font(.system(size: 11))
        }
        .task(id: "\(response?.request ?? ""):\(ignoreWhitespace)") {
            pieces = nil
            let ignore = ignoreWhitespace
            let result = await Task.detached(priority: .userInitiated) {
                InlineDiff.segments(old: WorkspaceGitText.comparing(review.before, ignoreWhitespace: ignore), new: WorkspaceGitText.comparing(review.after, ignoreWhitespace: ignore))
            }.value
            if !Task.isCancelled { pieces = result }
        }
    }
}
