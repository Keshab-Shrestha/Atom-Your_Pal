# ZENO Task Plan

Renamed ZENO -> ATOM on 2026-10-13; entries below keep the name they were written under.

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

### Task 2.x — Shortcuts: Plain Commands Skip the Model (ADR-071) — built; tested; not yet tried by voice

Run plain spoken commands in code before any model is called.

**Keshab's list (2026-10-10):** "open settings, open brave, open finder, open notes, open journal, play/pause the music on current brave window, search <tag> on chrome/currently open youtube site". His answers: "settings" means both (ZENO's Settings, and "open system settings" for the Mac's); play/pause by the Mac's media key; searches on YouTube reuse the open YouTube tab, "on Google" or "on Chrome" opens a new tab.

1. `services/tool-engine/src/shortcuts/`: a pure matcher `matchShortcut(text, context) → { name, call } | undefined`; `context` has the installed app names. Tests first, in two groups: sentences that must match, and look-alikes that must not ("open Safari and search for cats", "open the pod bay doors", "scroll down and tell me what it says", "open" alone, a near-match app name, "please" and capitals and punctuation variants of the real commands).
2. Run the matched call through the existing tool engine, so every rule and log line stays. Return the fixed reply, or "not handled" if the tool fails or refuses.
3. A Core option `shortcuts`: try it before `model.complete`; on a hit, the reply and exchange join the conversation with no model call; on "not handled", carry on as today. Cancel behaves as for a model turn.
4. Wire it in `apps/mac/src/runtime.ts` unless `ZENO_SHORTCUTS=0`; log `shortcut.hit` / `shortcut.fallback` (name and reason only). `.env.example`.

**Done when:** unit tests pass including every look-alike staying unmatched; typecheck and existing tests green; on the real Mac, the log shows no model request for a shortcut and the time from end of speech to action is recorded next to today's 2–3 s model path; by voice, a shortcut works, a look-alike goes to the model, and "open Terminal" is refused with the reason spoken; Keshab's verdict is written here.

**Out of scope:** typing, sending, deleting, buying, quitting; web page buttons; partial speech; wake words.

**As built (2026-10-10):**
- `services/tool-engine/src/shortcuts.ts`: `matchShortcut` (pure) and `createShortcuts` (runs the match through the tool engine, returns the tool's reply or undefined). The sentence is lower-cased and loses commas, end punctuation, a leading "Zeno", "please", "can you" and a trailing "please"; then the whole of it must fit one pattern:
  - "open/show (the/my/your/ZENO's) settings" → `open_zeno_settings`.
  - "open/launch/start/switch to (the/my) <app> (app)" → `open_app`, only when <app> is exactly an installed app's name, or that name without " Browser" ("Brave"). "Mac settings" and "System Preferences" mean System Settings.
  - "play/pause/resume/unpause (the) (music/video/song/YouTube) (in/on Brave/the browser/YouTube)" → `play_pause`.
  - "search (for) <text> on/in YouTube", "search YouTube for <text>" → `open_url` with a YouTube results address and `same_tab`. The same with Google or Chrome → a Google search in a new tab. Text up to 200 characters.
- New tools in `tools/island.ts`: `open_zeno_settings` and `play_pause`, carried out by the island (`settings.open`, `media.key`). The island presses the system play/pause key with the Accessibility permission it holds for dictation, or shows a notice when it lacks it.
- `open_app`: Finder is now in the app list (it lives in CoreServices), and System Settings may be opened (open only; computer control still never touches it).
- `open_url` takes `same_tab`: when the browser in front (Chrome, Arc, Edge or Brave, the ones `front_window` reads) shows the same site in a normal window, the address is loaded in that tab; otherwise, or if the browser cannot be scripted, a new tab as before.
- Core option `shortcuts`, tried before the model; a reply joins the conversation, a refusal or failure goes to the model unchanged (so "open Terminal" is answered by the model with the reason). Wired in `runtime.ts` unless `ZENO_SHORTCUTS=0`; logs `shortcut.hit` (name, ms) and `shortcut.fallback` (name, reason), never the sentence.
- Tests: 7 matcher/runner tests (every look-alike from the plan stays unmatched), 3 `open_url same_tab` and 1 System Settings test, 1 island tools test, 2 Core tests; 5 Swift tests for the two events and the key numbers. 447 TS and 408 Swift tests pass; typecheck clean. A dry run against this Mac's installed apps matched all of Keshab's commands (nothing was run).

**Known limits:** play/pause is a toggle ("play" while playing pauses); without Accessibility the runtime still answers "Done." while the island shows the notice; `same_tab` can only reuse a tab in the browser in front.

**Not done:** by voice through the island; the time from end of speech to action next to the 2–3 s model path; Keshab's verdict.

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

### Task 2.z — Wisp Notices You (ADR-073) — built; tested; seen in the gallery; not yet seen on the real screen

Built 2026-10-10. `WispGaze`, `WispReaction` and `WispReactionPlayer` (in `ZenoIslandCore`) have 12 new tests; all 330 Swift tests pass. The gallery (`10-wisp-*`) now has a third row showing each Wisp looking up-left and right, hovered, squish, dizzy, hello and yawn. Not yet done: Keshab's look on the real screen (see Done when).

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

### Task 2.w — Drop Wisp on a Window to Ask About It (ADR-074) — built; tested; not yet tried on the real screen

Built 2026-10-10 at Keshab's request, ahead of ADR-067's voice check. Swift: `WindowPick` (the window under a point, the Option rule, window-list coordinates) with 7 tests, plus 3 protocol tests; 340 Swift tests pass. TS: `readApp` in `front-window.ts`, `screen-context.ts` (the pending read and the pointer), and `context.window` / `context.ready` in the protocol; 399 TS tests pass, and typecheck is clean.

As built:
- The island brings the app to the front and waits up to 0.5 s for it before asking the runtime.
- The microphone opens through ADR-067's follow-up path, whatever the follow-up setting.
- If nothing is said, the read lapses after 30 s (or at a new conversation), so a typed question within 30 s also gets it.

Known limits:
- A fully transparent window from another app could be picked.
- No timeout if `context.ready` never comes.
- `activate()` from the background must be checked on the real Mac.

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

### Polish batches (ADR-075 to ADR-080), chosen by Keshab 2026-10-10 — planned; not started

Built one batch at a time, in this order, each with tests and a gallery image where it shows on screen. Each batch ends with typecheck, all TS tests, all Swift tests and the gallery, then Keshab's look.

**Task 2.A — Setup and errors (ADR-075).** Built 2026-10-10; tested (366 Swift tests); gallery `11-setup-*`; not yet tried on the real Mac.

As built:
- Permission rows include Accessibility, which is read only, for typing dictated text.
- Input Monitoring is read with `IOHIDCheckAccess`, so "never asked" shows as Not yet asked.
- For Microphone and Input Monitoring never asked, the row button asks macOS on the user's click.
- On a config error or after repeated crashes, the panel now opens on the stopped card instead of an alert that quit ZENO.
- "Choose another model" shows only while the runtime runs. A missing key in .env stops the runtime, so that card offers Restart and Open log.
- "Sign in" opens Terminal with `claude auth login` through a temporary `.command` file, so no Automation permission is needed.
1. Core: permission state per row (pure mapping from system answers to Granted / Not yet asked / Denied), and the failure → sentence + action table. Tests first.
2. Island:
   - the permissions checklist in Settings → General, plus the first-launch card;
   - plain error cards with action buttons;
   - "Restart ZENO" and "Open log" on the stopped card;
   - the first-run tour, skipped if the user talks first.
3. README quick start.

**Done when:**
- no check ever triggers a permission prompt (verified on the real Mac);
- each known failure shows one sentence and a working button;
- the tour runs once and can be replayed.

**Task 2.B — Everyday polish (ADR-076).** Built 2026-10-10; tested (380 Swift, 406 TS); gallery `12-everyday`; not yet tried on the real Mac.

As built:
- **Paused while asleep or locked.** Wisp's timer stops, nothing prepares the mic, and the Talk and Dictate keys are ignored. Launching while locked starts paused (`CGSSessionScreenIsLocked`, undocumented). A dictation already running when the Mac locks is not cancelled.
- **Capabilities.** The list is re-sent after each model switch. Every user-facing tool must declare one: memory tools included, and a test enforces it. Example phrases are display only, so a click cannot run them.
- **Plan usage.** Reports are merged field by field.
- **Switch card.** Shown only when another provider is usable.
1. Island: pause and resume on sleep, wake, lock and unlock.
2. Tool engine: examples per tool, with tests requiring them. Runtime: the `capabilities` and `plan.usage` events (protocol doc updated).
3. Island:
   - the "What can I ask?" page and the empty conversation;
   - plan meters;
   - "Switch to <provider>" on a rate-limit card.

**Done when:**
- after locking the Mac and unlocking, Talk and dictation work at once, and the log shows no mic preparation while locked;
- the page lists only tools that are on;
- the meters match the logged `plan.usage`.

**Task 2.C — Wisp and voice polish (ADR-077).** Built 2026-10-10; tested (390 Swift, 407 TS); not yet seen on the real screen. The flight leans with its horizontal direction, fading at take-off and landing. Wisp stays at 30 fps while hovered or reacting. The CPU measurement is still to do.
1. Core: the Bézier flight path (pure, tested).
2. PetController: the flight, and the timer at 10 fps while napping or tucked.
3. `DEFAULT_SYSTEM_PROMPT`: the three rules (core test updated).

**Done when:**
- Wisp's flight to the menu-bar icon arcs and lands exactly;
- CPU while napping is lower than today's (measured the same way as TASK.md 0.5.4b).

**Task 2.D — Wisp's home display (ADR-078).** Built 2026-10-10; tested (403 Swift); not yet tried on two displays.

As built:
- **Checks.** The home is re-checked once a second and on display changes, so a busy Wisp moves once it is idle.
- **Follow the pointer.** Wisp moves 3–4 s after the pointer settles on another display.
- **Home display unplugged.** The walkway moves at once, and a tucked Wisp comes out.
- **Parked Wisp.** It stays where it was parked.
1. Core resolver with tests: main display, display with the pointer, chosen display, unplugged display.
2. Settings row; re-place Wisp on `didChangeScreenParametersNotification`.

**Done when:** on two displays, each choice puts the walkway where it says, and unplugging the chosen display brings Wisp to the main one.

**Task 2.E — Settings tidy-up (ADR-079).** Built 2026-10-10; tested (394 Swift).

As built:
- **The split.** `ExpandedView.swift` went from 1,490 to 121 lines, plus one file per page under `Settings/`, `ConversationView`, `StatusView` and `SharedRows`. The gallery was byte-identical before and after the split.
- **Reset per page.** The Wisp page now holds Wisp, Speech bubble and Panel. Appearance, Shortcuts, Dictation and Wisp each have "Reset this page", replacing "Reset look".
- **What the Wisp reset touches.** It also resets "Reacts to you", but never "Show Wisp" or the parked spot.
1. Split `ExpandedView.swift` with no change in behaviour (tests and gallery identical).
2. Merge Wisp, Bubble and Panel; add "Reset this page".

**Done when:** every setting is reachable on the new pages, and each reset touches only its page.

**Task 2.F — Pointing from a screenshot (ADR-080, Cua only).** Built 2026-10-10; tested (433 TS); the real Cua screenshot was taken once (1280×720 JPEG, about 340 ms, temp folder removed). Not yet tried by voice.

As built:
- Cua 0.28.2 captures the main display only (`get_desktop_state`), and ZENO's own windows can appear in the screenshot.
- Images travel in tool results for all three providers.
- The marker is held back from streamed speech like "Sources:" (`pointing.ts`).
- A reply that is only a marker is spoken as "It's <label>."
- The raw reply, marker included, stays in Core history, so it may appear in conversation notes.
1. Runtime: a `look_at_screen` tool, only while `ZENO_COMPUTER=1`, using Cua's screenshot (pointer display first, 1280 px long side, never stored or logged).
2. A pure parser for `[POINT:x,y:label]` / `[POINT:none]`, stripped before speech, with a range check against the screenshot size and the pixel → screen-point conversion per display. Tests first, including a second display.
3. Send the existing `computer.point` event.

**Done when:** with computer control on, "where's the Wi-Fi icon?" makes Wisp point there and say one sentence, and a malformed marker is dropped without being spoken.


## Phase 3 — Helpers: Sid, Kame and Puff (ADR-081, 2026-10-10; ADR-082; ADR-087)

Keshab's answers: research, then open in its app; ZENO's own window; flies over and says one line; Sid end to end first. Each task below is one capability and ends with its own tests and docs.

**Task 3.1 — Helper store and the Helpers window.**
1. Runtime: tables for helpers (name, app), jobs (id, helper, task, state, timestamps, partial) and reports (job, title, one-line summary, body, sources) in ZENO's SQLite file; a pure job state machine (queued → running → done / failed / stopped) with tests.
2. Protocol: `helpers.list`, `helper.set` (app), `job.stop`, `job.delete` commands; a `helpers` event with every helper, its jobs and its reports' titles; `report.get` → `report` event for one report body.
3. Swift: a "Helpers" window (Dock icon while open) opened from the menu-bar icon and the panel: Sid's card with an app picker (installed apps), job list, report view, Stop and Delete. Kame and Puff appear as "coming soon".

**Done when:** Sid can be set to Brave in the window, the choice survives a restart, and a job added by a test shows up, can be stopped and deleted.

**As built (2026-10-10):** built; tested; seen in the gallery (`13-helpers`); not yet opened on the real screen.
- `services/helpers` (`@zeno/helpers`): the roster (Sid available; Kame and Puff "coming soon"), the job state machine, and a store in its own SQLite file (`ZENO_HELPERS_FILE`, default `data/helpers.db`, gitignored) with helper apps, jobs and reports. `start`, `step`, `finish` and `fail` are ready for 3.2. A job left running when ZENO closed becomes failed ("ZENO was closed while this job ran"). Sources keep http and https only.
- Protocol: the six commands and two events in `docs/island-protocol.md`. `helper.set` accepts only an installed app. If the file cannot be opened, the runtime logs `helpers.unavailable` and carries on: the list is empty and `helper.set`, `job.add` and `report.get` are refused ("Helpers are off: their file could not be opened.").
- Logs: `helpers.change` with helper, job id, state and ms only; never the task, report or addresses.
- Swift: the Helpers window (720×520, remembers its place, Dock icon and a small menu with Edit commands while open), opened from "Helpers…" in the menu-bar icon's menu and a people button in the panel header. Sid's card shows the app picker, "Give Sid a task", the jobs with Stop, Delete and Read, and the report with its sources (http and https only).
- Tests: 21 TS (store, state machine, protocol, island) and 14 Swift. 468 TS and 422 Swift tests pass; typecheck clean.
- Known limit: changing the theme while the window is open updates the title bar only the next time it opens. Jobs stay queued until Task 3.2.

**Revised by ADR-082 (2026-10-10): Wisp manages a team of workers.** Tasks 3.2–3.9 replace the earlier 3.2–3.6. Each is one capability with its own tests and docs.

**Task 3.2 — The worker runner, with Sid researching.** A job runner in the runtime: at most three jobs at once, one per worker, a time and step limit, cancel by `job.stop`; a running job never blocks the conversation. A job is a separate Claude plan session whose tools come from the worker's role in code; this task builds the researcher's (WebSearch, WebFetch only) and the structured report (title, one line, body, sources). Progress steps go to the window. Another provider: the job fails with "Sid needs the Claude plan".
**Done when:** a job added in the window runs, produces a stored report with sources, stop ends it within a second, and the conversation answers meanwhile.

**As built (2026-10-10):** built; tested; one real job run end to end from a script; not yet tried from the window.
- `services/helpers/src/runner.ts`: at most 3 jobs at once, one per worker, oldest first; picks up queued jobs at start; stop or delete aborts the run at once and drops its late result; at 15 minutes it aborts and keeps a returned report as partial, else fails "Took longer than 15 minutes"; closing ZENO stops every run (the next start marks them failed).
- `services/llm-gateway/src/providers/claude-plan-job.ts`: one Agent SDK session per job with Claude Code's WebSearch and WebFetch only, no MCP servers, no user settings (`strictMcpConfig`, `settingSources: []`), 30 turns. `canUseTool` is the gate: it allows search and the structured answer, counts pages, refuses the 13th fetch ("write the report now", marked partial) and refuses any other tool. The report comes back as structured output, checked against a strict schema. Steps: "Searching the web", "Reading n of up to 12 pages", "Writing the report". Plan usage goes through the same checks and meters as conversations.
- Runtime: the provider in use when a job starts decides; any provider but the Claude plan fails the job with "Sid needs the Claude plan for research." Logs `job.run` with worker, job, state, ms, pages and partial only. Quitting ZENO stops jobs and their Claude processes.
- Live (Haiku 4.5, the saved choice): "What is the difference between TCP and UDP?" finished in 25.7 s with 1 page read and 4 sources. The plan then reported 98 % of the five-hour window used.
- Tests: 15 new (runner 9, research run 6); 483 TS pass, typecheck clean.
- Known limits: no test yet that a conversation answers during a job (nothing in the Core waits on it); "no markdown" in a report is asked, not checked; Sid's soul is fixed until 3.3; no `ZENO_HELPERS=0` switch.

**Task 3.2b — Laya chooses each job's model (ADR-083).**
1. `services/decision-engine`: a `DecisionEngine` interface (`chooseModel(task, role) → { tier, score?, source }`) and the Laya implementation: an MCP stdio client to `laya-mcp-server`, started on the first job and kept warm, stopped on quit; the difficulty question and thresholds from ADR-083; a 5 s limit; any failure → the role's default tier. Tests with a fake Laya.
2. Tiers to models from the plan's offered models (newest Haiku / Sonnet / Opus; missing family → next tier down); role floors; "Allow the large model" switch and a per-worker pin (protocol + Helpers window).
3. The runner asks for the model before each job; the window shows the model and why; logs hold tier, score and source only.
**Done when:** a lookup task runs on Haiku and a refactor task on Opus (or Sonnet with the large model off), Laya stopped makes jobs fall back without waiting, and the pin overrides Laya.

**As built (2026-10-10):** built; tested; Laya checked live (no Claude jobs, the plan was nearly spent); not yet tried from the window.
- `services/decision-engine` (`@zeno/decision-engine`): the `DecisionEngine` interface (`chooseTier`, `warm`, `close`), the thresholds in one place, and the Laya engine over MCP stdio (`@modelcontextprotocol/sdk` 1.31.0, already in the lockfile). 5 s per call; a failure or a missing server falls back to medium; one restart after a crash, then off until ZENO restarts. `ZENO_LAYA=0` turns it off, `ZENO_LAYA_SERVER` sets the path. Laya starts when the Helpers window opens (its cold start took 5.4 s, longer than a job's 5 s limit) and stops when ZENO quits.
- `services/helpers/src/models.ts`: roles on the roster (Sid researcher, Kame coder, Puff designer), role floors, newest model per family with "next tier down" when one is missing, and the reasons the window shows. A pin wins over Laya, the floor and the large-model switch.
- Store: pins, the large-model switch (default on) and each job's model and reason, with old files migrated. Protocol: `helper.pin`, `helpers.settings` and the new `helpers` fields.
- Window: a Model picker ("Chosen by Laya" or a model), "Allow the large model for helpers", and a line on each job such as "Sonnet 4.5 · Laya: moderate".
- Live: cold start 5.4 s; then "What year was TCP/IP adopted?" → small (trivial, 0.16) and "Refactor the authentication module to support OAuth and add tests" → large (hard, 2.67), about 50 ms a call warm; the process was gone after close.
- Tests: 28 TS (engine 13, models 9, store 3, island and protocol) and 6 Swift. 511 TS and 430 Swift pass; typecheck clean.
- Known limits: a model that fell back a tier keeps Laya's label as its reason; only Haiku, Sonnet and Opus models are offered for pins; a `models` tier the island does not know stops the window updating until the island is updated.

**Task 3.3 — The team and their souls.** All seven workers in the roster with their souls (role, personality, how they work, rules, lessons), editable in the window with versions. Penny and Hana available with the research tools; Kame, Puff and Quill wait for 3.11; Tinker for 3.13. (Hana's job folder moves to 3.11, where writing to folders is built.)
**Done when:** each worker's soul shows in the window, an edit is used by the next job, and an older version can be restored.

**As built (2026-10-11):** built; tested; seen in the gallery (`13-helpers`, "Sid's soul"); not yet opened on the real screen and no live job run (plan quota).
- Roster (`services/helpers/src/jobs.ts`): Sid researcher, Kame coder, Puff designer, Quill documenter, Penny financial information, Hana HR, Tinker improver, each with a default soul. Sid, Penny and Hana are available and run the research job (WebSearch and WebFetch only); the rest show "coming soon". `available` and `role` are code; a soul edit cannot change them.
- Souls: a `souls` table in `data/helpers.db` (helper, version, five fields, time). Version 1 is the default, written on first open. A save adds a version (none when unchanged); a restore copies an old version into a new one, so it can be undone. Every version is kept; the newest 10 are listed. Names: letters, at most 20, unique among workers, not Wisp or ZENO. Field limits 600 / 1500 / 1500 / 2000.
- Jobs: the runtime reads the soul when a job starts, so an edit applies from the next job. The instructions are the soul, then the role's fixed rules in code: Penny gives information, never advice, never touches accounts or trading, and every report of hers ends with "This is information, not professional financial advice." (added by code if missing); Hana never puts a private person's details into a web search.
- Protocol: `soul.set` and `soul.restore`; the `helpers` event gains `role`, `soul`, `soulVersion` and `soulVersions`. The command limit is now 16 384 characters (the longest soul). Logs carry the helper and version only.
- Window: every worker can be chosen; the header shows the role; "Soul" opens a form (name, personality, how it works, rules, lessons learned, each with a count), Save (⌘S) and a Versions menu that restores an older one. A worker not ready for jobs shows its soul only.
- Tests: 9 store and instruction tests, protocol and island tests (TS 521 pass, 2 skipped; typecheck clean) and 7 Swift (463 pass).
- Known limits: the old Sid soul text (`RESEARCHER_SOUL`) is gone, replaced by Sid's default soul; renaming a worker does not yet change how voice addresses it ("<Name>, …" comes with 3.5); the Versions menu shows numbers and dates, not the old text.

**Revised by ADR-087 (2026-10-10): orchestration after Paperclip.** Tasks 3.4–3.16 replace the earlier 3.4–3.9. 3.3 is unchanged. Each is one capability with its own tests and docs.

**Task 3.4 — Tasks and the task board.** Store: tasks (goal, parent, worker, brief, state, blocked-by, thread of comments, reports and runs); a job becomes a run of a task; one run per task, claimed atomically; blocker cycles refused; a task waits until its blockers are done and then gets their reports. Protocol for tasks and comments. Window: a board (To do, Running, Needs you, Done) and a thread per task with its activity list.
**Done when:** a task blocked by another starts only after it finishes and receives its report, a cycle is refused, two claims on one task give one run, and the board shows each state.

**As built (2026-10-11):** built; tested; seen in the gallery (`13-helpers`: the board, a task's thread); not yet opened on the real screen and no live run.
- A job is a task: `jobs` gains `goal` and `parent_id`; new tables `job_blockers`, `job_comments` and `job_events` (activity: created, waits, commented, running, done, failed, stopped). Old files are migrated.
- Blockers: at most 6, each an existing task that has not failed or been stopped; repeats dropped. A new task cannot close a circle (what it waits for already exists); `setBlockers` on a queued task checks for circles through any path (`makesCycle`). A task whose blocker fails or is stopped fails too, down the chain (`queued → failed` is now allowed, only for this). Deleting a done blocker lets the waiting task go on without its report.
- One run per task: `start` claims with `UPDATE … WHERE state = 'queued'` and refuses a task still waiting; a second claim throws. The runner asks for runnable tasks only (queued with every blocker done) and looks again whenever a task ends or its blockers change.
- The run's brief (`briefFor`): the task, its goal, Keshab's notes, and the reports of the tasks it waited for (each body cut to 8000 characters), marked as data, never instructions.
- Protocol: `job.add` takes `blockedBy`; new `job.block`, `comment.add`, `thread.get` and the `thread` event; jobs carry `blockedBy`, `waitingFor`, `comments`, `goal`, `parentId`.
- Window: "Board" at the top of the sidebar groups every worker's tasks into Needs you (failed), Running, To do (in run order) and Done; a "Waits for" menu under the task field; a task's title, a board card or "Read report" opens its thread: what it waits for (changeable while it has not started), the report, notes with a field to add one, and the activity. The open thread is asked for again when its task changes.
- Tests: 9 store and runner tests, protocol and island tests (TS 531 pass, 2 skipped; typecheck clean) and 10 Swift (472 pass).
- Known limits: "Needs you" holds failed tasks only until budgets and plan approval (3.7, 3.8) add more; a done task cannot be run again yet (3.6); the board lists each worker's newest 20 tasks; `report.get` stays in the protocol but the window now uses `thread.get`.

**Task 3.5 — Wisp the manager.** The `delegate` tool (a goal and up to six tasks with worker and blockers), checked in code; the combined report; one spoken line when ZENO is idle; "<Name>, …" by voice gives that worker a task directly.
**Done when:** "research home networking and write it up as a guide" makes Wisp create a Sid task and a Quill task blocked by it, says who is on it, and later says one line, with the combined report in the window.

**As built (2026-10-11):** built; tested; seen in the gallery (`13-helpers`, a task's thread with "The whole goal"); not yet tried by voice or with a live run (plan quota).
- Goals: a `goals` table (text, times, combined report) and `goal_id` on tasks. `addGoal` checks everything before writing anything: 1 to 6 tasks, each worker known and available, each task's `after` pointing only at earlier tasks of the goal (so a goal can never be a circle), at most 6 waits.
- `delegate` tool (`services/helpers/src/delegate.ts`): `goal` (a short name for the result) and `tasks` (`{worker, task, after}`); workers by their current names, any case. Every refusal comes back to the model in words it can act on. The team ("Your team: Sid (researcher), Quill (documenter), …; not ready yet: …") is in each request's context, so a renamed worker is delegated to by its new name. Logs `goal.delegated` with the goal id and task count.
- Quill is now available with the research tools: its report is the write-up. It gains folders in 3.11.
- "<Name>, …" by voice (ADR-081), settled in code before any model: "Sid, research mesh Wi-Fi", "Ask Penny to …", "Tell Hana to …", with a comma or colon after the name so "Penny for your thoughts" stays with Wisp. It makes a goal of one task ("Sid is on it." / "Sid will start on it after the current task."); "Sid, stop" stops its running task; "Kame, …" answers "Kame is not ready yet." Logs `worker.command` with the worker and action.
- Ending a goal (`watchGoals` in `goals.ts`): once its last task ends, the combined report is the task's own (one task), else one model call with no tools (the reports marked as data, never instructions), else the reports joined if the call fails or its reply has no title, line and body. Sources are merged without repeats (at most 20, http and https only). Logs `goal.ended` (ids, count, whether spoken) and `goal.report_fallback` (the reason).
- The line, in code: "Your home networking guide is ready. The Helpers window has the report." (with "but 1 of 3 tasks failed" when some did); "Sid is done." for one task; "The team couldn't finish your …" when none was done; nothing when Keshab stopped every task. The island says it when ZENO is idle, in the timers' queue.
- Window: a task's thread shows "The whole goal" for a goal of several tasks: how many are done, then the combined report. The thread is asked for again when the goal ends. "Goal:" is not repeated when it is the task itself.
- Tests: 15 TS (goals and delegate 13, island 2) and 3 Swift. TS 546 pass, 2 skipped; typecheck clean; Swift 475 pass.
- Known limits: a goal whose last task was running when ZENO closed never gets its combined report (its tasks are still in the window); the line is spoken only, not shown; "What is Sid doing?" is still left to Wisp; the board does not group tasks by goal.

**Task 3.6 — Wake-ups and memory.** Wake on assignment, on asking again and on a new comment; wake-ups during a run merge into one more run; each (worker, task) resumes its Claude session (`resume`), with "Start fresh" in the thread.
**Done when:** "Sid, dig deeper on that" continues the same session, three wake-ups during a run lead to one more run, and "Start fresh" starts a new session.

**As built (2026-10-11):** built; tested (a fake Claude Code for the session); not yet tried live (plan quota).
- A note wakes its task (`comment.add`, the thread's field, or by voice): an ended task (done, failed or stopped) goes back to "to do" and runs again; a running one is marked and runs once more when it ends, so several notes meanwhile make one more run; a queued one just gets the note in its brief. A failed run that was asked again runs once more instead of failing what waits for it; a stop drops the wake. Activity gains "Asked again" (`woken`) and "Set to start fresh" (`fresh`). Waking a task of an ended goal opens the goal again, so it ends again with a new report and line.
- Memory: each run's Claude session id is kept on its task (`session_id`). The next run resumes it (Agent SDK `resume`, sessions now kept by Claude Code with `persistSession: true`) and is given only the notes added since the last run started (`followUpBrief`). If resuming fails for any reason but the plan's limits, the run starts fresh once (`job.resume_failed` in the log).
- "Start fresh" (`job.fresh`, a button in the thread when a task has a session and is not running) forgets the session; an ended task runs again from the start. Jobs carry `resumable`.
- Voice: "Sid, dig deeper on that", "Sid, also cover IPv6", "Sid, keep going" (follow-up words, or a sentence ending in "that", "it" or "this") become a note on Sid's newest task: "Sid will look again." (or "… when this run ends."). With no earlier task it is a new task.
- The thread's note field says what a note will do: "Ask Sid again", "Add a note: Sid runs once more after this", "Add a note for Sid".
- `store.ts` was split: its tables, migrations and row mapping are in `store-schema.ts`.
- Tests: 10 TS (wake-ups 8, research resume 1, island 1) and 2 Swift. TS 556 pass, 2 skipped; typecheck clean; Swift 477 pass.
- Known limits: a woken task replaces its report (the activity keeps when); tasks that failed because it failed stay failed; a session Claude Code has cleaned up costs one failed resume before the fresh run; "Sid, look into it" with an earlier task counts as a follow-up.

**Task 3.7 — Budgets.** Daily caps per worker and for the team from each run's reported usage; a warning at 80 %; at 100 % the worker pauses and its tasks wait as "needs you"; new runs also wait above a set plan-window level; caps and resume in the window.
**Done when:** a worker over its cap pauses with its task in "needs you", no new run starts, and raising the cap resumes it.

**As built (2026-10-11):** built; tested; seen in the gallery (`13-helpers`: Sid near its cap, the board with the team budget, plan limit and a held task); not yet tried live.
- Spend is each run's reported cost (`total_cost_usd`): dollars of API-equivalent use, what the work would cost on the API. The plan does not charge it; it is a fair measure of how much plan a run takes across models. A `spend` table keeps each run's amount (by task and worker); a day is local midnight to midnight. Failed runs report nothing (their cost is not counted).
- Caps (`budgets.ts`, store settings): $5 a day per worker and $15 for the team by default, each settable from $1 to $50 or "No cap" in the window (the protocol allows more than 0 up to 1000). The plan limit (default 80 %) holds new runs while the plan's five-hour window is used above it; 100 means never.
- A runnable task (queued, nothing to wait for) is held while its worker's or the team's budget is used up or the plan is above its limit (`holdFor`, checked by the runner before each start). A run already going finishes. Held tasks carry the reason (`held`) and show under "Needs you" with an amber dot. Raising a cap, or a new day, or the plan's window easing frees them (the runner looks again on budget changes, plan usage reports and every minute).
- Window: a worker's page shows "Budget $5 a day" and "$4.10 of $5.00 today" (amber with "80% used" from 80 %, and why it waits once used up); the board has "Team budget" and "Plan limit".
- Tests: 9 TS (budgets 5, island 1, protocol, research cost) and 3 Swift. TS 562 pass, 2 skipped; typecheck clean; Swift 480 pass.
- Known limits: no spoken warning at 80 % (the window shows it); a held task's reason is refreshed on the next helpers change, not when the plan's use changes; a run that fails costs plan that is not counted; there is no separate "Resume" button (raising the cap is the resume).

**Task 3.8 — Plan first.** A per-worker or per-task switch: the first run plans with no write tools; the task waits as "needs you"; approve or reject by voice through Wisp's approval card or in the window; the approved plan goes to the next run.
**Done when:** a plan-first task stops after planning, a rejection ends it, and an approval starts a run that receives the plan.

**As built (2026-10-11):** built; tested (a fake Claude Code for the plan run); not yet tried live.
- Switches: a worker's "Plan first" (window switch, `helper.planFirst`, default off) applies to its new tasks; one task can say otherwise (`job.add` `planFirst`). The goal and voice paths follow the worker's switch.
- The plan run (`runPlan`): no tools at all, nothing kept for resuming, a structured plan back (`summary` at most 160 characters, `steps` at most 4000). Its cost counts toward budgets. The runner saves it (`savePlan`); the task goes back to "to do" with `planStatus: awaiting`, held under "Needs you" ("Sid's plan waits for your OK."). No run starts until Keshab answers.
- Approving (`plan.approve`, the thread's Approve button, Wisp's approval card, or "Sid, go ahead" / "yes" / "do it") lets the next run start; its brief carries "The plan Keshab approved. Follow it:". Rejecting (`plan.reject`, Reject, or "Sid, no" / "drop it") stops the task, and what waits for it fails. Voice answers must be the whole sentence, so "Sid, go find prices" is still a new task.
- When a plan is written, ZENO says "Sid has a plan ready for your OK." when idle, then shows Wisp's approval card (the computer-control card): Allow approves; Decline or no answer within 60 s leaves the plan waiting in the window, never a rejection.
- Window: the thread shows the plan (waiting, approved) with Approve and Reject; activity "Wrote a plan", "Plan approved", "Plan rejected".
- Tests: 10 TS (plan first 4, plan run 1, island 2, protocol) and 2 Swift. TS 569 pass, 2 skipped; typecheck clean; Swift 482 pass.
- Known limits: the window has no per-task switch (the protocol has); researchers have no write tools anyway, so for them the plan is a preview of what they will search and deliver until folder grants (3.11); a waiting plan is said and asked about once.

**Task 3.9 — Routines.** Schedules (daily or weekly at a time, or every N hours) that create a task for a worker; one catch-up after ZENO was closed; skipped while the previous run still goes; a Wisp `schedule` tool for voice; a list in the window.
**Done when:** "Sid, every morning at 8, summarise networking news" creates a routine that makes a task at 8, a missed morning runs once at start, and an overlapping run is skipped.

**As built (2026-10-11):** built; tested with a fake clock; not yet tried live.
- `routines.ts`: three schedules in local time: daily at a time, weekly on a day at a time, every 1 to 168 hours (counted from when the routine was made). A routine is due when a scheduled time has passed since it last came due (or since it was made), so any number of missed times make one catch-up. At most 20 routines. A `routines` table in the helpers file.
- The clock: the runtime looks every 30 s and once at start (`runRoutines`). A due routine makes a task for its worker; if its last task is still to do or running, it is skipped this time ("skipped: the last one was still going"), as is one whose worker is no longer available. Routine tasks are plain tasks (no goal, so nothing is said when they finish).
- By voice, in code: "Sid, every morning at 8, summarise networking news", "every evening at 7:30 …" (evening, night and afternoon mean PM), "every Monday at 9 am: …", "daily at …", "every 3 hours, …", "every hour …": "Sid will do that every day at 8:00 am." Any other "Sid, every …" goes to Wisp, which has a `schedule` tool (worker, task, every day / week / hours, time HH:MM, weekday, hours), checked in code. Logs `routine.scheduled` and `helpers.change` (ids and outcomes only).
- Window: a worker's page lists its routines (when, what, how the last one went) with Remove (`routine.delete`).
- `store.ts` was split again: its public types are in `store-types.ts` (store.ts 640 lines).
- Tests: 9 TS (routines 7, island 1, protocol) and 1 Swift. TS 577 pass, 2 skipped; typecheck clean; Swift 483 pass.
- Known limits: routines are added by voice or Wisp only (the window lists and removes); an hourly routine counts from when it was made, not from the hour; a routine cannot be paused, only removed.

**Task 3.10 — Hand-offs.** A worker's `hand_off` tool creates a sub-task for another worker, checked in code (role allows it, depth at most 2, at most 3 sub-tasks per task, budgets); shown in the parent's thread.
**Done when:** Sid hands Penny a costs question as a sub-task, a third level is refused, and the parent waits for it.

**As built (2026-10-11):** built; tested (a fake Claude Code for the tool); not yet tried live.
- The tool: a running top-level task's Claude session gets `hand_off` (worker, task) through an in-process MCP server (`mcp__zeno__hand_off`), the only server it may use. Its description names the workers its role may hand to, by their current names. Sub-tasks get no such tool.
- Checks in code (`store.handOff`): the task is running; the target is available, not itself, and its role is allowed (`HAND_OFFS`: researcher to financial adviser, documenter and HR; financial adviser and HR to researcher and documenter; documenter to researcher); at most two levels (a sub-task cannot hand off again); at most 3 sub-tasks a task; neither the target's nor the team's budget used up. Every refusal comes back to the model as words it can act on.
- Waiting: the sub-task becomes a blocker of the task and the task is marked to run again. The worker finishes its run with what it has; then the task waits for the sub-task and runs again (resuming its session) with "The sub-tasks you handed off" in its brief. A sub-task that fails or is stopped does not fail its parent: the link is dropped and the parent runs again, told it did not finish. A sub-task joins its parent's goal.
- Window: the thread shows "Handed off" with each sub-task (opening its own thread), activity "Handed off a sub-task"; a sub-task's board card says "for #1".
- Tests: 7 TS (hand-offs 4, provider 1, island 1) and 1 Swift. TS 583 pass, 2 skipped; typecheck clean; Swift 484 pass.
- Known limits: the parent's first report is replaced when it runs again; a hand-off made in a plan run is not possible (plan runs have no tools); the worker is told, not forced, to finish quickly after handing off.

**Task 3.11 — Folder grants, and Kame, Puff and Quill.** Grants in the window (refusing the home folder, `/`, system and credential folders); file tools checked against grants in code; sandboxed commands without network; approval through Wisp for risky commands; a `zeno/<task>` branch in git repositories, never pushed. The coder, designer and documenter roles.
**Done when:** Kame changes a file in a granted repo on its own branch, is refused a path outside, and `git push` is never run.

**As built (2026-10-11):** built; tested (checks, a real git repository, a fake Claude Code); not yet run live: Claude Code's sandbox on this Mac and a real Kame task are still to try (plan quota).
- Grants (`grants.ts`, `grants` table): only for the coder, designer and documenter; at most 8 a worker; checked when added and saved as real paths. Refused: the home folder itself, `/` and anything outside the home folder except external drives under `/Volumes`, `~/Library`, and any hidden folder (`~/.ssh`, `~/Documents/.secret`). The window has "Add folder…" (the system folder picker) and Remove.
- Kame and Puff are available. A coder or designer with no folder fails at once ("Kame needs a folder to work in"); Quill works in its folder when it has one, else writes up from the web as before.
- A run in folders: Claude Code's Read, Write, Edit, Glob, Grep and Bash in the work folder, 60 turns. Every call goes through ZENO's check: a file path must resolve (real path, symlinks and `..` included) inside the run's folders; a command is classified in code: refused (`git push`, changing remotes, switching to main or resetting, `sudo`, keychain and system commands, `curl`, `ssh` and other network), asked on Wisp's approval card (deleting folders, installing software, `git clean`), or allowed. Bash always runs in Claude Code's sandbox (`failIfUnavailable`, never unsandboxed): no network, writes only in the run's folders, keys and tokens unreadable (`~/.ssh`, `~/.aws`, `~/.config`, `~/Library/Keychains`, …). Logs keep the tool and the verdict, never paths or commands.
- Git: in a repository, ZENO (not the model) makes a worktree on `zeno/task-<id>` beside the helpers file (`data/worktrees/task-<id>`), so the current branch and working copy are never touched; the worker works there; after the run ZENO commits everything as "ZENO" on that branch, and the report says where. Nothing is ever pushed: the command is refused and the sandbox has no network anyway.
- Closed after a review of the change: ZENO's own git commands run with no repository hooks (they would run outside the sandbox), and a worker can never change git's data (`.git` folders and the worktree's `.git` file are refused to file tools and unwritable in the sandbox), so it cannot point ZENO's commit at another repository.
- Fixed while testing: the work folder inside the worktree came out wrong when the folder's path went through a symlink (`/var` is `/private/var`); real paths are now used on both sides, with a check that it stays inside the worktree.
- Tests: 14 TS (grants and checks 5, folder check 2, worktree 2, provider 1, island 1, protocol, and older tests that used Kame as "not ready" now use Tinker) and 1 Swift. TS 594 pass, 2 skipped; typecheck clean; Swift 485 pass.
- Known limits: the folder for a task is the first grant unless the task names another's folder; worktrees are not cleaned up; Kame and Puff have no hand-off; a run in folders cannot use the web.

**Task 3.12 — Skills.** Per-worker choice of skills from `~/.claude/skills` in the window; only those are loaded for the worker's runs.
**Done when:** a worker given one skill uses it, and a skill not given is not loaded.

**As built (2026-10-11):** built; tested (real files for the plugin, a fake Claude Code for the run); not yet tried live.
- Keshab's skills are the folders in `~/.claude/skills` with a `SKILL.md` (name and description read from its front matter). The window has a "Skills" menu per worker; at most 10, names checked, and each must be one of Keshab's (`helper.skills`).
- Loading only those: before each run ZENO rebuilds the worker's own small plugin (`data/skill-plugins/<worker>/`, a `zeno-skills` manifest and links to exactly the chosen skills) and the run loads it (`plugins`, `skills: ["zeno-skills:<name>"]`). Runs load no user settings, so no other skill is there; a Skill call for any other name is refused in code. Plan runs load no skills.
- Skills are data for the task: they never add tools. A skill's scripts can only run through a run's sandboxed Bash (runs in folders); research runs have no Bash.
- Tests: 5 TS (skills 2, provider 1, island 1, protocol) and 1 Swift. TS 598 pass, 2 skipped; typecheck clean; Swift 486 pass.
- Known limits: skill files stay readable on disk to a run in folders (the SDK filter hides them from the model's list, it does not lock files); a skill renamed or removed from `~/.claude/skills` is quietly skipped until Keshab chooses again.

**Task 3.13 — Tinker and feedback.** Rate a finished task (good or not, with a comment); Tinker reviews failed and poorly rated tasks and proposes soul changes with a reason; accept or reject in the window; every version kept and undoable.
**Done when:** a poorly rated task leads to a proposal that, once accepted, shows in the worker's soul, and undo restores the old one.

**As built (2026-10-11):** built; tested (a fake Claude Code for the review); not yet tried live.
- Rating: a finished (done or failed) task's thread has "How did it go?": Good, or Not good with an optional "what was wrong" (`job.rate`).
- "Not good" makes a Tinker task, "Review task 12 (Sid)" (once per task). It runs like any task (budgets apply, it shows on the board). Tinker's run has no tools and nothing kept for resuming (`runReview`). It reads the task, the comment, the error or report and the worker's soul, all marked as data, and returns at most one change: a field (lessons preferred, or rules, how it works, personality), its whole new text, and the reason. "No change" is an answer too (for example a failure outside the worker's control).
- A proposal is checked so that the changed soul is still a valid soul. The worker's page shows "Tinker suggests" with Accept and Reject. Accept saves a new soul version with the change. Undo restores the version from before it, as another new version, so every version stays kept.
- Tinker takes no tasks of its own ("Tinker only reviews tasks you rate as not good."); the sidebar says "Reviews rated tasks".
- Failed tasks are reviewed when Keshab rates them not good, not automatically: most failures so far are limits and setup ("needs the Claude plan", "ZENO was closed"), where a soul change would not help and a review would spend plan for nothing.
- Tests: 8 TS (feedback 5, provider 1, island 1, protocol) and 1 Swift. TS 605 pass, 2 skipped; typecheck clean; Swift 487 pass.
- Known limits: a proposal is shown on the worker's page, not said aloud; Tinker reviews one task at a time and does not look across several.

**Task 3.14 — Open in the worker's app.** A browser opens the top sources as tabs; Notes saves the report as a note; done by code from http(s) sources.

**As built (2026-10-11):** built; tested with fakes for `open` and AppleScript; not yet tried on the real apps.
- `open-in-app.ts`: a browser (Safari, Brave, Chrome, Arc, Firefox, Edge and others by name) opens the report's top 5 web sources as tabs (`open -a`), http and https only; Notes gets a new note with the report and its sources (adding only, as the Notes tool); any other app opens the report as a text file (`data/reports/task-<id>.txt`).
- From the thread: "Open in Brave Browser" above a finished report, when its worker has an app (`job.open`). By voice: "Sid, open it", "Sid, open the sources", "Sid, show that" open Sid's newest finished report and ZENO says what it did; problems come back as words ("Choose where Sid opens things in the Helpers window first.", "The report has no web sources to open."). Logs `report.opened` with ids only.
- Tests: 6 TS (open in app 3, voice 1, island 1, protocol) and 1 Swift. TS 610 pass, 2 skipped; typecheck clean; Swift 488 pass.
- Known limits: nothing opens by itself when a task finishes (on request only); a browser not in the list is treated as "any other app" (the report as a text file).

**Task 3.15 — Workers on screen.** Each worker's original look in Wisp's style, a small working sign while busy, and Wisp flying over to say its one line when a goal is done.

**As built (2026-10-11):** built; tested (protocol and status); the flight and the card not yet seen on the real screen.
- Looks: each worker shows its avatar image from `assets/avatars/<worker>/` (ADR-085) when Keshab adds them, else its first letter in a disc, as before; no third-party characters, no Lab code.
- Working sign: the compact island card now shows the marks of up to three workers at work, each with its running arc of Wisp's light, when ZENO is not listening. The island keeps the helpers list from start (it used to ask only while the Helpers window was open).
- The line: just before ZENO says a team line (a goal done, a plan waiting), the runtime sends `worker.line`; the card shows "From the team" with it, and Wisp flies to the menu-bar icon with the line beside it (the tour's flight), then back.
- Tests: 1 TS (island) and 1 Swift. TS 610 pass, 2 skipped; Swift 489 pass.
- Known limits: the worker images themselves wait for Keshab's designs; the flight is skipped when Wisp is hidden or a turn is running (the line is still said).

**Task 3.16 — Optional Paperclip connection.** Off unless `ZENO_PAPERCLIP_URL` is set, loopback only; Wisp creates an issue for a chosen Paperclip agent, reads its state and comments, approves or rejects its approvals; Paperclip tasks on the board marked "Paperclip"; the window warns that Paperclip agents run outside ZENO's checks and that its telemetry is on unless turned off. ZENO never installs or starts Paperclip.
**Done when:** with Keshab's Paperclip running, a task handed to a Paperclip agent shows on the board and its result comes back; with the setting unset or a non-loopback address, nothing is sent.

**As built (2026-10-11):** built; tested against a fake Paperclip that follows its documented API (`docs/api` in paperclipai/paperclip); not yet tried with Keshab's own Paperclip (not installed).
- On only when `ZENO_PAPERCLIP_URL` is an http or https address on this Mac (`localhost`, `127.0.0.1`, `::1`, no user or password); anything else logs `paperclip.refused` and sends nothing. Requests never follow redirects and time out after 10 s. Local trusted mode: no keys, nothing stored but the issues ZENO handed over (`data/paperclip.json`: ids, titles, agent names, status, the result). `ZENO_PAPERCLIP_COMPANY` picks a company, else the first.
- Narrow client (`paperclip.ts`): list agents, create an issue for an agent, read an issue and its comments, list pending approvals, approve or reject one. Ids are checked before they go into a path.
- Wisp's tools, only when on: `paperclip_hand` (an agent by name or role, a title, a description; "Handed to Paperclip's CTO as PAP-1."), `paperclip_check` (the handed tasks with their results, and approvals waiting, marked as data), `paperclip_decide` (approve or reject one, sent only after Keshab's OK on Wisp's approval card; no answer is a no).
- Coming back: every minute ZENO reads the handed tasks not yet finished; when one is done (or cancelled) its newest comment becomes the result and ZENO says one line when idle ("Paperclip's CTO finished \"Review\"."), once.
- Window: the board has a "Paperclip" section, each task marked "Paperclip" with its id, status, agent and result, under the warning that Paperclip's agents run outside ZENO's checks and that its telemetry is on unless `PAPERCLIP_TELEMETRY_DISABLED=1` is set where it runs. ZENO never installs, starts or configures Paperclip.
- Tests: 5 TS (Paperclip 4, island 1) and 1 Swift. TS 615 pass, 2 skipped; typecheck clean; Swift 490 pass.
- Known limits: the field names for comments and approvals (`body`, `title`) follow Paperclip's docs and are read defensively; a live check with a real Paperclip may need small adjustments.

**New agents with their own roles and soul.md (ADR-088).** Keshab: "make sure we can create other agents as well that we can work with in the future .. and we can create their own roles with personality/soul.md".
**Done when:** an agent made in the window (or by dropping a folder in) has its own role, kit and soul.md, works like the built-in workers (Wisp, voice, board, budgets), edits to its soul.md become versions, and it can be removed without deleting anything.

**As built (2026-10-11):** built; tested (real agent folders in temporary directories, a fake Claude Code for the think kit); seen in the gallery ("New agent"); not yet tried with a live run.
- `services/helpers/src/agents.ts`: an agent is `data/agents/<id>/soul.md` (front matter `name`, `role`, `kit`; sections Personality, How it works, Rules, Lessons). The folder name comes from the name (`rumi`, `ana-li-2`). At most 20 agents; a broken or clashing file is skipped and named (`agentProblems`).
- The team is the seven built-in workers plus every agent folder, read each time the team is listed or a task starts. A changed soul.md (an editor, or a save, restore or accepted Tinker proposal, which write the file back) becomes a new version, so Versions and undo work as before.
- Kits, fixed in code: `research` (web search and pages), `folders` (granted folders, sandboxed, own branch, never pushed), `think` (no tools at all; the run's only possible call is its report). An unknown kit reads as `think`. The runtime picks the run by kit (Tinker and the documenter keep their own rules). Roles are Keshab's words (letters, at most 40, not `improver`); role rules such as Penny's financial notice apply by role to any agent.
- Agents work everywhere: Wisp's team line and `delegate`, "Rumi, …" by voice, routines, plan first, budgets, skills, ratings and Tinker, the board. Hand-offs follow the role map, so an agent whose role is not in it neither hands off nor receives.
- Window: "New agent" at the bottom of the (now scrolling) team list opens a form (name, role, kit, personality, how it works, rules); Create writes the soul.md and selects the agent. An added agent's page has Remove, which asks first; its folder moves to `data/agents-removed/`, never deleted.
- Tests: 10 TS (agents 6, provider 1, island 1, protocol, older expectations) and 1 Swift. TS 623 pass, 2 skipped; typecheck clean; Swift 491 pass.
- Known limits: role and kit are changed by editing soul.md (the window's Soul form edits the soul only); built-in workers' souls stay in ZENO's store, not in soul.md files; agents live in `data/` (local, not in git).

**Pal and the pals redrawn (ADR-089).** Keshab: "change wisp to pal", "add a new pal … with the following script", "redraw all the pals animation with reference to this pasted json format … premium looking".

**As built (2026-10-11):** built; tested; seen in the gallery (`16-pals`); not yet seen on the real screen.
- Wisp is Pal everywhere, code included (files, types, words); saved settings keep their stored `zeno.wisp.*` names.
- `assets/pals/pal.json` is Keshab's "Strobi copy" avatar definition, as pasted. `scripts/make-pals.py` makes each worker's from it: Sid sea-glass blue with tall ears, Kame mint with low nubs and a broader body, Puff blush pink with long ears, Quill warm paper with one ear folded, Penny gold with small wide ears, Hana lavender with round ears, Tinker apricot with an antenna. An agent Keshab adds gets Pal's shape in colours chosen by its id. `build-app.sh` copies them into the app.
- `PalCharacter.swift` (Core): the format (body, nodes, colours, 28 expressions, 23 animations); an animation's steps loop, each easing in (smoothstep) and holding; blinks at the intervals each animation allows; the expression's own colours and motion (shake, slow drift). ZENO's moments pick an animation: idle, listening, thinking, happy while speaking, sleeping, confused for a problem, surprised when carried; reactions: celebrate, confused, surprised, drowsy; a worker at work plays "working".
- `PalFigure.swift`: ZENO's own renderer. The rounded body turns with the head (nod, turn, tilt) and its far side falls into shade; nodes are placed in 3D and drawn back to front; light from the top left, a rim of light, a gloss on the body, glossy eyes with two catchlights, drawn a little larger than the numbers so they read at small sizes. No Lab code.
- "Character" is the new default style (Settings → Appearance), taken once whatever was stored; the earlier styles stay. The Helpers window and the island card show each worker's character, playing "working" while busy.
- Tests: 5 Swift (format, steps and looping, colours and motion, blinks, mapping) and updated default-style tests. Swift 496 pass; TS 623 pass.
- Known limits: the 3D is drawn as shaded shapes (a box seen turned, not a modelled mesh); feet and ears are seen from the front only; Void's flat rule does not apply to the characters (their shading is part of the character; no glow).

**One window (ADR-089).** Keshab: "i want to have the chats, settings, agents all in one window".

**As built (2026-10-11):** built; tested; seen in the gallery (`13-helpers`: Chat, Settings, the board, a worker); not yet used on the real screen.
- The Helpers window is now the ZENO window (`MainWindow.swift`, 920×640, remembers its place): its sidebar has Pal (its character playing ZENO's state) with the state in words, Chat, Board, the team with New agent, and Settings at the bottom. Chat is the conversation and composer from the panel; Settings is the panel's Settings, both at a readable width.
- Opening ZENO opens this window on the page asked for: a click on the island card, the menu-bar icon, Pal, the toggle shortcut (which closes it when it is in front), "open settings" by voice, a setup problem (Chat) or the model card (Settings). The drop-down panel stays closed; the compact card, the menu-bar icon and Pal stay for quick status and talking. The menu-bar menu says "Open ZENO…". ZENO's words say "the ZENO window" instead of "the Helpers window".
- Tests: all suites pass (TS 623, Swift 496); the window is checked by renders.
- Known limits: the drop-down panel's code remains (unused) until it is removed; the window's Chat page and the panel share one conversation.

**The ZENO window grows (ADR-090).** Keshab: "progress situation, to do, issues and others like plugins, mcps … and on board section lets have a visual where we can see how the agents are working". Five parts, one at a time.

**Part 1, Overview — as built (2026-10-11):** built; tested; seen in the gallery. A sidebar page with the board's counts (running, needs you, to do, ended today), who is at work (its character playing "working", the task, its step, how long), goals with a bar for how far they are, today's team budget and the plan's five-hour use, and the newest results; every row opens its task. `TeamOverview` (Core) computes it from the helpers list. 1 Swift test (497 pass). Fixed while testing: a goal took its name from whichever task came first, even one without it.

**Part 2, Needs you — as built (2026-10-11):** built; tested; seen in the gallery. A sidebar page (with a count and an amber dot) listing everything waiting on Keshab, each with its buttons: Pal's approval card (Allow, Decline), plans (Approve, Reject, Open), Tinker's proposals (Accept, Reject), tasks held by a budget or the plan's limit (Budgets, Open), failed tasks (Open). `NeedsYouItem` (Core) gathers them; plan and proposal answers work for any task or worker from here. 1 Swift test (498 pass). Paperclip's approvals stay with Wisp's `paperclip_check` / `paperclip_decide` (not in the window yet).

**Part 3, Issues — as built (2026-10-11):** built; tested. A sidebar page listing failed tasks (why, when, "tried again once") with Retry and Open; Needs you's failed rows get Retry too. `job.retry` runs a failed or stopped task again (resuming its session). A failure a second try may fix (a time limit, Claude Code ending early or answering in the wrong shape, ZENO closed mid-run) is retried once by itself (`MAX_AUTO_RETRIES`), before anything waiting on it fails; setup problems and the plan's limits never are. Activity "Tried again". 3 TS tests, protocol, and 1 Swift (TS 626, Swift 499 pass). Two older tests now expect the automatic retry.

**Part 4, Plugins — as built (2026-10-11):** built; tested (a real stdio MCP server started by the test; fakes for the run); seen in the gallery; no real server tried by Keshab yet.
- MCP servers (`services/helpers/src/mcp.ts`, table `mcp_servers` in the local helpers file): a server runs a command (program, arguments, `KEY=value` environment) or connects to a URL (Streamable HTTP or SSE, `Name: value` headers). Checked when added (a lower-case name not "zeno", no tokens in the address), saved switched off. At most 20.
- Test (`mcp.test`, `mcp-servers.ts`): starts the command (or connects), completes the MCP handshake and lists the tools, within 15 s; a failure is said in words without the server's own output. A server turns on only after a test listed its tools.
- Per worker: Keshab picks which workers may use it. A run gets its servers in the Agent SDK's `mcpServers`; every call to one of their tools goes through ZENO's check: a Trusted server's tools run; any other asks on Pal's card (no answer is a no). Plan and review runs get none. Logs keep the server and the verdict only.
- Secrets: environment values and header values stay in the local file; the window gets only their names ("Private: NOTES_TOKEN"); nothing is logged.
- The Plugins page lists the servers (status dot, command or address, tools, Test, Remove, On, Trusted, Workers), an Add server form, and every skill with the workers that use it. The sidebar's page rows are more compact.
- Tests: 8 TS (store 3, run-time 4 with a real MCP server, gateway 1), island and protocol, 1 Swift (TS 637, Swift 500 pass).
- Known limits: OAuth sign-in for URL servers is not built (tokens go in headers); a server is not re-tested by itself when its command changes (remove and add again).

**Part 5, Office floor — as built (2026-10-11):** built; tested (the plan is pure and tested); seen in the gallery; not yet watched live.
- The Board opens on Floor (Floor | Columns, kept while ZENO runs). Each worker has its own desk; one at work sits there playing "working" with its step in a bubble, and its monitor lights. One waiting for an OK or held sits at its desk with an amber dot and says why. Idle workers rest in the lounge; a failed last task shows "sad" with a red dot; a goal finished in the last minute makes its workers celebrate.
- Pal sits at the manager's desk in its own office, with its mood from ZENO's state. A hand-off not yet done sends an envelope from the desk that handed it off to the worker doing it.
- Clicking a worker opens its task (or its page). Pals walk between lounge and desk when their state changes. ZENO's own drawing: no art from the reference project.
- Tests: 1 Swift (Swift 501 pass).

**Part 5 redone in 2D pixel art (2026-10-11, Keshab: "something like munder-difflin … 2d … for office and pals as well"):** built; tested; seen in the gallery; not yet watched live.
- A top-down pixel office of 20 × 13 tiles of 16 px, drawn pixel by pixel in code (`OfficeArt`): a sage tiled floor, a cream wall with windows, a clock, a calendar and the "Needs you" board (a note per worker waiting for Keshab), Pal's carpeted office with a bookshelf, eight wooden desks with monitors and chairs, a meeting table with four more seats on a rug, and a lounge on planks (vending machine, counter with coffee machine and microwave, fridge, sofa, coffee table), plants, a printer and a water cooler.
- Pals in pixel art (`PixelPal`), rasterised from each pal's own file: body, ears or antenna, arms and feet where the file puts them, in its colours, outlined and lit from the top left. Poses: idle, breathing, blink, typing (hands on the keyboard, monitor lit), walking, cheering with confetti, sad with a tear.
- Pals walk between the lounge and their desk along the way through the office (breadth-first over free tiles, through the lounge's doors, `OfficeMap`/`OfficeWalk`). Pixel speech bubbles show the step ("Running the floor" over Pal while anyone works); "!" in amber (needs you) or red (failed); envelopes fly on hand-offs; names on small plates.
- Drawn without smoothing, at a whole-number scale when there is room (2× in the default window). munder-difflin was the visual reference only: its tiles are LimeZu's paid art and its cast are TV characters, so nothing of it is copied.
- Tests: 6 Swift (paths reach every seat around furniture and only through doors, walking, pixel pals from their files, the layers) (Swift 507 pass).

**Fixes after Keshab's first look (2026-10-11):**
- Files: Quill's task to save a document in ~/ZenoDoc ran without file tools (no folder granted) and reported it could not save. Now a file worker (coder, designer, or the documenter when its task saves files) with no folder asks on Pal's card for the folder its task names (a path inside home, or "a folder named X", in Documents or on the Desktop if it says so), else ~/Documents/ZENO. Allowed: ZENO makes the folder, grants it (the usual checks: inside home, not home itself, ~/Library or hidden folders) and the worker runs with its file tools (read, write, edit, copy and move with commands). Refused or unanswered: the task fails with words saying so, and is not retried by itself.
- Floor: only a worker at work sits at a PC; waiting, held, queued, failed and idle workers are in the lounge (their "!" and bubble go with them).
- Tests: 2 TS (the folder offered, the ask with a real store), the floor test updated (TS 637, Swift 507 pass).

## ADR-091 — Chats, a Dashboard, Git, Notifications and an Icon

**Part 1, window fixes — as built (2026-10-11):** built; tested; seen in the gallery.
- A worker's row in the sidebar shows its job (its role, such as Researcher), not "No app".
- Rename: a pencil by the worker's name on its page; Enter saves a new soul version with the name (checked like any soul: length, unique).
- A top bar over the main pane with the page's name (and the worker's role); it moves the window like a title bar, and a double click zooms it.
- The office floor keeps its shape and fits both the Board's width and the window's height (no more overflowing in full screen).
- The chat's top bar has Sounds: speak the team's reports, speak timers and updates, start and stop sounds. Muted lines still show on the island and Pal still flies over; they are not chimed or said (`speech.set`, sent when ZENO connects and on each change).
- Tests: 1 TS (muted reports are shown, not said), protocol, 1 Swift (rename, speech.set) (TS 638, Swift 508 pass).

**Part 2, notifications — as built (2026-10-11):** built; tested; not yet seen on the real Mac (macOS asks once to allow them).
- ZENO.app posts macOS notifications (UserNotifications; a development build posts none): a worker finished (its report's title), a task failed (why, first line), something needs Keshab (a plan for his OK, a held task, a soul proposal, and an approval card while ZENO is not in front), and a budget (a worker's or the team's) or the Claude plan's five hours passing 80% or used up.
- Only what is new: the first team list after start is learned, not announced; each thing once; a budget warns again after it resets. Never a task's or report's text beyond the title.
- Clicking one opens the ZENO window on its task. Settings → General → Notifications turns each kind off.
- Tests: 2 Swift (what is new, budgets and the plan) (Swift 510 pass).

**Part 3, tokens and the Dashboard — as built (2026-10-11):** built; tested; seen in the gallery; counts start from now (earlier runs were not recorded).
- Every Claude run records its tokens (input, output, cache read, cache write) and API-equivalent dollars from Claude Code's result: each worker's task (research, plan, review, file runs) and each of ZENO's own chat answers. Table `usage` in the local helpers file: counts and model ids only, kept 90 days.
- The Dashboard (sidebar, under Overview; its row shows today's tokens): today, the last 7 days and dollars; a bar per day (new tokens solid, cached faint); the Claude plan's five-hour and seven-day use; the week by worker (ZENO's chat apart) and by model; how to use fewer.
- Tests: 3 TS (sums by day, worker and model; the store; tokens from a result), the helpers event, 1 Swift (decoding, short numbers) (TS 641, Swift 511 pass).

**Part 4, chats — as built (2026-10-11):** built; tested; seen in the gallery; not yet used live.
- Every conversation with ZENO is a chat, saved after each exchange in the local memory file (tables `chats`, `chat_messages`; the newest 200 kept; never logged). Its title is its first words.
- The sidebar lists the chats where the Team section was (and the separate Chat row is gone): the current one is marked; a click continues one (ZENO Core resumes that session with its saved turns, so voice and typing go to it); New chat starts fresh; a chat's menu deletes it (deleting the current one starts a new chat). The chat page's top bar shows the chat's title.
- The team moved to the Board: a chip per worker (its pal, name, and its step or role) opens its page; New agent is there too.
- Protocol: `chats.list`, `chat.open`, `chat.delete`; events `chats` (with `current`) and `chat.opened` (its turns).
- Tests: 3 TS (the chat store, Core resume, the island commands), protocol, 1 Swift (decoding, replay) (TS 644, Swift 512 pass).

**Part 5, Git — as built (2026-10-11):** built; tested with real git repositories (a local bare remote); seen in the gallery; not yet pushed to Keshab's own remote.
- The Dashboard's Git section lists every `zeno/task-<id>` branch in the repositories Keshab granted, like a pull request: repository and branch, the task's title, its commits on the base (the remote's default branch, else the current one), changed files with lines added and removed, the remote's address (credentials taken out) and whether it is pushed (Not pushed, Pushed, Changed since push).
- Show changes: the patch, added lines green and removed red (first 400 lines; long patches cut).
- Push…: only after Keshab confirms in a dialog naming the branch, its commits and the remote. ZENO pushes `refs/heads/zeno/task-N` to `origin` only: never forced, no hooks, never waiting for a password (a remote that needs one fails with words). The runtime refuses any other branch, a repository outside the granted folders, or one with no `origin`. Workers and models still never push.
- Protocol: `git.list`, `git.push`, `git.diff`; events `git` and `git.diff`. Logs: the task number only.
- Tests: 2 TS (branches, files, pushed states, push, refusals with real git; remote addresses without credentials), island and protocol (only zeno/task-* and full paths), 1 Swift (decoding, when it can be pushed) (TS 647, Swift 513 pass).

**Part 6, the icon — as built (2026-10-11):** built; installed in ZENO.app.
- Pal on the black Void tile with its graphite hairline and a faint glow of Pal's light, drawn by ZENO (`AppIconArt.swift`, rendered with `ZENO_ISLAND_GALLERY_ONLY=icon`). `scripts/make-icon.sh` makes `assets/icon/ZENO.icns` (16 to 1024 px); `build-app.sh` copies it into the app and names it in `CFBundleIconFile`.

## ADR-092 — Claude on the plan only; a source release

**As built (2026-10-11):** Gemini and the Claude API are removed: their adapters (`providers/claude.ts`, `gemini.ts`) and tests, the `@anthropic-ai/sdk` and `@google/genai` dependencies, their keys in `.env.example`, and the app's API-key failure messages. `PROVIDERS` holds only `claude-plan` (the default); an old `ZENO_LLM_PROVIDER=gemini` or `claude`, or a saved choice of one, runs on the plan with its default model. Settings → AI model lists only Claude (my plan). Tests rewritten for one provider (TS 601, Swift 512 pass). Publishing: a tagged source release with notes, no app binary (it records Keshab's project path and runs only here).

## ADR-093 — A 2D pixel Pal, AI tools found on the Mac, and a clean-up

**Part 1, the 2D pixel Pal — as built (2026-10-11):** built; tested; seen in the gallery.
- Pal on screen (the desktop pet, the panel header, the empty chat) is the pixel character from `pal.json`, crisp at a whole-number scale (`PalView` rewritten; `PixelPalMotion`): resting breathes and blinks, listening and carried raise their arms, thinking glances side to side, speaking bobs, a problem is sad, napping closes its eyes with a "z". Reacts to you: the eyes follow the pointer, it grows a touch under it, and squish, dizzy, hello and yawn play.
- Removed: the five styles and the Appearance page's Pal choice, Glow, Tucks away and Hiding lean (and flight lean), the "Tuck away" menu item, the panel's Size and Background settings on the Pal page, the avatar-move and character-move migrations, `PetPeek` (peeking, `PetRetreat`), and their gallery sheets and tests.
- Tests: 3 Swift (moods, noticing and reactions, click) (Swift 494 pass).

**Part 2, AI tools found on the Mac — as built (2026-10-11):** built; tested; checked live on this Mac.
- At start, and on Settings → AI model → Scan, ZENO looks for Claude Code, Codex (also inside the ChatGPT VS Code/Cursor extension), the Gemini CLI, Ollama and LM Studio, and shows each as found, signed in (Claude via `claude auth status`, Codex via `codex login status`, the Gemini CLI by its saved sign-in existing; no login file is read) or not found.
- ZENO can run on Codex (ChatGPT plan, `codex exec` read-only, nothing kept) and the Gemini CLI (Google sign-in, `gemini -p` in plan mode) as well as Claude Code (the default). They answer in chat only: ZENO's tools and the team stay on Claude. API keys are taken out of their environment, so they always use the sign-in. A tool known to be signed out cannot be chosen. Ollama and LM Studio are listed but not used (CLAUDE.md §11).
- Live on this Mac: Claude Code and Codex found and signed in (a real Codex answer in about 7 s); the Gemini CLI found, not signed in (ZENO says so: "run `gemini` and sign in with Google"); Ollama found and not used.
- Tests: 10 TS (adapters with a fake runner; the scan with a fake disk; finding Codex in the editor extension; signed-out tools unavailable), protocol, 1 Swift (TS 609, Swift 495 pass).

**Part 3, clean-up — as built (2026-10-11):** done as Keshab asked: agent 1 listed 60 candidates; agent 2 checked each one again on its own (37 unused, 3 in use, 24 needing a decision, plus 4 knock-on items); only the confirmed-unused ones were removed (agent 3), then every check ran again.
- Removed: the drop-down panel's dead controller code (since ADR-089 "open" goes to the window: the rest of `setExpanded`, the outside-click monitor, panel key focus and Esc, `closing`, `Presentation.expanded`, the panel Size setting `PanelSize`), flight lean (`PalFlight.lean`), the Pal half of `AvatarExpression`, the unused `report.get` command and `report` event on both sides, `turn.complete.requestId`, `RuntimeError.retryable`, `ThemePalette.userBubble`, and small leftovers (`PixelCanvas.stamp`, `isHolding`, `heardSpeech`, `SettingsHome.reachable`, `IslandLog.debug`, `MenuBarIcon.setHighlighted`, `defaultInputName`, `isFollowingUp`, `FILE_ROLES`, `isNear`/`BUDGET_WARNING`, `episodeCount`, `isLink`, unused imports). 49 files, 443 lines out, 112 in.
- Fixed on the way: the "not found or not signed in" messages now name the right tool (Codex, Gemini CLI), not always Claude Code.
- Waiting for Keshab (technically unused, but removing them drops something): the gallery's drop-down panel sheets and the panel views only they draw (`ExpandedView`, `PanelHeader`, `PanelLight`); custom PNG avatars (`AvatarImages`, `assets/avatars`); the DesignStudy mock-ups; the `ZENO_PANEL_DEMO` script; the empty service/package folders PROJECT_STRUCTURE.md lists. Missing wiring rather than dead code: `mic.ready` (a "speak now" cue the Swift side ignores), `agentProblems()` (a broken soul.md is never shown), `emptyReplyReason` (could say "declined" or "cut off"), a second click on Pal closing the window (`PetClickAction`).
- Checks: typecheck clean; TS 609 pass (2 skipped); Swift 487 pass, no build warnings.

**ADR-093 part 4 — as built (2026-10-11):** Keshab's decisions on the waiting items; built; tested; gallery renders.
- Removed: the drop-down panel's views and gallery sheets (`ExpandedView`, `PanelHeader`, `PanelLight` and its tests, `IslandModel.expanded`/`showsExpanded`, the panel branch of `IslandView`, `IslandMetrics.expanded`, `Motion.breathe(slow:)`, `PanelTab`'s word labels and `twoWordTabs`; sheets 2-*, 3, 4, 9-*-panel, 11-setup-panel*, 12-everyday). The scrolling helpers moved to `Scrollable.swift`. `PanelTab` stays: it picks the window page.
- Removed: custom PNG avatars (`AvatarImages`, `AvatarExpression`, `assets/avatars`, the build step and its "avatars" line, sheet 16-avatars; a worker's badge is its pixel character or its letter), the DesignStudy mock-ups (sheet 14, `ZENO_ISLAND_GALLERY_ONLY=design`), `ZENO_PANEL_DEMO`, and the 8 empty service/package folders (PROJECT_STRUCTURE.md marks them "not created yet").
- "Speak now": a turn shows "Listening…" until the runtime's `mic.ready`, then "Speak now": Pal raises its arms with pixel sound bars, no bubble (Keshab kept "listening gets no bubble"; the card under the icon shows it with Pal off), until listening ends; local Parakeet talk shows it at once (its microphone is already open).
- Broken agents: each `data/agents/<id>/soul.md` that cannot be loaded is logged once at start (`helpers.agent_problem`, id and why) and sent in `helpers` as `agentProblems`; the Board lists them under the team as "<id>: <problem>".
- Empty replies say why: the Agent SDK's `stop_reason` reaches `emptyReplyReason`, so a refusal says "declined" and a token cut-off says "cut off".
- A second click on Pal closes the ZENO window when it is open and in front (like the menu-bar icon); a double-click never closes what its first click opened.
- Tests: 2 TS (agent problems in `helpers`; stop reasons) and the agent-store test rewritten; 3 Swift (speak now, its bubble, agent problems decoded), click test renamed (`windowOpen`). Checks: typecheck clean; TS 611 pass (2 skipped); Swift 483 pass; no new build warnings (the one in `IslandSettings.swift` is already at 149bedd); gallery renders 29 sheets.

## ADR-094 — Skills that grow, workers that wake, a Scheduled page, room for many agents

**ADR-094 part A — as built (2026-10-12):** skills that grow, always with Keshab's OK; built by a worker, then checked; tested with a fake Claude Code; gallery renders; not yet tried live.
- ZENO's own skills live in `data/skills/<name>/SKILL.md` (beside the helpers file, gitignored). Workers choose from Keshab's `~/.claude/skills` (read only, never written) and ZENO's; a name in both is Keshab's. The Plugins page and the worker's skill menu show each skill's source ("yours" or "made by ZENO"). The per-worker skill plugins moved from `data/skills/<worker>/` to `data/skill-plugins/<worker>/`, so they never mix with ZENO's skills (they are rebuilt before each run).
- Drafts: rating a done task good, or "Make a skill" in its thread (`skill.make`), queues one Tinker task "Make a skill from task 12 (Sid)" (at most one draft per task; budgets apply). Tinker's run has no tools (`runSkillDraft`) and returns a name (lower case and dashes, 2–41), a description (≤ 200) and the steps (≤ 8,000), checked again by the store (`skill_drafts`). Approve (`skill.approve`) writes the SKILL.md (front matter name and description, then the steps); a name already used by one of Keshab's skills or ZENO's is refused with words. Reject (`skill.reject`) marks it.
- Use: each Skill call a run is allowed reaches `onSkill` → `recordSkillUse` (`skill_uses`), logged as `job.skill` (ids and the skill's name).
- Edits: a bad rating, or a failure a retry does not fix, of a task that used one of ZENO's skills queues one Tinker task per skill, "Improve the compare-laptops skill (task 12)". Tinker (`runSkillEdit`, no tools) returns the whole new steps and a reason, or "no change" (`skill_edits`). Accept writes the new steps, keeping the description, and keeps the steps from just before for Undo; Reject marks it; Undo restores them (`skill.edit.accept/reject/undo`). A skill from `~/.claude/skills`, or one now shadowed by Keshab's of the same name, is never edited.
- Window: `helpers` carries `skillDrafts` (name, description, a 400-character preview) and `skillEdits` (reason and a compact before/after from the first changed line), pending ones and the newest few. The Plugins page shows them with Approve/Reject and Accept/Reject/Undo; Needs you lists the pending ones; a notification says "Tinker drafted a skill: <name>" or "Tinker suggests an edit to <name>" (never the steps). A done task's thread has "Make a skill" (or says where its draft is).
- Tests: 12 TS (store 6, Tinker runs 2, provider 2, skills listing 1, island 1; protocol cases added) and 3 Swift (decoding, answers and Make a skill, Needs you and notices). Checks: typecheck clean; TS 623 pass (2 skipped); Swift 487 pass.
- Known limits: a draft whose name is taken can only be rejected (no rename in the window); every good rating spends one Tinker run; drafts and edits are reviewed one task at a time; part C is not built yet.

**ADR-094 part B — as built (2026-10-12):** delegation that runs itself, inside the same limits; built by a worker, then checked; tested with a fake clock; gallery renders; not yet tried live.
- Team tasks: a task can be posted to the team (`team.add`, optional `role`; absent means anyone) instead of one worker. It waits unassigned in its own table (`team_tasks`, not `jobs`: `jobs.helper` is NOT NULL and the runner would otherwise pick it up), at most 50; a role must be one some worker that takes tasks has. `team.delete` takes one back. The task field on a worker's page has a "For" pill: the worker, "Team: anyone" or "Team: <role>". Pal has a `post_to_team` tool for work no single worker fits (logged as `team.posted`, the id only); it says who wakes up to take it.
- Wake-ups: per worker, off by default; every 15 minutes, hourly, every 4 hours or daily (`wake_ups`: interval, paused, last and next wake). Set on the worker's page ("Wakes up" pill) or `helper.wakeUp` / `helper.wakeUp.pause`. Tinker has none.
- The clock: `scheduleTick` (apps/mac/src/scheduler.ts) runs every 30 s on the routines' timer: routines first, then `runWakeUps(planUsed)`. A due worker records its wake (next = now + interval; wakes missed while ZENO was closed count once). If it runs nothing, is within its and the team's daily budget and the plan is below its limit, it takes the oldest team task its role may do, one per wake, with one SQL statement (`DELETE … RETURNING` inside the transaction that inserts the task), so two wakes never take the same one. The taken task is an ordinary queued task of that worker: plan first, blockers, hand-off rules and budgets apply as before. Logged as `wakeup.woke` (worker, team task id, task id).
- Routines can be paused and resumed (`routine.pause`); a resumed routine does not make up missed times. Each routine now carries its next time (`nextDue`).
- Scheduled page: a sidebar row below Issues and Board. It lists every worker's routines and wake-ups (schedule, "Next in …", "Last ran … ago", Pause/Resume, Delete; for a wake-up Delete is "Turn off"), the paused last, then the team tasks waiting (role and age, Delete). Empty: "Nothing is scheduled…". The Board shows a compact "Team" group of waiting team tasks (a click opens Scheduled).
- `helpers` carries `wakeUp` per worker, `paused`/`nextAt` per routine and `teamTasks`; no task text in logs or changes.
- Tests: 14 TS (team store 10: create/claim, atomic single claim, role filter, oldest first, busy/budget/plan refusal, wake times with a fake clock, ids-only changes, paused routines, next due, Pal's tool; scheduler tick 2; island protocol 1 and island round trip 1, with the routines case extended) and 6 Swift (decoding, commands, the For pill, window actions, page sorting, times in words). Checks: typecheck clean; TS 639 pass (2 skipped); Swift 493 pass; gallery has a Scheduled window.
- Known limits: a team task has no blockers and no goal (ZENO says nothing when it is done; the Board shows it); idle meant nothing running or queued (replaced by ADR-095: a wake-up takes a task whenever a run slot is free, even with that worker's own tasks queued or running); a removed agent's wake-up row stays but never wakes; daily is every 24 hours from when it was set, not a clock time.

**ADR-094 part C — as built (2026-10-12):** room for many agents; built by a worker, then checked; window only (no runtime change); gallery renders a 50-agent sample; not yet tried live.
- Board chips (`TeamRoster.chips`, ZenoIslandCore): a team of 12 or fewer shows everyone, as before. A larger team shows only who matters now, at most 12: working (longest at work first), then waiting for Keshab (anyone with a Needs you item: failed, plan to approve, held, proposal, skill draft), then used in the last 24 hours (a task started or ended; most recent first); ties keep the team's order. When someone is left out, an "All agents (N)" chip sits before New agent.
- All agents: a card over the Board (from that chip or a floor sign) listing everyone A to Z with role and step, searched by name or role in any case (`TeamRoster.search`; "financial info" and "adviser" both find Penny). A row opens the worker's page as a chip does; Escape, the cross or a click outside closes it; Return opens a single match.
- Floor (`OfficePlan`): 8 desks and 4 meeting seats. Workers at work take seats in the order they started, each its own seat (its place in the team, wrapping past 12) or the next free one, so a team of 12 or fewer sits exactly as before and nobody moves while those who started earlier keep working; the rest are a pixel "+N at work" sign right of the top desks. The lounge shows everyone idle up to its 10 spots (in the team's order); past that the 10 who matter most (waiting for Keshab or failed first, then most recently active) and a "+N more" sign by the lounge door. Clicking a sign opens All agents. The "Needs you" board's notes count everyone waiting, shown or not. Pal's office is unchanged.
- Made legible for a full floor: the four meeting seats show no bubble (a tile apart, their bubbles overlapped; a click still opens the task), and names in the lounge's bottom row stay on the floor.
- Tests: 10 Swift (`TeamRosterTests.swift`: chips for 0, 1, 12, 13 and 50 agents and their order and stability; search; seats for 0, 1, 12, 13 and 50 at work, signs' counts, stable seats as others start, needs-you count). Checks: Swift 503 pass; no new build warnings; typecheck clean; TS 639 pass (2 skipped); gallery sheet 13 has "Fifty agents" and "All agents" windows and `13-helpers-floor-crowd`.

ADR-094 is done: parts A, B and C built and tested. Next: Keshab tries them on the real Mac.

## ADR-095 — ATOM, Managers, Agents and Sub-Agents; Runs in Parallel

**ADR-095 package 1 — as built (2026-10-12):** items 1 (ATOM, user-facing) and 5 (runs in parallel); built by a worker, then checked; Managers (items 2, 6) and Sub-Agents (item 4) are packages 2–3, not built.
- Runs in parallel: the runner's one-run-per-worker rule is gone; the team-wide limit is "Runs at once" (`MAX_RUNNING` = 6 default, `MAX_RUNNING_RANGE` 1–10), stored as the `maxRunning` helper setting beside the plan limit (`store.maxRunning()` / `setMaxRunning`, part of `budgets()`), read by the runner before each start, so a change applies at once (lowering it stops nothing already running). Budgets and the plan limit (`mayStart`) still hold starts. Protocol: `helpers.settings` takes `maxRunning`; `helpers` carries it. Settings → General has a "Team" card with a "Runs at once" stepper (shown when the runtime sends the value); the Board's limits row keeps only the team budget and the plan limit.
- Wake-ups: a worker takes a team task while a run slot is free (team-wide runs < Runs at once), within budgets and the plan, even with its own tasks queued or running (replaces ADR-094's "nothing running or queued"). Tasks taken in one wake-up pass count as runs, so a pass never takes more team tasks than free run slots; the rest stay in the team pool.
- Single-run assumptions changed: voice "Sid, …" says "is on it" unless every run slot is taken ("will start on it when another task ends"); a worker's card line and floor bubble show the newest running task's step, with "N at work · " when it runs more than one; "longest at work" uses its oldest running task; each run links its skills in its own folder (`data/skill-plugins/<worker>/<task>`, removed after the run) so two runs of one worker never rebuild each other's.
- ATOM: every place Keshab sees or hears the name (Settings page and switches, menus "Show/Hide ATOM", the floor's office label, "ATOM asks" cards, the tour's "Hi, I'm ATOM.", theme descriptions, gallery captions, model-facing tool descriptions and the pointed-window heading). The system prompt tells the model the user may call it ATOM or Pal; "atom" joins "pal" and "zeno" as names no worker may take. Code names, files, assets and settings keys keep "Pal". README, docs/island-protocol.md and SECURITY.md say ATOM.
- Tests: TS 9 new or extended (runner: two jobs of one worker at once, the limit from Settings applied live, range refused; default and kept across a reopen; team: busy worker still takes a task while a slot is free, full slots leave it waiting, one pass takes no more than the free slots; voice reply when slots are full; island round trip and protocol cases for `maxRunning`; system prompt; reserved name). Swift 2 new (decode and command for Runs at once; a worker with two runs on its card, seat and overview). Checks: typecheck clean; TS 646 (644 pass, 2 skipped); Swift 505 pass; no new build warnings; gallery shows ATOM.
- Known limits: a wake-up pass counts only the slots it fills itself, so tasks already queued (not yet running) do not hold a slot; a file worker with no folder may ask twice when two of its tasks start together; ZENO's chat and "N at work" on Managers' desks come with package 2.

**ADR-095 package 2 — as built (2026-10-12):** items 2 (Managers), the ATOM-hands-to-Managers part of 1, and 6 (Board and floor show Managers only); built by a worker, to be checked. Sub-Agents (item 4) are package 3, not built.
- Managers are soul files beside the agents: `data/agents/<id>/soul.md` with `kind: manager` and `mode: plan | group` (anything else reads as group); a Manager file with `kit`, `role` or `manager` is refused (an agent problem). Agents name theirs with `manager: <id>`; one naming no Manager works without one and is listed as a problem. Built-in workers keep theirs in the setting `manager:<id>`. Managers are versioned like souls, have a daily budget (default the team's cap, `budget:<id>`), take no tasks of their own, and are listed in `helpers` (`managers`, each Agent's `manager`). At most 12 (`MAX_MANAGERS`).
- First start (once; the setting `managers:migrated`): with no Managers, one per role in use (Research, Coding, Design, Writing, Finance, People, else the role's own name; mode group), and every worker that takes tasks is put under its role's Manager. An added agent's move is written to its soul.md and recorded as a soul version (the same text). Keshab: agent page "Manager" picker (`agent.manager`), Board "New manager" (`manager.create`), and on a Manager's page Rename, mode switch, budget and Remove (refused while it has Agents; the folder goes to `agents-removed/`). A new agent goes under the Manager of an Agent with its role, else the first by name.
- ATOM hands to Managers: `teamContext` lists the team by Manager; the `delegate` tool takes a "plan" Manager's name for a whole part (the goal gets one task for that Manager) and a "group" Manager's Agents directly; naming a group Manager, or an Agent under a plan Manager, is refused with words the model can act on, and `addGoal` checks again. Voice "Sid, …" still goes straight to the Agent.
- A plan Manager's task runs through the runner like any task (a run slot, its budget, held when over): the first run (`runManagerSplit`, no tools) splits the part into at most 6 tasks for its own Agents (`store.managerSplit`: Agents' tasks with `parentId` the Manager's task, the goal's text, `after` between them; the Manager's task waits for all and runs again). When they end, `runManagerReview` (no tools) either asks one done task for its one revision (`store.managerRevise`: a note via `addComment`, which wakes it; the Manager's task waits for it) or passes a summary with the Agents' sources up; after a revision it passes up whatever comes back. ATOM's combine is unchanged (it sees the Manager's summary as that task's report). A task that ends unfinished does not fail the Manager (it reviews what finished; none finished fails its run). Agents' tasks under a Manager hand off as top-level tasks do. A Manager's run is not rated or made a skill. Logged: `manager.run` with Manager, task id, outcome and task count only.
- Window: Board chips are Manager chips ("N at work" = its Agents' running tasks plus its own runs, or "N agents · mode"; "!" when an Agent's plan, proposal or held task needs Keshab, or its own run is held); "All agents" lists everyone grouped by Manager ("No manager" last). A Manager's page: its pal, Rename/Remove, mode switch with what it means, budget, its Agents (each opens the agent page) and their tasks plus its own runs. Floor: one desk per Manager (`OfficePlan` with `TeamRoster.managers`), working with "N at work" while any Agent works, "!" and "Needs you" when one needs Keshab, idle Managers in the lounge; a desk click opens the Manager's page. Without Managers (an older runtime) the ADR-094 worker chips and floor stay, caps included. Gallery: a Research (plans and reviews, 4 agents), Coding (3) and Writing (2) team, a Manager's page and the New manager form.
- Tests: TS 14 new (managers: soul files, names, migration once and idempotent with versions, problems, create/rename/mode/move/remove, budgets and holds, delegation in both modes, split ≤6 and one revision, unfinished tasks and refusals; manager runs with a fake SDK: split, revision, pass-up, bad split, none finished; protocol and island round trip). Swift 6 new (decode, commands, window state, chips with 0/1/5 Managers, floor desks and lounge, All agents grouping). Checks: typecheck clean; TS 660 (658 pass, 2 skipped); Swift 511 pass; no new build warnings; gallery looked at (Board, floor, Manager page).
- Known limits: built-in workers' Managers live in settings, not a file; deleting every Manager after the first start does not make them again; a failed split (unknown Agent name, bad shape) fails the Manager's task with why; a Manager's own runs are on its page, not in the Board's columns, Needs you or Issues; the New agent form has no Manager picker (it defaults by role; move it after).

**ADR-095 package 3 — as built (2026-10-12):** item 4 (Sub-Agents); built by a worker, to be checked. No setting: always available, within the cap.
- An Agent's run with tools may start the Agent SDK's built-in subagents (`agents` option, launched by Claude Code's `Agent` tool, older name `Task`): a fixed set by what the run may use (`subAgentsFor` in `services/llm-gateway/src/providers/sub-agents.ts`): web runs get "searcher" (WebSearch) and "reader" (WebFetch); folder runs "coder" (the file tools and Bash) and "checker" (Read, Glob, Grep, Bash: no edits); think, plan, Tinker and Manager runs none (no `Agent` tool, no `agents`). Each definition's tools are filtered to the run's own (plus `Skill` when the Agent has skills, through the same per-run plugin), with `model: inherit`, `permissionMode: default`, `maxTurns` 20 and `Agent`/`Task` disallowed (no nesting). The run's instructions add one line: up to 4, only when parts can run side by side.
- Every launch passes one gate (`subAgentGate`), from both a PreToolUse hook (Claude Code lets the Agent tool through without asking canUseTool in the default mode) and canUseTool (counted once per tool call): only the run's own kinds, never from a sub-agent, at most `MAX_SUB_AGENTS` = 4 a run (the 5th is refused with words the model can act on), and the input rebuilt to description, prompt, kind and `run_in_background: false` (no remote or worktree copy, no other model). A sub-agent's own tool calls reach the same canUseTool (they carry its `agentID`): only tools some sub-agent has (all the run's own) plus Claude Code's hand-back, then the run's usual checks (shared page limit, folder check and sandbox, skill names); its MCP servers and `hand_off` are refused.
- Cost: the result's `total_cost_usd` covers subagents (SDK: same calls as `modelUsage`, which includes Task subagents), so it already counts toward the Agent's budget via `addSpend`; nothing added. Dashboard tokens still come from `result.usage` (main loop only).
- The thread: `onSubAgent` reports each start (from the gate, with the call's id, name and description cut to 120 characters) and end (the run's own tool result for that call: done, or failed on an error result, with the subagent's text cut to 200; any still open when the run ends failed). The runtime records it with `store.recordSubAgent` in a `sub_agents` table (job, call id, name, description, state, result; the newest 12 per task; deleted with the task; one left "started" when ZENO closed reads failed). Each job in `helpers` carries `subAgents`; the change is logged as `{ action: "subAgent", helper, job, name, state }`: never the description or result. The Swift thread view shows "Sub-agents" with a dot, the name, Working/Done/Failed and the result (else the description); a change re-asks the open thread like any job change.
- Tests: TS 8 new (agents per kit, subsets and none for no-tool runs; the cap of 4 through hook and canUseTool counted once, unknown kind, nesting, rebuilt input; sub-agent calls through the page limit, folder check and own-tools rule; recording started/done/failed from the stream; store record, cut, change events, newest 12, closed-while-running; island `helpers` round trip) and 2 extended (the run's tool lists now end with `Agent`). Swift 2 new (decode with a malformed entry left out, state words and detail line; a change re-asks the open thread). Checks: typecheck clean; TS 672 (670 pass, 2 skipped); Swift 515 pass; no new build warnings.
- Checker fixes: a worker run's dashboard tokens now sum `modelUsage` across models (sub-agents included) instead of the main loop's `usage` (chat unchanged); `sub_agents` keeps only the newest 12 rows per task (older pruned on each start); a PreToolUse hook on every tool denies a sub-agent's call to any tool outside the sub-agents' lists, even one Claude Code auto-allows. Tests: 3 new (summed modelUsage vs usage, 20 starts → 12 rows, the all-tools hook).
- Known limits: not yet run against the real Claude Code (the routing of subagent calls to canUseTool and the PreToolUse hook are from the SDK's types and the installed CLI 2.1.296); passing `Skill` in a subagent's tools is marked deprecated by the SDK (the `skills` field would preload whole skills instead, outside the Skill gate and `onSkill`); a sub-agent counts for the Agent's budget only after the run ends, as the run's own cost does; the 4 is per run, so a task asked again may start 4 more.

ADR-095 is done: packages 1–3 built and tested. Next: Keshab tries them on the real Mac.

**ADR-096 — as built (2026-10-12):** Back and Save in the ZENO window. A worker built it. Keshab asked for no new tests, no gallery and no review.
- Back: `WindowHistory` and `WindowLocation` are in `ZenoIslandCore/WindowHistory.swift`. `WindowPage` moved there too. A step is the sidebar page. On the team page, a step also keeps the agent, Manager, Board, task, soul, New agent, New manager and All agents.
- `IslandModel.recordLocation()` runs on each change of `location` (an `onChange` in `HelpersView`). It keeps the step before as a Back step. A change from the runtime is not a step. The history keeps at most 30 steps and no two equal steps in a row.
- `IslandModel.goBack()` skips a step when its task, Manager or agent is gone. `HelpersState.show(_:)` puts the team page back. The top bar shows "‹" when a step exists. Go → Back (⌘[) and the mouse back button do the same.
- Save: one shared `SaveButton` lights only for a change and shows "Saved" for 1.5 s. It is on the soul, the agent name, the Manager name, a task note, New agent, New manager and a new MCP server. Return saves one-line fields.
- Pickers, menus, switches and the Runs at once stepper save at once, as before.
- Unsaved edits: each edit view calls `tracksEdits`. `IslandModel.navigate` runs a page change, or first asks "Discard changes?" (Keep editing / Discard). Every page change in the window uses it, and so does closing the window.
- Checks: `swift build` passes with no new warnings. No tests ran.

ADR-091 is done: all six parts built and tested. Next: Keshab tries them on the real Mac (macOS will ask once to allow notifications); then Tasks 3.17–3.22 each need his decision.

**Also planned (ADR-087, Keshab: "include these as well").** Each starts with its own ADR (safety and scope) before any code, after 3.16.

**Task 3.17 — Companies and user logins.** Separate workspaces with their own tasks, workers, budgets and history; sign-in for more than one person.
**Task 3.18 — Secrets manager.** Worker credentials in the macOS Keychain, given to one worker's run by reference; never in souls, tasks or logs.
**Task 3.19 — Cloud sandboxes.** Runs on a remote sandbox instead of this Mac.
**Task 3.20 — Team templates.** Export and import a team (workers, souls, skills, routines) with secrets and local paths removed.
**Task 3.21 — Mobile web app.** The board and approvals from a phone.
**Task 3.22 — Codex and Hermes as workers.** A worker runs through the local `codex` or `hermes` command, with the same role, grant and budget checks.

**Later (not planned):** steering a running run, retries, workers driving apps through computer control.


## ADR-097 item 1 — as built (2026-10-12)

Model choice. Keshab chooses the default model and the model of each chat.

- The Claude plan gives its live model list. The runtime asks the Agent SDK (`listPlanModels` in `services/llm-gateway/src/providers/claude-plan.ts`) at start and on Refresh. The request sends no prompt and uses no tools, no settings and no connectors. If the request fails, the runtime uses the table in `PROVIDERS`.
- Codex and the Gemini CLI have a known list in `packages/shared/src/config.ts`. Each list starts with the program's own model.
- `apps/mac/src/model-settings.ts`: `offeredModels` uses the live list. `check` accepts a model from the list or a valid custom model id. `refreshModels` gets the live list again.
- Settings → Model shows the live list, a "Custom model…" entry with a Save button, and a Refresh button.
- Each chat keeps its own provider and model in `memory.db` (columns `chats.provider` and `chats.model`). A chat without them uses the default.
- The chat page has a Model menu in its top bar. The menu sends `chat.model`. The choice applies to that chat only.
- The runtime sends a typed turn to the chat's own model (`modelForTurn` in `apps/mac/src/runtime.ts`). Voice turns and new chats use the default model.
- Protocol: `model.refresh`, `chat.model`, and `currentProvider` / `currentModel` in `chats` (docs/island-protocol.md).
- Not done: tests for the new code. Keshab asked for build only.

## ADR-097 items 2 and 4 — as built (2026-10-12)

Own schedules. Keshab makes, edits and deletes schedules on the Scheduled page.

- The Scheduled page has a "New schedule" button. The button opens a form: the agent, the task, the repeat and the time. The agent menu lists only the agents that take tasks.
- The repeat is one of the three kinds that the store has: every day at a time, every week on a day at a time, or every 1 to 168 hours. An hourly schedule also has a first run time.
- Each routine card has an Edit button. Edit opens the same form with the routine's values. Save sends the change.
- The form uses the shared `SaveButton` ("Create" or "Save", ⌘S) and `.tracksEdits`. Leaving the page with unsaved text asks "Discard changes?". The form closes when ZENO answers without a problem.
- Store: `addRoutine` takes an optional `startAt`. The new `updateRoutine` changes the worker, the task and the schedule. A changed routine counts from now, so a changed time does not come due at once. `anchorFor` in `services/helpers/src/routines.ts` sets the hourly anchor.
- Protocol: `routine.add` and `routine.update`, and `schedule` (the numbers) in each routine (docs/island-protocol.md). The runtime checks the shape; the store checks the worker, the task and the numbers.
- Swift: `RoutineSchedule` and `RoutineDraft` (`Scheduled.swift`), `HelpersState.saveRoutine`, `ScheduleFormCard` (`ScheduledView.swift`).
- Not done: a "weekdays only" repeat. The store has no such kind.

Sounds settings. Settings has a Sounds page with one switch for each sound. Each switch takes effect at once.

| Switch | Sound | Setting |
|---|---|---|
| Speak the team's reports | ZENO says a goal's report aloud | `speakReports` (existing), sent in `speech.set` |
| Speak timers and updates | ZENO says timers and other updates aloud | `speakUpdates` (existing), sent in `speech.set` |
| Chime before speaking | The Glass chime before a spoken line | `speechChime` (new), sent as `chime` in `speech.set` |
| Start and stop sounds | The Tink and Pop tones of dictation | `soundsEnabled` (existing) |
| Notification sounds | The macOS sound of ZENO's notifications | `notificationSounds` (new) |

- The page is `Settings/SoundsPage.swift`. The Start and stop sounds switch moved there from General.
- The chat's Sounds menu uses the same settings. It also has the two new switches and a "Sound settings…" link.
- ATOM makes no sound of its own. ATOM shows a spoken line in its bubble while ZENO says it. The two Speak switches control that speech. So the page has no separate ATOM switch.
- Not done: tests for the new code. Keshab asked for build only.

## ADR-097 item 3 — as built (2026-10-12)

Memory from chats. Keshab chooses the chats to keep in memory. ZENO searches the kept chats for every request.

- The Memory page has a "Recent chats" card. Each chat shows its title, date and message count. Tick "Keep in memory" on each chat to keep, then click Save. A kept chat shows "Kept" and a Remove button. The card uses the shared `SaveButton` and `.tracksEdits`.
- Protocol: `memory.keepChat` and `memory.dropChat`, and `chats` in the `memory` event (docs/island-protocol.md).
- ZENO keeps each kept chat at 3 depths in `data/memory.db`: a summary (level 1), sections of 8 messages with a heading each (level 2), and the exact lines, cut to 800 characters or less (level 3). The tables are `kept_chats`, `kept_sections`, `kept_lines` and the full-text table `kept_fts`. The code is `services/memory/src/chat-index.ts`.
- The summary and the headings come from one run of the plan's small model without tools (`runChatDigest` in `claude-plan-job.ts`). If the run fails, or the Claude plan is not in use, ZENO makes the digest from the first lines and keywords. Keeping a chat never fails because of the model.
- The search uses keywords (SQLite FTS5) and meaning (the local model `Xenova/all-MiniLM-L6-v2`, through `@huggingface/transformers`, which ZENO already uses). Reciprocal rank fusion merges the two results. The search starts at the summaries. It searches the sections of the best 3 chats only, then the lines of the best 3 sections only.
- The embedding model loads in the background. A request does not wait for it: until it is ready, the search uses keywords only. If the model cannot load, ZENO logs it and uses keywords only. Vectors that are missing are added when the model is ready.
- Each request gets the best kept lines, with their chat title and section heading, in the system prompt (1,500 characters or less). The Core's context hook can now be async.
- Not done: tests for the new code (Keshab asked for build only). A kept chat is a copy: turns added to the chat after keeping are not in memory. Remove and keep the chat again to add them.

## ADR-098 item 9 — as built (2026-10-12)

Token savings from jcode. ZENO sends fewer tokens to Claude, and the cache holds more of them.

- Sub-agents use cheaper models. The searcher and the reader use Haiku with low effort. The checker uses Sonnet. The coder uses the model of its run. The code is `subAgentsFor` in `services/llm-gateway/src/providers/sub-agents.ts`.
- Runs without tools use low effort. These runs are the plan, Tinker's review, the skill draft and edit, the Manager split and review, and the chat digest. The code is `runStructured` in `claude-plan-job.ts`.
- Managers and Tinker use Sonnet at most. A model that Keshab pins on an agent stays. The code is the `cap` input of `chooseJobModel` in `services/helpers/src/models.ts`. The reason in the window is "Role maximum".
- Each chat keeps one Claude Code session. A typed turn in a chat resumes the session and sends only the new turn and the context for this request. The `chats` table has a new column `session` (JSON: session id, model, hash of the last answer). ZENO resumes the session only when the model is the same and the last answer in the chat is the answer from that session. Otherwise, ZENO starts a new session with the whole chat and keeps its id.
- If a resume fails before Claude does anything, ZENO starts a new session with the whole chat.
- Voice turns do not change. They use the pre-started process and no session. A typed chat turn does not use the pre-started process, because that process keeps no session.
- The team list and the memory guidance are now in the system prompt (the `standing` option of `createCore`). The per-turn text has only the time, the memory facts, the kept-chat lines, the episodes and the pointed window. A chat session renders its system prompt each time (`snapshot: false`), so a changed team list arrives on the next turn.
- After an answer with tools, the adapter pre-starts the next process with the instructions of that answer. Thus a changed team list does not stop the pre-start.
- The Dashboard shows the cache hit rate for 7 days and for today, and for each day under its bar. The cache hit rate is cache reads ÷ (input + cache reads + cache writes). The Dashboard shows "Cache went cold" when the last 3 chat answers read 0 cached tokens (`chatCacheCold` in the `usage` summary).
- Not done: tests for the new code (Keshab asked for build only). A long chat session is not cut to 20 exchanges: Claude Code compacts it when it is full.

## ADR-098 items 1–2 — as built (2026-10-12)

Telegram for ATOM, and results to the phone. ZENO uses its own bot. Hermes keeps its bot.

- Set up: make a new bot with @BotFather. Add `ZENO_TELEGRAM_BOT_TOKEN` and `ZENO_TELEGRAM_CHAT_ID` to `.env`. Restart ZENO. The feature is off until both values are set.
- `apps/mac/src/telegram.ts` (`startTelegram`, `splitMessage`) talks to the Bot API with Node's `fetch`. It uses long polling (`getUpdates` with offset and a 50 s timeout), `sendMessage` (plain text, split at 4096 characters) and `answerCallbackQuery`. Errors back off from 1 s to 60 s. `stop()` aborts the call in flight.
- ZENO serves only the chat in `ZENO_TELEGRAM_CHAT_ID`. ZENO ignores other chats and logs only a count. The log never holds the token or message text.
- `apps/mac/src/telegram-bot.ts` (`startTelegramBot`, `needsYou`) holds ZENO's side:
  - Plain text is an ATOM chat turn. The turn goes to a Core of its own (`makeCore` in `runtime.ts`), with the chat id `telegram`. The ZENO window lists this chat as "Telegram". Turns run one at a time.
  - `/needs` sends each Needs you item with its buttons: ATOM's questions (Allow, Decline), plans (Approve, Reject), Tinker's proposals, skill drafts and skill edits (Accept or Approve, Reject), held tasks, and failed tasks (Retry). At most 10 items. Each button calls the same store command as the window.
  - `/tasks` lists running and waiting tasks (at most 20 lines). `/report <number>` sends a task's report, cut at 3500 characters. `/help` lists the commands.
  - Push: a new Needs you item (not a failure), a finished goal (its title and summary), and the result of a schedule with "Send result to Telegram" on.
- The computer bridge has `pending()` and `onAsk()`, so ATOM's questions also go to Telegram.
- Routines have `notifyTelegram` (store column `notify_telegram`, default off). `routine.add` and `routine.update` take it. The Scheduled form has a "Send result to Telegram" switch.
- Settings → General has a Telegram card. It shows "Connected" or "Not set up" (with the two `.env` names) and the "Send to Telegram" switch. The switch is on by default. The island sends it as `telegram.set` when ZENO connects and when it changes. The `ready` event has `telegram`.
- The "Send to Telegram" switch controls all sends that ZENO starts, also schedule results. Replies to Keshab's messages always go.
- Steering (ADR-100): `/steer <number> <text>` calls `TaskSteering.steer`, the same function as the window. It answers "Sent to task #N now." or "Kept for task #N. It runs after this step." `/interrupt <number>` calls `TaskSteering.interrupt` and answers "Task #N stopped. It waits for your message." A `HelperError` message is the answer. Without steering, both commands answer "Steering is off." The log holds the command name only, never the message.
- Test results (ADR-100): a Needs you item for a Tinker proposal or skill edit has one more line, "Test cases: 2 better, 1 same". The line has the same words as the window. No results: no line. No new buttons.
- Tests: `telegram-bot.test.ts` covers the bot, the commands, steering and the test line.
- One writer for each chat: the chats `telegram`, `api` and `api-<chatId>` are read-only in the ZENO window. The `chats` event sets `readOnly: true` on them. A window turn (typed or spoken) in one gets the error "This chat is written from Telegram. Open it to read it only." The window shows one line in place of the composer. Reading, copying and search still work. Not done: a chat that Telegram writes has no way to move to the window.

## ADR-098 item 4 — as built (2026-10-12)

A browser for workers.

- Turn on the Browser switch on the worker's page. The store keeps the setting `browser:<id>`. The protocol command is `helper.browser`. Each helper in `helpers` has `browser`.
- With the switch on, each run of the worker gets Playwright's MCP server (`@playwright/mcp` 0.0.83, Apache-2.0) under the name `zeno-browser`. A "think" worker does not get it. Sub-agents do not get it.
- The launch command is `node <@playwright/mcp>/cli.js --browser chromium --user-data-dir data/browser-profile/<id> --output-dir data/browser-files/<id> --no-webmcp`. The browser is headed, so Keshab can watch it.
- Install the browser once: `node apps/mac/node_modules/@playwright/mcp/cli.js install-browser chromium`. Without it, the first browser call fails with an install message.
- `browserCheck` in `apps/mac/src/browser.ts` checks each browser call. The first visit to each site and the first typing or submit on each site ask Keshab on ATOM's card. The answer lasts for the run. Uploads come only from the worker's granted folders. The check refuses a call that names a file. A PostToolUse hook gives each result to the check, so it knows the page's origin and the last snapshot.
- The task's step shows the tool and the origin, for example "Browser: click on https://example.com".
- The gateway option is `browser` in `runResearch` (`claude-plan-job.ts`). The runtime makes a new check for each run.
- Password fields: ZENO's init script (`apps/mac/src/browser-password-mark.cjs`, `--init-script`) puts "[password field]" before the name of each password input (type `password`, or `autocomplete` with "password"). The page snapshot shows it. For `browser_type` and `browser_fill_form`, `browserCheck` reads the target's line in the snapshot. A password field, or a target ZENO cannot find in the snapshot, asks Keshab on each call, also on a site that is already allowed. The answer is never kept. The model has no new tool. The summary of a typing call and its result hide the typed text.
- Two browser tasks of one worker: the second waits for the first (`acquireBrowser`, first come first served). Its step says "Waiting for the browser". The turn is released when the first task ends, fails or stops. A stop ends a wait. Another worker does not wait.
- Not done: a headless switch. Inputs inside shadow roots are not marked. `browser_press_key` can still type into a focused password field after the site question. The turn is released when the run ends, not when the browser process has exited. The init script is tested with fakes, not yet in a real Chromium (not installed here).

## ADR-098 item 6 — as built (2026-10-12)

One search, and labels on tasks.

- The search field is at the top of the window's sidebar. Edit → Find (⌘F) puts the cursor in it. Esc or the clear button empties it.
- While the field has words, the sidebar shows the results in place of its pages: Chats, Tasks and Reports. Each result has a title, a short snippet and a date. Each kind has at most 20 results. The search starts 250 ms after the last key.
- A chat result opens the chat. A task or report result opens the task's thread. Both go through `model.navigate`, so Back and "Discard changes?" work.
- Each database has SQLite FTS5 tables. Triggers keep them in step with their tables. An older file gets its FTS tables filled once at start.
  - `memory.db`: `chat_fts` (one row per chat message). The code is `services/memory/src/chat-search.ts`.
  - `helpers.db`: `task_fts` (task text), `note_fts` (task notes) and `report_fts` (title, summary, body). The code is `services/helpers/src/search.ts`.
- All words must match. Each word also matches as the start of a longer word. Each word is quoted, so FTS syntax does not get through. A query has at most 200 characters.
- Labels: the table `job_labels` (job_id, label). A label has 1 to 24 characters: a to z, digits, dash and space. A task has at most 6 labels. A deleted task loses its labels (trigger). A label search finds part of a label.
- The task thread has a Labels section: chips with × to remove, and an "Add label" field with the Add button. Return saves.
- The Board has a Label menu. It lists the labels in use. Choose a label to see only its tasks, as columns. Choose "All" to see all tasks.
- Protocol: `search` → `search.results`, `job.label.add`, `job.label.remove`. Each job in `helpers` has `labels`. The log has counts only (`search` with `chats`, `tasks`, `reports`), never the query.
- Not done: tests (Keshab asked for build only). A task result that is older than the Board shows (the newest 20 per worker) shows dim and does not open. Chat titles are searched through the first message only.

## ADR-098 item 7 — as built (2026-10-12)

Codex when the Claude plan limit stops work.

- The switch is "Use Codex when the Claude plan limit is reached", in Settings → General, in the Team card. It is off by default. The store keeps the setting `codexFallback`. The protocol command is `helpers.settings` with `codexFallback`. The `helpers` event has `codexFallback` and `codexReady`.
- The switch shows only when Codex is found and signed in (`codexReady`). The runtime asks `codex login status` at start and when Keshab turns the switch on. ZENO also finds Codex in the ChatGPT app now (`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`).
- With the switch on, the runner starts a task on Codex when only the Claude plan's limit holds it. Budgets still hold tasks. A plan that waits for Keshab, Tinker and Managers stay on Claude. The Codex run uses a normal run slot. The task does not show as held.
- `runCodexJob` (`services/llm-gateway/src/providers/codex-job.ts`) sends the same brief: the soul, the task (`briefFor`) and a report contract. Codex replies with one JSON object. `parseReport` checks it, as for Claude runs.
- Commands by kit:
  - think: `codex exec --json --ephemeral --skip-git-repo-check --ignore-user-config --output-last-message <file> --sandbox read-only -c web_search="disabled" <prompt>`
  - research, and a write-up without a folder: the same with `-c web_search="live"`.
  - folders: `codex exec --json --ephemeral --skip-git-repo-check --ignore-user-config --output-last-message <file> --sandbox workspace-write -c sandbox_workspace_write.network_access=false --cd <worktree> [--add-dir <other granted folder>] <prompt>`. ZENO commits the changes on the task's branch, as for Claude.
- stdin is closed. API keys are removed (`signedInEnv`). The time limit is the job limit (15 minutes).
- The thread shows the model "codex" with the reason "Ran on Codex (Claude plan limit reached)". The step says the same.
- The tokens come from the `turn.completed` events of `--json`. They go to the usage table with the model `codex` and $0. ZENO adds no spend, so budgets count $0.
- The log has `job.codex` (task id, kit, folder yes or no) and `codex.ready`.
- Not done: tests (Keshab asked for build only). A Codex run does not resume an earlier session. Hand-off, skills, MCP servers, the browser and sub-agents are not given to Codex. Wake-ups still wait at the plan's limit. The usage table has no provider column, so the model `codex` marks these runs. Codex output over 16 MB fails the run.

## ADR-098 item 5 — as built (2026-10-12)

ZENO as a server: a local HTTP API, an MCP server and webhooks for schedules.

- The API is `apps/mac/src/api-server.ts` (`createApiServer`). It uses Node's `http`. It has no framework.
- Turn it on in Settings → General → "Local API". It is off by default. The island keeps the switch (`zeno.api.on`) and sends `api.set` when ZENO connects and when the switch changes. The runtime answers with the `api` event (on, port, token file, error).
- The API listens on 127.0.0.1 only. The port is `ZENO_API_PORT` (default 4790).
- Each request needs `Authorization: Bearer <token>`. The token is in `data/api-token` (32 random bytes as hex, mode 0600). ZENO makes it at the first start. ZENO compares SHA-256 digests in constant time. A wrong token gets 401. The log has the count only.
- "Copy token" reads the file when clicked and puts the token on the clipboard. The token is never in the log or the protocol.
- Endpoints: `POST /v1/goals`, `GET /v1/goals/:id`, `POST /v1/chat`, `GET /v1/tasks`, `GET /v1/tasks/:id`, `GET /v1/needs`, `POST /v1/needs/:key`, `POST /v1/hooks/:routineId`. Each answer is `{ok, data, error}`. A body is at most 64 KB.
- Goals and chat turns go to a Core of their own (`makeCore`, as for Telegram). The chat is `api`, or `api-<chatId>`. One turn runs at a time. A goal has a `source` (the chat that made it; NULL for old goals). The `goal` change event carries it. The API goal turn takes the goal id only from a goal with the source `api`.
- The delegate tool reads the source from the turn (`turn-chat.ts`, `AsyncLocalStorage`), not from a Core. The Claude plan runs all tools through one shared runner, so a tool cannot belong to one Core.
- Needs you uses `needsYou` and `answerNeed` from `telegram-bot.ts`. `answerNeed` is the Telegram button code, moved out so both use it. The action is the button's word in lower case (`approve`, `reject`, `allow`, `decline`, `accept`, `retry`).
- Webhooks: each routine has a `webhook` column (default off). The Scheduled form has the switch "Can be started by webhook". In edit mode the form shows the path. `HelperStore.startRoutine(id)` makes the task now. A routine without the switch gets 403. A routine whose last task has not ended gets 409.
- The log has `api.request` (method, route pattern, status, ms), `api.unauthorized` (count), `api.start`, `api.stop` and `api.start_failed`. It never has bodies, goals, answers or the token.
- The MCP server is `apps/mac/src/mcp-serve.ts`. It uses `@modelcontextprotocol/sdk` (already a dependency) over stdio. It is a client of the API and reads `data/api-token`. Tools: `zeno_give_goal`, `zeno_goal_status`, `zeno_chat`, `zeno_list_tasks`, `zeno_task_report`, `zeno_needs_you`. Add it with `claude mcp add zeno -- node <ZENO folder>/apps/mac/src/mcp-serve.ts`.
- Docs: README "Use ZENO from other tools", SECURITY.md "Local API and MCP server", docs/island-protocol.md "Local API".
- Not done: tests (Keshab asked for build only). No `pnpm zeno:mcp` script: pnpm writes a line to stdout, and that breaks the MCP stream. The MCP server has no tool to answer Needs you. Terminal mode has no switch, so the API is off there.

## ADR-098 item 3 — as built (2026-10-12)

Steer or interrupt a running task.

- Open the thread of a running task. The field "Tell <agent>…" sends a message. Click Send or push Return. The protocol command is `job.steer` (`id`, `text` of 1 to 2000 characters).
- The worker reads the message at its next step. The run does not stop. The runtime gives each worker run its input as a stream (Agent SDK streaming input: `query({ prompt: AsyncIterable<SDKUserMessage> })`, sdk.d.ts line 3245; `priority` at line 6228). Each message has `priority: "next"` and `client_composed: true`, so the CLI does not read `@file` mentions or run slash commands.
- ZENO keeps the message as a task note with `delivery: "live"`. The thread shows it as "Keshab (while running)". A resumed run does not get a "live" note again.
- Some runs cannot take a message: plan, Manager and Tinker runs, and a run that has its result. Then ZENO keeps the message with `delivery: "after"`, and the task runs once more after this run. The thread shows "Keshab (after this run: the run could not take it)".
- The CLI takes a message between steps. When the run ends before a step follows the message, ZENO changes the message to "after" (`steerUnread`). This is a guess from step boundaries: a message can then go to the worker two times.
- The Interrupt button is next to Stop on a running task. The protocol command is `job.interrupt` (`id`). It calls the SDK's `Query.interrupt()` (sdk.d.ts line 2858). Then the input stream ends, and the run ends with `RunInterrupted`.
- The runtime keeps the session id. The store moves the task back to `queued` with `interrupted` = 1 (`HelperStore.interrupt`). The task is held with "Interrupted — waiting for you." It shows under Needs you. The activity line is "Interrupted".
- The field on an interrupted task is "Tell <agent> what to do next". The message wakes the task. The next run resumes the same Claude session with the message (`resumeOf`, `followUpBrief`). When a note waited already at the interrupt, the task runs again at once.
- Stop still ends the task, also an interrupted task.
- Code: `apps/mac/src/task-steering.ts` (`taskSteering`: `track`, `steer`, `interrupt`). The runtime has `steering` (for Telegram later). The island helpers have `steer` and `interrupt`. The gateway option is `steering` in `runResearch` (`LiveRun`, `RunSteering`, `RunInterrupted` in `claude-plan-job.ts`). The runner outcome is `interrupted`.
- The log has `job.steer` (task id, state, live yes or no) and `job.interrupt` (task id, ok). It never has the message.
- Not done: tests (Keshab asked for build only). Telegram does not call steer or interrupt yet. A Codex run cannot be steered. The thread has no "Kept for after this run" line for an ordinary note.

## ADR-098 item 8 — as built (2026-10-12)

Test cases for souls and skills.

- Open the thread of a done task. "Save as test case" saves the task for its agent. When the run used a ZENO-made skill, "Save for <skill>" saves the task for that skill. The protocol command is `testcase.save` (`jobId`, `kind` `soul` or `skill`, `target`).
- The store keeps each test case in the table `test_cases`: id, target kind, target (agent id or skill name), task id, task text, the original report (cut to 4000 characters) and the time. A target keeps 10 test cases at most. The store refuses the 11th with a clear message. It also refuses a task that is not done, a task with no report, a wrong target and a second save of the same task for the same target.
- The agent page and each ZENO-made skill on the Plugins page list the test cases ("Test cases · 2 of 10"). Delete removes one (`testcase.delete`, `id`).
- When Tinker saves a soul proposal or a skill edit, and the target has test cases, the Tinker task runs the test cases before it ends. ZENO takes the newest 3 cases. For each case, ZENO makes two dry runs: one with the current soul or skill text, one with the proposed text. Then a judge run compares the two answers with the saved report. The judge gives `better` (`old`, `new` or `same`) and a reason (200 characters at most).
- Each run has no tools: `tools` [], `strictMcpConfig`, `settingSources` [], effort "low" (the `runStructured` pattern, modes `testAnswer` and `testJudge`). The model is Sonnet at most (`modelForTier(..., "medium")`).
- The cost counts on the Tinker task that made the change, so it counts on Tinker's budget. When the plan is above its limit, a case is "Not run: plan limit". When Tinker's or the team's budget is used up, a case is "Not run: budget used up". A plan-limit error in a run stops the remaining cases.
- The store keeps the results per proposal or edit in the table `test_results` (state, verdict, reason, the two answers cut to 4000 characters). A new run replaces the old results.
- The proposal card (agent page and Needs you) and the skill edit card (Plugins page and Needs you) show "Test cases: 2 better, 1 same". "Compare" opens the old and the new answer side by side for each case (cut to 800 characters), with the judge's reason. "Run tests" runs the cases again (`testcase.run`, `proposalKind`, `id`). Accept and Reject do not change.
- Code: `services/helpers/src/test-cases.ts` (`testCaseTable`, briefs, limits). Store: `saveTestCase`, `deleteTestCase`, `testCases`, `testInputs`, `startTestRun`, `finishTestCase`, `testResults`, `tinkerTaskOf`. Gateway: `runTestAnswer`, `runTestJudge` in `claude-plan-job.ts`. Runtime: `apps/mac/src/test-runs.ts` (`runTestCases`), the `test` hook of `runTinker`, and `runTests` in `runtime.ts`. Window: `TestCaseViews.swift` (`TestRunView`, `TestCasesList`, `SaveTestCaseSection`) and `TestCases.swift` (Core).
- The log has `test.run` (kind, id and counts) and `test.failed` (kind, id and the error kind). The change events have ids, targets and states only. The log never has a task, a report or an answer.
- Not done: tests (Keshab asked for build only). Telegram does not show test results. A run that ZENO closes in the middle stays "running" until "Run tests" runs it again.

## Backlog After ADR-098 (2026-10-13)

This list comes from a comparison of ZENO with Paperclip. The agent did not fetch the Paperclip docs. The Paperclip rows use ZENO's notes and prior knowledge. A "no hits" result is a search, not proof.

Order of work: fix and test first, then build.

### B1 — Tests for the ADR-097 and ADR-098 code — done (2026-10-13)

Keshab asked for build only, so these items had no tests. They have tests now (commit 51f8fcd). Not covered: slow request bodies, a real browser launch, and Telegram push for finished goals and schedule results.

- Add tests for `api-server.ts`, `telegram-bot.ts`, `telegram.ts`, `browser.ts`, `mcp-serve.ts` and `task-steering.ts`.
- Fix the tests that the new code broke.
- Run `node --test "**/*.test.ts"` and `pnpm typecheck`.

### B2 — Known weak spots (each is recorded in the ADR sections above)

- Fixed (2026-10-13): a Telegram turn and a window turn on the same chat could disagree on the history. Each chat now has one writer; the window reads `telegram` and `api*` chats only.
- Fixed: a second browser task of one worker waits for the first.
- Fixed (2026-10-13): a goal that another surface made during an API goal turn could get the wrong id. A goal now has a `source`. Not checked with the real Claude plan: the source reaches the shared tool runner through `AsyncLocalStorage`.
- Fixed: a password field, or a field ZENO cannot identify, always asks. Open: shadow-root inputs and `browser_press_key` into a focused password field.
- Codex runs get no hand-off, skills, MCP servers, browser or sub-agents. This is not a gap: no browser or MCP tool exists for the safety checks to guard. A test checks it (`codex-job.test.ts`).
- No separate webhook secret (ADR-103). The webhook uses the API bearer token and the API listens on 127.0.0.1 only.
- Fixed: the MCP server has the tool `zeno_answer_need` (key and action). A browser action before the first navigate is now refused.
- `runtime.ts` split: done, 832 lines (a pure move into `run-job.ts`, `runtime-support.ts` and `island-wiring.ts`; tests unchanged). `island-protocol.ts` split: done, 140 lines (a pure move into `island-items.ts` and `island-commands.ts`; `island-protocol.ts` still re-exports every name; tests unchanged).

### B3 — Gaps against Paperclip (most valuable first)

1. Activity timeline for each run (ADR-099): built and tested (TS 746 tests, Swift 517). Not yet seen in the real window. Codex and Manager runs record no calls.
2. Telegram parity (B3.2, ADR-100): built and tested. `/steer`, `/interrupt` and the test line in Needs you items. Not yet tried on a real phone.
3. WhatsApp for ATOM (B3.3): skipped by Keshab 2026-10-13.
4. Checkpoint and undo of a run's file edits, also outside git repos (B3.4, ADR-101): TypeScript side built and tested. The Swift side is built by another agent. Bash edits are not tracked. Codex runs have no undo.
5. Skills hub (B3.5, ADR-102): TypeScript side built and tested. The Swift side is built by another agent. Search and install of skills from a pinned list of public repos (`anthropics/skills`). A person approves each install. No update is automatic.
6. Smaller gaps: image and video generation. Remote terminals (Task 3.19, Cloud sandboxes, is the nearest planned task).

B3 items 1, 2, 4 and 5 are built (items 4 and 5: TypeScript side). Item 3 is skipped. The rest is not started.

## Phase 4 — Lantern: the Redesign (ADR-084, 2026-10-10)

Design: `docs/design/design-study.md` §3 A (tokens, type, motion) and §4 (rollout). Mockups: gallery sheets `14-design-study-*`. Each step changes how things look and move, never what they do; each ends with its tests, a gallery render shown to Keshab, and docs.

- **4.1 Tokens and motion.** A `lantern` palette (dark and Lantern Day) with contrast tests, a `Motion` set of named springs with Reduce Motion fallbacks; Lantern is the default theme.
- **4.2 Menu-bar item.** One Wisp outline (template image), lit while listening, amber when asking, coral on a problem.
- **4.3 Panel header and tabs.** Live Wisp in the header, the state in rounded type, two word tabs with the light underneath, header glow from state.
**As built, 4.1–4.3 (2026-10-10):** built; tested (436 Swift); seen in the gallery; not yet seen in the real app.
- 4.1: `lantern` and `lanternDay` palettes (contrast-tested; Lantern Day's amber is `#A05E00`, since the study's `#A86200` is only 4.4:1 on its surface) and named motions in `Motion.swift` with Reduce Motion fallbacks. Lantern is the default; a stored Quiet Native (the old default, which cannot be told apart from a deliberate choice) moves to Lantern once, then any choice sticks.
- 4.2: one Wisp outline in the menu bar (`MenuBarGlyph.swift`, our own drawing), plain, lit while listening, amber for asking or a notice, coral on a problem (`MenuBarLight`, tested).
- 4.3: live Wisp in the header (the user's Wisp style and mood), state in rounded type, three word tabs with a sliding light (Status stays until 4.4), header glow by state (`PanelLight`, tested); focus order and VoiceOver labels kept.
- Known limits: the panel rim does not yet follow the state; the glow is faint on Lantern Day.

**As built, 4.4–4.6 and Keshab's feedback (2026-10-10):** built; tested (444 Swift); seen in the gallery; not yet checked by eye in the running app (corners and shadow, open and close, the menu-bar glyph).
- Feedback "a padding for the whole and more in conversation; the box shape is square": `Spacing` values (panel edges 22, inside wells 14, between wells 18, conversation sides 26, between turns 28); the edge-to-edge hairlines and hard scroll edge that boxed in the conversation are gone; the window shadow is re-traced after opening and resizing, and the blur gets a rounded mask before macOS 26 (both possible causes of square corners in the real app).
- 4.4: the Status tab is gone; Settings opens with a "now" card (provider, model, "Change model", plan meters, microphone, voice, "Last turn" with every stage on tap, the last problem), then two groups of rows with outline glyphs; pages push with a hand-off, rows cascade once per opening (`PanelPages`, tested).
- 4.5: quiet rounded slips for the user, full-width replies with no avatar, older replies fade, a breathing caret after the reply being spoken, a pencil for New conversation, a capsule composer with a lit mic that becomes Send once you type; hover still shows a turn's timings.
- 4.6: the panel opens from under the menu-bar icon on `Motion.open` (96 %, a 6 pt drop, 0.3 s fade) and closes on `Motion.close` without bounce; Reduce Motion fades only.
- The menu-bar glyph is redrawn from Wisp's own body (egg-shaped head, one soft wave into a tail, Wisp's eyes), so it no longer resembles a well-known game character.
- Known limits: replies arrive whole, so words do not fade in one by one; the shadow may lag the opening size for about 0.2 s; `IslandController.swift` is 1120 lines.

- **4.4 Settings home with "now".** The Status tab's content in a top card, monochrome rows, page hand-off; the Status tab removed last.
- **4.5 Conversation.** Quiet user slips, full-width replies without avatars, older turns receding, a glowing caret while a reply streams, a pencil for New conversation, a lit mic.
- **4.6 Panel open and close.** Springs from the menu-bar item.
- **4.7 Wisp's bubble.** Night glass, lit rim while listening, amber for attention.
- **4.8 Work strip and pointing label.** Same glass; amber approval with Allow as the only filled button.
- **4.9 Helpers window.** Letter discs with a working arc, dot states, a progress line, "Read report" as the lit button.
- **4.10 Sounds** (optional, a separate decision).

**As built, 4.7–4.9 (2026-10-10):** built; tested (455 Swift); seen in the gallery; not yet checked in the running app (the Helpers window's transparent title bar, the turning arc, the breathing dot, the bubble growing from its tail).
- 4.7: Wisp's bubble is night glass (radius 18, no icon circle, a soft curved tail); listening and dictating light its rim with a pool of light at the tail and a meter in Wisp's light; amber for a notice or a question, coral for a problem; grows from the tail and leaves on the named springs.
- 4.8: the work strip is a glass capsule with a breathing dot of light and a concentric Stop; the approval card has an amber rim and dot, the request in rounded type, Decline with its `esc` hint and Allow as the only filled button, both concentric with the corners; the pointing label is a glass capsule.
- 4.9: the Helpers window has a darker sidebar reaching the top, helper discs (avatar or letter) with a turning arc of light while working, jobs as dots (running, queued, done, failed, stopped), a line of light for "n of m" steps (`HelperJob.progress`, tested), compact "Opens in" and "Model" pills, a capsule task field, "Read report" as the only lit button, and a roomier report view.
- Kept on purpose: "ZENO needs your OK" wording; Delete on every job row; the helper header shows job counts, since helpers have no description yet.

**Void theme (ADR-086, 2026-10-10):** built; tested (456 Swift); seen in the gallery; not yet checked in the running app (window shadows off, the menu-bar glyph refreshing on a theme change, hover timing). Void is the default (a stored Lantern moves to it once; any later choice sticks); Lantern and the others are unchanged (pixel-compared before and after). New palette properties (`surfaceStyle`, `buttonStyle`, `usesGlow`, `usesShadows`, `monoIdentifiers`, `statusDots`, `borderHover`, `identifier`, `cornerGap`) drive every component: pure black, 1 px `#292d30` hairlines, no glows or shadows (Wisp and the menu-bar glyph included), ghost buttons (Allow with an amber hairline, "Read report" with a violet one), status dots, SF Mono for identifiers with violet only on model names and source hosts, one New York line per screen, 150 ms hover. Departures: captions are `#878b92` (Iron `#6e727a` is below AA on black); overlays have no backdrop blur; the working strip stays a pill; under Void the Glow, bubble Background and Glass/Solid settings have no visible effect.

**Avatars (ADR-085, 2026-10-10):** the loader is built and tested (453 Swift); waiting for Keshab's exported images in `assets/avatars/`. `build-app.sh` copies the PNGs one folder deep into the app; `AvatarImages` finds them (`ZENO_AVATARS_DIR`, then the app bundle, then the repo); a new Wisp style "Avatar" draws the image for each mood and reaction with ZENO's own motion and light (speaking alternates two mouths about 6 times a second, unevenly); helpers show their face in the Helpers window. With Wisp's images present, Avatar becomes the default, and a stored Orb moves to it once. A missing image falls back to today's drawing. Not done: Wisp's "happy" for a finished job (only the hello), mirroring when Wisp faces left, the letter discs with a working arc from the mock.

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

2026-10-13: the work is far past Phase 0.5. The code is built through ADR-098. Two things remain:

1. B1 in "Backlog After ADR-098": tests for the new code.
2. Keshab's hand checks of built work (the tasks marked "not yet seen" or "not yet tried by voice").

Then B2 and B3. Everything else waits.

## ADR-104 — Smooth 2D Pal and office floor (2026-10-13)

Pal and the office floor are now smooth vector art (`PalDrawing`, `OfficeDrawing`). Moods, timing, layout and labels are unchanged. The pixel code is removed. Swift tests: 525 pass. `docs/images/office-floor.png` is regenerated.

## ADR-106 — One turn, then idle (2026-10-13)

ATOM no longer listens again after a reply. "Answer without keys" is off by default. A typed turn never opens the microphone. A Quiet chat does not speak the reply to a typed message. Keshab: check by hand with the running app.
