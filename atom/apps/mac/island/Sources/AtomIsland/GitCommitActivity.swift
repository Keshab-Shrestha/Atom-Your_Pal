import SwiftUI
import AtomIslandCore

/// A contribution-style strip from actual dated commits in the currently listed local branches.
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
        if let latest = commits.compactMap(\.at).max() {
            let calendar = Calendar.current
            let end = calendar.startOfDay(for: latest)
            let dates = (-13...0).compactMap { calendar.date(byAdding: .day, value: $0, to: end) }
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Recorded commits").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text.color)
                    Spacer(minLength: 8)
                    Text("14 days ending " + latest.formatted(date: .abbreviated, time: .omitted))
                        .appFont(.system(size: 11)).foregroundStyle(theme.text2.color)
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 5), count: 7), spacing: 5) {
                    ForEach(dates, id: \.self) { day in
                        let count = commits.filter { calendar.isDate($0.at!, inSameDayAs: day) }.count
                        RoundedRectangle(cornerRadius: 3)
                            .fill(count == 0 ? theme.fill3.color : theme.success.color.opacity(count < 2 ? 0.35 : count < 4 ? 0.65 : 1))
                            .frame(maxWidth: .infinity).frame(height: 22)
                            .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(count == 0 ? theme.text3.color.opacity(0.65) : Color.clear, lineWidth: 0.6))
                            .help("\(day.formatted(date: .abbreviated, time: .omitted)): \(count) recorded commits")
                            .accessibilityLabel("\(day.formatted(date: .abbreviated, time: .omitted)), \(count) recorded commits")
                    }
                }
                Text("Local branch snapshots only; shared commits counted once per repository. Push status appears on each branch.")
                    .appFont(.system(size: 11)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
            }.padding(.vertical, 6)
        }
    }
}
