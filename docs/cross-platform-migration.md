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
| Copy (text and rich HTML), quote, fork, edit, retry | `ChatCopyControl`, `ChatActionsMenu`, `MarkdownHTML` | todo | 2 |
| Attachments, paste, drop | `ChatAttachments`, `ComposerPaste`, `PastedTextFile`, `IslandController+Drop` | todo | 2 |
| Stop (button and Esc), working strip, send blocked while a turn runs | `WorkStrip`, `IslandController+Shortcuts` | **done** (step 2b) | 2b |
| Queue, held draft, recovery after interruption | `ChatControlsModel`, `ForegroundRecovery*` | todo | 2g |
| Model, thinking and access menus | `ChatModelPicker`, `ChatReasoningMenu`, `ChatAccessMenu` | todo | 2 |
| Slash picker, find in chat, chat brief | `SlashPicker`, `ChatFindBar`, `ChatBriefEditor` | todo | 2 |
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
2. **Chat parity**, one capability at a time. 2a Markdown replies and stay-at-end scrolling: done. 2b Stop and approvals: done. 2c chat actions: done. Next, in this order: 2d copy, quote, fork; 2e model, thinking and access menus; 2f attachments and paste; 2g Stop/queue/drafts/recovery; 2h slash picker, find, chat brief; 2i questions and work shown in chat; 2j file-edit review (diff and token).
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

## Verification in step 1, and what was not verified

Checked here: `pnpm typecheck` (including the window), 29 tests for the bridge and the window, the production build, and the window driven in Chromium against the fake runtime (light, dark, narrow) and against the real runtime (start, `ready`, empty list, clean stop).

**Not checked:** any Windows or Linux run; the Tauri shell (not written); a real model turn; the Swift app and its 798 tests (no Swift toolchain here, and no Swift file changed). `.github/workflows/ci.yml` gained a three-system job for the bridge and the window; it has not run yet.
