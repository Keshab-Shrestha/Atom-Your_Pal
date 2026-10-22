import AppKit
import SwiftUI
import AtomIslandCore

struct BrainSourcesPane: View {
    let model: IslandModel
    var openNote: (Int) -> Void = { _ in }
    private let removing = State(initialValue: false)
    @Environment(\.theme) private var theme
    private var waiting: Bool { model.brainSourcePending != nil }

    var body: some View {
        Scrollable {
            VStack(alignment: .leading, spacing: 14) {
                Text("Notes folder").font(.system(size: 17, weight: .semibold)).foregroundStyle(theme.text.color)
                Text("Connect one folder of Markdown and text notes. Copies join your existing Second brain, search and links. Source files stay untouched. Imported text is reference material; it cannot grant permissions.")
                    .font(.system(size: 12.5)).foregroundStyle(theme.text2.color)
                if let problem = model.brainSourceError { ProblemLine(text: problem) }
                if waiting { HStack { ProgressView().controlSize(.small); Text("Updating notes source…").font(.system(size: 12)) } }
                if let folder = model.brainSources.folder {
                    Text(folder.path).font(.system(size: 12, design: .monospaced)).textSelection(.enabled)
                    Text("\(model.brainSources.notes) imported · \(model.brainSources.corrected) locally corrected · \(model.brainSources.conflicts) conflicts · \(model.brainSources.missing) missing or skipped · \(model.brainSources.excluded) excluded")
                        .font(.system(size: 12)).foregroundStyle(theme.text2.color)
                    Text("Last checked: \(folder.checkedAt) · \(folder.skipped) entries skipped")
                        .font(.system(size: 11)).foregroundStyle(theme.text3.color)
                    Text("Refresh reads new and edited files. Local corrections are preserved. Missing or skipped files leave a labeled last copy. Deleting an imported note excludes it from future refreshes until this source is removed and connected again.")
                        .font(.system(size: 12)).foregroundStyle(theme.text2.color)
                    HStack(spacing: 8) {
                        PillButton(title: "Refresh", symbol: "arrow.clockwise") { model.requestBrainSource("refresh") }
                        PillButton(title: "Reload status") { model.requestBrainSource("get") }
                        PillButton(title: "Remove source…", symbol: "trash") { removing.wrappedValue = true }
                    }.disabled(waiting)
                    SourceAnalysisSection(model: model, openNote: openNote)
                } else if let preview = model.brainSourcePreview {
                    Text(preview.path).font(.system(size: 12, design: .monospaced)).textSelection(.enabled)
                    Text("\(preview.count) notes ready to import · \(preview.skipped) entries skipped")
                        .font(.system(size: 12, weight: .medium))
                    ForEach(preview.files, id: \.self) { file in Text(file).font(.system(size: 11.5, design: .monospaced)).foregroundStyle(theme.text2.color) }
                    if preview.count > preview.files.count { Text("And \(preview.count - preview.files.count) more notes.").font(.system(size: 11)) }
                    Text("Import stores copies locally and permits future manual refreshes of this folder. Note snippets may go to your selected model when you use them in chat. Connecting does not grant file editing or upload the folder automatically.")
                        .font(.system(size: 12)).foregroundStyle(theme.text2.color)
                    HStack(spacing: 8) {
                        PillButton(title: "Import notes", prominent: true) { model.requestBrainSource("connect", token: preview.token) }
                            .disabled(waiting || preview.count == 0)
                        PillButton(title: "Cancel") { model.requestBrainSource("cancel") }
                            .disabled(waiting)
                    }
                } else {
                    PillButton(title: "Choose notes folder…", symbol: "folder.badge.plus", prominent: true, action: choose)
                        .disabled(waiting)
                }
                Text("Import/refresh reads UTF-8 .md, .markdown and .txt. Skips hidden files, symlinks, hardlinks, protected paths, likely credentials, invalid text and files over 256 KiB. Scan budget: 500 notes, 8 MiB, 5,000 entries and eight folder levels. Import makes no model call or source-file changes. Optional analysis uses imported copies only.")
                    .font(.system(size: 11)).foregroundStyle(theme.text3.color)
            }
            .frame(maxWidth: 720, alignment: .leading)
            .padding(Spacing.panel)
        }
        .onAppear { model.requestBrainSource("get") }
        .confirmationDialog("Remove this source and all its imported copies, including saved local corrections? Original files are untouched. Other notes, chats and permissions stay unchanged.", isPresented: removing.projectedValue) {
            Button("Remove source and imported copies", role: .destructive) { model.requestBrainSource("disconnect") }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func choose() {
        let picker = NSOpenPanel()
        picker.canChooseDirectories = true; picker.canChooseFiles = false; picker.allowsMultipleSelection = false
        picker.prompt = "Preview notes"
        picker.message = "Choose an ordinary notes folder. ATOM previews supported files locally before you connect it."
        guard picker.runModal() == .OK, let url = picker.url else { return }
        model.requestBrainSource("preview", path: url.path)
    }
}
