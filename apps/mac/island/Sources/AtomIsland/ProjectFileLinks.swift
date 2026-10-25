import SwiftUI
import AtomIslandCore

struct ProjectFileLinks: View {
    let text: String
    let project: ProjectInfo?
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    private let files = State<[ProjectFileNavigation.Entry]>(initialValue: [])
    private let notice = State<String?>(initialValue: nil)

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if !files.wrappedValue.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(files.wrappedValue) { file in
                            Button {
                                guard !snapshot else { return }
                                notice.wrappedValue = ProjectFileNavigation.reveal(file, project: project)
                                    ? nil : "That file is no longer available inside this project."
                            } label: { Label(file.relative, systemImage: "doc") }
                            .help("Reveal \(file.relative) in Finder")
                            .accessibilityLabel("Reveal \(file.relative) in Finder")
                        }
                    }
                }
                .frame(height: 36).scrollIndicators(.automatic)
            }
            if let message = notice.wrappedValue { Text(message).foregroundStyle(theme.problem.color) }
        }
        .appFont(.system(size: 11.5)).buttonStyle(.borderless).foregroundStyle(theme.text2.color)
        .task(id: [text, project?.id ?? "", project?.folderPath ?? "", String(project?.missing ?? true), String(project?.archived ?? true), String(snapshot)]) {
            files.wrappedValue = []; notice.wrappedValue = nil
            guard !snapshot, let project else { return }
            let worker = Task.detached(priority: .utility) {
                var resolved: [ProjectFileNavigation.Entry] = []
                for path in ProjectFileNavigation.references(text) {
                    guard !Task.isCancelled else { break }
                    if let entry = ProjectFileNavigation.resolve(path, project: project), !resolved.contains(entry) { resolved.append(entry) }
                    if resolved.count == 8 { break }
                }
                return resolved
            }
            let result = await withTaskCancellationHandler(operation: { await worker.value }, onCancel: { worker.cancel() })
            guard !Task.isCancelled else { return }
            files.wrappedValue = result
        }
    }
}
