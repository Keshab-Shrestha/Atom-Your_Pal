# ZENO Task Plan

## Prime Rule

> Build ZENO one capability at a time.

The existence of a large architecture does not mean the entire architecture should be implemented now.

---

## 1. Development Loop

Every task follows:

```text
Understand
↓
Define
↓
Implement
↓
Test
↓
Verify
↓
Document
↓
Stop
```

Do not automatically continue to another task.

---

## 2. Current Phase

### Phase 0.5 — Desktop Island

Phase 0 (Voice Foundation) is complete. Its task history is in `docs/phase-0-tasks.md`.

Phase 0.5 gives ZENO a permanent place on the Mac (ADR-033 to ADR-036):

```text
Ctrl+Option held (any app)        pointer at top edge
            ↓                              ↓
      ZENO Island (Swift app, apps/mac/island)
            ↓  commands        ↑  events
      stdin / stdout, JSON lines (docs/island-protocol.md)
            ↓                  ↑
      ZENO runtime (Node, apps/mac/src — Phase 0, unchanged)
      Microphone → Whisper → Core → LLM Gateway → LLM → Kokoro → Speaker
```

---

## 3. Phase 0.5 Objectives

The system must support:

- a panel hidden above the top-centre of the main display
- revealing it by hovering at the top edge, and hiding it again
- holding Ctrl+Option in any app to talk, releasing to send
- live status in the panel: listening (with level), transcribing, thinking, speaking
- the transcript and reply shown in the panel
- an expanded view of the current conversation, with "new conversation"
- clear guidance when a permission (microphone, Input Monitoring) is missing
- the island starting, restarting and stopping the runtime
- the terminal interface (`pnpm start`) still working

Done means: with the terminal closed, the user can hold Ctrl+Option in another app, ask a question, see the status and reply in the island, and hear ZENO answer.

---

## 4. Explicitly Deferred

Do not implement these during Phase 0.5 unless a task explicitly requires them:

- everything deferred in Phase 0 (persistent memory, tools, computer control, other devices, cloud)
- launch at login, auto-update, signing and notarization, a DMG installer
- a settings window (settings stay in `.env`)
- configurable hotkeys (Ctrl+Option is fixed for now)
- a menu bar icon
- wake word or voice activity detection (ADR-027)
- screen capture or pointing at things on screen (Phase 3)
- multiple displays beyond "the display with the menu bar"
- custom sounds, characters or animations beyond simple transitions

---

## 5. Task Sequence

### Task 0.5.1 — Move the Project Out of iCloud

Move the repository from `~/Documents/zeno` to `~/Developer/zeno`.

`~/Documents` is synced by iCloud. With iCloud storage full, macOS replaced about 6,000 project files with online-only placeholders, which froze git and the type check (Task 0.11). A native app build adds many more small files.

Requirements:

- every file is local before the move (no `dataless` files)
- git history, `.env`, `models/` and `logs/` are preserved
- `node_modules` is reinstalled fresh in the new location
- the old folder is kept until the user confirms the new one works, then deleted by the user

Verification: `git log` and `git status` match; tests, type check and `pnpm start` work from the new path.

Status: **Done (2026-10-02).**

- Copied with `rsync`, excluding `node_modules`: 162 files, identical SHA-256 checksums, no `dataless` files in the source
- Same commit (`043c98c`), clean `git status`, `git fsck` passes; `.env` kept its owner-only permissions (`-rw-------`)
- `pnpm install --frozen-lockfile`: 93 packages in 4.6 s
- Type check passes (0.8 s); 106 unit tests pass; live Kokoro test passes
- `pnpm start` launches, loads the voice in 0.4 s, quits cleanly; the log now writes to `~/Developer/zeno/logs/`
- Nothing outside the project referred to the old path

Remaining for the user: open the new folder in editors and terminals, then delete `~/Documents/zeno`.

---

### Task 0.5.2 — Island Protocol and Runtime Mode

Let the runtime be driven by another program instead of the keyboard.

- Write `docs/island-protocol.md`: every command and event, with fields and examples
- Add an island mode: `node apps/mac/src/main.ts --island` reads commands from stdin and writes events to stdout, one JSON object per line
- Commands: `talk.start`, `talk.send`, `talk.cancel`, `conversation.reset`, `quit`
- Events: `ready`, `state`, `mic.level` (throttled to about 20 per second), `mic.silent`, `transcript`, `reply`, `notice`, `error` (stage and message), `turn.complete` (timings)
- Human-readable output goes to stderr or the log in this mode, never stdout
- The voice loop, Core and gateway are unchanged

Tests: protocol encoding and decoding; a fake island drives a full turn with fake components; unknown or malformed commands produce an `error` event, not a crash.

Verification: a script drives a real turn through stdin and stdout.

Status: **Done (2026-10-02).**

- `docs/island-protocol.md`: transport, lifecycle, exit codes (78 = configuration error, do not restart), 5 commands, 11 events, error stages, example, privacy
- `main.ts` split into `runtime.ts` (shared pipeline, logging), `terminal.ts` (`pnpm start`, unchanged behaviour) and `island.ts` (`--island`); protocol in `island-protocol.ts`
- Voice loop: notices are now structured (`too_short`, `mic_starting`, `no_speech`), so each interface words them for its own controls; microphone levels are passed on (real microphone: about 84 chunks per second, throttled to 20 events per second carrying the loudest peak)
- In island mode, stdout carries only events: all other console output is redirected to stderr
- Fixed while testing: a SIGTERM during startup could kill the runtime before cleanup (the readiness line is now printed after the handlers are installed); the silence-warning timer kept a cancelled session alive for 60 s
- Tests: 137 (135 pass, 2 live skipped): 10 protocol, 15 island-mode with fake parts over the real wire format, 3 new smoke tests that start the real program in island mode (config error → exit 78, stdout only events, SIGTERM exits cleanly)
- Live, driven by a script through stdin / stdout with the real microphone, Whisper, Gemini and Kokoro: a full turn (`ready` 0.75 s after start, transcription 0.9 s, first sound 1.2 s after the reply); interrupting mid-reply with `talk.start`; cancel; reset; quit with exit 0. The log contained timings only, no words

Note: `gemini-3.6-flash` had used its free daily quota, so the live turns used `gemini-3.5-flash-lite` (`ZENO_LLM_MODEL`), which took 5.7–11.6 s to reply. The 429 error itself arrived correctly as `{"stage":"model","kind":"rate_limit","retryable":true}`.

---

### Task 0.5.3 — Island App Skeleton ✅ Done (2026-10-02)

Create the Swift app in `apps/mac/island/` (Swift Package, macOS 14+).

- Runs as a background app: no Dock icon, no main window
- Builds into `ZENO.app` with a script, including `Info.plist` with the microphone usage description
- Starts the runtime as a child process, reads its events, sends it commands
- Restarts the runtime if it exits unexpectedly (with backoff); stops it on quit
- Finds `node` and the project folder reliably (Homebrew path, `.env` location)
- Logs runtime start, stop and restart to the existing log

Tests: Swift unit tests for the event decoder and the restart policy.

Verification: launching `ZENO.app` starts the runtime (seen in `logs/zeno.log`); quitting stops it.

Result:

- `apps/mac/island/`: Swift package with `ZenoIslandCore` (protocol, line splitting, restart policy, Node/project lookup, supervisor, log) and the `ZenoIsland` app. `pnpm island:build` makes `apps/mac/island/build/ZENO.app` (344 KB, ad hoc signed, `LSUIElement`), recording the project folder and Node path; `pnpm island:test` runs 33 Swift tests, including the supervisor against real child processes
- Launched with `open`: background app, no Dock icon; runtime started as its child and ready in 0.6–1.1 s
- Runtime killed: restarted after 1 s, ready again in 1.7 s. Restarts back off 1 → 2 → 5 → 10 → 30 s and stop after 5 quick failures; a configuration error (exit 78) is shown in an alert and not restarted
- Quit, SIGTERM and SIGINT stop the runtime and its voice worker in 0.1–0.3 s; force-killing the app ends the runtime too (it exits when its input closes). A second launch defers to the running one
- Fixed during testing: quitting by signal hung the app, because the wait for the runtime ran inside a main-queue block. Callbacks now reach the main thread through the run loop
- Node: the build prefers Homebrew's (`/opt/homebrew/bin/node`, v26) over one inside another tool's folder; at least v22.18 is required (runs TypeScript directly). Starting from Finder, `/opt/homebrew/bin` is added to `PATH` so ffmpeg and whisper-cli are found

---

### Task 0.5.4 — The Panel: Placement and Hover Reveal ✅ Built (2026-10-02), awaiting Keshab's look

The island window, with placeholder content.

- Borderless, non-activating panel at the top-centre of the display with the menu bar
- Above the menu bar, on every Space, over full-screen apps, never takes keyboard focus
- Idle: fully above the top edge
- Hover at the top edge near the centre for 0.25 s: slides down; pointer leaves: slides up after a short delay
- Follows display changes (resolution, menu bar display)

Tests: Swift unit tests for the reveal and hide timing and the frame calculations (hidden, shown, expanded).

Verification: on the Mac mini, including over a full-screen app and on a second Space.

Result:

- `IslandGeometry` (frames and hover zones), `HoverController` (reveal and hide timing, no timers inside, so it is unit-tested with plain numbers) and `IslandStatus` (the pill's one line) in `ZenoIslandCore`; `IslandPanel` and `IslandController` in the app. Placeholder content: a black pill with a status dot and "Ready" / "Listening" / "Thinking"…
- Pill 200 × 36 pt; hover strip 320 pt wide at the very top edge; reveal after 0.25 s, slide 0.22 s, hide 0.5 s after the pointer leaves (fade instead of slide with Reduce Motion). Panel at window level 26, above the menu bar (24)
- Verified on the Mac mini by moving the real pointer and reading the window server's window list (no screenshots available to the agent): hidden at idle; shown 0.25 s after resting at the top-centre; stays while over the pill; hides 0.5 s after leaving; no reveal when passing through quickly, at the top edge away from the centre, or at the top of the second display; clicking the pill leaves the front app in front; works over a full-screen app's Space and after leaving it
- Cost: no CPU while the pointer is still; about 2 % of one core while it moves constantly; 33–41 MB
- 49 Swift tests (16 new). `pnpm island:test` passes the swift-testing plugin path explicitly: with only the Command Line Tools, SwiftPM otherwise fails to rebuild changed test files ("plugin for module 'TestingMacros' not found")
- Fixed during testing: `isFloatingPanel = true` resets the window level, so it was below the menu bar; it is now set before the level
- Not yet checked: how it looks (Keshab), changing display resolution, a notched MacBook

---

### Task 0.5.5 — Global Push-to-Talk (Ctrl+Option)

- Listen-only event tap for modifier changes and key presses
- Holding Ctrl+Option: `talk.start`, and the island appears; releasing: `talk.send`
- Any other key while held: `talk.cancel` (a shortcut, not a question)
- Esc while listening: `talk.cancel`
- Without Input Monitoring permission: the island explains how to grant it and offers to open System Settings; hover and click still work

Tests: Swift unit tests for the key state machine (press, release, chord, Esc, repeated events).

Verification: talking from another app (e.g. Safari) with ZENO not focused; typing Ctrl+Option+Arrow does not send.

---

### Task 0.5.6 — Live Status and Replies

Show what ZENO is doing.

- Compact pill: listening with a live level meter, transcribing, thinking, speaking
- The transcript and reply text, truncated in the compact pill
- Notices and errors in plain words, with the fix where there is one (e.g. microphone silent)
- Stays visible for the whole turn; hides a few seconds after speaking ends unless hovered

Verification: full turns with the real microphone; each state and the main errors seen on screen.

---

### Task 0.5.7 — Expanded Conversation View

- Click the pill: expands to show the current conversation (session-only, ADR-030)
- "New conversation" button (`conversation.reset`)
- Click outside or move away: collapses

Verification: a multi-turn conversation is readable; reset clears it and ZENO forgets it.

---

### Task 0.5.8 — End-to-End Island Test

Verify Phase 0.5 as the user will use it.

- With the terminal closed, start `ZENO.app`
- From another app: hold Ctrl+Option, ask a question, release; see status and reply; hear the answer
- Ask a follow-up; interrupt ZENO mid-reply; cancel with a shortcut
- Check hover reveal, the expanded view, and recovery when the runtime is killed

Record timings from `logs/zeno.log` and the user's verdict.

---

## 6. Definition of Done

A task is done only when:

- implementation exists
- relevant tests pass
- behavior is verified
- no unrelated changes remain
- documentation is updated if necessary
- STATUS.md reflects reality
- TASK.md reflects progress

---

## 7. Task Completion Template

```text
Task:
Objective:

Files changed:

Implementation:

Tests:

Verification:

Known limitations:

Documentation updated:

Next task:

STOP
```

---

## 8. Rules

Never:

- implement several unrelated tasks simultaneously
- refactor unrelated code
- introduce speculative infrastructure
- add unnecessary dependencies
- claim tests passed without running them
- claim functionality works without verifying it

---

## 9. Current Priority

Phase 0.5 — Desktop Island. Tasks 0.5.1–0.5.4 are done (0.5.4 awaits Keshab's look at the panel). Next task: 0.5.5 (Global Push-to-Talk).

Everything else waits.
