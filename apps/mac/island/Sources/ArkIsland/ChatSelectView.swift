import AppKit
import SwiftUI
import ArkIslandCore

/// "Select text" (2026-11-02, Keshab: "select any amount of texts and its format (bold, italic, underlined and also tables as it
/// is)"): the open chat as one native text view, so a drag or ⌘A spans every message. SwiftUI selects within one block of text
/// only. It opens with everything selected; ⌘C copies rich text and HTML (tables stay tables); Esc or Done goes back.
struct ChatSelectView: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let style = ChatTranscript.Style(text: theme.text.hex, muted: theme.text2.hex, rule: theme.text3.hex)
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Glyph(systemName: "text.cursor").foregroundStyle(theme.text3.color)
                Text("Select text: drag or ⌘A, then ⌘C copies with formatting and tables.")
                    .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                Spacer()
                Button("Done") { model.chatSelecting = false }.keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, Spacing.conversation).padding(.vertical, 8)
            Divider()
            SelectableTranscript(html: ChatTranscript.html(model.conversation, style: style)) { model.chatSelecting = false }
        }
    }
}

extension ChatSelectView {
    /// The transcript page as attributed text (tables become text tables). Main thread: AppKit's HTML reader requires it.
    static func attributed(_ html: String) -> NSAttributedString {
        (try? NSAttributedString(data: Data(html.utf8), options: [.documentType: NSAttributedString.DocumentType.html,
                                                                 .characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil))
            ?? NSAttributedString(string: html)
    }

    /// The part of the transcript a copy writes: the selection without the screen's colours.
    static func copyable(_ selection: NSAttributedString) -> NSAttributedString {
        let part = NSMutableAttributedString(attributedString: selection)
        let whole = NSRange(location: 0, length: part.length)
        part.removeAttribute(.foregroundColor, range: whole)
        part.removeAttribute(.backgroundColor, range: whole)
        return part
    }
}

/// The text view behind Select text: read-only, selectable, rich.
private struct SelectableTranscript: NSViewRepresentable {
    let html: String
    let escape: () -> Void

    final class Coordinator { var html = "" }
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        let text = RichCopyTextView()
        text.isEditable = false
        text.isSelectable = true
        text.isRichText = true
        text.drawsBackground = false
        text.textContainerInset = NSSize(width: 24, height: 16)
        text.isVerticallyResizable = true
        text.autoresizingMask = [.width]
        text.textContainer?.widthTracksTextView = true
        scroll.documentView = text
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let text = scroll.documentView as? RichCopyTextView else { return }
        text.escape = escape
        guard context.coordinator.html != html else { return }
        context.coordinator.html = html
        text.textStorage?.setAttributedString(ChatSelectView.attributed(html))
        DispatchQueue.main.async {
            text.window?.makeFirstResponder(text)
            text.selectAll(nil)
            text.scrollToEndOfDocument(nil)
        }
    }
}

/// ⌘C writes the selection as RTF and HTML (tables stay tables) and as plain text, without the screen's text colour, so a
/// paste on a white page is readable. Esc leaves Select text.
private final class RichCopyTextView: NSTextView {
    var escape: (() -> Void)?

    override func copy(_ sender: Any?) {
        let range = selectedRange()
        guard range.length > 0, let storage = textStorage else { return }
        let part = ChatSelectView.copyable(storage.attributedSubstring(from: range))
        let whole = NSRange(location: 0, length: part.length)
        let board = NSPasteboard.general
        board.clearContents()
        if let rtf = part.rtf(from: whole, documentAttributes: [:]) { board.setData(rtf, forType: .rtf) }
        if let html = try? part.data(from: whole, documentAttributes: [.documentType: NSAttributedString.DocumentType.html]) { board.setData(html, forType: .html) }
        board.setString(part.string, forType: .string)
    }

    override func cancelOperation(_ sender: Any?) { escape?() }
}
