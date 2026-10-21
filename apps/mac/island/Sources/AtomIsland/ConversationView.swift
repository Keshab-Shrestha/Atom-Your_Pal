import AppKit
import SwiftUI
import AtomIslandCore

// ADR-084 (Lantern, Task 4.5): your words are quiet slips, Pal's replies are plain full-width text, the light stays
// with the newest words (older turns recede) and glows at the caret while a reply is being spoken. The composer is
// a capsule with a lit microphone and the hold shortcut in its placeholder.

/// Type to ATOM: Return sends, the reply is spoken and shown like a voice turn. Empty, the button is the lit
/// microphone that names the hold shortcut; with words, it sends them. ADR-125: Shift+Return starts a new line (the box
/// grows to 8 lines, then scrolls), ⌘V attaches a copied file or image, ↑ in an empty box brings back the last message,
/// and each chat keeps its own unsent words and files. ADR-126: "@" lists helpers (the message goes to the one chosen),
/// Second brain notes (sent with it as files) and "A file…". ADR-127: while ATOM answers, Return makes the message wait
/// for the answer. ADR-142: messages stay separate; ⌘Return sends the oldest queued message now.
struct Composer: View {
    let model: IslandModel
    private let galleryDraft: State<String>
    private var draft: Binding<String> {
        snapshot ? galleryDraft.projectedValue : Binding(get: { model.composerText }, set: { model.composerText = $0 })
    }
    private var attached: Binding<ComposerDraft> {
        snapshot ? galleryAttached.projectedValue : Binding(get: { model.composerFiles }, set: { model.composerFiles = $0 })
    }
    /// ADR-113: files waiting to go with the next message.
    private let galleryAttached = State(initialValue: ComposerDraft())
    /// ADR-117: the row of the "/" picker that Return or Tab picks.
    private let pick = State(initialValue: 0)
    /// ADR-125: ↑ and ↓ through the messages sent in this chat.
    private let recall = State(initialValue: MessageRecall(sent: []))
    /// ADR-125: ⌘V attaches files and images.
    private let paste = State(initialValue: ComposerPaste())
    /// ADR-126: the box as it was when Escape closed the "@" menu; it stays closed while that "@word" is typed on.
    private let mentionClosed = State<String?>(initialValue: nil)
    private let projectMatches = State<[ProjectFileNavigation.Entry]>(initialValue: [])
    private let projectSearchNotice = State<String?>(initialValue: nil)
    private let projectMatchesKey = State<[String]>(initialValue: [])
    @FocusState private var focused: Bool
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    /// Concentric with the panel's bottom corners (the theme's `cornerGap`: 24 = 16 + 8 in Void).
    /// `initialDraft` is for the gallery: the box starts with these words (the "/" picker shows for "/re").
    init(model: IslandModel, initialDraft: String = "") {
        self.model = model
        self.galleryDraft = State(initialValue: initialDraft)
    }

    private var composerShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 24, style: .continuous)
    }

    var body: some View {
        let readOnly = model.chats?.currentReadOnlyNotice
        VStack(alignment: .leading, spacing: 6) {
            // ADR-117: typing "/" lists ATOM's commands, Keshab's skills and his Claude commands above the field.
            if !slashItems.isEmpty && readOnly == nil {
                SlashPicker(items: slashItems, selected: min(pick.wrappedValue, slashItems.count - 1), choose: choose)
            } else if !mentionItems.isEmpty && readOnly == nil {
                MentionPicker(items: mentionItems, selected: min(pick.wrappedValue, mentionItems.count - 1), choose: choose)
            }
            if let message = projectSearchNotice.wrappedValue, mentionClosed.wrappedValue == nil, MentionMenu.query(in: draft.wrappedValue) != nil, readOnly == nil {
                Text(message).font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            }
            if let error = model.modelError {
                HStack(alignment: .top, spacing: 8) {
                    Text(error).font(.system(size: 12)).foregroundStyle(theme.problem.color).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Button { model.modelError = nil } label: { Image(systemName: "xmark") }
                        .buttonStyle(.plain).accessibilityLabel("Dismiss settings error")
                }
            }
            if readOnly == nil { queueControls }
            if !snapshot { recoveryControls }
            if !attached.wrappedValue.isEmpty || attached.wrappedValue.notice != nil {
                AttachedFilesRow(files: attached.wrappedValue.files, notes: attached.wrappedValue.notes, notice: attached.wrappedValue.notice,
                                 remove: { attached.wrappedValue.remove($0) }, removeNote: { attached.wrappedValue.remove(note: $0) })
                    .id(model.chats?.current ?? "")
            }
            VStack(alignment: .leading, spacing: 14) {
                Group {
                    if let notice = readOnly {
                        // ADR-098: Telegram or the local API writes this chat. Reading, copying and search still work.
                        Text(notice).font(.system(size: 14)).foregroundStyle(theme.text2.color).lineLimit(2)
                            .frame(maxWidth: .infinity, minHeight: 30, alignment: .leading)
                            .accessibilityLabel(notice)
                    } else if snapshot {
                        // `ImageRenderer` cannot draw a text field: show the placeholder as it would appear.
                        Text(placeholder).font(.system(size: 14)).foregroundStyle(theme.text3.color).lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        TextField(placeholder, text: draft.projectedValue, prompt: Text(placeholder).foregroundColor(theme.text3.color), axis: .vertical)
                            .lineLimit(ComposerLines.range)
                            .textFieldStyle(.plain)
                            .font(.system(size: 14))
                            .foregroundStyle(theme.text.color)
                            .focused($focused)
                            .onSubmit(send)
                            .onKeyPress(.return, phases: .down) { press in newLine(press) }
                            .onKeyPress(.upArrow) { movePick(-1) == .handled ? .handled : recallMessage(older: true) }
                            .onKeyPress(.downArrow) { movePick(1) == .handled ? .handled : recallMessage(older: false) }
                            .onKeyPress(.tab) { pickRow() }
                            .onKeyPress(.escape) { closeMenu() }
                            .accessibilityLabel("Message to ATOM")
                    }
                }
                .frame(minHeight: 60, alignment: .topLeading)
                if readOnly == nil {
                    HStack(spacing: 12) {
                        if snapshot {
                            Text("Default model").font(.system(size: 12)).foregroundStyle(theme.text2.color)
                            Image(systemName: "chevron.down").font(.system(size: 9)).foregroundStyle(theme.text3.color)
                        } else {
                            ChatModelMenu(model: model)
                            ChatReasoningMenu(model: model)
                            ChatAccessMenu(model: model)
                            SkillsMenu(skills: model.helpers.list?.skills ?? []) { name in
                                draft.wrappedValue = ComposerDraft.applying(skill: name, to: draft.wrappedValue)
                            }
                        }
                        Spacer(minLength: 4)
                        if snapshot {
                            Image(systemName: "paperclip").foregroundStyle(theme.text3.color)
                        } else {
                            AttachButton { attached.wrappedValue.add($0) }
                        }
                        if answering && empty {
                            StopReplyButton { model.stopReply() }
                        } else {
                            ComposerButton(empty: empty, listening: model.status.kind == .listening, hint: talkHint, queueing: model.queue.running, action: send)
                        }
                    }
                }
            }
            if !snapshot, readOnly == nil, model.queue.awaitingStart || model.queue.running {
                Text(model.queue.awaitingStart ? "Sending… · Return: queue another message" : "Return: queue message · ⌘Return: send next now")
                    .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            }
        }
        .onChange(of: draft.wrappedValue) { _, now in
            pick.wrappedValue = 0
            if let closed = mentionClosed.wrappedValue, !now.hasPrefix(closed) || MentionMenu.query(in: now) == nil { mentionClosed.wrappedValue = nil }
            if MentionMenu.query(in: now) != nil { model.loadNotesForMentions() }
        }
        .onChange(of: model.chats?.current) { _, _ in recall.wrappedValue = MessageRecall(sent: []) }
        .task(id: projectMentionKey) { await searchProjectMentions() }
        .onChange(of: focused) { _, now in paste.wrappedValue.focused = now }
        .onChange(of: model.composerFocusTick) { _, _ in
            if paste.wrappedValue.window === NSApp.keyWindow { focused = true }
        }
        .onAppear {
            guard !snapshot else { return }
            paste.wrappedValue.start(attach: { attached.wrappedValue.add($0) }, text: pasteText)
        }
        .onDisappear {
            guard !snapshot else { return }
            paste.wrappedValue.stop()
        }
        .background {
            if !snapshot { WindowProbe { paste.wrappedValue.window = $0 } }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(composerShape.fill(theme.fill1.color))
        .overlay(composerShape.strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
        // Dropping files on the composer attaches them.
        .modifier(ComposerDropTarget(files: attached))
    }

    @ViewBuilder private var queueControls: some View {
        if !model.queue.messages.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("Queued (\(model.queue.messages.count))").font(.system(size: 11, weight: .semibold)).foregroundStyle(theme.text2.color)
                ScrollView(.vertical, showsIndicators: true) {
                    VStack(spacing: 4) {
                        ForEach(Array(model.queue.messages.enumerated()), id: \.element.id) { index, message in
                            QueuedRow(message: message, position: index + 1, canEdit: model.composerEmpty, canSend: !model.queue.awaitingStart,
                                      edit: { model.editWaitingInput(message.id) }, remove: { model.discardWaitingInput(message.id) },
                                      sendNow: index == 0 ? { model.sendQueuedNow() } : nil)
                        }
                    }
                }
                .frame(height: CGFloat(min(3, model.queue.messages.count)) * 35)
            }
        }
    }

    @ViewBuilder private var recoveryControls: some View {
        let readOnly = model.chats?.currentReadOnlyNotice
        if !model.heldInputs.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("Held messages (\(model.heldInputs.count)) · review before sending")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(theme.text2.color)
                Text("Some input may have reached ATOM. Refresh Recovery and check saved history before retrying.")
                    .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                ScrollView(.vertical, showsIndicators: true) {
                    VStack(spacing: 4) {
                        ForEach(Array(model.heldInputs.enumerated()), id: \.element.id) { index, message in
                            QueuedRow(message: message, position: index + 1, held: true,
                                      canEdit: model.composerEmpty && readOnly == nil && !model.recovery.syncPending,
                                      edit: { model.editWaitingInput(message.id) }, remove: { model.discardWaitingInput(message.id) })
                        }
                    }
                }
                .frame(height: CGFloat(min(3, model.heldInputs.count)) * 35)
            }
        }
        if !model.otherInputChats.isEmpty {
            Menu("Saved input in other chats (\(model.otherInputChats.count))") {
                ForEach(model.otherInputChats, id: \.self) { id in
                    Button(model.savedInputTitle(id)) { model.openSavedInput(id) }
                        .disabled(!model.canOpenSavedInput(id))
                }
            }
            .menuStyle(.borderlessButton).fixedSize()
            .font(.system(size: 11)).foregroundStyle(theme.text2.color)
            .help("Open a saved chat, or recover an unfinished chat into an empty message box. Recovered text is never sent automatically.")
        }
        if let notice = model.inputNotice {
            Text(notice).font(.system(size: 11)).foregroundStyle(theme.problem.color)
        }
    }

    private var talkHint: String? { model.settings.shortcut(for: .talk).map { "Hold \($0.display) to talk" } }
    private var placeholder: String {
        "Ask anything, @mention files, or / for skills"
    }

    /// Nothing to send: no words, files or notes.
    private var empty: Bool { draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attached.wrappedValue.isEmpty }

    /// ATOM is working out or saying an answer.
    private var answering: Bool {
        switch model.status.kind {
        case .transcribing, .thinking, .speaking: return true
        default: return false
        }
    }

    // MARK: the "/" picker (ADR-117)

    private var slashItems: [SlashItem] {
        Array(SlashMenu.items(for: draft.wrappedValue, skills: model.helpers.list?.skills ?? [], commands: model.claudeCommands).prefix(SlashMenu.limit))
    }

    /// A row picked: ATOM's own command runs now; a skill or a Claude command fills its name, ready for the words.
    private func choose(_ item: SlashItem) {
        if let action = item.action { run(action) } else { draft.wrappedValue = SlashMenu.completion(for: item) }
    }

    private func run(_ action: SlashAction) {
        draft.wrappedValue = action == .help ? "/" : "" // help shows the whole list
        pick.wrappedValue = 0
        if action != .help { model.runSlash(action) }
    }

    // MARK: the "@" menu (ADR-126)

    private var mentionItems: [MentionItem] {
        guard slashItems.isEmpty, mentionClosed.wrappedValue == nil, let query = MentionMenu.query(in: draft.wrappedValue) else { return [] }
        let ordinary = MentionMenu.items(query: query, helpers: model.helpers.list?.helpers ?? [], notes: model.brain.graph?.nodes ?? [])
        let paths = projectMatchesKey.wrappedValue == projectMentionKey ? projectMatches.wrappedValue : []
        let files = paths.map { MentionItem(kind: .projectFile, name: $0.relative, detail: "Project file", symbol: "doc", relativePath: $0.relative) }
        let picker = ordinary.filter { $0.kind == .file }
        return Array((files + ordinary.filter { $0.kind != .file }).prefix(MentionMenu.limit - picker.count)) + picker
    }

    private var projectMentionKey: [String] {
        [model.chats?.current ?? "", model.chats?.currentProjectId ?? "", model.chats?.currentProject?.folderPath ?? "",
         String(model.chats?.currentProject?.missing ?? true), String(model.chats?.currentProject?.archived ?? true),
         MentionMenu.query(in: draft.wrappedValue) ?? "\0", mentionClosed.wrappedValue ?? "",
         String(model.chats?.currentReadOnlyNotice != nil)]
    }

    private func searchProjectMentions() async {
        projectMatches.wrappedValue = []; projectSearchNotice.wrappedValue = nil
        projectMatchesKey.wrappedValue = []
        let key = projectMentionKey
        guard !snapshot, model.chats?.currentReadOnlyNotice == nil, mentionClosed.wrappedValue == nil,
              let project = model.chats?.currentProject, let query = MentionMenu.query(in: draft.wrappedValue) else { return }
        try? await Task.sleep(for: .milliseconds(180))
        guard !Task.isCancelled else { return }
        let worker = Task.detached(priority: .utility) { ProjectFileNavigation.search(project: project, query: query) }
        let result = await withTaskCancellationHandler(operation: { await worker.value }, onCancel: { worker.cancel() })
        guard !Task.isCancelled, key == projectMentionKey else { return }
        projectMatches.wrappedValue = result.files
        projectMatchesKey.wrappedValue = key
        pick.wrappedValue = 0
        projectSearchNotice.wrappedValue = result.unavailable ? "Project files are unavailable. Reopen the project folder."
            : result.limited ? "Showing a limited file search; type a more specific path."
            : result.files.isEmpty ? "No matching project files." : nil
    }

    /// A helper's name goes in the words; a note is attached; "A file…" opens the file chooser.
    private func choose(_ item: MentionItem) {
        if item.kind == .projectFile {
            guard let path = item.relativePath,
                  let file = ProjectFileNavigation.resolve(path, project: model.chats?.currentProject),
                  projectMatchesKey.wrappedValue == projectMentionKey,
                  projectMatches.wrappedValue.contains(file) else {
                attached.wrappedValue.refuse("That project file is no longer available. Search again."); return
            }
            let completed = MentionMenu.completing(item, in: draft.wrappedValue) + "`" + file.relative + "` "
            draft.wrappedValue = completed
            pick.wrappedValue = 0
            return
        }
        draft.wrappedValue = MentionMenu.completing(item, in: draft.wrappedValue)
        pick.wrappedValue = 0
        switch item.kind {
        case .helper: break
        case .note: if let id = item.noteId { attached.wrappedValue.add(note: DraftNote(id: id, title: item.name)) }
        case .file: attached.wrappedValue.add(AttachButton.chooseFiles())
        case .projectFile: break
        }
    }

    /// The rows of whichever menu is open: "/" or "@".
    private var openRows: Int { slashItems.isEmpty ? mentionItems.count : slashItems.count }

    private func movePick(_ step: Int) -> KeyPress.Result {
        let count = openRows
        guard count > 0 else { return .ignored }
        pick.wrappedValue = (min(pick.wrappedValue, count - 1) + step + count) % count
        return .handled
    }

    /// Return or Tab with a menu open picks the highlighted row.
    private func pickRow() -> KeyPress.Result {
        let slash = slashItems
        if !slash.isEmpty { choose(slash[min(pick.wrappedValue, slash.count - 1)]); return .handled }
        let mentions = mentionItems
        if !mentions.isEmpty { choose(mentions[min(pick.wrappedValue, mentions.count - 1)]); return .handled }
        return .ignored
    }

    /// Escape: the "/" menu clears its command; the "@" menu just closes, keeping the words.
    private func closeMenu() -> KeyPress.Result {
        if !slashItems.isEmpty { draft.wrappedValue = ""; return .handled }
        guard !mentionItems.isEmpty else { return .ignored }
        mentionClosed.wrappedValue = draft.wrappedValue
        return .handled
    }

    // MARK: ADR-125

    /// Shift+Return starts a new line where the caret is. Plain Return sends (`onSubmit`); while Japanese or other
    /// input is being composed, Return is the input method's.
    private func newLine(_ press: KeyPress) -> KeyPress.Result {
        // ADR-142: ⌘Return appends this draft, then sends the oldest live entry now; an empty box sends the existing head.
        if press.modifiers.contains(.command), !FieldEditor.composing { send(now: true); return .handled }
        guard press.modifiers.contains(.shift), !FieldEditor.composing, let editor = FieldEditor.current else { return .ignored }
        editor.insertNewlineIgnoringFieldEditor(nil)
        return .handled
    }

    /// ↑ in an empty box: the last message sent in this chat, then earlier ones; ↓ back toward an empty box. In words
    /// of your own the arrows move the caret.
    private func recallMessage(older: Bool) -> KeyPress.Result {
        let current = draft.wrappedValue
        if older && current.isEmpty { recall.wrappedValue = MessageRecall(sent: model.conversation.turns.map(\.transcript)) }
        guard let text = older ? recall.wrappedValue.older(current: current) : recall.wrappedValue.newer(current: current) else { return .ignored }
        draft.wrappedValue = text
        return .handled
    }

    private func send() { send(now: false) }

    private func send(now: Bool) {
        if !snapshot, model.cleanComposerForReview() { return }
        // The picker is open: Return picks the highlighted row (a full "/new" runs ATOM's command; "/review" gets a space).
        if pickRow() == .handled { return }
        if let built = SlashMenu.builtIn(in: draft.wrappedValue) { run(built.action); return }
        if empty {
            if now, !snapshot { model.sendQueuedNow() }
            return
        }
        if let why = ComposerDraft.refusal(forText: draft.wrappedValue) {
            attached.wrappedValue.refuse(why) // the text stays, and the notice says why
            return
        }
        guard !snapshot else { return }
        model.submitComposer(now: now)
    }

    /// Native insertion preserves the current selection and ordinary text Undo. IME composition is left alone.
    private func pasteText(_ text: String, editor: NSTextView) -> Bool {
        guard !snapshot, model.chats?.currentReadOnlyNotice == nil else { return false }
        let clean = HiddenCharacters.strip(text)
        if clean.text.isEmpty, clean.removed > 0 {
            attached.wrappedValue.refuse("Removed \(clean.removed) hidden controls; there was no visible text to paste.")
            return true
        }
        let range = editor.selectedRange()
        let source = editor.string as NSString
        guard range.location != NSNotFound, NSMaxRange(range) <= source.length else { return false }
        guard clean.removed > 0 else { return false }
        if !clean.text.isEmpty { editor.insertText(clean.text, replacementRange: range) }
        attached.wrappedValue.refuse("Removed \(clean.removed) hidden controls from the paste.")
        return true
    }
}

/// Native drop destinations cannot be rendered by ImageRenderer.
private struct ComposerDropTarget: ViewModifier {
    @Binding var files: ComposerDraft
    @Environment(\.islandSnapshot) private var snapshot
    func body(content: Content) -> some View {
        if snapshot { content }
        else {
            content.dropDestination(for: URL.self) { urls, _ in
                let paths = urls.filter(\.isFileURL).map(\.path)
                guard !paths.isEmpty else { return false }
                files.add(paths)
                return true
            }
        }
    }
}

/// The paperclip: chooses files (text, code, PDFs, images) for the next message.
private struct AttachButton: View {
    let add: ([String]) -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: choose) {
            Image(systemName: "paperclip").font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text2.color)
                .frame(width: 28, height: 28).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Attach files: text, code, PDFs or images. You can also drop them here.")
        .accessibilityLabel("Attach files")
    }

    private func choose() { add(Self.chooseFiles()) }

    /// The file chooser; the chosen paths, or none.
    static func chooseFiles() -> [String] {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.prompt = "Attach"
        return panel.runModal() == .OK ? panel.urls.map(\.path) : []
    }
}

/// "/": the user's skills. Choosing one puts "/name " in front of the words; ATOM then follows that skill for the message.
private struct SkillsMenu: View {
    let skills: [SkillInfo]
    let choose: (String) -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        Menu {
            if skills.isEmpty {
                Text("No skills yet. Add one in ~/.claude/skills.")
            } else {
                ForEach(skills, id: \.name) { skill in
                    // The name only: a long description made the menu as wide as the window. It is the hover tip.
                    Button {
                        choose(skill.name)
                    } label: {
                        Text(skill.name)
                    }
                    .help(skill.description)
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "sparkles").font(.system(size: 10.5, weight: .medium))
                Text("Skills").font(.system(size: 11.5))
            }
            .foregroundStyle(theme.text2.color)
            .padding(.horizontal, 8).frame(height: 28).contentShape(Rectangle())
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .help("Use one of your skills for this message. You can also type /skill-name.")
        .accessibilityLabel("Skills")
    }
}

/// One FIFO or held entry. Actions address its stable id; only the live head offers Send next now.
private struct QueuedRow: View {
    let message: QueuedMessage
    var position = 1
    var held = false
    var canEdit = true
    var canSend = true
    let edit: () -> Void
    let remove: () -> Void
    var sendNow: (() -> Void)? = nil
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 8) {
            Text(held ? "\(position)" : position == 1 ? "Next" : "\(position)")
                .font(.system(size: 11, weight: .semibold)).foregroundStyle(theme.text2.color)
            Text(summary).font(.system(size: 12)).foregroundStyle(theme.text.color).lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 8)
            Button("Edit", action: edit).disabled(!canEdit).help("Move this message to an empty composer; submitting it again adds it at the end")
            Button(held ? "Discard" : "Remove", action: remove).help("Remove only this unsent message")
            if let sendNow {
                Button("Send next now", action: sendNow).disabled(!canSend).help("Stop the current answer and send this message; the remaining entries keep their order")
            }
        }
        .buttonStyle(.plain).font(.system(size: 11.5)).foregroundStyle(theme.text2.color)
        .padding(.horizontal, 10).frame(height: 30)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous).fill(theme.fill2.color))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(held ? "Unsent" : "Queued") message \(position): \(summary)")
    }

    private var summary: String {
        let line = message.text.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        let count = message.files.files.count + message.files.notes.count
        let files = count == 0 ? "" : count == 1 ? "1 attachment" : "\(count) attachments"
        return [line, files].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// The composer's stop button: a filled square in a circle, in the place of the microphone while ATOM answers.
private struct StopReplyButton: View {
    let action: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                .fill(theme.isGhost ? theme.text.color : theme.onAccent.color)
                .frame(width: 10, height: 10)
                .frame(width: 30, height: 30)
                .background {
                    if theme.isGhost {
                        ControlFill(Circle(), fill: Color.clear, hovering: true)
                    } else {
                        Circle().fill(theme.accentFill)
                    }
                }
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help("Stop the answer")
        .accessibilityLabel("Stop the answer")
    }
}

/// The composer's round button, a lit object: the microphone while the field is empty (it names the hold shortcut;
/// talking is the shortcut itself), the send arrow once there is something to send. Brightest while listening.
private struct ComposerButton: View {
    let empty: Bool
    let listening: Bool
    let hint: String?
    var queueing = false
    let action: () -> Void
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if theme.isGhost { ghost } else { filled }
    }

    /// Void (ADR-086): a ghost circle, its hairline brightening once there is something to send, and blue (with the
    /// microphone) while listening. No glow.
    private var ghost: some View {
        let tint: Color? = listening ? theme.live.color : nil
        return Button(action: action) {
            Image(systemName: empty ? "mic" : queueing ? "arrow.turn.down.right" : "arrow.up")
                .font(.system(size: empty ? 12.5 : 11.5, weight: empty ? .regular : .semibold))
                .foregroundStyle(tint ?? (empty ? theme.text2.color : theme.text.color))
                .frame(width: 30, height: 30)
                .background(ControlFill(Circle(), fill: Color.clear, hovering: !empty, tint: tint))
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.plain)
        .allowsHitTesting(!empty)
        .accessibilityRemoveTraits(empty ? .isButton : [])
        .animation(Motion.plain, value: empty)
        .animation(Motion.plain, value: listening)
        .accessibilityLabel(empty ? (hint ?? "Microphone") : queueing ? "Queue message" : "Send")
        .help(empty ? (hint ?? "Set a Talk shortcut in Settings") : queueing ? "Queue this message (Return)" : "Send (Return)")
    }

    private var filled: some View {
        let lit = !empty || listening
        return Button(action: action) {
            Image(systemName: empty ? "mic.fill" : queueing ? "arrow.turn.down.right" : "arrow.up")
                .font(.system(size: empty ? 12 : 11.5, weight: .bold))
                .foregroundStyle(lit ? theme.onAccent.color : theme.text3.color)
                .frame(width: 30, height: 30)
                .background(Circle().fill(lit ? theme.accentFill : AnyShapeStyle(theme.fill2.color)))
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.plain)
        .allowsHitTesting(!empty) // not dimmed while empty: the lit microphone is a hint, the shortcut is the action
        .accessibilityRemoveTraits(empty ? .isButton : [])
        .animation(Motion.snap(reduceMotion), value: empty)
        .animation(Motion.glow(reduceMotion), value: listening)
        .accessibilityLabel(empty ? (hint ?? "Microphone") : queueing ? "Queue message" : "Send")
        .help(empty ? (hint ?? "Set a Talk shortcut in Settings") : queueing ? "Queue this message (Return)" : "Send (Return)")
    }
}

struct ConversationTab: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let results = model.chatFindShown ? ChatFind.search(model.conversation.turns, query: model.chatFindQuery) : ChatFind.Results()
        VStack(spacing: 0) {
            if model.chatControls.notice != nil {
                ChatControlFeedback(model: model).padding(.horizontal, Spacing.conversation).padding(.vertical, 7)
            }
            if model.chatFindShown { ChatFindBar(model: model, results: results) }
            if SetupCards.isShown(model) {
                VStack(spacing: 0) {
                    Scrollable { SetupCards(model: model).padding(.bottom, 10) }
                        .frame(maxHeight: model.conversation.isEmpty ? .infinity : 210)
                    if model.conversation.isEmpty { composer } else { content(results: results) }
                }
            } else {
                content(results: results)
            }
        }
    }

    /// "Try again" on a turn that failed: the same words, asked once more. Nil for any other turn.
    private func retry(for turn: Conversation.Turn) -> (() -> Void)? {
        guard case .failed = turn.outcome, !turn.transcript.isEmpty else { return nil }
        let words = turn.transcript
        let chat = model.chats?.current
        return {
            guard model.chats?.current == chat, model.conversation.turns.contains(where: { $0.id == turn.id }) else { return }
            guard model.chats?.currentReadOnlyNotice == nil, model.composerEmpty else {
                model.chatControls.notice = "Keep or clear the existing draft before preparing a retry."
                return
            }
            model.composerText = words
            model.composerFocusTick += 1
            model.chatControls.notice = "Retry draft restored. Review it before sending; earlier file or network effects may already exist."
        }
    }

    private func savedAction(_ turn: Conversation.Turn, kind: String) -> (() -> Void)? {
        guard let seq = turn.sourceSeq, !turn.transcript.isEmpty, model.chatBranchAvailable,
              model.chatControls.snapshot?.revision != nil else { return nil }
        let chat = model.chats?.current
        return {
            guard model.chats?.current == chat, model.conversation.turns.contains(where: { $0.id == turn.id }) else { return }
            model.forkSavedChat(kind: kind, through: seq)
        }
    }

    private var composer: some View {
        VStack(spacing: 8) {
            if let work = model.conversation.turns.last?.work, work.state == "working", work.chat == model.chats?.current,
               let question = work.questions.first(where: { $0.state == "pending" }) {
                ChatQuestionCard(model: model, work: work, question: question).id(question.id)
            }
            RememberRows(model: model) // upgrades.md C2: facts the notes noticed, kept only on Remember
            Composer(model: model)
        }
        .padding(.horizontal, Spacing.conversation)
        .padding(.top, 12)
        .padding(.bottom, 20)
    }

    /// One column for both states, with the composer after the if/else: in two branches it was a different view each time, so its half-typed draft and
    /// attached files were thrown away whenever the conversation flipped between empty and not (a voice turn arriving, a new chat; code check, 2026-10-16).
    @ViewBuilder private func content(results: ChatFind.Results) -> some View {
        let match = model.chatFindShown ? results.selected(model.chatFindSelection) : nil
        VStack(spacing: 0) {
            if model.conversation.isEmpty {
                Spacer(minLength: 0)
                EmptyConversation(model: model)
                    .padding(.horizontal, Spacing.panel)
                    .padding(.bottom, 20)
            } else {
                if let note = model.trimmedNotice { TrimmedNote(text: note) } // ADR-107
                ScrollViewReader { proxy in
                    ChatScrollView(turnIDs: model.conversation.turns.map(\.id), suspendFollowing: model.chatFindShown) {
                        LazyVStack(alignment: .leading, spacing: Spacing.turn) {
                            ForEach(model.conversation.turns) { turn in
                                TurnView(turn: turn, latest: model.conversation.isLatest(turn), retry: retry(for: turn),
                                         quote: model.chats?.currentReadOnlyNotice == nil ? { model.quoteReply(turn.id) } : nil,
                                         editSaved: savedAction(turn, kind: "edit"), retrySaved: savedAction(turn, kind: "retry"),
                                         project: model.chats?.currentProject, findMatch: match?.turnID == turn.id ? match : nil).id(turn.id)
                            }
                        }
                        .padding(.horizontal, Spacing.conversation)
                        .padding(.vertical, 20)
                    }
                    .id(model.chats?.current ?? "")
                    .onChange(of: model.chatFindScrollTick) { _, _ in
                        guard let match else { return }
                        let request = model.chatFindScrollTick
                        DispatchQueue.main.async {
                            guard model.chatFindShown, model.chatFindScrollTick == request,
                                  model.conversation.turns.contains(where: { $0.id == match.turnID }) else { return }
                            proxy.scrollTo(match.turnID, anchor: .center)
                        }
                    }
                }
            }
            composer
            if model.conversation.isEmpty { Spacer(minLength: 0) }
        }
        .frame(maxWidth: .infinity)
    }
}

/// Before the first turn: a simple heading above the same composer used by an existing conversation.
private struct EmptyConversation: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(spacing: 12) {
            Text("What can I help you with?")
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(theme.text.color)
            Text("Ask a question or start something new.")
                .font(.system(size: 14)).foregroundStyle(theme.text3.color)
            BriefCard(model: model).padding(.top, 6).frame(maxWidth: 520) // upgrades.md C3: today's brief, when there is one
            EmptyConversationExamples(model: model).padding(.top, 6)
        }
    }


}

struct TurnView: View {
    let turn: Conversation.Turn
    /// Retained for caller compatibility; all settled messages now share the same readable contrast.
    var latest = true
    /// Asks the same words again; only given for a turn that failed.
    var retry: (() -> Void)? = nil
    var quote: (() -> Void)? = nil
    var editSaved: (() -> Void)? = nil
    var retrySaved: (() -> Void)? = nil
    var project: ProjectInfo? = nil
    var findMatch: ChatFind.Match? = nil
    private let hovering = State(initialValue: false)
    private let pathNotice = State<String?>(initialValue: nil)
    @Environment(\.islandSnapshot) private var snapshot
    /// A view preference only: never substitute the excerpt for the real transcript.
    private let messageExpanded = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        let preview = UserMessagePreview.collapsed(turn.transcript)
        let collapsed = preview != nil && !messageExpanded.wrappedValue && findMatch?.user != true
        let copyTitle = preview == nil ? "Copy message" : "Copy full message"
        VStack(alignment: .leading, spacing: 12) {
            if !turn.transcript.isEmpty { // an answer ATOM posted by itself has no question (ADR-109)
                ChatUserBubbleLayout {
                    VStack(alignment: .trailing, spacing: 4) {
                        Text(collapsed ? (preview ?? turn.transcript) : turn.transcript)
                            .lineLimit(collapsed ? UserMessagePreview.lineLimit : nil)
                            .truncationMode(.tail)
                            .accessibilityHint(collapsed ? "Message preview. Open Message actions and choose Show full message to read the rest." : "")
                            .font(.system(size: 14))
                            .foregroundStyle(theme.text.color)
                            .lineSpacing(5)
                            .padding(12)
                            .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).fill(theme.fill1.color))
                            .textSelection(.enabled)
                            .contextMenu { userActions(collapsed: collapsed) }
                            .overlay(alignment: .topLeading) {
                                ChatActionsMenu(title: "Message actions", revealed: hovering.wrappedValue) { userActions(collapsed: collapsed) }
                                    .offset(x: -28)
                            }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("You said")
                .accessibilityActions {
                    Button(copyTitle) { _ = ChatClipboard.write(MarkdownCopy.Content(text: turn.transcript)) }
                    if preview != nil {
                        Button(collapsed ? "Show full message" : "Show less") { messageExpanded.wrappedValue.toggle() }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                if let work = turn.work { ChatWorkView(work: work) }
                switch turn.outcome {
                case .inProgress where turn.reply == nil:
                    ThinkingDots().padding(.vertical, 4)
                case .notice(let message):
                    outcomeLine(message, symbol: "hand.raised.fill", color: theme.attention.color)
                case .failed(let message):
                    if let reply = turn.reply { ReplyText(text: reply, latest: true, streaming: false) }
                    outcomeLine(message, symbol: "exclamationmark.triangle.fill", color: theme.problem.color)
                    if let retry { QuietButton(title: "Review retry", symbol: "arrow.clockwise", action: retry) }
                default:
                    if let reply = turn.reply { ReplyText(text: reply, latest: true, streaming: turn.isStreaming) }
                }
            }
            .padding(.trailing, 28)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .topTrailing) {
                if let reply = turn.reply, !turn.isStreaming {
                    ChatActionsMenu(title: "Reply actions", revealed: hovering.wrappedValue) { replyActions(reply) }
                }
            }
            .contentShape(Rectangle())
            .contextMenu { if let reply = turn.reply, !turn.isStreaming { replyActions(reply) } }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("ATOM said")
            .accessibilityActions {
                if let reply = turn.reply, !turn.isStreaming {
                    if let quote, !reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Button("Reply to this", action: quote)
                    }
                    ForEach(MarkdownCopy.ReplyFormat.allCases, id: \.self) { format in
                        Button("Copy reply as \(format.title)") { _ = ChatClipboard.write(MarkdownCopy.reply(reply, format: format)) }
                    }
                }
            }
            if let reply = turn.reply, !turn.isStreaming {
                ProjectFileLinks(text: reply, project: project)
            }
            if let notice = pathNotice.wrappedValue {
                Text(notice).font(.system(size: 11)).foregroundStyle(theme.problem.color)
            }
        }
        .overlay {
            if findMatch != nil {
                RoundedRectangle(cornerRadius: theme.radiusCard).stroke(theme.accent.color, lineWidth: 1).padding(-4)
                    .allowsHitTesting(false).accessibilityHidden(true)
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            guard url.isFileURL || url.scheme == nil else { return .systemAction }
            guard !snapshot else { return .discarded }
            let candidate = url.isFileURL ? url.absoluteString : url.path
            if let file = ProjectFileNavigation.resolve(candidate, project: project),
               ProjectFileNavigation.reveal(file, project: project) {
                pathNotice.wrappedValue = nil
            } else { pathNotice.wrappedValue = "That file is unavailable or outside the active project." }
            return .handled
        })
        .contentShape(Rectangle())
        .onHover { hovering.wrappedValue = $0 }
        .onChange(of: turn.transcript) { _, _ in messageExpanded.wrappedValue = false }
    }

    @ViewBuilder private func userActions(collapsed: Bool) -> some View {
        Button(UserMessagePreview.collapsed(turn.transcript) == nil ? "Copy message" : "Copy full message") { _ = ChatClipboard.write(MarkdownCopy.Content(text: turn.transcript)) }
        if UserMessagePreview.collapsed(turn.transcript) != nil {
            Button(collapsed ? "Show full message" : "Show less") { messageExpanded.wrappedValue.toggle() }
        }
        if let editSaved, let retrySaved {
            Divider()
            Button("Edit in new chat", action: editSaved)
            Button("Retry in new chat", action: retrySaved)
        }
    }

    @ViewBuilder private func replyActions(_ reply: String) -> some View {
        ForEach(MarkdownCopy.ReplyFormat.allCases, id: \.self) { format in
            Button("Copy as \(format.title)") { _ = ChatClipboard.write(MarkdownCopy.reply(reply, format: format)) }
        }
        if let quote, !reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Divider()
            Button("Reply to this", action: quote)
        }
        if let timings = turn.timings {
            Divider()
            Text(NowFacts.summary(timings))
        }
    }

    @ViewBuilder private func outcomeLine(_ text: String, symbol: String, color: Color) -> some View {
        if theme.statusDots {
            // Void: the colour is only the dot; the words stay quiet.
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                StatusDot(color: color).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 0.5 }
                Text(text).font(.system(size: 12)).foregroundStyle(theme.text2.color)
            }
            .fixedSize(horizontal: false, vertical: true)
        } else {
            Label(text, systemImage: symbol)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(color)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Pal's reply at reading size. While it is being spoken, a caret of Pal's light glows after the last word: the
/// same text is laid out twice, the lower copy invisible except for the caret's glow, so the glow sits exactly on it.
private struct ReplyText: View {
    let text: String
    let latest: Bool
    let streaming: Bool
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if MarkdownBlocks.isRich(text) {
            MarkdownReply(text: text, latest: latest, copyEnabled: !streaming)
        } else {
            plain
        }
    }

    private var plain: some View {
        let light = theme.glow.a > 0 ? theme.glow.with(alpha: 1).color : theme.accent.color
        return ZStack(alignment: .topLeading) {
            if streaming, theme.usesGlow {
                (Text(text).foregroundColor(.clear) + caret(theme.isDark ? light : theme.accent.color))
                    .shadow(color: light.opacity(0.9), radius: 5)
                    .modifier(Breathing(active: !snapshot && !reduceMotion))
                    .accessibilityHidden(true)
            }
            (Text(text).foregroundColor(latest ? theme.text.color : theme.text2.color)
                + (streaming ? caret(theme.isDark ? light : theme.accent.color) : Text("")))
                .textSelection(.enabled)
        }
        .font(.system(size: 14))
        .lineSpacing(5)
        .fixedSize(horizontal: false, vertical: true)
        .animation(Motion.glow(reduceMotion), value: latest)
    }

    private func caret(_ colour: Color) -> Text {
        Text(" \u{25CF}").font(.system(size: 8)).baselineOffset(1).foregroundColor(colour)
    }
}

/// The caret's glow dimming and brightening while the reply is spoken.
private struct Breathing: ViewModifier {
    let active: Bool

    func body(content: Content) -> some View {
        if active {
            content.phaseAnimator([1.0, 0.45]) { view, phase in view.opacity(phase) } animation: { _ in .easeInOut(duration: 0.9) }
        } else {
            content
        }
    }
}

struct ThinkingDots: View {
    @Environment(\.theme) private var theme

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 15)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<3) { i in
                    Circle()
                        .fill(theme.statusDots ? theme.idColor(theme.text2) : theme.text2.color) // Void: thinking is violet
                        .frame(width: 5, height: 5)
                        .opacity(0.3 + 0.7 * max(0, sin((t * 4) - Double(i) * 0.7)))
                }
            }
        }
        .accessibilityLabel("Thinking")
    }
}
