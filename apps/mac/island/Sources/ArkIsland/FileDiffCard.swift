import SwiftUI
import ArkIslandCore

// ADR-275 (design reference: Ghostex, MIT; redrawn in ARK's tokens): a file change as a card. A header with a pencil tile, the
// file count and "+N −M" with five mini squares; then one section per file (chevron, name in bold, folder dim) with
// its hunks: a tinted "@@" line, then the lines with old and new numbers, added lines green and removed lines red, the changed
// characters of a paired line in a stronger tint and hidden characters as marks. Plain text, never Markdown or code that runs. "Reveal in Finder" is ARK's file action (ProjectFileNavigation): it never opens the file.

struct FileDiffCard: View {
    struct File: Identifiable {
        let path: String
        let diff: UnifiedDiff
        var id: String { path }
    }

    let files: [File]
    /// "1 file to change" while the change waits for the owner.
    var pending = true
    @State private var closed: Set<String> = []
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            header
            ForEach(files) { file in
                RowDivider(inset: 0)
                section(file)
            }
        }
        .background(shape.fill(theme.fill1.color))
        .overlay(shape.strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
        .clipShape(shape)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("File changes")
    }

    private var header: some View {
        let added = files.reduce(0) { $0 + $1.diff.added }, removed = files.reduce(0) { $0 + $1.diff.removed }
        let count = files.count == 1 ? "1 file" : "\(files.count) files"
        return HStack(spacing: 8) {
            Glyph(systemName: "pencil").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text2.color)
                .frame(width: 26, height: 26)
                .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(theme.fill2.color))
                .accessibilityHidden(true)
            // The path shows once, in the file's own row below.
            Text(pending ? "\(count) to change" : "Edited \(count)").appFont(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.text.color)
            Spacer(minLength: 8)
            counts(added: added, removed: removed)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private func counts(added: Int, removed: Int) -> some View {
        let squares = UnifiedDiff.squares(added: added, removed: removed)
        return HStack(spacing: 6) {
            Text("+\(added)").foregroundStyle(theme.success.color)
            Text("−\(removed)").foregroundStyle(theme.problem.color)
            HStack(spacing: 1.5) {
                ForEach(0..<5, id: \.self) { i in
                    Rectangle()
                        .fill(i < squares.added ? theme.success.color : i < squares.added + squares.removed ? theme.problem.color : theme.fill3.color)
                        .frame(width: 6, height: 6)
                }
            }
        }
        .appFont(.system(size: 11, weight: .medium, design: .monospaced)).monospacedDigit()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(added) lines added, \(removed) removed")
    }

    private func section(_ file: File) -> some View {
        let open = !closed.contains(file.id)
        let parts = UnifiedDiff.split(path: file.path)
        return VStack(alignment: .leading, spacing: 0) {
            Button { if open { closed.insert(file.id) } else { closed.remove(file.id) } } label: {
                HStack(spacing: 8) {
                    Glyph(systemName: "chevron.right").appFont(.system(size: 9, weight: .semibold)).foregroundStyle(theme.text3.color)
                        .rotationEffect(.degrees(open ? 90 : 0))
                    Text(verbatim: parts.name).appFont(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text.color)
                    Text(verbatim: parts.folder).appFont(.system(size: 11)).foregroundStyle(theme.text3.color).lineLimit(1).truncationMode(.head)
                    Spacer(minLength: 8)
                    // One file: the header's counts are this file's; show them once.
                    if files.count > 1 { counts(added: file.diff.added, removed: file.diff.removed) }
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(parts.name) in \(parts.folder)")
            .accessibilityValue(open ? "Expanded" : "Collapsed")
            if open {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(file.diff.hunks) { hunk in
                        Text(verbatim: hunk.header).appFont(.system(size: 11, design: .monospaced)).foregroundStyle(theme.text2.color)
                            .padding(.horizontal, 12).padding(.vertical, 4)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(theme.accent.color.opacity(0.08))
                        ForEach(hunk.lines) { line in row(line) }
                    }
                }
                .textSelection(.enabled)
                Button { reveal(file.path) } label: {
                    Label("Reveal in Finder", systemImage: "arrow.up.forward.square").labelStyle(.titleAndIcon)
                        .appFont(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.accent.color)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .help("Show \(parts.name) in Finder. ARK does not open the file.")
            }
        }
    }

    private func row(_ line: UnifiedDiff.Line) -> some View {
        let (sign, tint): (String, Color?) = switch line.kind {
        case .added: ("+", theme.success.color)
        case .removed: ("−", theme.problem.color)
        case .context, .note: (" ", nil)
        }
        return HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(line.old.map(String.init) ?? "").frame(width: 34, alignment: .trailing)
            Text(line.new.map(String.init) ?? "").frame(width: 34, alignment: .trailing)
            Text(sign).frame(width: 18).foregroundStyle(tint ?? theme.text3.color)
            Group {
                if line.kind == .note { Text(verbatim: line.text).italic().foregroundStyle(theme.text3.color) }
                else { Text(styled(line, tint: tint)).foregroundStyle(theme.text.color) }
            }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .appFont(.system(size: 11, design: .monospaced)).foregroundStyle(theme.text3.color)
        .padding(.vertical, 1).padding(.trailing, 12)
        .background(tint.map { $0.opacity(theme.isDark ? 0.16 : 0.10) } ?? .clear)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(line.kind == .note ? line.text
            : "\(line.kind == .added ? "Added" : line.kind == .removed ? "Removed" : "Line") \(line.new ?? line.old ?? 0): \(UnifiedDiff.segments(line.text, changed: nil).map(\.text).joined())")
    }

    /// The changed characters get a stronger tint; a hidden character shows as a dim mark (`UnifiedDiff.segments`).
    private func styled(_ line: UnifiedDiff.Line, tint: Color?) -> AttributedString {
        var out = AttributedString()
        for segment in UnifiedDiff.segments(line.text, changed: line.changed) {
            var piece = AttributedString(segment.text)
            if segment.changed, let tint { piece.backgroundColor = tint.opacity(theme.isDark ? 0.42 : 0.30) }
            if segment.mark { piece.foregroundColor = theme.attention.color }
            out += piece
        }
        return out.characters.isEmpty ? AttributedString(" ") : out
    }

    private func reveal(_ path: String) {
        guard !snapshot else { return }
        let url = URL(fileURLWithPath: path)
        // A new file is not there yet: show its folder.
        NSWorkspace.shared.activateFileViewerSelecting([FileManager.default.fileExists(atPath: path) ? url : url.deletingLastPathComponent()])
    }
}
