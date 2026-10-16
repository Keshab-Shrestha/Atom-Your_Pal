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
/// for the answer (a "Next" row shows it); ⌘Return sends at once, stopping the answer.
struct Composer: View {
    let model: IslandModel
    private let draft: State<String>
    /// ADR-113: files waiting to go with the next message.
    private let attached = State(initialValue: ComposerDraft())
    /// ADR-117: the row of the "/" picker that Return or Tab picks.
    private let pick = State(initialValue: 0)
    /// ADR-125: ↑ and ↓ through the messages sent in this chat.
    private let recall = State(initialValue: MessageRecall(sent: []))
    /// ADR-125: ⌘V attaches files and images.
    private let paste = State(initialValue: ComposerPaste())
    /// ADR-126: the box as it was when Escape closed the "@" menu; it stays closed while that "@word" is typed on.
    private let mentionClosed = State<String?>(initialValue: nil)
    @FocusState private var focused: Bool
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    /// Concentric with the panel's bottom corners (the theme's `cornerGap`: 24 = 16 + 8 in Void).
    /// `initialDraft` is for the gallery: the box starts with these words (the "/" picker shows for "/re").
    init(model: IslandModel, initialDraft: String = "") {
        self.model = model
        self.draft = State(initialValue: initialDraft)
    }

    private var composerShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: max(10, theme.radiusSurface - theme.cornerGap), style: .continuous)
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
            if let next = model.queue.next, readOnly == nil {
                QueuedRow(message: next, edit: model.editQueued, sendNow: model.sendQueuedNow)
            }
            if !attached.wrappedValue.isEmpty || attached.wrappedValue.notice != nil {
                AttachedFilesRow(files: attached.wrappedValue.files, notes: attached.wrappedValue.notes, notice: attached.wrappedValue.notice,
                                 remove: { attached.wrappedValue.remove($0) }, removeNote: { attached.wrappedValue.remove(note: $0) })
            }
            // Two columns: the field and the tools on the left, the voice button alone at the right edge, centred on
            // both rows. The model menu used to sit under the button and fight it for the corner (2026-10-15).
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 6) {
                    if let notice = readOnly {
                        // ADR-098: Telegram or the local API writes this chat. Reading, copying and search still work.
                        Text(notice).font(.system(size: 12.5)).foregroundStyle(theme.text3.color).lineLimit(2)
                            .frame(maxWidth: .infinity, minHeight: 30, alignment: .leading)
                            .accessibilityLabel(notice)
                    } else if snapshot {
                        // `ImageRenderer` cannot draw a text field: show the placeholder as it would appear.
                        Text(placeholder).font(.system(size: 12.5)).foregroundStyle(theme.text3.color).lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        TextField(placeholder, text: draft.projectedValue, axis: .vertical)
                            .lineLimit(ComposerLines.range)
                            .textFieldStyle(.plain)
                            .font(.system(size: 12.5))
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
                    if readOnly == nil && !snapshot {
                        // The things that shape the next message sit with it: files, skills and the chat's model.
                        HStack(spacing: 8) {
                            AttachButton { attached.wrappedValue.add($0) }
                            SkillsMenu(skills: model.helpers.list?.skills ?? []) { name in
                                draft.wrappedValue = ComposerDraft.applying(skill: name, to: draft.wrappedValue)
                            }
                            Spacer(minLength: 4)
                            ChatModelMenu(model: model) // ADR-097, moved here from the top bar
                        }
                    }
                }
                if readOnly == nil {
                    if answering && empty {
                        // ATOM is thinking or speaking and nothing is typed: the button stops the answer.
                        StopReplyButton { model.stopReply() }
                    } else {
                        ComposerButton(empty: empty, listening: model.status.kind == .listening, hint: talkHint, action: send)
                    }
                }
            }
        }
        .onChange(of: draft.wrappedValue) { _, now in
            pick.wrappedValue = 0
            if let closed = mentionClosed.wrappedValue, !now.hasPrefix(closed) || MentionMenu.query(in: now) == nil { mentionClosed.wrappedValue = nil }
            if MentionMenu.query(in: now) != nil { model.loadNotesForMentions() }
        }
        // ADR-125: each chat keeps its unsent words and files; they come back when it opens again.
        .onChange(of: model.chats?.current) { old, new in switchDraft(from: old, to: new) }
        .onChange(of: model.returned) { _, _ in takeReturned() }
        .onChange(of: focused) { _, now in paste.wrappedValue.focused = now }
        .onAppear {
            guard !snapshot else { return }
            if draft.wrappedValue.isEmpty { switchDraft(from: nil, to: model.chats?.current) }
            takeReturned()
            paste.wrappedValue.start { attached.wrappedValue.add($0) }
        }
        .onDisappear {
            guard !snapshot else { return }
            paste.wrappedValue.stop()
            // The composer is rebuilt when setup cards come and go: the words wait in the chat's draft.
            switchDraft(from: model.chats?.current, to: nil)
        }
        .background(WindowProbe { paste.wrappedValue.window = $0 })
        .padding(.leading, 18)
        .padding(.trailing, 5)
        .padding(.vertical, 5)
        .background(composerShape.fill(theme.fill1.color))
        .overlay(composerShape.strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
        // Dropping files on the composer attaches them.
        .dropDestination(for: URL.self) { urls, _ in
            let paths = urls.filter(\.isFileURL).map(\.path)
            guard !paths.isEmpty else { return false }
            attached.wrappedValue.add(paths)
            return true
        }
    }

    private var talkHint: String? { model.settings.shortcut(for: .talk).map { "Hold \($0.display) to talk" } }
    private var placeholder: String {
        model.settings.shortcut(for: .talk).map { "Ask ATOM, or hold \($0.display) to talk" } ?? "Ask ATOM…"
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
        return MentionMenu.items(query: query, helpers: model.helpers.list?.helpers ?? [], notes: model.brain.graph?.nodes ?? [])
    }

    /// A helper's name goes in the words; a note is attached; "A file…" opens the file chooser.
    private func choose(_ item: MentionItem) {
        draft.wrappedValue = MentionMenu.completing(item, in: draft.wrappedValue)
        pick.wrappedValue = 0
        switch item.kind {
        case .helper: break
        case .note: if let id = item.noteId { attached.wrappedValue.add(note: DraftNote(id: id, title: item.name)) }
        case .file: attached.wrappedValue.add(AttachButton.chooseFiles())
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
        // ADR-127: ⌘Return sends now, even while ATOM answers (the answer stops).
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

    /// Keeps the words and files of the chat being left and puts those of the chat being opened in the box.
    private func switchDraft(from old: String?, to new: String?) {
        let next = model.chatDrafts.switching(from: old, to: new, text: draft.wrappedValue, files: attached.wrappedValue)
        guard new != nil else { return }
        draft.wrappedValue = next.text
        attached.wrappedValue = next.files
        recall.wrappedValue = MessageRecall(sent: [])
    }

    /// ADR-127: a waiting message that was not sent comes back in front of what is in the box.
    private func takeReturned() {
        guard !snapshot, let back = model.takeReturned() else { return }
        let typed = draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines)
        draft.wrappedValue = typed.isEmpty ? back.text : back.text + "\n\n" + typed
        attached.wrappedValue.add(back.files.files.map(\.path))
        for note in back.files.notes { attached.wrappedValue.add(note: note) }
    }

    private func send() { send(now: false) }

    private func send(now: Bool) {
        // The picker is open: Return picks the highlighted row (a full "/new" runs ATOM's command; "/review" gets a space).
        if pickRow() == .handled { return }
        if let built = SlashMenu.builtIn(in: draft.wrappedValue) { run(built.action); return }
        guard !empty else { return }
        if let why = ComposerDraft.refusal(forText: draft.wrappedValue) {
            attached.wrappedValue.refuse(why) // the text stays, and the notice says why
            return
        }
        if model.queue.running {
            model.queueMessage(draft.wrappedValue, draft: attached.wrappedValue) // goes when the answer ends…
            if now { model.sendQueuedNow() } // …or now, joined to one already waiting so the two go as one
        } else {
            model.ask(draft.wrappedValue, draft: attached.wrappedValue)
        }
        draft.wrappedValue = ""
        attached.wrappedValue.clear()
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

/// The files waiting to go with the message, each with a button to take it off.
private struct AttachedFilesRow: View {
    let files: [DraftFile]
    var notes: [DraftNote] = []
    let notice: String?
    let remove: (String) -> Void
    var removeNote: (Int) -> Void = { _ in }
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if !files.isEmpty || !notes.isEmpty {
                HStack(spacing: 6) {
                    ForEach(files) { file in chip(file.name, symbol: "doc") { remove(file.path) } }
                    // ADR-126: a Second brain note, sent as "<title>.md".
                    ForEach(notes) { note in chip(note.title, symbol: "brain") { removeNote(note.id) } }
                }
            }
            if let notice { Text(notice).font(.system(size: 11)).foregroundStyle(theme.problem.color) }
        }
        .padding(.top, 2)
    }

    private func chip(_ name: String, symbol: String, remove: @escaping () -> Void) -> some View {
        HStack(spacing: 4) {
            Image(systemName: symbol).font(.system(size: 10))
            Text(name).font(.system(size: 11.5)).lineLimit(1).truncationMode(.middle).frame(maxWidth: 160)
            Button(action: remove) {
                Image(systemName: "xmark").font(.system(size: 8, weight: .bold)).frame(width: 14, height: 14).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(name)")
        }
        .foregroundStyle(theme.text2.color)
        .padding(.horizontal, 8).frame(height: 24)
        .background(Capsule().fill(theme.fill2.color))
    }
}

/// ADR-127: the message waiting for ATOM's answer to end. Edit puts it back in the box; Send now stops the answer.
private struct QueuedRow: View {
    let message: QueuedMessage
    let edit: () -> Void
    let sendNow: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.turn.down.right").font(.system(size: 10.5, weight: .semibold)).foregroundStyle(theme.text3.color)
            Text("Next").font(.system(size: 11, weight: .semibold)).foregroundStyle(theme.text2.color)
            Text(summary).font(.system(size: 12)).foregroundStyle(theme.text.color).lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 8)
            Button("Edit", action: edit).buttonStyle(.plain).font(.system(size: 11.5)).foregroundStyle(theme.text2.color)
                .help("Put it back in the box")
            Button("Send now", action: sendNow).buttonStyle(.plain).font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text.color)
                .help("Stop the answer and send this (⌘Return)")
        }
        .padding(.horizontal, 10).frame(height: 28)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous).fill(theme.fill2.color))
        .padding(.top, 3).padding(.trailing, 4)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Next message, sent when ATOM finishes: \(summary)")
    }

    /// The first line, and how many files go with it.
    private var summary: String {
        let line = message.text.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        let count = message.files.files.count + message.files.notes.count
        let files = count == 0 ? "" : count == 1 ? "1 file" : "\(count) files"
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
            Image(systemName: empty ? "mic" : "arrow.up")
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
        .accessibilityLabel(empty ? (hint ?? "Microphone") : "Send")
        .help(empty ? (hint ?? "Set a Talk shortcut in Settings") : "Send (Return)")
    }

    private var filled: some View {
        let light = theme.glow.a > 0 ? theme.glow.with(alpha: 1).color : theme.accent.color
        let lit = !empty || listening || hint != nil
        return Button(action: action) {
            Image(systemName: empty ? "mic.fill" : "arrow.up")
                .font(.system(size: empty ? 12 : 11.5, weight: .bold))
                .foregroundStyle(lit ? theme.onAccent.color : theme.text3.color)
                .frame(width: 30, height: 30)
                .background(Circle().fill(lit ? theme.accentFill : AnyShapeStyle(theme.fill2.color)))
                .shadow(color: light.opacity(lit ? (listening ? 0.85 : 0.45) : 0), radius: listening ? 9 : 6)
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.plain)
        .allowsHitTesting(!empty) // not dimmed while empty: the lit microphone is a hint, the shortcut is the action
        .accessibilityRemoveTraits(empty ? .isButton : [])
        .animation(Motion.snap(reduceMotion), value: empty)
        .animation(Motion.glow(reduceMotion), value: listening)
        .accessibilityLabel(empty ? (hint ?? "Microphone") : "Send")
        .help(empty ? (hint ?? "Set a Talk shortcut in Settings") : "Send (Return)")
    }
}

struct ConversationTab: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        // ADR-075: setup and error cards come first. They scroll, and push the empty-state picture out, so the
        // composer always stays in the panel.
        if SetupCards.isShown(model) {
            VStack(spacing: 0) {
                Scrollable { SetupCards(model: model).padding(.bottom, 10) }
                    .frame(maxHeight: model.conversation.isEmpty ? .infinity : 210)
                if model.conversation.isEmpty {
                    composer
                } else {
                    content
                }
            }
        } else {
            content
        }
    }

    /// "Try again" on a turn that failed: the same words, asked once more. Nil for any other turn.
    private func retry(for turn: Conversation.Turn) -> (() -> Void)? {
        guard case .failed = turn.outcome, !turn.transcript.isEmpty else { return nil }
        let words = turn.transcript
        return { model.ask(words) }
    }

    private var composer: some View {
        Composer(model: model)
            .padding(.horizontal, theme.cornerGap)
            .padding(.top, 8)
            .padding(.bottom, theme.cornerGap)
    }

    /// One column for both states, with the composer after the if/else: in two branches it was a different view each time, so its half-typed draft and
    /// attached files were thrown away whenever the conversation flipped between empty and not (a voice turn arriving, a new chat; code check, 2026-10-16).
    @ViewBuilder private var content: some View {
        VStack(spacing: 0) {
            if model.conversation.isEmpty {
                EmptyConversation(model: model)
                    .padding(.horizontal, Spacing.panel)
                    .frame(maxHeight: .infinity)
            } else {
                if let note = model.trimmedNotice { TrimmedNote(text: note) } // ADR-107
                else if let note = model.cacheExpiredNotice { TrimmedNote(text: note) } // token cost, job 4
                ScrollViewReader { proxy in
                    Scrollable {
                        LazyVStack(alignment: .leading, spacing: Spacing.turn) {
                            ForEach(model.conversation.turns) { turn in
                                TurnView(turn: turn, latest: model.conversation.isLatest(turn), retry: retry(for: turn)).id(turn.id)
                            }
                        }
                        .padding(.horizontal, Spacing.conversation)
                        .padding(.vertical, 20)
                    }
                    .softEdges()
                    .onAppear { proxy.scrollTo(model.conversation.turns.last?.id, anchor: .bottom) }
                    .onChange(of: model.conversation.turns) { _, turns in
                        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(turns.last?.id, anchor: .bottom) }
                    }
                }
            }
            composer
        }
        .frame(maxWidth: .infinity)
    }
}

/// Before the first turn: Pal in a pool of its own light, what to do, and a few phrases to try.
private struct EmptyConversation: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let light = theme.glow.with(alpha: 1).color
        VStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(RadialGradient(colors: [light.opacity(0.22), light.opacity(0)], center: .center, startRadius: 4, endRadius: 46))
                    .opacity(theme.glow.a > 0 ? 1 : 0)
                PalView(mood: .resting, time: 0.3, size: 44)
            }
            .frame(width: 92, height: 92)
            // Void's one display line, in New York (the system serif, ADR-086).
            Text("Ask ATOM anything")
                .font(theme.isFlat ? .system(size: 22, weight: .regular, design: .serif) : .system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(theme.isFlat ? Color.white : theme.text.color)
            Text(talkHint)
                .font(.system(size: 11.5))
                .foregroundStyle(theme.text2.color)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            EmptyConversationExamples(model: model).padding(.top, 6)
        }
    }

    private var talkHint: String {
        guard let combo = model.settings.shortcut(for: .talk) else {
            return "Set a Talk shortcut in Settings to start talking."
        }
        return "Hold \(combo.display), ask anything, then let go. Or type below."
    }
}

struct TurnView: View {
    let turn: Conversation.Turn
    /// The newest turn: full brightness. Older turns recede to secondary text.
    var latest = true
    /// Asks the same words again; only given for a turn that failed.
    var retry: (() -> Void)? = nil
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !turn.transcript.isEmpty { // an answer ATOM posted by itself has no question (ADR-109)
            HStack {
                Spacer(minLength: 48)
                Text(turn.transcript)
                    .font(.system(size: 12.5))
                    .foregroundStyle(theme.text2.color)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).fill(theme.fill1.color))
                    .overlay(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
                        .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color.opacity(0.5), lineWidth: theme.isFlat ? 1 : 0.5))
                    .textSelection(.enabled)
            }
            }
            VStack(alignment: .leading, spacing: 6) {
                switch turn.outcome {
                case .inProgress where turn.reply == nil:
                    ThinkingDots().padding(.vertical, 4)
                case .notice(let message):
                    outcomeLine(message, symbol: "hand.raised.fill", color: theme.attention.color)
                case .failed(let message):
                    if let reply = turn.reply { ReplyText(text: reply, latest: latest, streaming: false) }
                    outcomeLine(message, symbol: "exclamationmark.triangle.fill", color: theme.problem.color)
                    if let retry { QuietButton(title: "Try again", symbol: "arrow.clockwise", action: retry) }
                default:
                    if let reply = turn.reply { ReplyText(text: reply, latest: latest, streaming: turn.isStreaming) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            // Copy sits in the corner of a finished reply and shows while the pointer is over the turn.
            .overlay(alignment: .topTrailing) {
                if let reply = turn.reply, !turn.isStreaming, hovering.wrappedValue {
                    IconButton(symbol: "doc.on.doc", label: "Copy the reply") { Self.copy(reply) }
                        .transition(.opacity)
                }
            }
            // Timings stay out of the way: shown in the gap under the reply only while the pointer is over the turn,
            // so they take no room between turns.
            .overlay(alignment: .bottomLeading) {
                if let timings = turn.timings {
                    Text(NowFacts.summary(timings))
                        .font(theme.idFont(.system(size: 10, design: .rounded), size: 10))
                        .foregroundStyle(theme.text3.color)
                        .fixedSize()
                        .offset(y: 16)
                        .opacity(hovering.wrappedValue ? 1 : 0)
                        .accessibilityHidden(!hovering.wrappedValue)
                }
            }
        }
        .contentShape(Rectangle())
        .onHover { hovering.wrappedValue = $0 }
        .animation(.easeOut(duration: 0.15), value: hovering.wrappedValue)
    }

    private static func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        // A reply with a table, list or code also goes as HTML, so Notes, Pages and Mail paste the real thing.
        if MarkdownBlocks.isRich(text) { NSPasteboard.general.setString(MarkdownBlocks.html(text), forType: .html) }
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
            MarkdownReply(text: text, latest: latest)
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
        .font(.system(size: 13.5))
        .lineSpacing(3)
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
