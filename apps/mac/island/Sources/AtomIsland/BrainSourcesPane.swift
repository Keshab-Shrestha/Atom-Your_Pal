import AppKit
import SwiftUI
import AtomIslandCore

struct BrainSourcesPane: View {
    let model: IslandModel
    var openNote: (Int) -> Void = { _ in }
    private let removing = State(initialValue: false)
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    private var waiting: Bool { model.brainSourcePending != nil }

    var body: some View {
        Scrollable {
            VStack(alignment: .leading, spacing: 14) {
                Text("Notes folder").appFont(.system(size: 17, weight: .semibold)).foregroundStyle(theme.text.color)
                Text("Connect one folder of Markdown, text, PDF and Word (.docx) documents. Copies join your existing Second brain, search and links. Source files stay untouched. Imported text is reference material; it cannot grant permissions.")
                    .appFont(.system(size: 12.5)).foregroundStyle(theme.text2.color)
                if let problem = model.brainSourceError { ProblemLine(text: problem) }
                if waiting { HStack { ProgressView().controlSize(.small); Text("Updating notes source…").appFont(.system(size: 12)) } }
                if let folder = model.brainSources.folder {
                    if folder.documents != true {
                        Text("This existing source keeps its Markdown/text scope. To include PDF and Word files, remove and preview the folder again; preserve any local corrections first.")
                            .appFont(.system(size: 11)).foregroundStyle(theme.text2.color)
                    }
                    Text(folder.path).appFont(.system(size: 12, design: .monospaced)).textSelection(.enabled)
                    Text("\(model.brainSources.notes) imported · \(model.brainSources.corrected) locally corrected · \(model.brainSources.conflicts) conflicts · \(model.brainSources.missing) missing or skipped · \(model.brainSources.excluded) excluded")
                        .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                    Text("Last checked: \(folder.checkedAt) · \(folder.skipped) entries skipped")
                        .appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
                    Text("Refresh reads new and edited files. Local corrections are preserved. Missing or skipped files leave a labeled last copy. Deleting an imported note excludes it from future refreshes until this source is removed and connected again.")
                        .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                    HStack(spacing: 8) {
                        PillButton(title: "Refresh", symbol: "arrow.clockwise") { model.requestBrainSource("refresh") }
                        PillButton(title: "Reload status") { model.requestBrainSource("get") }
                        PillButton(title: "Remove source…", symbol: "trash") { removing.wrappedValue = true }
                    }.disabled(waiting)
                    SourceAnalysisSection(model: model, openNote: openNote)
                } else if let preview = model.brainSourcePreview {
                    Text(preview.path).appFont(.system(size: 12, design: .monospaced)).textSelection(.enabled)
                    Text("\(preview.count) notes ready to import · \(preview.skipped) entries skipped")
                        .appFont(.system(size: 12, weight: .medium))
                    ForEach(preview.files, id: \.self) { file in Text(file).appFont(.system(size: 11.5, design: .monospaced)).foregroundStyle(theme.text2.color) }
                    if preview.count > preview.files.count { Text("And \(preview.count - preview.files.count) more notes.").appFont(.system(size: 11)) }
                    Text("Import stores copies locally and permits future manual refreshes of this folder. Note snippets may go to your selected model when you use them in chat. Connecting does not grant file editing or upload the folder automatically.")
                        .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
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
                Text("Reads Markdown, text, PDF text layers and Word (.docx); no OCR or legacy .doc. Skips protected, linked, hidden, invalid or likely credential-bearing files. Text/extracted copies: 256 KiB each, 8 MiB total. Documents: 8 MiB each; PDFs: 100 pages. Local extraction is bounded; images, encrypted PDFs and unreadable files are skipped. Source files stay untouched. Import makes no model call.")
                    .appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.panel)
        }
        .onAppear { if !snapshot { model.requestBrainSource("get") } }
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
