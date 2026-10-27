import SwiftUI
import AtomIslandCore

/// Results stay beside the originating conversation. Reads/review reuse the existing task and Git authority.
struct ChatTaskResults: View {
    let model: IslandModel
    @State private var expanded: Bool

    init(model: IslandModel, initiallyExpanded: Bool = false) {
        self.model = model
        _expanded = State(initialValue: initiallyExpanded)
    }
    @State private var selected: Int?
    @State private var confirming: GitBranch?
    @Environment(\.theme) private var theme

    private var tasks: [BoardItem] {
        guard let chat = model.chats?.current else { return [] }
        return (model.helpers.list?.everyTask ?? []).filter { $0.job.chatId == chat }.sorted { $0.id > $1.id }
    }

    var body: some View {
        if !tasks.isEmpty {
            DisclosureGroup("Tasks from this chat · \(tasks.count)", isExpanded: $expanded) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Changes stay in their task working copy until you review and commit them.")
                        Spacer()
                        Button("Refresh") { refresh() }
                    }.appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color)
                    ForEach(tasks.prefix(10)) { item in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(item.job.title ?? item.job.task).appFont(.system(size: 12.5, weight: .medium)).lineLimit(2)
                                    Text("#\(item.id) · \(item.helperName) · \(item.job.state == .done ? "Ready for review" : item.job.state.rawValue)")
                                        .appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
                                    if let step = item.job.step { Text(step).appFont(.system(size: 11.5)) }
                                    if let error = item.job.error { Text(error).appFont(.system(size: 11.5)).foregroundStyle(theme.problem.color) }
                                }
                                Spacer()
                                Button(selected == item.id ? "Close result" : "Review result") {
                                    if selected == item.id { selected = nil }
                                    else { selected = item.id; model.sendHelpers(model.helpers.openThread(item.id)); refresh() }
                                }.buttonStyle(.borderless)
                            }
                            if selected == item.id {
                                if model.helpers.thread?.id == item.id, let evidence = model.helpers.thread?.executionEvidence {
                                    TaskEvidenceSection(evidence: evidence)
                                }
                                if model.helpers.thread?.id == item.id, let report = model.helpers.thread?.report {
                                    Text("Agent report · check claims are reported, not independently certified by ATOM")
                                        .appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
                                    ReportSection(report: report)
                                }
                                if let branch = model.helpers.git?.first(where: { $0.task == item.id }) {
                                    GitBranchCard(model: model, branch: branch) { confirming = branch }
                                    if let tree = branch.worktree {
                                        HStack {
                                            Button("Copy working-copy command") {
                                                let quoted = "'" + tree.replacingOccurrences(of: "'", with: "'\\''") + "'"
                                                _ = ChatClipboard.write(MarkdownCopy.reply("cd -- " + quoted))
                                            }
                                            Button("Open Terminal") { model.selectWorkspace(.terminal) }
                                        }.appFont(.system(size: 11.5)).buttonStyle(.borderless)
                                        Text("Terminal starts in the project folder. Review and paste the copied command to work in this task's copy. Commands run only when you enter them.")
                                            .appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
                                    }
                                } else {
                                    Text("No task branch is available. This task may not use Git; its report describes the outcome.")
                                        .appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color)
                                }
                            }
                        }
                        Divider()
                    }
                    if tasks.count > 10 { Text("Showing the newest ten task results.").appFont(.system(size: 11)) }
                    if let problem = model.helpers.problem { Text(problem).foregroundStyle(theme.problem.color) }
                }.padding(.top, 10)
            }
            .appFont(.system(size: 12, weight: .medium))
            .padding(.vertical, 8)
            .task(id: tasks.map { "\($0.id):\($0.job.state.rawValue)" }.joined(separator: ",")) { refresh() }
            .alert("Push \(confirming?.branch ?? "")?", isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }), presenting: confirming) { branch in
                Button("Push") { model.sendHelpers(model.helpers.gitCommand(.gitPush(repo: branch.repo, branch: branch.branch))) }
                Button("Cancel", role: .cancel) {}
            } message: { branch in
                Text("Sends \(branch.commits.count) commits to origin (\(branch.remote ?? "")). Never forced. No merge or original-project change is performed.")
            }
        }
    }

    private func refresh() { model.sendHelpers(model.helpers.gitCommand(.gitList)) }
}
