# Cross-platform window — migration from Swift (ADR-201)

Keshab asked for ATOM's app to leave Swift for something fast that runs on Mac, Windows and Linux, with every feature kept. This page is the plan and the checklist. **Nothing is deleted from the Swift app until a row below is verified at parity.** The Swift app keeps shipping on the Mac in the meantime.

## What moves, and what does not

ATOM already has two parts that talk by JSON lines (ADR-034, [island protocol](island-protocol.md)):

```text
Swift app (ATOM Island)  ──stdin/stdout──▶  TypeScript runtime (apps/mac/src)
  windows, menu bar, Pal                      chats, agents, memory, tools, models, approvals
```

The features live in the runtime. The Swift app is a client of it. So the migration replaces the client and leaves the runtime and the protocol alone:

```text
Window (TypeScript, Preact)  ──HTTP/SSE──▶  Bridge (Node)  ──stdin/stdout──▶  Runtime (unchanged)
   apps/desktop/ui                           apps/desktop/bridge
```

- **Runtime and protocol:** unchanged. Every command and event keeps its meaning.
- **Window:** a web UI in the "Four-lane workspace" design (rail, chat list, chat, workspace surface). It takes its event and command types from the runtime's own protocol file, so a protocol change that the window does not handle fails `pnpm typecheck`.
- **Bridge:** a Node program with no dependencies. It starts the runtime, restarts it with the Swift app's policy (1, 2, 4, 8, 15, 30 s; give up after 6 quick failures; exit 78 is a configuration error), and carries the lines over loopback HTTP. See [SECURITY.md](../SECURITY.md) for what protects that door.
- **Native shell (proposed, not built):** Tauri 2 (Rust, the system web view). It is small and fast, and gives a tray icon, global shortcuts and overlay windows on all three systems. It is not adopted until it builds and runs on macOS, Windows and Linux. The window talks to the shell through a `Transport` interface, so the choice is reversible (Electron is the fallback).

## What exists now (step 1, 24 October 2026)

| Piece | State |
|---|---|
| Bridge: start, supervise, restart, stop; SSE events; POST commands; token, Host and Origin checks | Done. 17 tests |
| Window: four lanes, dark and light themes from the design, Chat list, Chat view, composer, status pill, plain error banners | Done. 12 tests (event reducer, SSE parser, token contrast in both themes) |
| Chat flow against the real runtime | Starts, reports `ready`, shows its model, shows an empty chat list, shuts down cleanly. No model turn was sent (it would use a provider login) |
| Chat flow against a fake runtime | Load, open, send, reply, new chat, reload, narrow window, wrong token: checked in Chromium |
| Workspace lane | Shows the five surfaces as "Not in this build yet" so nothing looks broken |

Run it: `pnpm desktop:build`, then `pnpm desktop` (real runtime) or `pnpm desktop:demo` (a fake runtime, no keys). Open the address it prints.

## Parity checklist

Status words: **done**, **partial**, **todo**. A row is done only when it works against the real runtime and has a test or a recorded check. The Swift column is the view or code that the row replaces.

### A. Window screens

| Feature | Swift source | Status | Port step |
|---|---|---|---|
| Chat list: open, new, search, archived fold, pinned first, read-only tag | `SidebarLayout`, `ChatList` parts of `HelpersView` | partial: no drag order, no projects filter | 2 |
| Chat actions: rename, pin, archive (with Undo), delete with confirmation | `ChatControlsModel`, `ProjectsSection` | **done** (step 2c) | 2c |
| Chat view: messages, send, status pill, errors, stay-at-end scrolling | `ConversationView`, `StateViews`, `ChatScrollView` | partial | 2 |
| Markdown replies: headings, lists, tasks, quotes, rules, code, tables, bold/italic/strike/code/links | `MarkdownReply`, `MarkdownBlocks` | **done** (step 2a) | 2a |
| Copy: reply (Markdown, plain, rich), message, code, table (Markdown+rich, TSV, CSV), last reply (Ctrl/Cmd+Shift+C) | `ChatCopyControl`, `ChatActionsMenu`, `MarkdownCopy`, `MarkdownHTML` | **done** (step 2d-1) | 2d |
| Quote a reply into the draft ("Reply to this") | `ComposerQuote`, `IslandModel.quoteReply` | **done** (step 2d-1) | 2d |
| Fork through a message, fork the chat, edit and retry in a new chat | `ChatControlsModel`, `ChatActionsMenu` | **done** (step 2d-2); "Check result" after a lost answer is not ported | 2d-2 |
| Saved history sheet, chat brief, automatic summaries | `ChatControlsModel`, `ChatBriefEditor` | todo | 2h |
| Attachments (button, drop, pasted files and images, 5 files of up to 10 MB), chips with image thumbnails, long paste to a text file, hidden-character cleanup | `ChatAttachments`, `ComposerPaste`, `PastedTextFile`, `IslandController+Drop`, `HiddenCharacters` | **done** (step 2f); no Quick Look preview, no "Second brain note" chips, no persistence of pasted files | 2f |
| Stop (button and Esc), working strip | `WorkStrip`, `IslandController+Shortcuts` | **done** (step 2b) | 2b |
| Per-chat drafts and files, message queue (Enter queues while busy, Ctrl/Cmd+Enter sends the oldest now), held messages after Stop, an error, leaving the chat or a restart, Edit and Remove, 20 per chat, drafts saved across restarts | `ChatInput`, `ComposerDraft`, `IslandModel` queue | **done** (step 2g-1); files are not kept across a restart | 2g-1 |
| Recovery of interrupted requests and unconfirmed answers: delivery ids and receipts, the Recovery view, restore to a draft, dismiss | `ForegroundRecovery*` | **done for requests** (step 2g-2); unconfirmed answers to ATOM's questions wait for 2i | 2g-2, 2i |
| Model picker (search, provider filter, custom id, default), thinking menu, access menu incl. Full access consent | `ChatModelPicker`, `ChatReasoningMenu`, `ChatAccessMenu`, `ModelPickerCatalog` | **done** (step 2e); favourite models not ported | 2e |
| Slash picker (`/` menu: ATOM's commands, skills, Claude commands) | `SlashPicker`, `SlashMenu` | **done** (step 2h-1); `/model`, `/skills` and `/memory` say where to go until their pages exist | 2h-1 |
| Find in chat (loaded messages only) | `ChatFindBar`, `ChatFind` | **done** (step 2h-2) | 2h-2 |
| Chat brief, saved history sheet, automatic summaries | `ChatBriefEditor`, `ChatControlsModel` | todo | 2h-3 |
| Approvals: Allow, Decline, Allow for task/chat, Full-access card | `ApprovalState`, `WorkStrip` | **done** (step 2b) | 2b |
| File-edit review approvals (diff and token) | `EditReviewView`, `FileEditReview` | partial: can be declined, cannot be approved here (needs the diff surface) | 2j |
| Questions from ATOM, work and task results shown in chat | `ChatWorkView`, `ChatTaskResults`, `ComputerDecisionModel` | todo | 2i |
| Projects: add, rename, filter, sources, settings | `ProjectsSection`, `ProjectSettingsSheet`, `ProjectSourceSheet`, `ProjectFilterPicker` | todo | 5 |
| Files surface | `ProjectWorkspaceView`, `ProjectFileNavigation` | todo | 5 |
| Changes surface (compare, undo) | `EditReviewView`, `FileEditReview` | todo | 5 |
| Git surface | `ProjectGitView` | todo | 5 |
| Terminal surface | `WorkspaceTerminalView` (SwiftTerm, `AtomPTY`) | todo: needs a terminal emulator and a pseudo-terminal on each system | 6 |
| Browser surface | `WorkspaceBrowserView` (WebKit) | todo: a native web view per system | 6 |
| Needs you, Overview, Board, Floor, Columns | `NeedsYouView`, `OverviewView`, `OfficeFloorView`, `OfficeDrawing` | todo | 4 |
| Agents, tasks, timeline, checkpoints, souls, plans, test cases | `Helpers*View`, `PlanViews`, `TestCaseViews` | todo | 4 |
| Skills, skills hub, plugins, MCP | `SkillsSection`, `HubSkillsView`, `PluginsView`, `McpPasteForm` | todo | 7 |
| Dashboard (tokens, cost, plan use) | `DashboardView` | todo | 4 |
| Brain (graph, notes, sources) | `BrainView`, `BrainSourcesPane` | todo | 8 |
| Scheduled, daily brief, remember rows | `ScheduledView`, `BriefViews`, `RememberRows`, `PreparedBriefCards` | todo | 8 |
| Search everything | `SearchViews`, `SearchOpening` | todo | 8 |
| Reply drafts, Ask ATOM | `ReplyDraftPane`, `AskAtomPanel` | todo | 8 |
| Settings (all groups), backups, themes, shortcuts, setup | `Settings/`, `SetupViews`, `LocalBackupPane` | todo | 7 |
| Other themes (Daylight is the light theme now; Lantern, Quiet Native, Luminous, Warm) | `Theme.swift`, `AtomIslandCore/Theme.swift` | partial: dark and light only | 7 |

### B. Native shell (needs the shell, not just the window)

| Feature | Swift source | Cross-platform risk | Port step |
|---|---|---|---|
| Native window, title bar, zoom, remembered size | `MainWindow`, `WindowTopBar` | Low | 3 |
| Menu-bar icon and panel under it | `MenuBarGlyph`, `IslandPanel` | Tray icons exist on all three; Linux depends on the desktop (AppIndicator) | 9 |
| Status card, work strip, approval strip | `WorkStrip`, `StateViews` | Always-on-top overlay windows; Wayland limits where a window may sit | 9 |
| Pal, pointing at things, second cursor | `PalView`, `PalDrawing`, `OrbitCharacter`, `AgentCursorController`, `PalFlight` | Overlay and screen coordinates; Wayland cannot place windows freely | 12 |
| Hold-to-talk and dictate shortcuts | `ShortcutEngine`, `ShortcutRecorder` | **High.** The shortcuts are modifier-only holds (Ctrl+Option, Right Cmd+Right Option). Normal global-shortcut libraries do not support them; this needs a low-level key hook per system | 10 |
| Dictation into other apps | `DictationCapture`, `DictationController`, `TextInserter` | Text insertion uses macOS Accessibility; other systems need paste simulation. The Parakeet engine (`FluidAudio`) is macOS-only | 11 |
| Permission checks and prompts | `PermissionChecker`, `Permissions.swift` | Different on each system | 10 |
| Login item, notifications, "drop on window" context | `LoginItem`, `Notifier` | Low | 9 |

### C. Runtime parts that only work on macOS today

The runtime is TypeScript, but some tools call macOS programs. The first cross-platform release must **say so** (the `capabilities` event already lists what a tool can do) and must not fail silently. Each row needs a decision per system before its step.

| Runtime module | What it needs on macOS | Windows and Linux |
|---|---|---|
| `audio.ts` (microphone) | ffmpeg with `avfoundation` | ffmpeg also reads `dshow` (Windows) and `pulse`/`alsa` (Linux): a flag change plus a device list per system |
| `tts.ts` (speech output) | Kokoro, played through ffmpeg to the default output | Likely works if ffmpeg is installed; needs a check and an install message per system |
| `tools/apps.ts`, `tools/front-window.ts`, `open-in-app.ts` | `osascript`, `open -a`, `/Applications` | Decision: per-system implementation, or "not available" |
| `tools/media.ts`, `tools/notes.ts` | `osascript` (Music, Notes) | Mostly "not available"; media keys may have a cross-platform route |
| `tools/calendar.ts` | `atom-calendar` (EventKit helper, Swift) | Decision: ICS/CalDAV, or "not available". The helper is Swift, so it also has to be replaced |
| `document-text.ts` | `atom-documents` (Swift helper for PDF/Word) | Replace with a TypeScript or Rust extractor under the same limits (ADR-194) |
| `computer/cua-client.ts`, `computer/screen.ts` | the macOS accessibility driver; `sips` for images | Largest item. Computer control is a separate driver per system, with the same host-side policy |
| `helpers/grants.ts` | `Library/`, `osascript`, `launchctl` | Path and service handling per system |
| `codex-tools.ts`, `codex-command.ts` | project command inspection is limited to macOS | Decide per system |

## Order of work

One capability per step, each ending with tests and a recorded check (CLAUDE.md §3).

1. **Bridge and Chat core.** Done (above).
2. **Chat parity**, one capability at a time. 2a Markdown replies and stay-at-end scrolling: done. 2b Stop and approvals: done. 2c chat actions: done. Next, in this order: 2d copy, quote, fork;  2g Stop/queue/drafts/recovery (done); 2h slash picker (done, 2h-1), find in chat (done, 2h-2), chat brief; 2i questions and work shown in chat; 2j file-edit review (diff and token).
3. **Native shell.** Tauri window around the bridge, Node runtime as a bundled sidecar, and a CI job that builds it on macOS, Windows and Linux. First step that needs a machine (or CI runner) with the web view libraries; this environment has none.
4. **Board, Needs you, Dashboard.**
5. **Projects, Files, Changes, Git.**
6. **Terminal and Browser surfaces.**
7. **Settings, skills, plugins, themes.**
8. **Brain, Scheduled, briefs, search, reply drafts.**
9. **Tray, panel, status card, work strip, approvals overlay.**
10. **Voice: shortcuts, microphone, speech on each system.**
11. **Dictation into other apps.**
12. **Pal and pointing.**
13. **Windows and Linux tools** from table C.
14. **Retire Swift.** Only when every row is done and the Mac acceptance checks (the live workflow walkthroughs in `docs/`) pass on the new window. Until then both apps exist.

## Step 2a: Markdown replies (24 October 2026)

`ui/src/markdown.ts` is a line-for-line port of `MarkdownBlocks.swift` (same blocks, nesting limit 16, same list/table/fence rules) plus a bounded inline reader. `Markdown.tsx` builds elements from the result and never HTML strings. Links only for http, https and mailto; `javascript:`, `data:`, `file:` and protocol-relative addresses stay as visible text. Tests include the Swift suite's cases, nesting and linear-time bounds, and hostile text; the real sample chat was checked in Chromium (no injected element, no dialog). Not ported: the clipboard HTML flavour (belongs to the copy step). Inline text longer than 20,000 characters in one block is shown as plain text.

## Step 2b: Stop and approvals (24 October 2026)

Ports `ApprovalState` and `WorkStripState` into the reducer and draws them above the composer. Stop (button, or Esc while a turn runs) sends `talk.cancel` and clears any waiting question at once. A question shows its summary and reason with Decline and Allow; `rememberFile` requests offer "Allow for this task" and "Allow for this chat" (only the latter sends `rememberFile: true`); the Full-access request shows its whole scope and an "Enable Full access" button. Safety choices:

- **Focus never moves** to a question, so a key typed a moment earlier cannot answer it. It is announced to screen readers instead.
- **Sending is blocked while a turn runs.** A message sent then would end the turn, and ending a turn counts as "no" for anything waiting. Queueing is step 2g.
- **File-edit reviews can only be declined here.** Approving one needs the review token and the diff surface (step 2j); the window keeps neither the text nor the token. This is the same fail-safe as Telegram and the local API.
- A question is dropped when it closes, when the turn ends, when the chat resets, when the runtime stops, when the user answers or presses Stop, so a stale prompt cannot approve a later action.
- **The bridge replays the last `state` and a still-open question** to a window that connects or reloads mid-turn (the runtime does not repeat them). Without this a reload hid the question and the Stop button while the runtime kept waiting.

Checked: 8 new reducer tests and 1 bridge test, and 20 checks in Chromium against the fake runtime (strip, Stop, Esc, each card, reload mid-question). Not checked: a real approval from the real runtime (it needs a computer task or a file edit through a provider); the 60-second timeout (the runtime owns it).

## Step 2c: chat actions (24 October 2026)

Each chat row has an actions menu (Rename, Pin to top, Archive, Delete…). Pin and archive are `chat.control` `flags` requests: a fresh request UUID, compare-and-set against the chat's `flagsVersion`, one at a time, matched only by that UUID, with a 10-second "not confirmed" timeout. The answer's `previousPinned`/`previousArchived` and new version drive a one-step Undo (an Undo is confirmed, never offered again). Rename takes 1–60 characters on one line, checked before sending (the runtime checks again). Delete asks first, with Cancel focused. Items that cannot be used stay in the menu, disabled, with the reason: shared chats (Telegram, local API) cannot be renamed or archived; Archive waits for an idle runtime; an archived chat shows why it cannot be typed into. The menu is keyboard-operable (arrows, Home/End, Escape returns focus, Tab leaves) and visible without hover on touch screens.

Checked: 6 new reducer and 3 title tests; 21 browser checks against the fake runtime (menu keys, rename valid/empty/cancel, read-only refusals, pin order and Undo, archive and unarchive, archive blocked while a turn runs, delete confirm, cancel and delete of the open chat). Real findings fixed on the way: the open menu was painted under the next row; Undo offered itself again after running. Not checked: the same actions against the real runtime's saved chats.

## Step 2d-1: copy and quote (24 October 2026)

`copy.ts` ports `MarkdownCopy`, `MarkdownHTML`, `HiddenCharacters` and `ComposerQuote`; `clipboard.ts` writes one prepared item (plain plus HTML when rich; old contents are never read) and falls back to the older route if the permission is refused. A reply has Copy as Markdown (the source, no HTML), plain text (marks removed, code literal, tabs in tables) or rich text (HTML with a plain fallback; reply text is escaped, so a reply cannot put markup on the clipboard). A message copies exactly as typed. Code blocks have Copy code (the body only). Tables offer Markdown with a rich table, TSV and CSV. Ctrl/Cmd+Shift+C copies the last reply as Markdown, except while a dialog is open. The only feedback is a "Copied" or "Copy failed" toast, announced to screen readers; the copied text is never shown or logged. "Reply to this" appends a quote (first 600 characters or 8 lines, hidden display controls removed) after the draft, which is kept exactly; it refuses with a reason if the combined draft would pass 4,000 characters, never sends, and puts focus in the composer with the caret at the end.

Checked: 10 pure-function tests (including the Swift HTML case) and 15 browser checks that read the real clipboard back. Not checked: pasting into other applications.

## Step 2d-2: fork, edit and retry (24 October 2026)

Fork through a message, fork the whole chat ("Chat options"), and Edit or Retry a user message in a new chat. The flow follows `docs/conversation-controls.md`: `chat.control inspect` returns the archive's revision and size; the fork is then sent with a fresh request UUID, the saved message number and that revision, so a chat that changed in between is refused rather than copied wrongly. The runtime opens the child (`chat.opened`, `chats`, then the answer). Edit and Retry copy the messages *before* the chosen user message and put that prompt in the composer **unsent**; a typed draft is never replaced (the window says it kept it). Saved message numbers come only from `chat.opened`; a message that has just arrived has none, so its fork actions are disabled with the reason until the chat is reopened. Everything waits while a turn runs, a change is pending, or ATOM is not ready, and sending waits while a copy is in flight. The window keeps one composer draft for all chats until step 2g (per-chat drafts); that is why restore refuses to replace text.

Checked: 5 reducer tests and 16 browser checks against the fake runtime (which refuses a stale revision, a busy runtime and a non-user message, and creates one child per request). Not ported: "Check result" (resending the same request after a lost answer; here the timeout says the copy may exist and points to the chat list). Not checked against the real runtime's saved chats.

## Step 2e: model, thinking and access (24 October 2026)

Three controls under the composer, each one command and each answered by the next `chats` event (or an error in words): the **model picker** (`chat.model`: search, provider filter, current model checked, "Use app / project default", custom model id), **thinking** (`chat.reasoning`: Default plus the levels the runtime offers for the effective model; "Thinking unavailable" with a catalog refresh when there are none) and **access** (`chat.access` bound to the expected previous mode: Saved permissions, Chat only, Ask before changes, Full access). Full access is not applied by the window: the runtime asks for the existing consent card, which shows the whole scope, and the mode changes only after Allow. With the Gemini CLI only Saved permissions is offered, with the reason. Thinking and access wait for an idle, writable, ready chat; the model can be changed mid-turn (the next turn uses it) but not on a read-only chat; each control stays visible and says why when it cannot be used. Pure rules (catalog merge, search, custom-id check, titles) are ports of `ModelPickerCatalog`, `isValidModelId` and `ChatReasoning.title`. The bridge now replays the last `info` to a reloaded window.

Checked: 8 new tests (model rules, settings state, `info` replay) and 27 browser checks against the fake runtime (keyboard menus, each mode, Full access accept and decline, picker search/provider/custom/default, Gemini restrictions, busy and read-only states). Not ported: favourite models (a per-user setting in the Swift app). Not checked against the real runtime's providers.

## Step 2f: attachments and paste (24 October 2026)

**The path problem.** The protocol's `files` are full local paths, which a web page never has. The bridge therefore has one more door, `POST /upload?name=…` (token, same-origin, 10 MB, streamed): it stages the bytes in its own private folder (`atom-uploads-*`, mode 0700, one folder per upload, file mode 0600, swept after 2 hours, whole folder removed when the bridge stops, at most 256 MB waiting) and returns the path. The runtime then does what it always does (a real file, not a secret, a readable type, 10 MB), copies the file into ATOM's folder, and the staged copy is only a handoff. A file keeps its own name, **including a leading dot**: the runtime refuses secret-looking names by name, and an earlier version of this code stripped the dot, which would have turned `.env` into an acceptable `env`. Checked against the real runtime: `.env`, `id_rsa` and `tool.exe` sent through the bridge were refused in the runtime's own words, with no model turn.

**In the window.** A paperclip button, drop onto the chat, and paste (a copied file or screenshot attaches). Chips show the name, size and, for images, a thumbnail; each can be removed. Up to 5 files of at most 10 MB; empty files, unreadable types and folders are refused with the reason before anything is sent (the type and size lists are read out of the runtime's source by a test, so they cannot drift). A message may be files only. Because the runtime checks files only when it receives the message, and a refusal sends nothing, **the draft and the files stay in the composer until the runtime takes the turn** (a `transcript` event), and a refusal shows its words. A sent message shows each file by name; the local path never appears. Project chats take no attachments (the button says so; a drop shows the reason).

**Paste (ADR-149/150).** Pasted text is cleaned of hidden display controls and the count is shown; a paste of only such characters pastes nothing. A cleaned paste of 4,000 characters or more, or one that would take the draft past 4,000, becomes `Pasted text N.txt` and leaves the draft untouched; with all five slots full or in a project chat it is refused with instructions instead of being lost. Hidden characters that get into the draft another way are removed when you press Send, and that send stops so you can look first.

Checked: 12 new tests (limits and lists against the runtime source, paste rules, markers, state, 8 bridge upload tests), 26 browser checks against the fake runtime, and the real-runtime refusals above. Not ported: Quick Look preview, "Second brain note" chips, saving pasted text permanently (the staged copy is removed). Not checked: a real accepted attachment going to a model (it would use a provider login), and the 20-second "no answer" path.

## Step 2g-1: drafts, queue and held messages (24 October 2026)

**Drafts.** Each chat keeps its own words and files; switching chats saves one composer and restores the other. Words are also saved by the bridge in a private file (`data/desktop/chat-input.json`, folder 0700, file 0600, atomic writes, plaintext like the Mac app's ChatInput snapshot; strict shape, 128 KiB per text, 20 messages per chat, 100 chats, 8 MiB). Browser storage cannot do this, because the window's address changes with the port on every run. A file cannot be saved: after a restart a draft's words come back, and a held message says how many files were not kept. An unreadable save is set aside, not overwritten.

**Queue.** While a turn runs, or while messages already wait, Enter adds the message to the end of the queue (the button says Queue and the keys are explained). The oldest goes when the chat is idle with no question or work pending, one at a time: the next waits until the runtime has begun the previous turn (counted from `state` events, so a batched render cannot skip it; at most 10 seconds' patience). **Ctrl/Cmd+Enter** queues the draft and sends the oldest waiting message now, ending the turn in flight (an empty composer sends the oldest as it is). Each row has Edit (moves that one message into an **empty** composer; a composer with words refuses and says why) and Remove.

**Held, never sent by themselves.** After Stop, an error that ends the turn, leaving the chat, a runtime that stops or restarts, or a refusal of the send, **everything still waiting is held** in order. Held messages are shown with Edit and Discard and are never sent automatically; a new message does not release them. A chat keeps at most 20 waiting messages (live and held together); a full chat refuses and keeps the new draft in the composer.

Checked: 10 model tests, 4 bridge tests, 2 reducer tests, 25 browser checks against the fake runtime (per-chat drafts and files, queue order, Edit/Remove, Stop holds, no automatic send of held messages, one-at-a-time advance with the right answers, Send now, an error holds, leaving holds, reload restores drafts and held messages, words-only file at mode 0600). Not ported: reordering, the Recovery view and delivery receipts (2g-2). Not checked against the real runtime.

## Step 2g-2: recovery of interrupted requests (24 October 2026)

**Delivery ids.** Every `text.send` now carries a `request` id (a UUID made by the window). Sending the same words and files again reuses the id, so the runtime treats a repeat as the same delivery and does not run it twice; the same id with different words is refused by the runtime. If ATOM does not confirm within 20 seconds the window says so and that sending it again as it is cannot run it twice.

**Receipts and the list.** The runtime's `foreground.receipt` events and `foreground.list` answers (asked on ready, after a receipt and after a dismissal; the window also lists the ids it still holds waiting) feed a Recovery view in the Chat options menu, with a mark and a count when something needs review (stopped, failed or interrupted by a crash or restart). Each entry shows its state, its chat and when. Completed replies that are saved in the chat are acknowledged once (`foreground.ack`) so the runtime can scrub its copy; held copies the host already journals are dropped from the held list only when they have no files and nothing was lost.

**Review, Restore, Dismiss.** Review shows the prompt and, when the runtime kept a reply, a bounded part of it with Next and Copy this part. **Restore** puts the prompt into an **empty** composer and sends nothing (a typed draft is never overwritten; the view says so and keeps the record), then reminds you to review before sending. **Dismiss** asks first, with Keep focused. Nothing is ever resent by itself, after a crash, a restart or at any time. Open source chat goes to the chat the request was made in.

Checked: 7 model tests (`recovery.ts`), reducer tests for receipts, matching by request id, paging and dismissal, held-copy reconciliation tests, and 23 browser checks against the fake runtime (normal turn needs no review, acknowledged and scrubbed, mark and count, Stopped and Failed entries, Restore refused over a draft and accepted in an empty composer, Dismiss confirmation, bounded reply paging, identical id not run twice, different words refused, crash leaves Interrupted and retained, nothing resent). Not ported: recovery of unconfirmed answers to questions (`pendingAnswers` is sent empty until step 2i), and anything about work/task results. Not checked against the real runtime with a real model.

## Step 2h-1: the "/" picker (24 October 2026)

**What it does.** Typing `/` as the whole first word opens a list of up to eight rows: ATOM's own commands (`/new`, `/model`, `/skills`, `/memory`, `/help`), then the user's skills, then their Claude commands (`~/.claude/commands`). More letters narrow it: names that start with the letters, then names that contain them, then descriptions. A name used by ATOM wins over a skill, a skill over a command; each name appears once. The rules are a port of `SlashMenu.swift`, with its tests. Each row shows its source (ATOM, Skill, Command) and a command's argument hint.

**Keys.** Up and Down move (wrapping), Enter or Tab picks, Escape clears the command, a click picks. Enter with the picker open never sends. Picking a skill or command fills `/name ` and leaves the caret ready for the words; the runtime, not the window, decides what it does when the message is sent. A typed name that matches nothing, or a skill with its words (`/review a.ts`), is an ordinary message. The box is a combobox/listbox for screen readers. The picker is not shown in a chat that can only be read.

**ATOM's own commands run in the window and never reach the model.** `/new` starts a new chat. `/help` shows the list. The other three open pages that are not in this window yet, so each says so in the message box instead of doing nothing: `/model` points to the model button under the box (the model menu is already here, step 2e), `/skills` and `/memory` name the Mac app. They start working when their pages are ported (Plugins and Brain, later steps).

**Where the lists come from.** After every `ready` the window sends `helpers.list` (the skills are one field of a large answer; nothing else is kept) and `commands.list`. A name with white space cannot be typed and is left out. Checked against the real runtime through the bridge: both commands are answered; a real skill came back with its description; the user had no Claude commands.

Checked: 7 model tests (ports of the Swift suite plus the eight-row limit and stricter `/ new` handling), 1 reducer test, 26 browser checks against the fake runtime (order, source labels, keys, wrap, narrowing by name and description, Tab and click, a skill with words is sent, unknown names are sent, `/new` makes a chat and sends nothing, the three page commands say why, `/help`, read-only chat, light and narrow layout). Not ported: the `@` mention menu (separate capability). Not checked: a real skill or command being run by a model.

## Step 2h-2: find in chat (24 October 2026)

**What it does.** Ctrl/Cmd+F (or Chat options → Find in chat) opens a bar above the messages with a box, the count ("3 of 12", "500+" at the limit), Previous and Next, and Close. It searches the **loaded messages of this chat only**, not archived history or other chats (the box says so). The search is literal (no patterns) and ignores case; it reads each message's source text, as the Mac app does, so a match inside Markdown syntax counts. At most 500 matches. The selected match is shown as a line of context (40 characters before, 60 after, never cutting an emoji in half) and its message is outlined and scrolled to the middle. Port of `ChatFind.swift`.

**Keys.** Enter next, Shift+Enter previous (both wrap), Escape closes from the box or any button in the bar and returns to the message box; a reopened bar is empty. Ctrl/Cmd+F is taken from the browser only in the chat and not while a dialog is open. **Escape in Find, and in the "/" picker, no longer also stops a running turn** (found while testing: the window-level Escape-to-stop saw both; the picker had the same fault since 2h-1). Switching chats closes Find.

**While it is open the chat does not follow new text** (as in the Mac app), so a match you are reading does not scroll away; closing Find lets your own next message bring you to the end as before.

Checked: 7 model tests (empty query, case, literal characters, context lengths, emoji, 500 limit and exactly 500, selection wrap), 26 browser checks against the fake runtime (open and focus, count, You/ATOM labels, no match, Escape and focus, many matches and wrapping, in view, no jump on new text, menu, other chat, Escape not stopping a turn, empty chat, light and narrow). Not ported: highlighting the matched words inside the rendered message (only the message is outlined, as in the Mac app); collapsing and expanding long messages (this window does not collapse them yet).

## Verification in step 1, and what was not verified

Checked here: `pnpm typecheck` (including the window), 29 tests for the bridge and the window, the production build, and the window driven in Chromium against the fake runtime (light, dark, narrow) and against the real runtime (start, `ready`, empty list, clean stop).

**Not checked:** any Windows or Linux run; the Tauri shell (not written); a real model turn; the Swift app and its 798 tests (no Swift toolchain here, and no Swift file changed). `.github/workflows/ci.yml` gained a three-system job for the bridge and the window; it has not run yet.
