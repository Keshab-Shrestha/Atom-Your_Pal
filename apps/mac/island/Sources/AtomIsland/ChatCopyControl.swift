import AppKit
import SwiftUI
import AtomIslandCore

@MainActor
enum ChatClipboard {
    /// Prepare one complete item before replacing the clipboard; copying never reads its previous contents.
    static func write(_ content: MarkdownCopy.Content) -> Bool {
        var copied = false
        defer {
            NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested,
                                 userInfo: [.announcement: copied ? "Copied" : "Copy failed",
                                            .priority: NSAccessibilityPriorityLevel.medium.rawValue])
        }
        let item = NSPasteboardItem()
        guard item.setString(content.text, forType: .string) else { return false }
        if let html = content.html, !item.setString(html, forType: .html) { return false }
        if let tabular = content.tabular, !item.setString(tabular, forType: .tabularText) { return false }
        NSPasteboard.general.clearContents()
        copied = NSPasteboard.general.writeObjects([item])
        return copied
    }
}

/// Always in the layout: a standard focusable control for pointer, keyboard and VoiceOver users.
struct ChatCopyControl: View {
    struct Choice: Identifiable {
        let title: String
        let content: () -> MarkdownCopy.Content
        var id: String { title }
    }

    let title: String
    let choices: [Choice]
    let helpText: String

    init(title: String, content: @escaping () -> MarkdownCopy.Content) {
        self.init(title: title, choices: [Choice(title: title, content: content)])
    }

    init(title: String, choices: [Choice], helpText: String? = nil) {
        self.title = title
        self.choices = choices
        self.helpText = helpText ?? title
    }
    private let notice = State<String?>(initialValue: nil)
    private let receipt = State(initialValue: 0)
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        Group {
            if snapshot {
                label
            } else if choices.count > 1 {
                Menu {
                    ForEach(choices) { choice in
                        Button(choice.title) { copy(choice) }
                    }
                } label: {
                    label
                } primaryAction: {
                    if let first = choices.first { copy(first) }
                }
                .menuStyle(.borderlessButton)
            } else if let first = choices.first {
                Button { copy(first) } label: { label }
                    .buttonStyle(.borderless)
            }
        }
        .fixedSize()
        .accessibilityLabel(title)
        .accessibilityValue(notice.wrappedValue ?? "")
        .help(helpText)
        .task(id: receipt.wrappedValue) {
            guard notice.wrappedValue != nil else { return }
            try? await Task.sleep(for: .milliseconds(1400))
            guard !Task.isCancelled else { return }
            notice.wrappedValue = nil
        }
    }

    private var label: some View {
        Label(notice.wrappedValue ?? title, systemImage: notice.wrappedValue == "Copied" ? "checkmark" : notice.wrappedValue == "Copy failed" ? "exclamationmark.triangle" : "doc.on.doc")
            .appFont(.system(size: 11.5))
            .foregroundStyle(notice.wrappedValue == "Copy failed" ? theme.problem.color : theme.text2.color)
            .padding(.vertical, 3)
    }

    private func copy(_ choice: Choice) {
        notice.wrappedValue = ChatClipboard.write(choice.content()) ? "Copied" : "Copy failed"
        receipt.wrappedValue &+= 1
    }
}
