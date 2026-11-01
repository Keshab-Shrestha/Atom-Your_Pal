import SwiftUI
import ArkIslandCore

/// A contribution calendar (EasyUI's Activity Heatmap) from actual dated commits in the currently listed local branches.
/// This is not a push log or a complete repository history; shared commits are counted once per repository.
struct GitCommitActivity: View {
    let branches: [GitBranch]
    @Environment(\.theme) private var theme

    private var dated: [GitCommit] {
        var seen = Set<String>()
        return branches.flatMap { branch in branch.commits.compactMap { commit in
            guard commit.at != nil, seen.insert(branch.repo + "#" + commit.sha).inserted else { return nil }
            return commit
        } }
    }

    var body: some View {
        let commits = dated
        if !commits.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                ActivityHeatmap(events: commits.compactMap(\.at), unit: "commits")
                Text("Local branch snapshots only; shared commits counted once per repository. Push status appears on each branch.")
                    .appFont(.system(size: 11)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
            }.padding(.vertical, 4)
        }
    }
}
