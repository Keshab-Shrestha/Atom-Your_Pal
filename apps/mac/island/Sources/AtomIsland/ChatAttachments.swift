import AppKit
import SwiftUI
import QuickLook
import QuickLookThumbnailing
import AtomIslandCore

/// ADR-148: file previews belong to the unsent composer, never to provider delivery or file permissions.
struct AttachedFilesRow: View {
    let files: [DraftFile]
    var notes: [DraftNote] = []
    let notice: String?
    let remove: (String) -> Void
    var removeNote: (Int) -> Void = { _ in }
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    private let preview = State<URL?>(initialValue: nil)
    private let previewNotice = State<String?>(initialValue: nil)

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if !files.isEmpty || !notes.isEmpty {
                if snapshot {
                    chips // Gallery rendering neither reads attachment bytes nor invokes Quick Look.
                } else {
                    ScrollView(.horizontal) { chips }
                        // Reserve room for users who keep macOS scroll bars permanently visible.
                        .frame(height: files.isEmpty ? 42 : 60)
                        .scrollIndicators(.automatic)
                }
            }
            if let notice { message(notice) }
            if let error = previewNotice.wrappedValue { message(error) }
        }
        .padding(.top, 2)
        .quickLookPreview(preview.projectedValue)
        .onChange(of: files.map(\.path)) { _, paths in
            previewNotice.wrappedValue = nil
            if let url = preview.wrappedValue, !paths.contains(url.path) { preview.wrappedValue = nil }
        }
        .onDisappear { preview.wrappedValue = nil }
    }

    private var chips: some View {
        HStack(spacing: 6) {
            ForEach(files) { file in
                HStack(spacing: 4) {
                    Button { show(file) } label: {
                        HStack(spacing: 6) {
                            if snapshot {
                                Image(systemName: "doc").frame(width: 32, height: 32)
                            } else {
                                AttachmentThumbnail(path: file.path)
                                    .frame(width: 32, height: 32)
                                    .allowsHitTesting(false)
                                    .accessibilityHidden(true)
                            }
                            Text(file.name).lineLimit(1).truncationMode(.middle).frame(maxWidth: 160)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Preview \(file.name)")
                    .accessibilityHint("Open this attachment in Quick Look")
                    .help("Preview \(file.path)")
                    removeButton(file.name) { remove(file.path) }
                }
                .padding(.horizontal, 8).frame(height: 42)
                .background(RoundedRectangle(cornerRadius: theme.radiusControl).fill(theme.fill2.color))
            }
            // Notes are host-resolved ids, not local files; retain their existing remove-only chips.
            ForEach(notes) { note in
                HStack(spacing: 4) {
                    Image(systemName: "brain").appFont(.system(size: 10))
                    Text(note.title).lineLimit(1).truncationMode(.middle).frame(maxWidth: 160)
                    removeButton(note.title) { removeNote(note.id) }
                }
                .padding(.horizontal, 8).frame(height: 24)
                .background(Capsule().fill(theme.fill2.color))
            }
        }
        .appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color)
    }

    private func message(_ text: String) -> some View {
        Text(text).appFont(.system(size: 11)).foregroundStyle(theme.problem.color)
    }

    private func removeButton(_ name: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: "xmark").appFont(.system(size: 8, weight: .bold))
                .frame(width: 18, height: 24).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Remove \(name)")
        .help("Remove \(name) from this message")
    }

    private func show(_ file: DraftFile) {
        guard !snapshot else { return }
        let url = URL(fileURLWithPath: file.path)
        guard AttachmentThumbnail.readableFile(url) else {
            preview.wrappedValue = nil
            previewNotice.wrappedValue = "Cannot preview \(file.name). The file is missing or unreadable; reattach it or remove it."
            return
        }
        previewNotice.wrappedValue = nil
        preview.wrappedValue = url
    }
}

/// Quick Look generates a small image asynchronously; stale completions cannot update reused/removed chips.
private struct AttachmentThumbnail: NSViewRepresentable {
    let path: String

    static func readableFile(_ url: URL) -> Bool {
        guard let values = try? url.resourceValues(forKeys: [.isRegularFileKey]), values.isRegularFile == true else { return false }
        return FileManager.default.isReadableFile(atPath: url.path)
    }

    func makeNSView(context: Context) -> Thumbnail {
        let view = Thumbnail(frame: .zero)
        view.imageScaling = .scaleProportionallyUpOrDown
        return view
    }

    func updateNSView(_ view: Thumbnail, context: Context) { view.load(path) }
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: Thumbnail, context: Context) -> CGSize? {
        CGSize(width: 32, height: 32) // A large file icon must not dictate the composer's layout.
    }
    static func dismantleNSView(_ view: Thumbnail, coordinator: ()) { view.cancel() }

    final class Thumbnail: NSImageView {
        private var path: String?
        private var request: QLThumbnailGenerator.Request?
        private var generation = UUID()

        func load(_ path: String) {
            guard self.path != path else { return }
            cancel()
            self.path = path
            let url = URL(fileURLWithPath: path)
            guard AttachmentThumbnail.readableFile(url) else {
                image = NSImage(systemSymbolName: "exclamationmark.triangle", accessibilityDescription: nil)
                toolTip = "File missing or unreadable"
                return
            }
            image = NSWorkspace.shared.icon(forFile: path)
            toolTip = "Click to preview"
            let request = QLThumbnailGenerator.Request(fileAt: url, size: CGSize(width: 32, height: 32),
                                                      scale: window?.backingScaleFactor ?? 2, representationTypes: .all)
            self.request = request
            let current = generation
            QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { [weak self] result, _ in
                // CGImage crosses the queue boundary; AppKit image/view changes stay on the main queue.
                let image = result?.cgImage
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.generation == current else { return }
                    self.request = nil
                    if let image {
                        self.image = NSImage(cgImage: image, size: .zero)
                    } else {
                        self.toolTip = "Thumbnail unavailable; click to preview"
                    }
                }
            }
        }

        func cancel() {
            generation = UUID()
            if let request { QLThumbnailGenerator.shared.cancel(request) }
            request = nil
            path = nil
        }
    }
}
