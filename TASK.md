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

---

### Task 0.5.3 — Island App Skeleton

Create the Swift app in `apps/mac/island/` (Swift Package, macOS 14+).

- Runs as a background app: no Dock icon, no main window
- Builds into `ZENO.app` with a script, including `Info.plist` with the microphone usage description
- Starts the runtime as a child process, reads its events, sends it commands
- Restarts the runtime if it exits unexpectedly (with backoff); stops it on quit
- Finds `node` and the project folder reliably (Homebrew path, `.env` location)
- Logs runtime start, stop and restart to the existing log

Tests: Swift unit tests for the event decoder and the restart policy.

Verification: launching `ZENO.app` starts the runtime (seen in `logs/zeno.log`); quitting stops it.

---

### Task 0.5.4 — The Panel: Placement and Hover Reveal

The island window, with placeholder content.

- Borderless, non-activating panel at the top-centre of the display with the menu bar
- Above the menu bar, on every Space, over full-screen apps, never takes keyboard focus
- Idle: fully above the top edge
- Hover at the top edge near the centre for 0.25 s: slides down; pointer leaves: slides up after a short delay
- Follows display changes (resolution, menu bar display)

Tests: Swift unit tests for the reveal and hide timing and the frame calculations (hidden, shown, expanded).

Verification: on the Mac mini, including over a full-screen app and on a second Space.

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

Phase 0.5 — Desktop Island. Task 0.5.1 is done. Next task: 0.5.2 (Island Protocol and Runtime Mode).

Everything else waits.
