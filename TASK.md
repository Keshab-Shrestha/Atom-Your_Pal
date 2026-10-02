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

Phase 0.5 gives ZENO a permanent place on the Mac (ADR-033 to ADR-042):

```text
shortcuts (any app, changeable)   pointer at left edge
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

- a dark glass island hidden past the left edge of the main display, below the menu bar
- revealing it by hovering at that edge, and hiding it again
- holding a shortcut in any app to talk, releasing to send (default Ctrl+Option)
- dictation: holding another shortcut, speaking, and the text is typed into the current app (ADR-041)
- live status in the panel: listening (with level), transcribing, thinking, speaking
- the transcript and reply shown in the panel
- an expanded view with the current conversation ("new conversation"), status details, and settings
- settings in the island: AI provider and model, every shortcut, pet, sounds (ADR-040)
- a pet that walks along the bottom of the screen and reacts to ZENO (ADR-042)
- clear guidance when a permission (microphone, Input Monitoring, Accessibility) is missing
- the island starting, restarting and stopping the runtime
- the terminal interface (`pnpm start`) still working

Done means: with the terminal closed, the user can hold the talk shortcut in another app, ask a question, see the status and reply in the island, and hear ZENO answer; dictate into another app; and change shortcuts and the model from the island.

---

## 4. Explicitly Deferred

Do not implement these during Phase 0.5 unless a task explicitly requires them:

- everything deferred in Phase 0 (persistent memory, tools, computer control, other devices, cloud)
- launch at login, auto-update, notarization, a DMG installer (a local signing certificate is needed for permissions, ADR-040)
- a separate settings window (settings live in the island)
- a menu bar icon
- AI cleanup of dictated text, per-app dictation modes, dictation history
- wake word or voice activity detection (ADR-027)
- screen capture or pointing at things on screen (Phase 3)
- multiple displays beyond "the display with the menu bar"
- copying code from FluidVoice or Vorssaint (GPL-3.0; designs only, ADR-039)

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

### Task 0.5.4 — The Panel: Placement and Hover Reveal ✅ Done (2026-10-02), placement replaced by 0.5.4b

The first version of the island window, at the top-centre (ADR-036). Kept here as history: its window, hover timing and supervisor wiring are reused by 0.5.4b, which moves it to the left edge (ADR-037).

Result:

- `IslandGeometry` (frames and hover zones), `HoverController` (reveal and hide timing, no timers inside, so it is unit-tested with plain numbers) and `IslandStatus` (the pill's one line) in `ZenoIslandCore`; `IslandPanel` and `IslandController` in the app
- Verified on the Mac mini by moving the real pointer and reading the window server's window list: hidden at idle; shown 0.25 s after resting at the edge; stays while over it; hides 0.5 s after leaving; no reveal when passing quickly or away from the strip; clicking it leaves the front app in front; works over a full-screen app's Space
- Cost: no CPU while the pointer is still; about 2 % of one core while it moves constantly; 33–41 MB
- `pnpm island:test` passes the swift-testing plugin path explicitly: with only the Command Line Tools, SwiftPM otherwise fails to rebuild changed test files ("plugin for module 'TestingMacros' not found")
- Fixed during testing: `isFloatingPanel = true` resets the window level; it is now set before the level
- Keshab's review: move it out of the crowded top-centre, and give it real content and settings (ADR-037, ADR-038)

---

### Task 0.5.4b — Left-Edge Island with Live State (ADR-037, ADR-038) ✅ Done (2026-10-02)

Move the island to the left edge below the menu bar and give the compact view its real content.

- Placement: hidden past the left edge of the main display; hover band at the left edge just below the menu bar; slides in from the left; never covers the menu bar
- Look: dark glass (system glass material on macOS 26+, dark blur otherwise), rounded corners, soft shadow
- Compact view: ZENO's live state with an icon and a microphone level meter driven by `mic.level` (Ready, Listening, Transcribing, Thinking, Speaking, Restarting, problems in plain words)
- Stays shown for a whole turn (`held` while not idle) and hides a few seconds after ZENO returns to idle, unless hovered
- Follows display changes (resolution, menu bar height, display arrangement)

Tests: Swift unit tests for the new frames and hover band (including menu bar height and a display arrangement with another display on the left), the level meter's smoothing, and the state-to-label mapping.

Verification: on the Mac mini with the real pointer: reveal, hide, no reveal at the top-left corner or in the menu bar, the Apple menu still clickable, full-screen app; Keshab's look.

Result:

- `IslandGeometry` places the card 8 pt in from the left edge and 8 pt below the menu bar (the real menu bar height, read from the display); hidden, it sits entirely past the left edge. The hover band is the left edge from the bottom of the menu bar down 140 pt
- `IslandStatus` turns runtime events into a title and detail ("Ready — Gemini 3.6 Flash", "Listening", "Thinking — Gemini 3.6 Flash", "Model limit reached — Gemini's daily free limit is used up"); `LevelMeter` turns `mic.level` into a decibel-scaled waveform that rises at once and falls gently
- `HoverController` gained `linger`: the island stays out 2.5 s after a turn, 6 s after a notice or problem; settings problems stay until fixed
- Look: `NSGlassEffectView` (macOS 26+) with a dark tint, otherwise a dark blur; state icon in a tinted circle; waveform while listening
- 63 Swift tests pass (30 new or rewritten: geometry, hover band, linger, wording, model names, meter)
- Verified on the Mac mini (real pointer, window server's window list): hidden at idle; shown at (8, 38) 0.25 s after resting in the band; hides 0.5 s after leaving; no reveal in the top-left corner, at the left edge inside the menu bar, further down the left edge, 10 pt in from the edge, on a quick flick, or at the second display's left edge (11 clean runs). One early run revealed at the menu bar edge; the trace showed a pointer position the test had not set (moved by hand during the run), inside the band
- The Apple menu opens with the island shown, and the island slides away as the pointer reaches the menu bar
- A scripted runtime played a full turn and a model error: the island came out on Listening, stayed through Thinking and Speaking, hid 2.5 s after the turn, came out for the error and stayed 6 s
- Real runtime: "Ready — Gemini 3.6 Flash"; 58 MB
- Not checked: the glass's look (no screen capture permission for the agent; vision unavailable), a left-hand Dock, Stage Manager

---

### Task 0.5.5 — Expanded Island With Settings (ADR-038, ADR-040) ✅ Done (2026-10-02)

Verified: Swift and Node tests; each tab rendered and reviewed with sample data (`ZENO_ISLAND_GALLERY`). Live model switching is still to be tried with the real runtime.

Click the compact card: it expands from the same corner into a larger glass panel with tabs.

- **Conversation:** the session's turns (transcript and reply), "New conversation" (`conversation.reset`)
- **Status:** provider and model, microphone, last turn's timings, last error with its fix
- **Settings:**
  - AI provider and model, switched live
  - Shortcuts: one row per action with a recorder (click, press the new keys; Esc cancels, Delete clears; conflicts with another action are refused)
  - Pet on or off; sounds on or off (stored now, used by later tasks)
- Runtime: `info` event (provider, model, providers with a key present, models offered for each); `model.set` command switches the LLM adapter without restarting; the choice is saved to `config/island.json` (not in git) and applied at next start over `.env`; API keys never reach the island
- The expanded panel can take key focus without activating ZENO; click outside, Esc or the collapse button closes it

Tests: Node tests for `model.set` (valid, unknown provider, no key, unknown model) and the settings file; Swift tests for decoding `info`, shortcut storage and display (⌃⌥⇧⌘ order), conflict detection.

Verification: open the panel from another app without that app losing focus; switch Gemini → Claude → Gemini in the middle of a conversation, the next turn uses the new model (log), the choice survives a restart; record a new shortcut and see it saved.

---

### Task 0.5.6 — Shortcuts Work Everywhere (ADR-040) — code done; live check partial (2026-10-02)

Checked live against a fake runtime with posted key events: hold ⌃⌥ sends `talk.start` then `talk.send`; a quick tap does nothing; ⌃⌥← does not talk; another key while held sends `talk.cancel`; ⌃⌥Z opens and closes the island; Right ⌥ starts Dictate. Still to check by hand: Esc only while busy, Right ⌥+letter typing an accent, a changed shortcut working at once, the Input Monitoring prompt from a fresh install. Signing: `make-signing-identity.sh` creates "ZENO Local Signing" in its own keychain (`~/Library/Keychains/zeno-signing.keychain-db`) so `build-app.sh` signs without a password prompt.

- Local signing certificate "ZENO Local Signing" so permissions survive rebuilds; `build-app.sh` signs with it
- Shortcut engine: Carbon hot keys for chords; listen-only event tap for hold and modifier-only shortcuts (clean press only)
- Talk: hold → `talk.start` and the island comes out; release → `talk.send`; another key while held → `talk.cancel`
- Show or hide the island; Cancel while listening or speaking
- Shortcuts follow changes in Settings at once and pause while recording
- Without Input Monitoring: the island explains and opens System Settings; re-checks when granted

Tests: Swift unit tests for the key state machine (press, release, chord, clean press, Esc, repeats) and the shortcut model.

Verification: talking from another app (e.g. Safari) with ZENO not focused; typing Ctrl+Option+Arrow does not talk; a changed shortcut works without restarting.

---

### Task 0.5.7 — Dictation (ADR-041, ADR-047) — built; Keshab: "satisfactory for now" (2026-10-02)

Built inside the app instead of the runtime (ADR-047): Parakeet via FluidAudio, a prepared Core Audio microphone, hold Right ⌘ + Right ⌥. Tested with 34 new Swift tests (audio rules, spelling list, island wording, the new shortcut) and used for real: 8 dictations typed into a browser, 67–337 ms to transcribe. Not yet checked by hand: TextEdit, Notes, Safari's address bar, a password field, clipboard unchanged afterwards, and the Accessibility prompt on a fresh install. The bullets below are the original plan; the runtime parts were dropped.

- Runtime: `dictation.start` / `stop` / `cancel`; transcribes without the model or speech; silence check for short clips; `dictation.text` event
- Island: hold the dictation shortcut → Listening with waveform → Transcribing → text pasted into the app that was focused when dictation started; clipboard saved and restored
- Accessibility permission guidance; secure input fields: text left on the clipboard, island says so
- Start and stop sounds (if on in Settings)

Tests: Node tests for dictation mode and the silence check; Swift tests for the clipboard save/restore rules.

Verification: dictate into TextEdit, Safari's address bar and Notes; clipboard content is unchanged afterwards; an accidental tap types nothing; a password field gets nothing pasted.

---

### Task 0.5.8 — The Pet (ADR-042) — built; seen on screen and moveable (2026-10-02)

Wisp is drawn in code (`WispView`), driven by a tested `PetBrain` (wander, rest, nap after 3 min, react to listening/thinking/speaking/problem; 16 tests), in a small window that follows Wisp (ADR-043). By default it wanders along the top of the Dock on the primary display; Keshab can drag it anywhere on any display, where it stays parked (remembered across launches) until dropped back on the Dock, double-clicked or sent home from the right-click menu. Clicks pass through everything but Wisp's body. 26 behaviour tests, 3 for the saved spot. On screen it floats at 38 pt/s and rests between trips (seen in the trace log); about 7% CPU while shown. Seen working by Keshab (drag, park, restart keeps the spot). Still to check by eye: each reaction during a real turn, and the right-click menu and double-click.

- Character: Wisp (ADR-042), drawn in SwiftUI shapes; floats and bobs instead of walking
- Small transparent window that follows Wisp; clicks pass through except over its body; never takes focus
- Drag to move it anywhere (dangles while held); parked where dropped; a parked Wisp whose display is unplugged comes home; right-click: Back to the Dock / Hide Wisp
- Walks, stops, naps after inactivity; perks up when listening; thinking dots; talks while speaking; worried on a problem
- On/off from Settings; Reduce Motion: no walking, gentle state changes only
- Pauses its animation when nothing changes on screen, so it costs almost nothing

Tests: Swift unit tests for the pet's behaviour state machine (state per ZENO state, walking bounds, nap timer).

Verification: watch it through a full turn; it never blocks clicks; CPU use while walking and while idle.

---

### Task 0.5.9 — End-to-End Island Test

Verify Phase 0.5 as the user will use it.

- With the terminal closed, start `ZENO.app`
- From another app: hold the talk shortcut, ask a question, release; see status and reply; hear the answer; the pet reacts
- Ask a follow-up; interrupt ZENO mid-reply; cancel with a shortcut
- Dictate into another app
- Change a shortcut and the model in Settings, and use them
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

Phase 0.5 — Desktop Island. Tasks 0.5.1–0.5.4b are done. Keshab asked for settings in the island, changeable shortcuts, dictation and a pet (ADR-039 to ADR-042). Current task: 0.5.8 (The Pet); 0.5.6 awaits its remaining hand checks and 0.5.7 (Dictation) waits for voice testing.

Everything else waits.
