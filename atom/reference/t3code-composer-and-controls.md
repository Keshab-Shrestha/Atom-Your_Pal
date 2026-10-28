# T3 Code: the composer and the controls around it

> Review update (2026-10-17): [second source review](t3code-second-review-2026-10-17.md) records corrections and pinned evidence. Use the [combined roadmap](../docs/upgrade-roadmap.md) for current ATOM status. Detailed observations below retain the earlier snapshot unless updated explicitly.

Source: github.com/pingdotgg/t3code (MIT licence). Read on 2026-10-17 from a shallow clone at commit `2fbd4318`.
Nobody ran T3 Code. All facts come from reading files. A claim that I did not check in code is marked "unverified".
Size: S is under one day, M is a few days, L is a week or more. Every idea needs its own ADR and task (CLAUDE.md section 3).
Paths that start with `apps/web/src/` are shortened to `web/` in the tables. Paths under `packages/` are full.

Ideas that other files in this folder already propose are not repeated. They are listed in section 4.3.
See `t3code-sessions-and-providers.md` (queue, compact, plan mode, depth, long paste) and `t3code-settings-and-keybindings.md` (command table).

---

## 1. What T3 Code does

### 1.1 The editor

- **Library.** Tiptap 3 on ProseMirror (`web/components/ComposerPromptEditorTiptap.tsx`, 1854 lines).
  `ComposerPromptEditor.tsx` is a 12 line wrapper around it.
  `docs/internals/composer-context-references.md` still says "Lexical". That text is old. The code uses Tiptap.
- **The draft is a plain Markdown string.** The draft store owns the string. The editor is only a view of it.
  A rich-text switch (`composerRichTextEnabled`, default on) changes the extensions and remounts the editor from the string.
  Plain mode leaves `**` and similar marks literal. (`docs/internals/composer-editors.md`)
- **Rich mode.** The marks stay in the text and show beside the styled words when the caret is on them.
  What the user typed is what the model receives. Nothing is converted to HTML.
- **Blocks.** `- `, `1. `, `- [ ] `, `> `, `# `, `---` and a fence of three backticks become list, task list, quote, heading, rule and code block.
  Code lives in `web/composer-rich-text-doc.ts` (1390 lines) and `web/composer-code-block.ts`.
  Block shortcuts of Tiptap itself are removed, because a block that the Markdown writer cannot write would lose text.
- **Code block.** Language picker in the corner (`ComposerCodeBlockLanguagePicker.tsx`, `composer-code-languages.ts`).
  Syntax colour in the draft (`composerCodeBlockHighlight.ts`). Very large blocks have no colour.
  Enter keeps the indent. Tab and Shift+Tab indent the chosen lines. A closing fence or two blank lines leave the block.
  Backspace at the start turns the block back to plain lines.
- **Lists.** Shift+Enter continues a list item. Shift+Enter on an empty item leaves the list. Tab nests.
  Plain mode uses `web/composer-list-continuation.ts` (119 lines, pure string logic).
- **Send and newline keys.** Enter sends. Shift+Enter makes a newline. The setting `sendShortcut` has three values:
  `enter`, `mod-enter-multiline` (Cmd+Enter only when the draft has several lines), `mod-enter`.
  (`packages/contracts/src/settings.ts`, `composerSubmissionIntentForKey` in `web/composer-logic.ts`)
- **Fence before send.** The code block handler must run before the send handler. Else a newline in a code block sends the draft.
  The doc says so in `composer-editors.md`. A test covers it.
- **IME safety.** Every Enter and arrow handler checks `event.isComposing` and `keyCode === 229`.
  The undo grouping also treats IME input as typing. (`ComposerPromptEditorTiptap.tsx` line 1218, `composer-undo-grouping.ts`)
- **Undo.** ProseMirror history, with a rule that groups edits by kind (typing, deleting, other) and a 1000 ms pause.
  Paste and cut are tagged so they form their own undo step. (`web/composer-undo-grouping.ts`)
- **Auto-grow.** The editor class is `min-h-19.5 max-h-52 overflow-y-auto` (about 78 px to 208 px). Then it scrolls.
- **Small touches in the editor.** Select text, then type a quote or bracket: it wraps the text (`handleTextInput`).
  On macOS Home and End go to the line edge. The caret steps over a chip as one character.
- **Paste.** `onComposerPaste` in `web/components/chat/ChatComposer.tsx`:
  1. Files and images become attachments. HEIC becomes JPEG. A large image is resized.
  2. Text of 32 KiB or more (counted in bytes) becomes a file `pasted-text.txt`. The model gets a path, not the text.
     (`packages/client-runtime/src/textPaste.ts`) A smaller paste also becomes a file when it would pass 120,000 characters.
  3. Cmd+Shift+V pastes as plain text and skips step 2 for that one paste.
  4. A copied chip carries its data in a special clipboard type. Pasting it in another thread brings the chip back.
  5. Dropping a folder on the composer inserts its path (`folderDrop.ts`).
- **Limit message.** Over 120,000 characters the composer shows "Prompt is N characters over the 120,000-character limit.
  Shorten or split it before sending." (`composerSubmission.ts`)
- **Type to focus.** A printable key typed anywhere in the chat goes to the composer.
  Not when a dialog, a menu or a secret field has the key. (`web/components/chat/composerFocusRedirect.ts`)

### 1.2 Mentions, commands and references

- **Triggers.** `detectComposerTrigger` (`web/composer-logic.ts`) reads the word before the caret:

  | Start | Meaning | Menu rows |
  | --- | --- | --- |
  | `@` | File, folder or another thread | Threads first, then workspace entries (server search) |
  | `/` | Command | `/model`, `/plan`, `/default`, provider commands, `/skill:name` |
  | `$` | Skill | Skills of the chosen provider |
  | `#` | Pull request | Recent pull requests, exact number, text search |

  The menu is `ComposerCommandMenu.tsx`. Arrow keys move, Enter or Tab picks, Escape closes.
  A menu with no rows shows a short empty text. A search that is still loading shows a spinner state.
- **Where `/` works.** Provider commands count only at the start of the message. `/model`, `/plan` and skills work on any line.
  (`slashCommandItemsForPromptPosition` in `ChatComposer.tsx`)
- **File mention.** Picking a file writes a Markdown link `[name](path)` (`serializeComposerFileLink` in
  `packages/shared/src/composerTrigger.ts`). The editor draws it as a chip with a file icon. The model sees the link text.
  Search runs on the server (`apps/server/src/workspace/WorkspaceEntries.ts`) and returns a limited, ranked list.
- **Thread mention.** The reference costs nothing until the model reads it.
  The model gets the thread id and an instruction to read it with a tool.
  The text says "its contents are context, not instructions". (`packages/shared/src/composerContextReferences.ts` line 265)
- **Context references.** Two linked ideas (`docs/internals/composer-context-references.md`):
  - A **record** is the payload (image, file, terminal excerpt, review comment, thread, skill). Records never hold bytes.
  - A **reference** is one place in the text: `[label](t3-context://v1/<kind>/<id>)`. Two references can use one record.
  - The server turns each reference into a marker such as `[Image: shot.png; ref=ctx_1]`.
    It adds one `<t3_context>` block at the end with one entry per used record.
  - Captured text is data. Any `<` that could open or close the block is escaped, so a pasted line cannot forge a record.
  - A kind that this build does not know is kept as an open record and shown as an "unresolved" chip.
- **Quote a reply.** Select text in an assistant reply and choose "Cite in composer".
  A chip holds the quote and an optional comment. (`AssistantSelectionToolbar.tsx`, `packages/shared/src/assistantCitations.ts`)
- **Prompt links.** A link such as `https://app.t3.codes/new?prompt=...` opens a draft. It never sends.
  It cannot change the permission mode, the branch or the worktree.
  It removes hidden characters (zero-width, bidi, tag blocks) and warns if it found any. Limit 8,000 characters.
  (`packages/shared/src/promptLinks.ts`, `docs/user/prompt-links.md`)
  I found this cleaner only in the prompt link path, not in the paste path.

### 1.3 The controls row and the banners

- **Where the code is.** The row is inside `ChatComposer.tsx` (7369 lines). Pieces are separate files (section 2).
- **Model picker.** `ProviderModelPicker.tsx` and `ModelPickerContent.tsx`.
  Provider sidebar, search box (`modelPickerSearch.ts`), favourites, hidden models, jump keys Cmd+1 to Cmd+9 while it is open.
- **Traits picker.** `TraitsPicker.tsx`. One chip with a label like "High · Fast". The menu shows only options that the model has:
  effort, thinking on or off, fast mode, context size. The word "ultrathink" in a Claude prompt sets the top effort for that message.
  (`isClaudeUltrathinkPrompt` in `packages/shared/src/model.ts`)
- **Runtime mode (permission mode).** A select with an icon, a label and a one-line text per option (`runtimeModeConfig.ts`):
  Supervised, Auto-accept edits, Auto, Full access. The list is cut to what the provider enforces (`supportedRuntimeModes`).
  The tooltip repeats the text. The chosen mode belongs to the thread.
- **Interaction mode.** A Build or Plan toggle button. Shown only when the setting `planModeEnabled` is on (default off).
  Shift+Tab in the editor toggles it. `/plan` and `/default` do the same.
  After a plan arrives, a banner says "Plan ready". The send button becomes "Implement" with a menu entry "Implement in a new thread".
  If the user types text, the button becomes "Refine". (`ComposerPlanFollowUpBanner.tsx`, `ComposerPrimaryActions.tsx`)
- **Branch and host pickers.** `BranchToolbar.tsx`, `BranchToolbarEnvModeSelector.tsx` (Local, New worktree, a previous worktree),
  `BranchToolbarEnvironmentSelector.tsx` (which computer). They sit with the composer and lock after the first message.
- **Narrow width.** Under 620 px the mode and trait controls move into one "..." menu (`CompactComposerControlsMenu.tsx`,
  `composerFooterLayout.ts`). In a long thread, scrolling up shrinks the composer to one row (setting `composerCollapseOnScroll`, default on).
- **Send and stop button** (`ComposerPrimaryActions.tsx`). One round button with these states:
  - Idle with text: up arrow. Empty: disabled.
  - Busy or connecting: spinner.
  - Agent running and draft empty: red Stop square, tooltip "Interrupt".
  - Agent running and draft has text: icon morphs between "queue" and "steer". Holding Cmd or Ctrl flips it live.
  - Editing a queued message: check mark, label "Update queued message".
  - Held queue after a restart: Play icon, label "Resume thread".
  - Old long thread: a "Compact 120k" chip next to the button (see context meter).
  - Disabled: the tooltip and the aria label give the reason (`sendDisabledReason`).
- **State-aware placeholder.** The empty text changes with the state: "Resolve this approval request to continue",
  "Choose an option above", "Choose a project above to start a thread", "Enable a provider in Settings to send a message",
  and the normal "Ask anything, @tag files/folders, $use skills, or / for commands". (`ChatComposer.tsx` line 7146)
- **Queue panel** (`QueuedRunsControl.tsx`). A banner above the composer. Each row has: a grip (drag, or arrow keys), image thumbnails,
  one-line text with a tooltip, a pencil (edit), a "Steer" button, and a remove button. The panel can collapse.
  An unsaved row shows a clock. The pencil loads the text and files into the composer; the row stays and is highlighted;
  the check mark saves in place; Cancel restores the earlier draft. (`queuedMessageEdit.ts`, `useQueuedRunEdit.ts`)
  Setting `followUpBehavior` (queue or steer, default queue) picks the plain-Enter action. The opposite action is Cmd+Enter.
  Steer is off while the agent compacts, so the message queues. (`packages/client-runtime/src/state/composerDispatch.ts`)
- **Context meter** (`ContextWindowMeter.tsx`). A small ring. It turns red above 90 percent.
  Hover opens a card: percent, used and maximum tokens, total processed, cost, an "auto compacts at N tokens" line,
  a "Compact context" button, and the reason when the button is off. Setting `contextWindowMeterEnabled` is off by default.
- **Compact chip.** For Claude, when the thread has 100,000 tokens or more and has been idle longer than the prompt cache time
  (fallback 70 minutes), the send button gets a chip "Compact 120k". Click toggles "Compact" and "Full".
  The tooltip says "Summarize 120k tokens of history, then send". (`shouldOfferResumeCompaction` in `ContextWindowMeter.logic.ts`)
- **Voice input.** Only on iPhone (iOS 26). A microphone in the composer. Record up to 5 minutes, then confirm to transcribe on the device.
  The text goes in at the caret. The controller saves the draft text, caret and a revision number first.
  A late result is dropped if the draft changed. While it records, the editor is frozen and send is blocked.
  (`packages/client-runtime/src/voice-input/controller.ts`, `apps/mobile/src/features/voice-input/ComposerDictationControl.tsx`)
  I found no voice button for web or desktop.
- **Attachments.** Images show as a thumbnail shelf and also as a chip at the caret. Files exist only as chips.
  Click opens a preview (code colour, rendered Markdown, CSV, audio). Upload starts at once. Send waits for all uploads.
  A failed upload has Retry and Remove. Limits: 100 files, 10 MiB per image, 80 MiB of images, 50 MiB per file.
  Removing an image that the text still mentions asks first. (`composerAttachmentFiles.ts`, `ComposerImageThumbnail.tsx`)
- **Drafts.** One draft per thread in a persisted store (`web/composerDraftStore.ts`, key `t3code:composer-drafts:v1`, version 9).
  The store also remembers the last model and its options per provider ("sticky").
  ArrowUp in an empty composer recalls sent prompts (`composerPromptHistory.ts`). It works only on the first visual line.
  Cmd+S stashes the draft and its files for 24 hours (`promptStashStore.ts`, `ComposerStashMenu.tsx`).
  A small badge with a count pulses when a stash is saved.
- **Question card** (`ComposerPendingUserInputPanel.tsx`). When the agent asks a question, a card opens above the composer.
  Options have number badges 1 to 9, and the number key picks. A single choice moves on by itself after a short delay.
  The composer becomes the "own answer" field, with its own placeholder. The primary button reads "Next question" or "Submit answers".
  A question with a free answer accepts files and images (`docs/user/question-attachments.md`).
  A question with fixed choices only disables the editor.
- **Approval card** (`ComposerPendingApprovalPanel.tsx`, `ComposerPendingApprovalActions.tsx`).
  It names the kind (Command approval, File change approval, File read approval). Buttons: Approve, Always allow this session, Decline, Cancel.
  The editor is disabled until the user answers.
- **Typing guard** (`composerTypingGuard.ts`). A new question or approval that arrives while the user types (last key under 1.5 s ago)
  is held back until the user stops, leaves the box or sends. This stops a stray Enter from answering a card.
- **Banner stack** (`ComposerBannerStack.tsx`). Queue, tasks, notices, usage limit, provider status and update notices share one stack.
  Order: activity, then urgent or error, then notices. A peek button expands the rest. A dismissed banner fades for 220 ms.
- **Task progress** (`ComposerTasksBadge.tsx`). A row of up to 10 segments shows the agent's to-do steps and their state.
- **Usage in the composer.** The command `/usage` opens a banner with the plan limits and reset times (`ComposerUsageLimits.tsx`).
  When a limit is hit, `UsageLimitRecoveryBanner.tsx` says "Usage limit reached" with the reset time.

### 1.4 Keyboard

- **Global and composer shortcuts** are data. One list, `DEFAULT_KEYBINDINGS` in `packages/shared/src/keybindings.ts`.
  Each rule has a key, a command and a `when` condition such as `composerFocus && turnRunning`.
  The user can change them in a JSON file (see the settings file in this folder).
- **Composer rules in that list** (`mod` is Cmd on macOS):

  | Key | Command |
  | --- | --- |
  | Enter | Send (fixed in code, mode set by `sendShortcut`) |
  | Cmd+Enter while running | Do the other action (steer or queue) |
  | Cmd+Shift+Enter | Send the oldest queued message as a steer |
  | Alt+ArrowUp in the composer | Edit the newest queued message |
  | Cmd+S | Stash the draft, or restore a stash |
  | Cmd+Alt+Enter | Send and open a new thread |
  | Cmd+Shift+M | Open the model picker |
  | Cmd+Shift+E | Open the traits (effort) menu |
  | Cmd+Shift+A | Open the runtime mode menu |
  | Cmd+Shift+H, X, G, L | Host, workspace mode, branch, previous worktree |
  | Cmd+N, Cmd+Shift+O | New thread |
  | Cmd+K | Command palette |

- **Composer-local keys** are in `onComposerCommandKey` (`ChatComposer.tsx` line 4134): Shift+Tab toggles Plan, Escape closes the menu,
  arrows move the menu, Enter or Tab picks, ArrowUp or ArrowDown recall prompts.
- **How a shortcut opens a control.** Each control has `data-composer-shortcut="composer.mode"`. A handler finds the visible
  button with that value, focuses it and clicks it (`openControl`, `ChatComposer.tsx` line 6099). The hidden "..." menu has two values.
- **Hints.** Tooltips show the key through `shortcutLabelForCommand`. Closing the palette returns focus to the composer
  (`docs/user/keyboard-focus.md`). Number keys pick items while a picker is open instead of switching threads.

### 1.5 Empty state of a new thread

- A "draft" thread has a hero headline (`web/components/chat/DraftHeroHeadline.tsx`):
  "What should we build in <project>?". The project name is a dotted-underline link that opens a search box of projects.
  The box also has "Add project". A "no project" scratch space exists. Without a project the headline reads "What should we work on?".
- When the first message goes, the headline fades and the composer moves down (`draftHeroTransition.ts`, easing `cubic-bezier(0.4, 0, 0.2, 1)`).
- Without a project the composer is off and says "Choose a project above to start a thread".
- I found no suggestion chips or example prompts in the web empty state (unverified: I did not read all of `ChatView.tsx`).
- First run: a welcome wizard connects computers, checks Claude Code and Codex sign-in, and imports projects
  (`docs/user/welcome-wizard.md`). It runs once. The setup terminal opens with the right command ready.

### 1.6 What makes it feel good

- Every disabled control says why (tooltip, aria label, or placeholder). Examples in 1.3.
- State-aware placeholder and button label (Submit, Queue, Steer, Update, Resume, Implement, Refine, Compact and send).
- The send icon morphs; the button grows 5 percent on hover and sinks on press (`ComposerPrimaryActions.tsx`).
- Motion respects reduced-motion (`motion-reduce:transition-none` on the meter and the stash count).
- A toast explains a blocked send: "Still bringing attached context into this message. Send again once its chip resolves."
- Copy and paste keep chips. Undo does not merge paste with typing.
- Haptics: I saw haptic calls only in `apps/mobile`. Not checked for the composer (unverified).

---

## 2. Where to look

| Feature | Path |
| --- | --- |
| Composer shell, footer, paste, menus, keys | `apps/web/src/components/chat/ChatComposer.tsx` |
| Editor (Tiptap) | `apps/web/src/components/ComposerPromptEditorTiptap.tsx` |
| Markdown <-> editor document | `apps/web/src/composer-rich-text-doc.ts`, `composer-rich-text.ts` |
| Code block, list rules | `apps/web/src/composer-code-block.ts`, `composer-list-continuation.ts` |
| Undo grouping | `apps/web/src/composer-undo-grouping.ts` |
| Triggers `@ / $ #`, send key intent | `apps/web/src/composer-logic.ts` |
| Mention tokens in text | `packages/shared/src/composerInlineTokens.ts`, `composerTrigger.ts` |
| Mention menu | `apps/web/src/components/chat/ComposerCommandMenu.tsx`, `composerSlashCommandSearch.ts` |
| Context record contract | `packages/contracts/src/composerContext.ts` |
| Reference grammar and projection | `packages/shared/src/composerContextReferences.ts` |
| Long paste rule | `packages/client-runtime/src/textPaste.ts` |
| Send, queue, steer decision | `packages/client-runtime/src/state/composerDispatch.ts` |
| Send and stop button | `apps/web/src/components/chat/ComposerPrimaryActions.tsx` |
| Queue panel | `apps/web/src/components/chat/QueuedRunsControl.tsx`, `queuedMessageEdit.ts` |
| Model picker | `ProviderModelPicker.tsx`, `ModelPickerContent.tsx`, `modelPickerSearch.ts` (in `components/chat`) |
| Traits picker | `apps/web/src/components/chat/TraitsPicker.tsx` |
| Runtime mode labels | `apps/web/src/components/chat/runtimeModeConfig.ts` |
| Plan mode banner and card | `ComposerPlanFollowUpBanner.tsx`, `ProposedPlanCard.tsx` |
| Branch, host, workspace pickers | `apps/web/src/components/BranchToolbar*.tsx` |
| Narrow footer menu | `CompactComposerControlsMenu.tsx`, `apps/web/src/components/composerFooterLayout.ts` |
| Context meter and compact chip | `ContextWindowMeter.tsx`, `ContextWindowMeter.logic.ts` |
| Question card | `ComposerPendingUserInputPanel.tsx`, `apps/web/src/pendingUserInput.ts` |
| Approval card | `ComposerPendingApprovalPanel.tsx`, `ComposerPendingApprovalActions.tsx` |
| Typing guard | `apps/web/src/components/chat/composerTypingGuard.ts` |
| Banner stack | `ComposerBannerStack.tsx`, `ComposerBanner.tsx` |
| Drafts and sticky model | `apps/web/src/composerDraftStore.ts` |
| Prompt stash | `apps/web/src/promptStashStore.ts`, `ComposerStashMenu.tsx` |
| Prompt recall (ArrowUp) | `apps/web/src/components/chat/composerPromptHistory.ts` |
| Attachments | `composerAttachmentFiles.ts`, `ComposerImageThumbnail.tsx`, `packages/contracts/src/chatAttachment.ts` |
| Prompt links | `packages/shared/src/promptLinks.ts`, `apps/web/src/components/promptLinks/` |
| Voice input | `packages/client-runtime/src/voice-input/`, `apps/mobile/src/features/voice-input/` |
| Default key bindings | `packages/shared/src/keybindings.ts` |
| Type-to-focus | `apps/web/src/components/chat/composerFocusRedirect.ts` |
| Empty state | `apps/web/src/components/chat/DraftHeroHeadline.tsx`, `draftHeroTransition.ts` |
| Docs | `docs/user/composer.md`, `permission-modes.md`, `prompt-links.md`, `question-attachments.md`, `keyboard-focus.md`; `docs/internals/composer-editors.md`, `composer-context-references.md`, `voice-input.md` |
| Tests (examples) | `composer-logic.test.ts`, `composer-rich-text-doc.test.ts` (1097 lines), `composerDispatch.test.ts`, `ComposerPrimaryActions.test.tsx` |

---

## 3. What ATOM has today and the gap

I read `ConversationView.swift`, `ComposerPaste.swift`, `AtomIslandCore/ComposerInput.swift`, `MentionMenu.swift`, `SlashMenu.swift`,
`MessageQueue.swift`, `ComposerDraft.swift`, `WindowTopBar.swift` (`ChatModelMenu`) and ADR-113, 117, 125, 126, 127.

| Feature | T3 Code | ATOM today | Gap |
| --- | --- | --- | --- |
| Editor | Tiptap, Markdown, chips inside text | SwiftUI `TextField` with `axis: .vertical`, plain text | Large. A rich editor needs an `NSTextView` wrapper (L). Not recommended now |
| Auto-grow | 78 to 208 px | 1 to 8 lines, then scrolls | None |
| Newline | Shift+Enter | Shift+Return (`newLine`) | None |
| Send key setting | 3 choices | Return only. Cmd+Return sends now while answering | Small. No choice |
| IME safety | `isComposing` checks | Return belongs to the input method (ADR-125) | None |
| Undo | Grouped history | Native field undo | None |
| Code blocks, lists, quotes | Yes | No | Not needed for a chat to Claude |
| Paste files | Yes | Yes, Finder files win over names (ADR-125) | None |
| Paste image | Yes, HEIC and resize | Yes, PNG, JPEG over 10 MB | None |
| Paste long text | File at 32 KiB | `text.send` refuses over 4000 characters (`island-commands.ts` line 316) | Gap (idea in sessions file) |
| Hidden characters | Cleaned in prompt links only | Not cleaned | Gap (idea 3) |
| Drop files | Yes, folders become a path | Yes, files only (`dropDestination`) | Small |
| `@` menu | Files, threads, search on server | Helpers, Second brain pages, "A file..." chooser | No project file search (ADR-126 left it out) |
| Inline chips | In the text | A chip row above the field | Large (L); the row is fine |
| `/` menu | Commands, skills | ATOM commands, skills, Claude commands (ADR-117) | No `/usage`, no `/plan` |
| `#` and `$` triggers | Yes | No | Not needed |
| Quote a reply | "Cite in composer" | No | Gap (idea 9) |
| Prompt links | Yes | No URL scheme found in `apps/mac` | Gap (idea 10) |
| Model picker | Search, favourites, per provider | Menu per chat with providers and "Custom model..." | Favourites (sessions file) |
| Effort, thinking, speed | Traits picker | Fixed `thinking: disabled`; no effort | In sessions file (depth idea) |
| Permission mode | 4 modes per thread | One fixed policy; the gate decides (`native-safety.ts`) | Gap (idea 8): the user cannot see the policy |
| Plan mode | Toggle, card, Implement | Plan-first helpers only | In sessions file |
| Branch, host pickers | In the composer | Not in the chat box | Not needed for chat; projects have git views |
| Send and stop | One button, many states, Stop when empty | `ComposerButton`, `StopReplyButton` when answering and empty | Parity on Stop. Gap in queue icon and tooltip (idea 1) |
| Queue | List with edit, reorder, steer, remove | One "Next" row; messages join (ADR-127) | Gap (idea 4) |
| Steer | Yes | No. Cmd+Return stops and sends | Unverified whether the SDK allows it |
| Context meter, Compact | Ring and chip | None | In sessions file |
| Voice | iPhone only | Hold-to-talk and dictation (strong) | ATOM is ahead |
| Attachments | Chips, preview, retry | Name chip with X; 5 files, 10 MB | Gap (idea 6) |
| Drafts | Per thread, saved to disk | Per chat, in memory, 20 chats, lost at quit (ADR-125) | Gap (idea 5) |
| Prompt stash | Cmd+S, 24 hours | None | Part of idea 5 |
| Prompt recall | ArrowUp | ArrowUp, 50 messages (`MessageRecall`) | None |
| Question card | Yes | None found. Tools outside the chat's set are denied (`native-safety.ts` line 25) | Gap (idea 7). Unverified: I did not test `AskUserQuestion` itself |
| Approval card | Composer-side card, 4 buttons | Needs-you card, Allow or Decline (`ApprovalState.swift`) | Fine. No "allow for this session" by design |
| Typing guard | Holds new cards 1.5 s | None found | Low value in ATOM (idea 12) |
| Shortcuts in the window | Data table, hints | Global keys only; Escape; Cmd+Return | Gap (command table idea in settings file) |
| Type-to-focus | Yes | No | Gap (idea 11) |
| Collapse on scroll | Yes | No | Low value (idea 12) |
| Disabled-state reasons | Placeholder, tooltip, aria | Read-only notice (ADR-098); send tooltip "Send (Return)" | Gap (idea 1) |
| Empty state | Hero headline, project picker | Pal, "Ask ATOM anything", brief card, example chips | ATOM is richer. Project picker is a small gap (idea 12) |
| First-run wizard | Computers, agents, projects | `FirstRunTour`, setup cards | Different job |

---

## 4. Ideas for ATOM, ranked

Rules used to judge each idea: it runs on the user's Claude plan with no billed key; code decides permissions, never the model;
minimal change; no heavy dependency; native SwiftUI.

### 4.1 Ranked list

#### 1. State-aware placeholder and send button (size S)
- **What.** One pure function returns the placeholder, the button tooltip and the button icon from the state.
  States: idle, answering with text (queue), answering and empty (stop), file limit reached, runtime not ready, read-only chat.
  While answering, the tooltip says "Return: wait for the answer. Cmd+Return: send now." The icon shows a queue mark.
- **Why.** T3 Code tells the user why a control is off and what a key does now. ATOM's tooltip says only "Send (Return)" (`ConversationView.swift` line 479).
  ADR-127 added a second meaning for Return that nothing shows.
- **Fit.** Pure Swift. No runtime change. Uses facts that the model already has (`answering`, `queue`).
- **First step.** Add `ComposerHint` in `AtomIslandCore` with tests. Use it for `placeholder` and `.help` in `Composer`.

#### 2. Native Quick Look and thumbnails on attached files (size S to M)
- **What.** An image chip shows a 24 px thumbnail. A click on any file chip opens Quick Look (`QLPreviewPanel`). Pasted screenshots get a real preview.
- **Why.** T3 Code previews attachments before send. A pasted image is named "Pasted image 2026-10-17 at 09.12.png" and shows nothing else.
  The user cannot check that the right screenshot is attached.
- **Fit.** AppKit only (`QuickLookUI`, `NSImage`). No dependency. The file stays on disk and is not read by the model until send.
- **First step.** Thumbnail for image files in `AttachedFilesRow.chip` (loaded off the main thread, cached by path). Then Quick Look on click.

#### 3. Remove hidden characters from pasted text, with a notice (size S)
- **What.** On paste and on send, drop zero-width, bidi, tag-block and similar characters. Show "Removed N hidden characters" once.
  Keep emoji joiners that sit between emoji.
- **Why.** Hidden text can carry instructions that the user cannot see. ATOM gives Claude tools. T3 Code does this for prompt links
  (`sanitizeLinkedPrompt`, `packages/shared/src/promptLinks.ts`). I found no call in its paste path, so ATOM can go one step further.
- **Fit.** Deterministic code, not the model. Small pure function. No new permission. Reversible by one setting if needed.
- **First step.** `HiddenCharacters.strip(_:)` in `AtomIslandCore` with tests built from the T3 Code character ranges (read the ranges, write ATOM's own code).

#### 4. A list of waiting messages instead of one joined message (size M)
- **What.** Show each waiting message as a row with Edit, Send now and Remove. Keep the join as an option, not the only way.
  Later: drag to reorder. Later still: Steer (see the note below).
- **Why.** T3 Code has this (`QueuedRunsControl.tsx`). ADR-127 listed it as left out. Today two messages merge into one turn, and the user cannot remove one.
- **Fit.** `MessageQueue` is pure and tested, so the change is local. Steer into a running turn is unverified for ATOM's one-session-per-chat design (ADR-110).
  Do not promise it. "Send now" already exists.
- **First step.** Change `MessageQueue.next` to an array. Keep the rule "stopped or failed turn puts all back in the box". Add a row view per message.

#### 5. Drafts saved to disk, then a stash (size S, then M)
- **What.** Step 1: write each chat's unsent text to a small JSON file so a quit does not lose it. Step 2: a stash with a shortcut and a menu.
- **Why.** ADR-125 says drafts are gone when ATOM quits. T3 Code stores drafts (`composerDraftStore.ts`) and stashes for 24 hours.
- **Fit.** Text only. Files stay as paths and are checked again on restore (ADR-113 refuses secret files). Store in the app data folder with mode 0600.
  A draft may hold a secret. Add it to the list of things that "Forget" clears.
- **First step.** Persist `ChatDrafts` text on change (debounced) and load at start. Keep the 20 chat limit. Add a test.

#### 6. File search in the "@" menu for project chats (size M)
- **What.** In a project chat, "@" also lists files of the project folder, ranked by name. A pick attaches the file as today (copy into the chat).
- **Why.** T3 Code's "@" is mostly file search. ADR-126 left it out and sends the user to the file chooser.
- **Fit.** Read only. Reuse the project read check (ADR-107) and its rules for secret files. Limit results to 8. No new dependency.
  The model still gets the file through the normal attach path, so the gate stays the owner.
- **First step.** A runtime command `files.search { chat, query }` that walks the project folder with a cap and returns paths. Show them under the pages in `MentionMenu`.

#### 7. A question card for the model (size M, needs an ADR)
- **What.** Let Claude ask one question with 2 to 4 options. The card shows number badges. Keys 1 to 9 pick. The user may type an own answer.
  The answer goes back as the tool result.
- **Why.** T3 Code turns `AskUserQuestion` into a card (`ComposerPendingUserInputPanel.tsx`). ATOM denies tools outside the chat's set, so helpers must guess or stop.
- **Fit.** Code decides: the gate allows only this tool, returns only the user's text, and times out like approvals (60 s, ADR-054).
  No file or command access. The card is not an approval. It must not look like one.
- **First step.** Read how `canUseTool` in `native-safety.ts` answers an unknown tool. Write the ADR. Build the card with `ApprovalState` as the model.

#### 8. A read-only "Access" pill that shows the policy (size S, then M)
- **What.** A small pill near the model menu: "Asks before changes". The tooltip lists in plain words what the gate allows in this chat.
  Later: 2 or 3 levels per chat, each enforced by the gate.
- **Why.** T3 Code shows its mode with an icon and one line per option (`runtimeModeConfig.ts`). ATOM's policy is strict but invisible.
- **Fit.** Never copy the T3 default `full-access`. Never offer a bypass mode. Show only what code enforces. Step 1 changes no behaviour.
- **First step.** Build the sentence from the same rules `native-safety.ts` uses, in one tested function. Show it in the pill tooltip.

#### 9. "Reply to this" quote (size S)
- **What.** A button on a reply inserts its first lines as a Markdown quote ("> ...") at the end of the box, with the caret below.
- **Why.** T3 Code lets the user cite part of a reply with a comment. The full version needs a text selection toolbar.
  The small version works with ATOM's `ReplyText` and a button next to "Copy the reply".
- **Fit.** Pure text. No model change. The quote counts toward the 4000 character limit.
- **First step.** Add `ComposerDraft.quoting(_:)` and an `IconButton` in `TurnView`.

#### 10. Prompt links with an `atom://` scheme (size M)
- **What.** `atom://new?prompt=...` opens the window with the text in the box. It never sends. It strips hidden characters (idea 3).
  It cannot change the model, a permission or a project.
- **Why.** Useful for notes, Shortcuts app, Raycast and pull request comments. T3 Code's rules are good: draft only, length limit 8,000, warn on hidden text.
- **Fit.** Needs a URL scheme in `Info.plist`; I found none in `apps/mac` (unverified for the packaged app). It is a new way in, so it needs an ADR and a security note.
- **First step.** Write the parser and its tests first. Decide the scheme with Keshab before any plist change.

#### 11. Type to focus (size S)
- **What.** A printable key typed while the chat page shows and no field has focus goes to the box.
- **Why.** T3 Code does this (`composerFocusRedirect.ts`). The user can start typing at once after opening the window.
- **Fit.** `ComposerPaste` already owns a local key monitor for the composer. Add the rule there. Skip when a sheet, a menu or a text field has focus.
- **First step.** A pure `shouldRedirect(key, firstResponder, hasSheet)` with tests. Then one call in the monitor.

#### 12. Three small, low-value ideas (size S each)
- **Hold new cards while the user types.** T3 Code holds a card for 1.5 s (`composerTypingGuard.ts`) so a stray Enter cannot answer it.
  ATOM answers cards by click, as far as I read (unverified for every card). Skip unless a key can answer a card.
- **Shrink the box when the user scrolls up** (`composerCollapseOnScroll`). Gain is larger in ATOM's small panel. Make it opt-in. Measure first.
- **Project name in the empty chat** ("in <project>" with a small picker, like `DraftHeroHeadline.tsx`). ATOM chats are not per project by default. Ask Keshab first.

### 4.2 Suggested order

1. Idea 1, then 3, then 11. Each is S, pure, and has tests.
2. Idea 5 step 1 (drafts to disk). It fixes a loss the user can feel.
3. Idea 2 (thumbnails first).
4. Idea 4, then 6, then 7 (each needs a short ADR).
5. Ideas 8, 9, 10 when Keshab wants them. Idea 12 is optional.

### 4.3 Already proposed in other files, with the composer part

| Idea | Where | What the composer part looks like in T3 Code |
| --- | --- | --- |
| Long paste becomes a file | `t3code-sessions-and-providers.md` idea 5 | Threshold 32 KiB in bytes. File name `pasted-text.txt`, then `pasted-text-2.txt`. Cmd+Shift+V keeps text. Also folds when the text would pass the limit |
| Context meter and Compact | same file, idea 2 | Ring, red above 90 percent. Chip "Compact 120k" only for old threads. Tooltip gives the token count |
| Edit an earlier message | same file, idea 3 | Button under each sent message. The text and files return to the composer |
| Depth choice | same file, idea 9 | One chip "High · Fast". Shows only options the model has. The word "ultrathink" sets top effort for one message |
| Plan mode for a plain chat | same file, idea 11 | Build or Plan button, Shift+Tab, banner "Plan ready", button becomes Implement or Refine |
| Command table and hints | `t3code-settings-and-keybindings.md` | Controls carry a `data-composer-shortcut` name. One handler clicks the visible control |

### 4.4 Not recommended now

- **A rich Markdown editor with inline chips.** Needs an `NSTextView` wrapper and a document model (T3 Code uses about 3,500 lines for it).
  A chat to Claude gains little. The chip row above the field works.
- **Code blocks and list continuation in the draft.** SwiftUI's field does not tell the caret position (ADR-126), so only end-of-text rules are possible.
- **`#` pull request and `$` skill triggers.** ATOM already has "/" for skills. Pull requests belong to the project pages.
- **Branch and host pickers in the chat box.** ATOM chats are not tied to a branch.
- **Typed send shortcut (Enter, Cmd+Enter).** Keshab sends with Return and talks with a hold key. Add it only if asked.
- **Voice button parity.** ATOM is ahead. Take one rule only: if dictation ever writes into the box, check that the text did not change before inserting
  (`controller.ts` keeps a revision number). Unverified whether ATOM's dictation targets the box.

## 5. Not checked

- I did not run T3 Code or read all 7369 lines of `ChatComposer.tsx`. I read the parts named above.
- I did not read the server code that turns file links into model text. Only the thread and context projection is read.
- I did not read mobile composer code beyond voice input.
- Steer into a running Claude turn in ATOM: unverified.
- Whether ATOM's packaged app registers a URL scheme: unverified.
