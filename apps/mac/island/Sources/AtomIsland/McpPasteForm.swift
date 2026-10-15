import SwiftUI
import AtomIslandCore

/// Plugins → MCP servers → Add server → Paste config (2026-10-15). The same JSON as Claude Desktop: the whole config file,
/// its `mcpServers` block, or one server. The pasted text is read at once and shown as a short list; "Add" saves each
/// server switched off, exactly as the by-hand form does, so nothing runs or is trusted by the paste.
struct McpPasteForm: View {
    let model: IslandModel
    /// The names of the servers already added.
    let existing: Set<String>
    /// Called after the servers were added.
    let done: () -> Void
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let text: State<String>
    private let notice = State<String?>(initialValue: nil)
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    /// `initialText` is for the gallery: the box starts with a pasted config.
    init(model: IslandModel, existing: Set<String>, initialText: String = "", done: @escaping () -> Void) {
        self.model = model
        self.existing = existing
        self.done = done
        self.text = State(initialValue: initialText)
    }

    private static let example = """
    {
      "mcpServers": {
        "filesystem": {
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/Documents"]
        }
      }
    }
    """

    var body: some View {
        let parsed = McpConfigImport.parse(text.wrappedValue, existing: existing)
        VStack(alignment: .leading, spacing: 10) {
            Text("Paste a server the way Claude Desktop writes it: the whole config file, its mcpServers block, or one server.")
                .font(.system(size: 12)).foregroundStyle(theme.text2.color)
            HStack(spacing: 8) {
                QuietButton(title: "Import from Claude Desktop", symbol: "square.and.arrow.down") { importFile() }
                Spacer()
            }
            if let notice = notice.wrappedValue { Text(notice).font(.system(size: 11)).foregroundStyle(theme.text3.color) }
            editor
            ForEach(parsed.entries) { entry in entryRow(entry) }
            ForEach(parsed.problems, id: \.self) { problem in ProblemLine(text: problem) }
            HStack {
                Text("Saved switched off. Test it, then turn it on for the workers you choose.")
                    .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                Spacer()
                let count = parsed.addable.count
                PillButton(title: count == 0 ? "Add" : count == 1 ? "Add 1 server" : "Add \(count) servers", symbol: "plus", prominent: true) { add(parsed) }
                    .opacity(count == 0 ? 0.45 : 1).allowsHitTesting(count > 0)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
    }

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            if snapshot {
                Text(text.wrappedValue.isEmpty ? Self.example : text.wrappedValue)
                    .foregroundStyle(text.wrappedValue.isEmpty ? theme.text3.color : theme.text.color)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            } else {
                TextEditor(text: text.projectedValue).scrollContentBackground(.hidden).frame(height: 150)
                if text.wrappedValue.isEmpty {
                    Text(Self.example).foregroundStyle(theme.text3.color).padding(.horizontal, 5).padding(.vertical, 8).allowsHitTesting(false)
                }
            }
        }
        .font(.system(size: 11.5, design: .monospaced))
        .padding(8)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous)
            .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: 1))
    }

    private func entryRow(_ entry: McpConfigImport.Entry) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: entry.exists ? "checkmark.circle" : "plus.circle").font(.system(size: 12))
                .foregroundStyle(entry.exists ? theme.text3.color : theme.success.color)
            VStack(alignment: .leading, spacing: 1) {
                Text(entry.draft.name).font(theme.idFont(.system(size: 12.5, weight: .medium), size: 12)).foregroundStyle(theme.text.color)
                Text(entry.summary).font(.system(size: 11, design: .monospaced)).foregroundStyle(theme.text2.color).lineLimit(2)
                if !entry.notes.isEmpty { Text(entry.notes.joined(separator: " · ")).font(.system(size: 10.5)).foregroundStyle(theme.text3.color) }
            }
            Spacer(minLength: 0)
        }
    }

    /// Reads Claude Desktop's config file into the box. Only on this click, and nothing is written.
    private func importFile() {
        let path = NSString(string: McpConfigImport.claudeDesktopConfigPath).expandingTildeInPath
        if let content = try? String(contentsOfFile: path, encoding: .utf8) {
            text.wrappedValue = content
            notice.wrappedValue = "Read from Claude Desktop's config. Servers that are already added are skipped."
        } else {
            notice.wrappedValue = "Claude Desktop's config was not found. In Claude Desktop open Settings → Developer → Edit Config, and paste what you want here."
        }
    }

    private func add(_ parsed: McpConfigImport) {
        for draft in parsed.addable {
            if let command = model.helpers.addMcp(draft) { model.sendHelpers(command) }
        }
        text.wrappedValue = ""
        notice.wrappedValue = nil
        model.showSaved("mcp")
        done()
    }
}
