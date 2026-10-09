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
- screen capture or pointing at things on screen (Phase 3; queued as Tasks 0.6.1–0.6.4 by ADR-054, after Task 0.5.9)
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

### Task 0.6.1 — Tool Calling in the Core (ADR-054) — ✅ Done (2026-10-02), live with Gemini

Task 0.5.9 passed (Keshab: works, it replied). Core can offer tools to the model, run the ones it picks through `services/tool-engine/`, and feed results back. One harmless test tool (the time). Tests with a fake model. No computer control yet.

**Done (2026-10-02):** `ToolSpec`/`ToolCall`/`ToolResult`/`ToolRunner` in contracts; the Core runs tool rounds (max 8, one call at a time, cancel-safe, history keeps only the question and final answer); the Claude adapter sends and reads `tool_use`/`tool_result` blocks; `services/tool-engine` validates every call against the tool's schema and turns failures into results; one tool, `current_time`, wired into the runtime and logged as `tool.call`. Gemini is not offered tools (ADR-054). 183 tests, 181 pass, 2 live tests skipped, typecheck clean.

**Gemini added (same day):** the Gemini adapter offers tools as function declarations, reads function calls (keeping Gemini 3's thought signature and passing it back unchanged, via an opaque `signature` on `ToolCall`), and sends results with the function name. 4 new adapter tests.

**Live check, real Gemini key:** asked "What day and time is it in Tokyo right now?" — the model called `current_time`, the engine ran it (14–66 ms), and the reply gave the right time (Saturday 3 October, 12:14 AM). `gemini-3.5-flash-lite` (your saved choice) took 1.8 s, `gemini-3.5-flash` 2.5 s. One first run took 47.8 s (cause not found; it did not repeat in two more runs). A follow-up question used no tool and history kept only the plain turns. Not yet tested by voice through the island app, and Claude's side has run only against fakes (no API credit).

---

### Task 0.6.2 — The Computer Tool (ADR-054) — built; tested live on TextEdit; approval prompt waits for 0.6.3

A `computer` tool in `services/tool-engine/` that starts `cua-driver mcp`, lists windows, reads an app, and acts on elements. Approval rules in code (send, buy, delete, submit, account change), no password fields, stop on Esc / ⌃⌥Z, every action logged. Needs Keshab to run `cua-driver permissions grant`. Tested on a harmless app first (TextEdit, Notes).

**Done (2026-10-02):** `services/tool-engine/src/computer/`: `cua-client.ts` (talks to `cua-driver mcp` over stdio; starts on first use, restarts after a crash, stops when idle or closed; always standard mode, telemetry off, and the unrestricted and manifest overrides stripped; cancel is passed on to Cua), `policy.ts` (blocked apps, risky labels, risky keys, secret fields), `tool.ts` (one `computer` tool, actions `list_apps look open click type key scroll`). Off unless `ZENO_COMPUTER=1`; until Task 0.6.3, every action that needs approval is declined and logged. 45 new tests (233 total, 231 pass, 2 skipped).

**Rules enforced in code, not by the model:** terminals, password managers, System Settings, Activity Monitor, Hermes, Claude, Cua and ZENO's own island are never controlled or even listed; the model may only act on numbered elements from its last `look`; Send/Delete/Buy/Pay/Quit-type buttons, Return, Delete, Cmd+Q, Spotlight and Force Quit ask first; passwords, PINs, one-time codes and card fields are never typed into; the menu bar is left out of a look; logs carry the action and app only, never typed text or screen content.

**Live, real `cua-driver` 0.28.2, TextEdit on a scratch file:** reads the window, types into it (confirmed by reading it back), refuses Terminal, refuses an invented element number. Real Gemini (Flash and Flash-Lite): Flash added "buy milk" to the note (after two failed clicks and a retry, 22 s); Flash-Lite, asked to press Delete, was asked-and-declined and told the user it was not done, and nothing was deleted. Two bugs found live and fixed: a text area's content ("buy milk, send…") tripped the "send" rule, and typed text goes in at the cursor, which the tool description now says.

**Not done:** the real approval prompt in Wisp (Task 0.6.3); clicking by voice end to end through the island; the Flash free quota ran out mid-testing (429), so reliability on longer tasks is unmeasured; Claude is untested on this tool.

### Task 0.6.3 — Wisp Shows the Work (ADR-054) — built; not yet seen on the real screen

Three new island events (`computer.step`, `approval.request`, `approval.closed`) and one command (`approval.answer`); protocol version stays 1. Specified in `docs/island-protocol.md` first.

**Done (2026-10-03):**
- **Runtime:** `apps/mac/src/computer-bridge.ts` sends steps and asks the user. No island, no answer in 60 s, Esc (`talk.cancel`), a new `talk.start`, a reset or quit all count as "no". An answer for an unknown or finished id is ignored, so an old prompt can never approve a later action. Wording is cut to one short line; steps carry the app and kind of action only, never typed text.
- **Island (Swift):** the bubble reads "Using your Mac / Typing in TextEdit" while ZENO acts; an amber card (`ApprovalPanel.swift`) replaces it when ZENO asks, with Decline and Allow, the tail pointing at Wisp (below Wisp near the top of the screen). It brings Wisp out of hiding. Without Wisp it stands at the bottom of the main display. The card never takes focus. A request is cleared when the turn ends, the conversation resets, an error arrives, or the runtime stops.
- **Tests:** 252 TypeScript (250 pass, 2 skipped) and 271 Swift, none failing. Layout checked on the gallery render (`8-computer-control.png`: four panels, no clipping, tails correct).
- **Live, real Cua and Gemini:** steps streamed in order; a Delete key press raised an approval request on the wire; the answer closed it. A model that gives up after too many tries ends cleanly with "used too many steps".
- **Fixed on the way:** a cancel that arrived while Cua was still starting was missed, so the call hung until its 30 s timeout; and a failed start left a timer that held the process open for 15 s.

**Not done:** the card has not been seen on the real screen, and Esc and the Allow click have not been tried by hand with `ZENO_COMPUTER=1`. Gemini Flash's daily free quota ran out partway through, so no run finished with an approved action and a final spoken answer.

### Task 0.6.4 — Pointing (ADR-054) — built; flown on the real screen; not yet heard by voice

The model names a place on screen; Wisp flies there and the bubble labels it. No screenshot is sent anywhere: the place comes from the numbered elements the last `look` already returned (Cua's own positions), so pointing needs nothing beyond the permissions computer control already has.

**Done (2026-10-03):**

- `computer` tool gains a `point` action (`element` from the last look, plus an optional spoken `label`). It refuses before any `look`, an element that is not in the last look, and an element with no position. It is never an approval case: it only shows, it does not act.
- `computer.point` event (`x y w h label`, Cua's coordinates) goes runtime → bridge → island. Documented in `docs/island-protocol.md`; bad numbers are a decode error, never a crash.
- Swift Core: `PointPlacement` (top-left/y-down to AppKit, any number of displays, stands on the element's top edge, hangs under it near the top of a display, never covers it; a place on no display is not flown to), `BubbleLayout` takes a preferred side, `PointingState` (ends on a new turn, reset, error or runtime stop).
- Island: Wisp flies to the spot slowly enough to follow, faces the way it travels, stays about 7 s after arriving, then goes home. The user taking Wisp by hand ends it. The bubble shows the label with "ZENO is pointing".
- Tests: 56 in the computer tool (+11), 3 in the bridge, 25 Swift (+5 suites in `PointingTests.swift`). Full run: typecheck clean, 276 TypeScript (274 pass, 2 skipped), 295 Swift.

**Verified on the real screen:** with `ZENO_POINT_DEMO` (development hook), Wisp flew to a button on the second display, to the middle of the main display and to the menu bar clock; bubble readable each time, clock uncovered, Wisp back home afterwards. With the real model against Brave, "point at the address bar" gave `look → point` in 5.8 s and the event the island got placed Wisp 15 px under the address bar with the bubble below it.

**Not done:** pointing by voice through the island (the live checks fed the same event by hand); the Allow/Decline card, still unseen; Claude untested on this tool; a window moving between the `look` and the `point` shows the old place.

### Task 0.6.5 — Fewer Steps, Clearer Results (ADR-054) — built; verified on the real driver; not measured with a real model

Ideas taken from how Hermes drives the same Cua driver, to cut model round trips and wasted retries. Fewer steps is the main cost lever for any pay-per-token model.

**Done (2026-10-03):** in `services/tool-engine/src/computer/tool.ts`:

- `look_after: true` on `click`, `type`, `key`, `scroll` and `set_value` returns the new screen in the same reply, so the model needs one call where it needed two. Not done for a refused or declined action. If the window cannot be read again, the action is still reported and the model is told to look. It keeps the "just typed" memory, so the Return rule is unchanged.
- Cua's verdict on each input is passed on in plain words: confirmed, could not confirm (look to check), or probably did nothing (look before trying anything else). The same no-effect result twice in a row tells the model to stop and tell the user. A result with no verdict reads as before. Cua's own retry ladder (pixel, foreground) is never shown to the model.
- `set_value` (element number plus the value in `text`) sets sliders, steppers and menu choices directly. It refuses password fields, asks for approval on the same risky labels as a click, and counts as typing only for text roles.
- Tests: 11 new in `tool.test.ts` (45 → 56 in that file). Full run: typecheck clean, 293 TypeScript tests (291 pass, 2 skipped).

**Verified on the real driver:** TextEdit `set_value` returned "(confirmed)", `look_after` returned the new window state in the same reply, and the file was restored to its original text.

**Not done:** a measurement of steps saved with a real model (the Gemini free quota was spent; Claude has no credit); the driver's health check (`cua-driver` `health_report`) as a ZENO command; the plan question (using a Claude subscription for the model), which is a separate decision.

### Task 0.6.6 — Claude on the User's Plan (ADR-055) — built; tested; driven by voice once (Allow path); Decline card not yet tried by voice

A fourth model choice, "Claude (my plan)", that runs the user's own signed-in `claude` through the Claude Agent SDK instead of per-token API calls. See ADR-055 for the rules.

**Done (2026-10-03):**

- `services/llm-gateway/src/providers/claude-plan.ts`: the adapter. `scrubbedEnv` removes `ANTHROPIC_*`, cloud and OAuth variables and other providers' keys. Stops on an API-key credential or on extra usage. Only ZENO's tools are allowed, run in-process. Errors are mapped to gateway kinds; none is retryable after a tool acted. Cancelling stops `claude` and the tool in flight.
- `packages/shared/src/config.ts`: `claude-plan` in the provider table; `findClaudeProgram`; the provider needs no key and counts as available when `claude` is found. A wrong `ZENO_CLAUDE_PATH` is never replaced by another copy.
- `apps/mac`: the runtime builds one tool engine and gives it to both the Core and the plan provider; `model.set` works for it; errors say "install Claude Code and run `claude auth login`" instead of "add a key to .env". 120 s whole-request limit for it. `plan.usage` in the log.
- Island: the picker shows "Claude (my plan)" with "Runs on your Claude plan", or "Claude Code not found or not signed in".
- Tests: 24 for the adapter, 3 for config, 4 for settings (fake SDK; no network, no `claude` process).

**Checked live (2026-10-03):** `model.set` through the island protocol switched to it and saved it. A TextEdit request that needs approval ("press return") ran with the approval hook answering: declined, the Return key was not pressed and Claude said so (6.4 s); allowed, it was pressed (9.4 s). Plan use stayed at 38% (5-hour) and 67% (7-day) with extra usage off, `apiKeySource` none.

**Voice check (2026-10-03):** picked Claude Haiku 4.5 (my plan) in the island and said "In TextEdit, press the return key once." The amber approval card appeared, Allow was tapped, Return was pressed (17.6 s, `plan.usage` 45% / 68%, extra usage off). Haiku tried a key before looking; ZENO refused that and it then looked first.

**Not done:** the Decline path by voice; a run of several tasks to see how much plan a normal use takes; the Claude usage page was not checked by ZENO (only the SDK's own report).

### Task 0.5.10 — Fixed Homes: Menu-Bar Panel and Work Strip (ADR-056) — built; tested; not yet seen on the real screen

From Keshab's end-to-end check (0.5.9): checks 1–4 and the Decline card passed. Two faults shared one cause, everything hung off Wisp: (5) opening the panel beside Wisp moved and froze Wisp; (7) pointing near a corner left no room for the bubble.

- **Menu-bar icon** (`MenuBarIcon`): symbol and colour follow the state. A click, a click on Wisp, or the shortcut opens the panel just below the icon; a click elsewhere, Esc or the collapse button closes it. Right-click: Open ZENO, Show Wisp, Quit ZENO. Wisp is no longer moved or frozen by the panel.
- **Left-edge island removed** (hover band, `HoverController`, `IslandGeometry`). Without Wisp, the status card hangs under the icon during a turn (`MenuPanelLayout`).
- **Work strip** (`WorkStripState`, `WorkStripLayout`, `WorkStripController`): bottom centre above the Dock and Wisp's walkway, from the first step, point or approval request until the turn ends plus 2.5 s. It shows the step and Stop (= Esc); an approval request grows it with Decline / Allow. Then "Done", "Stopped" or "Couldn't finish". It replaces the Wisp-held approval card (`ApprovalPanel.swift` deleted).
- **Pointing**: Wisp flies with no bubble and shows only a short label pill beside itself on arrival (`PointLabelLayout`, roomier side, kept on the display). Wisp's bubble is kept off while the strip is up or Wisp is pointing.
- Tests: 21 new (strip state and layout, label placement, panel under the icon); the left-edge and hover tests removed. 301 Swift tests pass. Gallery sheet `8-computer-control` shows the new strip states.
- Development hook `ZENO_WORK_DEMO=1` plays steps, an approval, a point at the top-right corner and the end of a turn through the real controller.

**Not done:** seen on the real screen. The Mac was locked when this was built (screen capture refused, and the island's microphone warm-up waited on CoreAudio until it was killed), so the live checks are Keshab's: open the panel from the icon and from Wisp (Wisp keeps walking); "In TextEdit, press the return key once" (strip, Allow/Decline in it, Stop); "Point at the Control Centre icon" (Wisp in the top-right corner with just a label).

---

### Task 0.5.11 — Makeover: Three Looks in Settings (ADR-057) — built; tested; not yet seen on the real screen

Keshab asked for a makeover from the island to Wisp; three directions were mocked up (`sketches/makeover/`), and he chose to keep all three, switchable in Settings.

- **Theme** (Quiet Native / Luminous / Warm) and **Wisp** (Ghost / Orb / Companion), chosen separately in Settings → Appearance with live previews; defaults Quiet Native + Orb. Saved with the look settings; "Reset" in General restores them.
- `ThemePalette` (core) drives every surface: panel, compact card, bubble, work strip, point label, menu items. Liquid Glass on macOS 26 is tinted per theme.
- `WispView` draws all three bodies with the same moods, motion and hiding pose.
- Settings rebuilt as pages with the right control per setting; the model picker is two menus; Status shows a labelled timing bar; conversation timings appear on hover.
- Tests: 6 new (`ThemeTests`: WCAG AA text contrast in every theme, saving and resetting the choices). 307 Swift tests pass; 322 TS pass, 2 skipped; typecheck clean. Gallery sheets `9-*` (each theme's panel, strip, bubble) and `10-*` (each Wisp's moods and hiding pose) reviewed; contrast, clipping and mood problems found there were fixed.

**Not done:** seen on the real screen. Keshab: open Settings → Appearance and try each theme and Wisp; check the hiding pose of Orb and Companion at a screen edge; check Warm on a light wallpaper.

---

## Phase 1 — Memory

Keshab (2026-10-04): "Let's skip the tests… continue building." Phase 0.5's hands-on checks are deferred at his request, not dropped: the "Not done" items above still stand. Phase 1 starts with the smallest memory a person expects (ADR-058).

### Task 1.1 — Remember, Recall, Forget (ADR-058) — built; tested; checked live in text

- New service `services/memory`: one SQLite file (`data/memory.db`, gitignored, Node's built-in `node:sqlite`) with full-text search. Every memory has an owner, scope, provenance (voice or text, request id, time) and lifecycle; forgetting deletes the row. 300 characters each, 500 at most, never dropped silently. Facts that look like passwords, PINs, card numbers or API keys are refused.
- Tools `remember`, `recall`, `forget` in the Tool Engine. The Core gained a `context` hook: up to 12 relevant memories (matching words first, then newest) are added to the system prompt of each request, with their ids.
- Island protocol: `memory.list`, `memory.forget`, `memory.clear` and a `memory` event (sent only to an island that asked). Settings has a **Memory** page: every fact with when and how it was kept, × to forget one, and "Forget everything" with a confirm step.
- `ZENO_MEMORY=0` turns it off; `ZENO_MEMORY_FILE` moves the file. The runtime starts with `--disable-warning=ExperimentalWarning` so Node 22's SQLite notice stays out of the log.
- Tests: TS 338 pass, 2 skipped (12 new for the store, tools and context; 2 for the Core hook; 3 for the protocol); Swift 310 pass (3 new). Live on Claude Haiku 4.5 (Claude plan), across two separate runtimes sharing one file: "remember my sister is Asha in Osaka" and "my coffee is black" were kept; the second runtime, with no conversation history, answered both; "forget my coffee" deleted it; "remember my bank PIN" was declined.

**Not done:** spoken through the island by Keshab; the Memory page seen on the real screen.

### Task 1.1b — Open at Login — built; not yet tried

Settings → General → **Open at login**: registers ZENO.app as a macOS Login Item (`SMAppService.mainApp`). The state is read from macOS each time, never saved by ZENO, so it always matches System Settings → General → Login Items. If macOS asks for approval, the row offers "Open…" to go there. Unavailable (switch off, with a note) when ZENO is not running from the app bundle.

Also checked: a damaged `data/memory.db` turns memory off with `memory.unavailable` in the log; ZENO keeps running.

**Not done:** Keshab turns it on, logs out and in.

### Task 1.2 — Conversation Notes and Offering to Remember (ADR-059) — built; tested; checked live in text

- After each reply, a background request writes ZENO's two-sentence note about the conversation (`episodes` table, one per session, newest 50 kept). The newest three from other sessions are in the system prompt. Settings → Memory → "Recent conversations" lists them with × and Clear. `ZENO_EPISODES=0` turns it off.
- ZENO offers to remember lasting personal facts mentioned in passing and keeps them only on a yes.
- Base prompt: one to three sentences, at most one question.
- Tests: TS 345 pass, 2 skipped (6 new for episodes and the recorder, 1 for the Core hook); Swift 311 pass. Live on Claude Haiku 4.5: a Kyoto trip plan was noted; after "New conversation", "What were we planning last time?" got the plan back. "I'm vegetarian" got an offer; "yes" kept it. A trivia question was not noted as a plan.

**Not done:** by voice through the island; the notes card on the real screen.

### Task 1.3 — Calendar and Reminders (ADR-060) — built; tested; helper in the app

- `zeno-calendar` EventKit helper in ZENO.app; tools `calendar_events`, `reminders_list`, `reminder_add`; date, time and zone in every request's context.
- Tests: TS 347 pass (3 new for the tools). The app builds with the helper inside, signed; the runtime logs `calendar.helper available:true`.

Live in text (Claude plan): the calendar call waited on macOS's permission dialog (screen asleep at night) and timed out. The helper now says exactly that, so ZENO can tell the user to click Allow.

### Task 1.4 — Timers (ADR-061) — built; tested; checked live in text

- `timer_set` / `timer_list` / `timer_cancel`; the runtime chimes and speaks when one ends, then the island shows "Timer done".
- Tests: TS 351 pass (4 timer tool, 1 island); Swift 312 pass. Live: "a timer for 5 seconds for the tea" fired at 5 s; "20 minutes for the laundry" listed, then cancelled.

### Task 1.5 — Weather (ADR-062) — built; tested; checked live in text

- `weather` tool on Open-Meteo; home from the time zone. Tests: 3 new. Live: "What's the weather like?" → Tokyo now and the next days; "Will it rain in Osaka tomorrow?" → 53%, bring an umbrella. Both took ~18 s at first: Open-Meteo's TLS handshake is ~6 s from here, and Claude Code had thinking on. Fixed by caching places and forecasts, refreshing home's every 30 min, and turning thinking off for the plan: weather 6.3 s, greeting 4.6 s, sums 4.2 s.

### Task 1.6 — Speed and typing

- Claude plan thinking off (unless `ZENO_THINKING=1`); weather cached and home pre-fetched. Measured: greeting 4.6 s, weather 6.3 s (was 19.4 s), timer 5.5 s, arithmetic 4.2 s.
- Type to ZENO: a composer at the bottom of the Conversation tab; Return sends; the reply is shown and spoken. Protocol `text.send`. Checked over the real pipe: "What is 6 times 7?" → "Six times seven is forty-two." in 4.8 s, first sound 1.2 s later.

- ADR-064: the next Claude Code process is pre-started (3 s after each answer, so it does not slow speech). Per-request context moved to `systemExtra`.
- ADR-065: speech starts on Claude's first sentence while it is still writing. A long opening is cut short; Kokoro now runs at fp32 (~1.6× faster here). Measured, question → first sound: greeting 1.7 s, plain question 1.3 s, weather 2.5 s.

## Phase 2 — Hands-Free and More Things to Do (2026-10-04)

- ADR-066: open apps and websites (always on; terminals, password managers, System Settings and AI agents refused). Checked live: Safari, Notes, YouTube opened; Terminal refused.
- ADR-067: answer ZENO's question without keys. The microphone opens after a reply that ends in "?"; 6 s to start, 0.9 s of quiet ends it. Setting "Answer without keys". **Not yet tried by voice.**
- ADR-068: music (Spotify/Music) and volume. **Not yet tried live** (macOS asks to allow ZENO to control the player).
- ADR-069: web search on the Claude plan; "Let me look that up" spoken first (~1 s); the Sources list is never spoken. Checked live in text.
- ADR-070: take a note into Apple Notes. **Not yet tried live.**

**Not done (1.3):** Keshab allows Calendar and Reminders when macOS asks (first time ZENO is asked about his schedule), then tries "What's on tomorrow?" and "Remind me to … at …".

### Task 2.x — Shortcuts: Plain Commands Skip the Model (ADR-071) — planned; not started

Run plain spoken commands in code before any model is called. Do not start until Keshab confirms the starting list.

1. `services/tool-engine/src/shortcuts/`: a pure matcher `matchShortcut(text, context) → { name, call } | undefined`; `context` has the installed app names. Tests first, in two groups: sentences that must match, and look-alikes that must not ("open Safari and search for cats", "open the pod bay doors", "scroll down and tell me what it says", "open" alone, a near-match app name, "please" and capitals and punctuation variants of the real commands).
2. Run the matched call through the existing tool engine, so every rule and log line stays. Return the fixed reply, or "not handled" if the tool fails or refuses.
3. A Core option `shortcuts`: try it before `model.complete`; on a hit, the reply and exchange join the conversation with no model call; on "not handled", carry on as today. Cancel behaves as for a model turn.
4. Wire it in `apps/mac/src/runtime.ts` unless `ZENO_SHORTCUTS=0`; log `shortcut.hit` / `shortcut.fallback` (name and reason only). `.env.example`.

**Done when:** unit tests pass including every look-alike staying unmatched; typecheck and existing tests green; on the real Mac, the log shows no model request for a shortcut and the time from end of speech to action is recorded next to today's 2–3 s model path; by voice, a shortcut works, a look-alike goes to the model, and "open Terminal" is refused with the reason spoken; Keshab's verdict is written here.

**Out of scope:** typing, sending, deleting, buying, quitting; web page buttons; partial speech; wake words.

### Task 2.y — What Is in Front (ADR-072) — built; tested; read once on the real Mac from the terminal (Brave); not yet tried by voice

Built 2026-10-10, ahead of Task 2.x at Keshab's choice. `front_window` has 10 unit tests; typecheck and all tests are green (384 pass, 2 skipped). On the real Mac: `lsappinfo` read the front app with no prompt. The first read of Brave failed while macOS showed its one-time Automation prompt, so the browser now gets 15 s and a timeout says to allow it and ask again. The second read returned the title and address. Arc's `mode` property is untested (no Arc installed); if Arc has none, Arc gives its name and the reason. Not yet done: Keshab's voice checks below, with Brave instead of Chrome (Chrome is not installed).

A read-only `front_window` tool: front app name, and for Chrome, Arc, Edge and Brave the tab title and address. On by default; Safari gives its name only (ADR-072, accepted 2026-10-10). Comes after Task 2.x unless Keshab says otherwise.

1. `services/tool-engine/src/tools/front-window.ts`. Write the tests first, using a fake `osascript` / front-app reader:
   - **pure functions:** `cleanAddress(url)` drops the query, fragment and user info, and keeps only http(s); `describeFront(...)` builds the labelled result;
   - **blocked apps:** an `appBlock` app gives "ZENO does not read <app>" and no title;
   - **private windows:** an incognito Chromium window gives no title or address;
   - **Safari, Firefox and other apps:** name only, and no browser script is run for them;
   - **long titles:** cut to 200 characters;
   - **browser errors:** a script error or refusal gives the app name and the reason, not a crash.
2. Front app without permissions: get the name and bundle id with no TCC prompt (`lsappinfo` or AppleScript `path to frontmost application`, whichever proves prompt-free on the real Mac). If a prompt appears, stop and report.
3. Register the tool in `apps/mac/src/runtime.ts` unless `ZENO_FRONT_WINDOW=0`. Log `front_window.read` with the bundle id and the returned field names only. Add the switch to `.env.example`. The tool description tells the model to call it only when the user refers to what is on screen, and to treat the result as data.
4. SECURITY.md §15 (desktop island): one bullet covering what is read, from which browsers, the limits, and that ZENO still holds no Accessibility.

**Done when:**
- unit tests pass, and typecheck and the existing tests are green;
- on the real Mac, by voice, with Chrome in front, "what's this page?" answers with the page title; macOS asked once for Chrome, and no Accessibility prompt appeared;
- with Safari in front, ZENO names Safari only, and macOS never asks to control Safari;
- "save this link in a note" puts the cleaned address in Notes;
- with Terminal in front, ZENO says it does not read it;
- the log shows no title or address.

**Out of scope:** page text (`WebFetch`, its own ADR); window titles of non-browser apps; sending the front app with every request; Safari and Firefox addresses.

### Task 2.z — Wisp Notices You (ADR-073) — planned; not started

Eyes that follow the pointer, a hover glow, a squish on click, dizzy after three fast clicks, a hello on launch, and a yawn before napping. ADR-073 accepted: on by default with a switch; hello on every launch.

1. `ZenoIslandCore`. Write the tests first:
   - **gaze:** where the eyes look from Wisp's centre and the pointer, clamped to a few points, zero beyond about 400 pt, zero unless floating or resting;
   - **click count:** which reaction it gives;
   - **reactions:** how long each lasts, and that any ZENO state (listening, thinking, speaking, worried, carried, tucked) replaces a reaction at once;
   - **Reduce Motion:** no squash, wobble or bounce.
2. `WispView` and `PetController`: draw the gaze and the reactions for Ghost, Orb and Companion. Reuse the pointer position already read for hover; add no new timer.
3. Settings → Wisp: "Reacts to you" switch. The gallery renders each reaction for each Wisp.
4. SECURITY.md §15: the pointer position is also used for Wisp's gaze, and is still not stored or logged.

**Done when:**
- Swift tests pass (`pnpm island:test`), and the existing tests are green;
- on the real screen, with each Wisp: the eyes follow the pointer, a click squishes and still opens or closes the panel, three clicks make it dizzy, and talking to ZENO interrupts any reaction;
- with Reduce Motion on, only the eyes move.

**Out of scope:** particles and stickers; sounds; outfits.

### Task 2.w — Drop Wisp on a Window to Ask About It (ADR-074) — planned; not started

Holding Option while dropping Wisp on a window brings that app to the front, reads it once with `front_window`, and opens the microphone for the question. Wisp then flies back. ADR-074 accepted: hold Option; the app comes to the front. Still waits for ADR-067's voice check.

1. `ZenoIslandCore`. Write the tests first:
   - **window choice:** from `CGWindowListCopyWindowInfo`-shaped data, pick the window under a point, skipping ZENO's own windows and windows that are not on screen;
   - **gesture:** a drop with Option asks, a drop without Option parks;
   - **flight home:** Wisp's spot is unchanged after asking.
2. Island: outline the window while Option is held; on the drop, refuse blocked apps with a bubble, otherwise bring the app to the front and send the runtime one new command (island protocol doc updated).
3. Runtime: on that command, run `front_window` once and attach the result to the next turn only, as screen content. Open the microphone with ADR-067's timing. Drop the read if nothing is said. Log `wisp.pointed` with the bundle id only.

**Done when:**
- Swift and TS tests pass, and typecheck is green;
- on the real screen, Option-dropping Wisp on Brave and asking "what's this about?" answers about that page;
- a plain drop still parks Wisp;
- Option-dropping on Terminal shows the refusal bubble and opens no microphone;
- the log has no title or address.

**Out of scope:** raising one exact window of a browser (needs Accessibility); dropping files; Safari addresses.

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
