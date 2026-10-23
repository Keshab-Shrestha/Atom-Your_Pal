import AppKit
import SwiftUI
import AtomIslandCore

// Quick actions (upgrades.md C4/U4): the shortcut reads the selected text of the app in front (Accessibility, or ⌘C with the
// clipboard put back, or the clipboard), and a small panel near the pointer offers what to do. Nothing is read before the
// shortcut is pressed. The text goes to the model only for the action the user picks. A password field is never read.

/// Reads the selection of the app that was in front when the shortcut was pressed.
@MainActor
private struct AppSelectionReader: SelectionReader {
    let inserter: TextInserter
    let app: NSRunningApplication?

    func focusIsSecure() async -> Bool { inserter.focusIsSecure(of: app) }
    func accessibilitySelection() async -> String? { inserter.selectedText(of: app) }
    func copiedSelection() async -> String? { await inserter.copySelection() }
    func clipboardText() async -> String? { NSPasteboard.general.string(forType: .string) }
}

@MainActor
final class QuickActionController: NSObject, NSWindowDelegate {
    private let model: IslandModel
    private let inserter = TextInserter()
    private var panel: NSPanel?
    private var replySession: ReplyDraftSession?

    init(model: IslandModel) {
        self.model = model
    }

    /// The shortcut was pressed.
    func begin() {
        if panel?.isVisible == true { close(); return }
        let target = inserter.currentTarget() // before ATOM's panel takes the focus
        Task { @MainActor in
            let found = await SelectionCapture.capture(using: AppSelectionReader(inserter: inserter, app: target.app))
            show(found, target: target)
        }
    }

    private func show(_ found: CaptureResult, target: TextInserter.Target) {
        close()
        let view = QuickActionView(model: model, found: found, targetName: target.name,
                                   replace: { [weak self] text in await self?.replace(text, in: target) ?? "" },
                                   draft: { [weak self] text in self?.showReply(text, target: target) },
                                   close: { [weak self] in self?.close() })
            .themed(model.settings.theme.palette)
        present(view, width: 440)
    }

    private func showReply(_ text: QuickText, target: TextInserter.Target) {
        close()
        let session = ReplyDraftSession(model: model, conversation: text.text)
        replySession = session
        present(ReplyDraftPane(session: session, source: text, close: { [weak self] in self?.close() },
                               insertTarget: target.name, insertRunning: { target.app.map { !$0.isTerminated } ?? false },
                               insert: { [weak self] draft in await self?.insertDraft(draft, in: target) ?? "" })
            .themed(model.settings.theme.palette), width: 560, height: 580)
    }

    private func present<Content: View>(_ view: Content, width: CGFloat, height: CGFloat? = nil) {
        let hosting = NSHostingView(rootView: view)
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: width, height: height ?? 300),
                            styleMask: [.titled, .closable, .fullSizeContentView, .utilityWindow], backing: .buffered, defer: false)
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.delegate = self
        let palette = model.settings.theme.palette
        panel.appearance = NSAppearance(named: palette.isDark ? .darkAqua : .aqua)
        panel.backgroundColor = palette.surfaceSolid.nsColor
        panel.contentView = hosting
        let size = NSSize(width: width, height: height ?? min(560, max(220, hosting.fittingSize.height)))
        panel.setContentSize(size)
        // Near the pointer, kept inside the screen.
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
        var origin = NSPoint(x: mouse.x - size.width / 2, y: mouse.y - size.height - 12)
        if let frame = screen?.visibleFrame {
            origin.x = min(max(origin.x, frame.minX + 8), frame.maxX - size.width - 8)
            origin.y = min(max(origin.y, frame.minY + 8), frame.maxY - size.height - 8)
        }
        panel.setFrameOrigin(origin)
        self.panel = panel
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func close() {
        replySession?.close()
        replySession = nil
        panel?.close()
        panel = nil
    }

    func windowWillClose(_ notification: Notification) {
        guard let window = notification.object as? NSWindow, window === panel else { return }
        replySession?.close(); replySession = nil; panel = nil
    }

    /// Validate the focused destination after activation; cancellation/Close cannot write after either awaited stage.
    private func insertDraft(_ text: String, in target: TextInserter.Target) async -> String {
        await inserter.insertReviewed(text, into: target)
    }

    /// Puts the text in place of the selection in the app it came from. Returns a word for the user when it could not.
    private func replace(_ text: String, in target: TextInserter.Target) async -> String {
        switch await inserter.insert(text, into: target) {
        case .typed: close(); return ""
        case .copied(let reason): return "\(reason). The text is on the clipboard."
        }
    }
}

/// The picker and what follows it: the actions, the wait, the changes to accept or the answer to read.
struct QuickActionView: View {
    let model: IslandModel
    let found: CaptureResult
    let targetName: String
    /// Puts text in place of the selection; returns a message when it could not.
    let replace: (String) async -> String
    let draft: (QuickText) -> Void
    let close: () -> Void

    private enum Phase {
        case choosing
        case asking
        case running(id: String, action: QuickAction, text: QuickText)
        case review(original: String, proposed: String)
        case card(String)
        case message(String)
    }

    private let phase = State(initialValue: Phase.choosing)
    private let instruction = State(initialValue: "")
    private let current = State(initialValue: "")
    private let note = State(initialValue: "")
    @Environment(\.theme) private var theme

    init(model: IslandModel, found: CaptureResult, targetName: String, replace: @escaping (String) async -> String, draft: @escaping (QuickText) -> Void, close: @escaping () -> Void) {
        self.model = model
        self.found = found
        self.targetName = targetName
        self.replace = replace
        self.draft = draft
        self.close = close
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            switch (found, phase.wrappedValue) {
            case (.refused(let words), _):
                Text(words).font(.system(size: 12.5)).foregroundStyle(theme.text2.color)
            case (.nothing, _):
                Text("Nothing is selected and the clipboard has no text. Select some text, then press the shortcut again.")
                    .font(.system(size: 12.5)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
            case (.text(let quick), .choosing):
                actions(quick)
            case (.text(let quick), .asking):
                askField(quick)
            case (.text, .running(let id, _, _)):
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("ATOM is working…").font(.system(size: 12)).foregroundStyle(theme.text2.color)
                    Spacer(minLength: 8)
                    QuietButton(title: "Cancel", symbol: "xmark") {
                        model.cancelAskAtom(id: id)
                        phase.wrappedValue = .choosing
                    }
                    .keyboardShortcut(.cancelAction)
                }
            case (.text, .review(let original, let proposed)):
                EditReviewView(original: original, proposed: proposed) { current.wrappedValue = $0 }
                HStack(spacing: 8) {
                    QuietButton(title: "Back", symbol: "chevron.left") { phase.wrappedValue = .choosing }
                    Spacer(minLength: 0)
                    PillButton(title: "Replace in \(targetName)", prominent: true) {
                        Task { note.wrappedValue = await replace(current.wrappedValue) }
                    }
                    .disabled(current.wrappedValue == original)
                }
                if !note.wrappedValue.isEmpty { Text(note.wrappedValue).font(.system(size: 11.5)).foregroundStyle(theme.problem.color) }
            case (.text, .card(let words)):
                ScrollView { Text(words).font(.system(size: 12.5)).foregroundStyle(theme.text.color).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                    .frame(maxHeight: 300)
                HStack(spacing: 8) {
                    QuietButton(title: "Back", symbol: "chevron.left") { phase.wrappedValue = .choosing }
                    Spacer(minLength: 0)
                    PillButton(title: "Copy", symbol: "doc.on.doc") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(words, forType: .string)
                        close()
                    }
                }
            case (.text, .message(let words)):
                Text(words).font(.system(size: 12.5)).foregroundStyle(theme.text2.color)
                QuietButton(title: "Back", symbol: "chevron.left") { phase.wrappedValue = .choosing }
            }
        }
        .padding(16)
        .frame(width: 440, alignment: .topLeading)
        .onChange(of: pendingAnswer) { _, answer in
            if let answer { received(answer) }
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "sparkles").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
            if case .text(let quick) = found {
                Text(quick.source.label + (quick.truncated ? " (cut to \(SelectionCapture.maxCharacters) characters)" : ""))
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
            } else {
                Text("Quick actions").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
            }
            Spacer(minLength: 8)
            QuietButton(title: "Close", symbol: "xmark") { close() }
        }
    }

    private func actions(_ quick: QuickText) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(String(quick.text.prefix(160)).replacingOccurrences(of: "\n", with: " ") + (quick.text.count > 160 ? "…" : ""))
                .font(.system(size: 12)).foregroundStyle(theme.text2.color).lineLimit(3)
            VStack(spacing: 0) {
                ForEach(QuickAction.allCases) { action in
                    if action != QuickAction.allCases.first { RowDivider(inset: 0) }
                    Button { choose(action, quick) } label: {
                        HStack(spacing: 8) {
                            Image(systemName: action.symbol).font(.system(size: 11)).frame(width: 18)
                            Text(action.title).font(.system(size: 12.5))
                            Spacer(minLength: 0)
                            if action.changesText && !quick.canReplace {
                                Text("Copy only").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                            }
                        }
                        .foregroundStyle(theme.text.color)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .background(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous).fill(theme.fill1.color))
        }
    }

    private func askField(_ quick: QuickText) -> some View {
        HStack(spacing: 8) {
            TextField("What should ATOM do with it?", text: instruction.projectedValue)
                .textFieldStyle(.plain).font(.system(size: 12.5)).foregroundStyle(theme.text.color)
                .onSubmit { start(.ask, quick) }
            QuietButton(title: "Back", symbol: "chevron.left") { phase.wrappedValue = .choosing }
            QuietButton(title: "Ask", symbol: "arrow.up") { start(.ask, quick) }
                .disabled(instruction.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.horizontal, 12).frame(height: 36)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous).fill(theme.fill1.color))
    }

    private func choose(_ action: QuickAction, _ quick: QuickText) {
        let provider = model.chats?.currentProvider ?? model.modelInfo?.provider
        if action == .reply && provider == "gemini-cli" { start(action, quick) }
        else if action == .reply { draft(quick) }
        else if action == .ask { phase.wrappedValue = .asking }
        else { start(action, quick) }
    }

    private func start(_ action: QuickAction, _ quick: QuickText) {
        do {
            let request = try action.request(text: quick.text, extra: instruction.wrappedValue)
            let id = "quick-" + UUID().uuidString.prefix(8).lowercased()
            phase.wrappedValue = .running(id: id, action: action, text: quick)
            model.askAtom(id: id, request: request)
        } catch let error as EditRequestError {
            phase.wrappedValue = .message(error.words)
        } catch {
            phase.wrappedValue = .message("That did not work. Try again.")
        }
    }

    private var pendingAnswer: EditAnswer? {
        if case .running(let id, _, _) = phase.wrappedValue { return model.editAnswers[id] }
        return nil
    }

    private func received(_ answer: EditAnswer) {
        guard case .running(let id, let action, let quick) = phase.wrappedValue else { return }
        _ = model.takeEditAnswer(id)
        switch answer {
        case .failed(let words):
            phase.wrappedValue = .message(words)
        case .answer(let new, let changed):
            if action.changesText, quick.canReplace {
                if !changed {
                    phase.wrappedValue = .message("ATOM changed nothing.")
                } else {
                    current.wrappedValue = quick.text
                    note.wrappedValue = ""
                    phase.wrappedValue = .review(original: quick.text, proposed: new)
                }
            } else {
                phase.wrappedValue = .card(new)
            }
        }
    }
}
