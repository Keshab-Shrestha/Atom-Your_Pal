# ZENO Architecture Decisions

This document records important architectural decisions.

---

## ADR-001 — ZENO Is a System, Not a Chatbot

### Decision

ZENO is designed as an intelligence system rather than a chatbot.

### Reason

A chatbot is insufficient for:

- devices
- memory
- capabilities
- permissions
- tasks
- events
- knowledge
- multi-user behavior

The LLM is only one component.

---

## ADR-002 — Provider Independence

### Decision

All LLM providers must be accessed through an LLM Gateway.

### Reason

This prevents architectural dependency on one provider.

Target:

```text
ZENO
 ↓
LLM Gateway
 ├── Claude
 ├── OpenAI
 └── Future Providers
```

---

## ADR-003 — Local Voice, Remote Reasoning Initially

### Decision

Use local processing for voice where practical while using remote frontier models for general reasoning.

### Reason

This provides:

- local audio processing
- reduced dependence on local compute
- access to strong reasoning models

---

## ADR-004 — No Ollama Dependency

### Decision

ZENO does not require Ollama or a local general-purpose LLM.

### Reason

The initial architecture does not require local general-purpose inference.

This may be revisited if requirements change.

---

## ADR-005 — Deterministic Routing First

### Decision

ZENO should attempt deterministic routing before probabilistic reasoning.

### Reason

This reduces:

- latency
- cost
- unnecessary inference
- complexity

---

## ADR-006 — Optional Decision Engine

### Decision

The Decision Engine is optional.

### Reason

Not every request requires probabilistic decision-making.

---

## ADR-007 — Replaceable Decision Engine

### Decision

The Decision Engine must be abstracted.

Potential implementations:

- Laya
- Jev
- future systems

### Reason

ZENO should not be architecturally locked to one decision technology.

---

## ADR-008 — Modular Monolith First

### Decision

Build the initial ZENO system as a modular monolith.

### Reason

This reduces unnecessary operational complexity.

Microservices may be introduced later when justified.

---

## ADR-009 — One Intelligence, Multiple Devices

### Decision

Devices are nodes connected to one ZENO intelligence.

### Reason

The user should experience one consistent assistant across devices.

---

## ADR-010 — Deterministic Permissions

### Decision

Permissions and authorization are enforced outside the LLM.

### Reason

Model output is not a secure authorization mechanism.

---

## ADR-011 — Capability-Based Architecture

### Decision

Device and application functionality should be represented as capabilities.

### Reason

Capabilities make permissions and available actions explicit.

---

## ADR-012 — Least Privilege

### Decision

Capabilities receive only the permissions they require.

### Reason

Reducing authority reduces potential damage.

---

## ADR-013 — Personal and Team Knowledge

### Decision

Knowledge can exist at multiple scopes.

Scopes include:

- personal
- project
- team
- organization
- platform

### Reason

Future ZENO usage requires controlled information sharing.

---

## ADR-014 — Knowledge Is Separate From the LLM

### Decision

Knowledge belongs to ZENO, not to an individual model.

### Reason

Models are replaceable.

Knowledge should remain available regardless of which model is used.

---

## ADR-015 — Memory Is Separate From Conversation

### Decision

Persistent memory is not equivalent to conversation history.

### Reason

Not every conversation detail should become permanent memory.

---

## ADR-016 — Provenance

### Decision

Important memory and knowledge should retain provenance.

### Reason

ZENO needs to distinguish:

- verified information
- derived information
- uncertain information

---

## ADR-017 — Think Globally, Implement Locally

### Decision

Architecture should account for the complete product, while implementation remains focused on the current capability.

### Reason

This prevents both:

- short-term architectural dead ends
- premature complexity

---

## ADR-018 — Measure Before Optimizing

### Decision

Do not optimize Laya, model routing, latency, or device behavior based solely on assumptions.

### Reason

Actual measurements should drive architectural changes.

---

## ADR-019 — Security Outside the Model

### Decision

Security controls must remain deterministic.

### Reason

The model should not be the final authority over its own permissions.

---

## ADR-020 — Controlled Capability Acquisition

### Decision

Future self-acquisition of capabilities must be controlled.

Requirements:

- validation
- sandboxing
- permissions
- versioning
- auditability

---

## ADR-021 — Tasks and Events Are Separate

### Decision

A task represents work.

An event represents something that occurred or should trigger behavior.

### Reason

Separating them simplifies orchestration.

---

## ADR-022 — User Does Not Select Execution Device

### Decision

ZENO should select an authorized device capable of performing an action.

### Reason

The user should interact with ZENO rather than manage infrastructure.

---

## ADR-023 — Phase 0 Must Remain Small

### Decision

Phase 0 is only the voice foundation.

### Reason

The first objective is proving the core loop.

---

## ADR-024 — Preserve the Future Without Implementing It

### Decision

Future architecture may be documented before implementation.

### Reason

Documentation provides direction without forcing premature complexity.

---

## ADR-025 — Top-Level Scaffold Exists From the Start

### Decision

The top-level folders (`apps/`, `services/`, `packages/`, `infrastructure/`, `docs/`, `tests/`) and their planned sub-folders exist as empty placeholders from the start.

Code is added to a folder only when the current task requires it.

Phase 0 code lives in the scaffold (`apps/mac/`, `services/core/`, `services/llm-gateway/`, `packages/contracts/`, `packages/shared/`) rather than a separate `src/` tree.

### Reason

Every piece of code has an obvious home from day one, which avoids a later move from `src/` into the long-term layout.

Placeholders cost nothing and do not authorize building the modules they name.

Folders under `services/` are modules of the modular monolith, not separate processes (ADR-008).

---

## ADR-026 — TypeScript / Node for Phase 0

### Decision

Phase 0 is implemented in TypeScript on Node.js, as a pnpm workspace.

### Reason

Matches the owner's existing projects and tooling.

Whisper.cpp runs as a local binary behind the STT adapter, so the language choice does not constrain speech recognition.

---

## ADR-027 — Push-to-Talk Input in Phase 0

### Decision

Recording starts and stops with a key (push-to-talk).

Wake-word detection ("Hey Zeno") is deferred.

### Reason

Push-to-talk is deterministic and needs no always-on listening, voice activity detection, or wake-word model.

---

## ADR-028 — Claude Is the First Provider

### Decision

The first LLM provider behind the LLM Gateway is Claude (Anthropic).

### Reason

One provider is enough to prove the loop. The gateway keeps it replaceable (ADR-002).

---

## ADR-029 — Local ONNX TTS: Kokoro-82M

### Decision

Initial TTS uses Kokoro-82M running locally on ONNX (via `kokoro-js` in Node), behind the TTS adapter.

The voice stack is:

```text
Whisper.cpp (local STT) → remote LLM (reasoning) → Kokoro ONNX (local TTS)
```

### Reason

Voice processing stays local; general intelligence does not need to be local (ADR-003).

ONNX models run on macOS, Windows and iOS, so the same TTS model works on every future ZENO node.

Kokoro gives near-natural voice quality at a small size.

### Alternatives Considered

- macOS `say`: zero setup, but macOS-only and low quality. Would force a second engine for Windows and iOS.
- Piper (ONNX): lighter and more voices, but flatter voice quality. Remains a drop-in fallback.
- TTS.cpp: promising, but newer and less proven. Can be evaluated later behind the same adapter.

---

## ADR-030 — Session-Only Conversation History in Phase 0

### Decision

Phase 0 keeps conversation turns in memory for the current session only.

Nothing is written to disk. History is lost when ZENO stops.

### Reason

Enables natural follow-up questions without introducing persistent memory, which is deferred to Phase 1 (ADR-015).

---

## ADR-031 — Gemini as a Second LLM Provider

### Decision

Gemini (Google, via the official `@google/genai` SDK) is supported alongside Claude, behind the same LLM Gateway.

`ZENO_LLM_PROVIDER` selects the provider (`claude` by default, or `gemini`). Only the selected provider's key is required. Default Gemini model: `gemini-3.6-flash` (changed from `gemini-3.5-flash` on 2026-10-01: measured 1.4–1.6 s per spoken reply versus ~9.5 s for 3.5 Flash that day).

### Reason

Proves the gateway is provider-independent (ADR-002) and gives a working path while one provider is unavailable (e.g. no credits).

Voice processing (Whisper, Kokoro) is local and exchanges only text with the Core, so it is unaffected by the provider choice (ADR-003).

### Notes

- On Google's free tier, prompts may be used to improve Google products. Since ZENO sends what the user says, the paid tier is preferable for private use.
- ADR-028 still holds: Claude remains the default provider.
- Free-tier limits are per model: about 20 requests per day and 5 per minute (measured 2026-10-01). Enough for testing, not for daily use; daily use needs billing enabled or Claude.

---

## ADR-032 — Whisper small.en with a Vocabulary Prompt

### Decision

The default speech-to-text model is `ggml-small.en.bin` (was `ggml-base.en.bin`). Whisper also gets an initial prompt built from `ZENO_STT_VOCABULARY`, a comma-separated list of names and places to expect (default: `ZENO`).

### Reason

The user found transcription noticeably wrong in real use, while speed was good. Benchmark on 2026-10-02 (8 spoken commands, 4 voices, recorded at the Mac mini's measured microphone level with room noise; details in `docs/stt-benchmark.md`):

| Model | Word errors | Time per command |
|---|---|---|
| base.en (previous) | 9.8% | ~270 ms |
| base.en + vocabulary | 4.9% | ~260 ms |
| small.en + vocabulary (chosen) | 2.4% | ~560 ms |
| large-v3-turbo q5 + vocabulary | 1.2% | ~1,380 ms |

small.en with the vocabulary prompt has about a quarter of the previous errors for about 0.3 s more per turn. large-v3-turbo was the most accurate but adds over a second, which matters more in a voice loop.

### Notes

- base.en remains available: set `ZENO_STT_MODEL=models/ggml-base.en.bin` for speed.
- The vocabulary prompt mainly fixes names (e.g. "Cartman do" → "Kathmandu"). Listing too many words can bias Whisper toward them; keep it to names actually used.
- Measured with synthetic voices; re-check with the user's own recordings when available.

---

## ADR-033 — Desktop Island Before Memory (Phase 0.5)

### Decision

A short phase, **Phase 0.5 — Desktop Island**, comes between Phase 0 (Voice Foundation) and Phase 1 (Memory).

It gives ZENO a permanent place on the Mac: a small panel hidden above the top-centre of the screen that appears on hover or while talking, and a push-to-talk key that works in any app.

The voice loop, Core and LLM Gateway from Phase 0 are reused unchanged. The phase adds a user interface and an input trigger, not new intelligence.

### Reason

After Phase 0, ZENO works only while its terminal window is focused, which makes it hard to use day to day.

Every later phase (memory, Mac tools, computer control) needs a place where the user talks to ZENO and sees what it is doing. Building that place first means later phases are tested the way they will be used.

### References

Ideas were taken from three open-source Mac apps. Each was read for its approach. No code is copied from GPL projects.

| Project | License | What ZENO takes |
|---|---|---|
| Vorssaint Utils | GPLv3, plus a trademark policy | Ideas only: a panel fully hidden above the screen edge, revealed by hovering after a short delay; dark rounded cards |
| Clicky (farzaa/clicky) | MIT | Push-to-talk on a held modifier pair (Ctrl+Option) through a listen-only event tap; the panel appears only while talking |
| Coucou (louis-cfm/coucou) | MIT code; name, character, icon and sounds are not licensed | How the panel window is built: borderless, above the menu bar, on every Space and over full-screen apps, never taking keyboard focus |

Not taken: Clicky's cloud speech services and analytics (ZENO keeps voice local, ADR-003); Coucou's Claude Code features and assets; Vorssaint's utilities.

### Alternatives Considered

- Go straight to Phase 1 (Memory) and keep the terminal: rejected. The terminal-only input is the main obstacle to daily use.
- Fold the island into a later phase: rejected. Later phases would be built and tested without the interface they will run in.

---

## ADR-034 — Native Swift Island, Node Runtime as Its Child Process

### Decision

The island is a native macOS app written in Swift (AppKit with SwiftUI views), in `apps/mac/island/`. Its job is display and input only.

The ZENO runtime stays in TypeScript (`apps/mac/src/`, ADR-026). The island app starts it as a child process (`node apps/mac/src/main.ts --island`). The two exchange JSON messages, one per line, over the child's standard input and output. The message format is in `docs/island-protocol.md`.

- The island sends commands: start talking, send, cancel, new conversation.
- The runtime sends events: state, microphone level, transcript, reply, notices and errors.

The island restarts the runtime if it exits unexpectedly, and stops it when the island quits.

`pnpm start` (the terminal interface) keeps working, for development and as a fallback.

### Reason

- Only native AppKit can reliably place a window above the menu bar, on every Space and over full-screen apps, without taking focus. It can also read global keys and mouse position directly.
- Keeping the runtime in TypeScript reuses all of Phase 0 and its tests. Whisper, Kokoro, the Core and the gateway do not change.
- Standard input and output is the simplest private channel. It needs no socket file and no port, and no other process can connect to it.
- Because the island app starts the runtime, macOS attributes the microphone to the island app. Its bundle declares the microphone usage, so the user sees one permission request from "ZENO".

### Alternatives Considered

- **Tauri or Electron with a web UI:** reuses TypeScript for the interface, but placing a window above the menu bar and reading global keys still needs native code. It also adds a large dependency (CLAUDE.md §18).
- **Rewrite the runtime in Swift:** discards working, tested Phase 0 code and the portable voice stack (ADR-029).
- **Local socket (as Coucou does):** suits separate processes that start independently. ZENO's island always starts the runtime itself, so a socket would only add a file to secure.
- **DynamicNotchKit (used by FluidVoice):** built for the notch area and cannot hide the panel fully off-screen. The Mac mini has no notch.

---

## ADR-035 — Global Push-to-Talk: Hold Ctrl+Option

### Decision

In the island app, the user holds **Ctrl+Option** to talk and releases to send. This works in any app.

- Press both keys: start listening. Interrupt ZENO if it is thinking or speaking.
- Release either key: send what was said.
- If any other key is pressed while both are held, the user was typing a shortcut (for example Ctrl+Option+Arrow). The recording is discarded and nothing is sent.
- Esc while listening cancels.

Keys are read with a **listen-only** event tap. It never blocks, changes or records keystrokes; ZENO only looks for the modifier pair. This needs the macOS **Input Monitoring** permission once. Without it, the island explains how to grant it, and hover plus click still work.

The key pair can be made configurable later. Ctrl+Option is the default.

This extends ADR-027. In the terminal interface, Space still toggles recording, because a terminal cannot detect a held key.

### Reason

Holding a key is the most natural push-to-talk and needs no wake word or always-on listening (ADR-027 still holds). A modifier pair rarely collides with typing, and the any-other-key rule handles the shortcuts that use it.

### Alternatives Considered

- A single function key (e.g. F5): easy to press by accident and awkward on compact keyboards.
- A toggle shortcut (press to start, press to send): works without holding, but is slower and less natural for short questions.
- `NSEvent` global monitor: needs the broader Accessibility permission instead of Input Monitoring.

---

## ADR-036 — Island Placement: Hidden Above the Screen, Revealed on Hover

> **Placement superseded by ADR-037** (2026-10-02): the island moved from the top-centre to the left edge, below the menu bar. The behaviour below (hidden when idle, revealed on hover, shown while talking, expanded on click) still holds.

### Decision

The island lives at the top-centre of the main display (the one with the menu bar).

- **Idle:** fully hidden above the top edge. Nothing on screen.
- **Hover:** when the pointer rests at the top edge near the centre for a short delay (default 0.25 s), a compact pill slides down. It hides again shortly after the pointer leaves.
- **While talking:** the pill appears by itself when push-to-talk starts. It stays through listening, thinking and speaking, then hides a few seconds after ZENO finishes.
- **Click:** the pill expands to show the current conversation and a "new conversation" button.

It does not depend on a camera notch, so it looks the same on the Mac mini and on notched MacBooks.

### Reason

Users can find it at a fixed spot without it taking space or attention when idle. Hover detection uses mouse-position events, which need no permission.

### Alternatives Considered

- Always-visible pill or menu bar icon: permanent clutter. A menu bar item may be added later for settings.
- Floating near the cursor (as Clicky does): useful for pointing at things on screen, which belongs to Phase 3 (Computer Control).

---

## ADR-037 — Island Placement: Left Edge, Below the Menu Bar

Supersedes the placement in ADR-036.

### Decision

The island lives at the **left edge of the main display, just below the menu bar**, instead of the top-centre.

- **Idle:** fully hidden past the left edge. Nothing on screen.
- **Hover:** when the pointer is pushed against the left edge in the band just below the menu bar for a short delay (0.25 s), the island slides in from the left. It hides shortly after the pointer leaves.
- **While talking, click and expand:** as in ADR-036. The expanded view grows downward and rightward from the same corner.
- It never covers the menu bar, so the Apple menu and the app menus stay reachable.

### Reason

- The top-centre is crowded: notch utilities, Dynamic-Island-style apps (FluidVoice is installed on this Mac), the camera notch on MacBooks, and macOS's own full-screen menu bar reveal all use it.
- The top-left corner itself belongs to the Apple menu, and screen corners are where macOS hot corners trigger. The band below the menu bar is free on this Mac: no hot corner at the top-left, Dock at the bottom, Stage Manager off.
- A screen edge is easy to hit: the pointer stops there, so a fast flick reaches it without aiming.

### Collisions avoided

- **Menu bar:** the hover band starts below it; the island is placed below `visibleFrame.maxY`.
- **Hot corner:** the band ends well short of the top corner.
- **Stage Manager and a left-hand Dock** also use the left edge. Both are off here. If either is on, the band is short (a few centimetres), so it overlaps them little; the reveal delay prevents reveals while passing.
- **Displays to the left:** with a display on the left of the main one, the pointer crosses instead of stopping at the edge. The island then only reveals on hover at the left edge of the whole desktop; this Mac's second display is on the right.

### Alternatives Considered

- **Top-left corner, covering the Apple menu while shown:** blocks the most-used menu exactly when the island is open.
- **Inside the menu bar, after the app menus:** the position changes with every app's menus, and many menu bar utilities live nearby.
- **Keep the top-centre:** collides with the apps above.

---

## ADR-038 — What the Island Shows and Controls

### Decision

The island has two sizes.

**Compact (on hover and while talking):** a dark glass card showing ZENO's live state with a microphone level meter: *Ready*, *Listening* (with the meter), *Transcribing*, *Thinking*, *Speaking*, or a problem in plain words. Nothing else, so it reads at a glance.

**Expanded (click the compact card):** a larger card with three tabs.

- **Conversation:** the current session's turns (session-only, ADR-030) and "New conversation".
- **Status:** the AI provider and model, the microphone, the last turn's timings (transcription, model, first sound), and the last error with its fix.
- **Settings:** choose the **AI provider and model** (Claude or Gemini, and which model). Only providers whose API key is present in `.env` can be chosen. The keys are never shown, sent to the island or written by it.

Choosing a model applies at once: the runtime switches its LLM adapter, and the conversation continues. The choice is saved in a small settings file (`config/island.json`, not in git) and used the next time ZENO starts, overriding `ZENO_LLM_PROVIDER` / `ZENO_LLM_MODEL` from `.env`.

**Look:** dark glass. It is translucent and blurs what is behind it, with rounded corners. It uses the system glass material on macOS 26+ and a dark blur on older systems.

### Reason

- A bare "Ready" pill is not a feature. The compact view stays focused on the one thing that matters while talking (is ZENO hearing me, and what is it doing). The detail lives one click away.
- The model is the setting changed most often: Gemini's free tier runs out daily, and Claude needs credits. Switching should not mean editing `.env` and restarting.
- Keeping keys in `.env` only means the island never handles secrets (SECURITY.md).

### Protocol

`docs/island-protocol.md` gains:

- an `info` event with the provider, the model, which providers are available (key present), and the models offered for each
- a `model.set` command (provider, model), answered by a new `info` event or an `error`

### Alternatives Considered

- **Show more in the compact view (model, microphone, timings):** too much to read at a glance. These details are kept in the Status tab instead.
- **Settings window or menu bar icon:** a separate place to look. The island is already where the user looks.
- **Microphone, voice and app-behaviour settings now:** not chosen for this phase; they can join the Settings tab later.
- **Editing `.env` from the island:** would put the island next to secrets.

---

## ADR-039 — Learning From FluidVoice and Vorssaint Without Copying Code

### Decision

ZENO's dictation follows the design of FluidVoice, and its settings and shortcuts follow the design of Vorssaint. ZENO **re-implements these designs in its own code**: no source files, functions or assets are copied from either project.

- Studying their source to learn how something works is allowed. Notes live outside the repository.
- Code is written from the design description, not from their code.

### Reason

Both projects are GPL-3.0. Copying their code would make ZENO GPL-3.0 too, which Keshab chose not to do (2026-10-02). Their designs are not covered by the licence: the same behaviour and look can be built independently.

---

## ADR-040 — Settings Live in the Island; Shortcuts Are Configurable

Extends ADR-038; replaces "configurable hotkeys deferred" in TASK.md.

### Decision

Clicking the island expands it into a panel with **Conversation**, **Status** and **Settings**. Settings is where everything the user changes lives:

- **AI:** provider and model (switched live)
- **Shortcuts:** each action has its own changeable shortcut, recorded in place
  - **Talk to ZENO:** hold to talk, release to send (default: hold Ctrl+Option)
  - **Dictate:** hold to dictate, release to type the text into the current app (default: hold Right Option)
  - **Show or hide the island** (default: Ctrl+Option+Z)
  - **Cancel:** stop listening or speaking (default: Esc, only active while ZENO is listening or speaking)
- **Pet:** on or off
- **Sounds:** start and stop sounds on or off

**Storage:** the island's own settings are in `UserDefaults` (domain `dev.zeno.island`), one key per setting, with defaults registered at launch. Runtime settings (provider, model) are saved by the runtime in `config/island.json` (ADR-038). API keys stay in `.env` only.

**Text fields and the recorder:** the expanded island may take keyboard focus without activating ZENO (a non-activating panel that becomes key only after a click). The app you were using stays active. Hover never takes focus.

**Shortcut engine:**

- Chorded shortcuts with a normal key (e.g. Ctrl+Option+Z): Carbon `RegisterEventHotKey`, which needs no permission
- Modifier-only and hold shortcuts (Ctrl+Option held, Right Option held): a listen-only `CGEventTap` on modifier changes and key presses, which needs Input Monitoring. A modifier-only shortcut fires only on a clean press: any other key while held cancels it
- While the recorder is recording, ZENO's own shortcuts are paused

**Signing:** macOS ties permissions (Input Monitoring, Accessibility, Microphone) to the app's signature. An ad-hoc signature changes with every build, so permissions would be asked for again after each rebuild. ZENO is signed with a local self-signed certificate ("ZENO Local Signing") created once on this Mac.

### Reason

Keshab wants settings in the island and changeable shortcuts (2026-10-02). Vorssaint shows that a non-activating panel can still accept keys after a click, which makes settings inside the island practical.

### Alternatives Considered

- **A separate settings window:** another place to look; Keshab asked for settings in the island.
- **A shortcut package (e.g. KeyboardShortcuts):** an extra dependency, and it does not support hold or modifier-only shortcuts.

---

## ADR-041 — Dictation: Speak, and the Text Is Typed Into the Current App

### Decision

A second voice mode next to "Talk to ZENO": **Dictate**. Hold the dictation shortcut, speak, release: the transcript is inserted into the app and text field you were in. No AI reply and no speech.

- **Transcription:** the runtime's Whisper (Phase 0), unchanged. The island shows Listening with the waveform, then Transcribing.
- **Insertion (in the Swift app):** the clipboard is saved, the text is put on it (marked as transient, so clipboard managers ignore it), Cmd+V is sent to the app, and after half a second the original clipboard is restored unless something else changed it in the meantime. This needs Accessibility permission.
- **Secure input** (password fields): nothing is pasted; the text is left on the clipboard and the island says so.
- **Silence check:** a short clip with no speech is dropped instead of transcribed, so an accidental tap does not type text Whisper made up.
- Spoken punctuation and filler words are left for a later task.

**Protocol:** `dictation.start` / `dictation.stop` / `dictation.cancel` commands; a `dictation.text` event with the transcript; the island reports whether the text was inserted.

### Reason

Keshab uses FluidVoice and wants the same in ZENO (2026-10-02). The runtime already transcribes well; what is new is putting the text where the user is typing, which belongs in the signed Swift app.

### Alternatives Considered

- **Typing the text as key presses:** slower for long text and breaks with some keyboard layouts; kept as a fallback for apps where pasting fails.
- **Accessibility API insertion:** not supported by many apps.

---

## ADR-042 — A Pet That Walks Along the Bottom of the Screen

### Decision

An optional animated character walks along the bottom of the main display, just above the Dock, and reacts to ZENO:

- **Idle:** walks back and forth, sometimes stops; naps after a few minutes with no activity
- **Listening:** stops and perks up
- **Thinking:** thinking dots
- **Speaking:** talks (mouth moves)
- **Problem:** looks worried

It is drawn in code (SwiftUI shapes), so no image assets. It lives in its own transparent, click-through window that never takes focus. It can be turned off in Settings.

The character is **Wisp**, chosen by Keshab (2026-10-02) from three drawn options (Wisp, a robot, a cat): a soft, glowing, pale-blue spirit with a rounded body and a wavy hem. It floats and bobs rather than walking with legs; its glow pulses faster while listening; it blinks, closes its eyes and shows floating "z"s when napping, shows thinking dots, and opens its mouth with small sound waves while speaking.

### Reason

Keshab asked for a pet that plays on the screen (2026-10-02). It makes ZENO's state visible without looking at the island.

### Update (2026-10-02): Wisp can be moved anywhere (ADR-043)

Keshab could see Wisp but wanted to place it himself, anywhere, so he never misses it (a hold-to-talk with no visible sign left him unsure anything was listening).

- **Drag it anywhere, on any display.** It dangles from its head while held and puts its feet down where it is dropped.
- **Parked:** dropped anywhere except the Dock walkway, it stays exactly there (it still reacts, blinks and naps) and the spot is remembered across launches (`zeno.petSpot`).
- **Walkway:** dropped within 44 pt of the Dock walkway on the primary display, it wanders again from that spot.
- **Home:** double-click, or right-click → "Back to the Dock", sends it back to the walkway. Right-click → "Hide Wisp" turns the pet off.
- **A display that is unplugged:** a parked Wisp whose display is gone comes home, so it is never lost off-screen.
- **Still never in the way:** the window is only as big as Wisp and listens to the mouse only while the pointer is over its body. Clicks anywhere else pass through to the app underneath. It never takes focus.
- **Reactions while held:** a reaction that starts while Wisp is held shows when it is put down.

---

## ADR-047 — Dictation Runs Inside the App: Parakeet, a Prepared Microphone, No Runtime

Date: 2026-10-02. Replaces the "Transcription" and "Protocol" parts of ADR-041; its insertion rules still stand.

### Decision

Dictation runs entirely in the Swift app, with no round trip to the Node runtime:

- **Engine:** Parakeet TDT v3 on the Apple Neural Engine, through FluidAudio (Apache-2.0, pinned to 0.17.5). It is loaded at launch, so a dictation never waits for it. Whisper stays the engine for the voice conversation.
- **Microphone:** a Core Audio input is *prepared* at launch (nothing is recorded, the microphone indicator is off) and started when the shortcut is held. Measured on this Mac: first samples after about 60 ms, against about 165 ms with AVAudioEngine and 200–550 ms starting ffmpeg. Nothing from before the key press is kept.
- **Shortcut:** hold **Right ⌘ + Right ⌥**, the same keys as FluidVoice (Keshab's choice). Dictation arms after 80 ms, Talk after 200 ms, so the first words are kept.
- **Text:** one pass over the whole recording. Clips under 1 s are padded with silence; clips with no speech are dropped before the model sees them. A spelling list (`~/Library/Application Support/ZENO/vocabulary.txt`, plus a built-in "zino" → "ZENO") fixes names after transcription.
- **Insertion:** remember the app in front when dictation starts; wait until ⌘ ⌥ ⌃ ⇧ are physically up (otherwise the paste becomes another shortcut); write into the field through Accessibility and check it changed; otherwise paste with ⌘V and restore the clipboard. A password field, or no Accessibility permission, leaves the text on the clipboard and the island says why.
- **Spoken punctuation (English):** "comma", "question mark", "new line", "new paragraph", "full stop" and the like become marks; "period" counts only as the last word.
- **Independent of the conversation:** dictation needs no model key and no network, and works while the conversation feature is off. It refuses to start while a conversation turn is in progress.

### Reason

FluidVoice's own log of Keshab's sessions showed about 65 ms to start, 56 ms to transcribe and 103 ms from release to text. The three causes were a prepared microphone, a model kept loaded and Parakeet; ZENO copied none of its code (GPL-3.0), only these ideas (`docs/dictation-research.md`).

### Results (Keshab's own use, 8 dictations)

All typed. Key release to text typed: about 0.6 s before the paste no longer waits for the clipboard restore (it now happens in the background); transcription 67–337 ms. Keshab: "the dictations has gotten very better... satisfactory for now". Not yet measured against FluidVoice on the same sentences.

### Known issues

- **Clipping:** all 8 recordings reached full scale. The webcam microphone has no gain control in macOS, so the level cannot be lowered there. Parakeet coped, but quieter input would be safer.
- **Accidental taps:** four taps of 0.05–0.18 s were correctly dropped as too short.
- **Model copies:** ZENO's Parakeet v3 files are APFS clones of FluidVoice's, so they share disk space.
- **English only:** Parakeet v3 cannot read Japanese, Hindi or Nepali (tested: it wrote romaji, or nothing). A Whisper large-v3-turbo path was designed and measured (Japanese near-exact, Hindi usable), then dropped at Keshab's request: ZENO keeps Parakeet v3 only, like FluidVoice. Parakeet v2 was tried and also dropped.
- **Not built:** other languages (Keshab chose to keep Parakeet v3 only), a way to edit the spelling list in Settings. Toggle mode, the live preview and filler removal are in ADR-050.

### Alternatives Considered

- **Whisper through the runtime (ADR-041):** about 1 s to transcribe and a start that lost the first words. Kept as the voice-conversation engine only.
- **Keeping the microphone recording all the time to catch the first words:** rejected for privacy; a prepared device starts fast enough.
- **Parakeet in a separate helper process:** more moving parts for no gain, since the app is already Swift.

## ADR-050 — Dictation Modes, Live Preview and Wisp's Speech Bubble

Date: 2026-10-02. Extends ADR-047 and ADR-042. Keshab asked for FluidVoice's features in ZENO's own code (it is GPL-3.0, so nothing is copied) and for Wisp to hold the island.

### Decision

- **Start and stop modes** (Settings → Dictation, `DictationMode`): *Hold* (hold, speak, let go), *Tap* (tap to start, tap to finish) and *Hold or tap*, the default. In Hold or tap, a press shorter than 0.4 s starts a hands-free dictation and the next tap finishes it; a longer press is hold-to-talk. Esc cancels in every mode. A hands-free dictation stops by itself after 5 minutes, and is dropped after 20 s if nothing but silence was heard.
- **Live preview:** while listening, every 0.6 s the growing recording (its last 15 s, Parakeet's limit) is read again and the newest words are shown, once there is 1 s of speech and 0.4 s of new audio. Parakeet reads whole clips, so this is the only way to preview without a streaming model. The typed text always comes from one final pass over the whole recording.
- **Filler words:** "um", "uh", "erm", "hmm" and similar are dropped before spoken punctuation is applied. A filler that ends a sentence hands its full stop to the word before; one that opens the text hands over its capital. Whole words only.
- **Wisp's speech bubble:** while Wisp is on screen and the island is closed, status (state, live words, level meter, outcome) appears in a bubble above Wisp, wherever it is parked, instead of at the left edge. The bubble is centred on Wisp, slides sideways to stay on its display while its tail keeps pointing at Wisp, and flips below Wisp near the top of the display. It is a separate click-through window above Wisp, so it never takes focus or blocks clicks. With Wisp hidden, or while the expanded island is open, the left-edge card works as before. The island's own Esc, shortcuts and expanded view are unchanged.

### Scope closed

Keshab liked these features and told us to let the rest of the FluidVoice list go (2026-10-02): dictation history, paste-last-dictation, the paste-landed check, AI cleanup, rewrite mode and per-app tone are **not planned**. Dictation is finished unless he asks for something new.

### Reason

A tap-to-toggle mode removes the need to hold two keys through a long paragraph. The preview shows the microphone is live and the words are right before they are typed. The bubble keeps the feedback next to the character Keshab can drag anywhere, so it cannot land where he does not look.

### Alternatives Considered

- **A pill above the Dock, or keeping the left edge:** shown as mock-ups; Keshab picked the bubble.
- **A streaming model for the preview:** more models and more memory for a feature that only shows words.
- **Typing the preview text live into the field:** rejected; corrections would fight the app's undo and the caret.

### Verification

Unit tests cover the tap and hold rules, filler removal, preview timing and text, the saved settings and the bubble placement (227 Swift tests). On the real screen, with a scripted dictation and no microphone or keys, the bubble window appeared above Wisp (layer above Wisp's), slid to stay inside the display with its tail on Wisp, followed a state change and disappeared after the outcome; the left-edge card stayed out. Not yet checked by hand: a real dictation with the live preview, the tap rules on the real keys, and the bubble while Wisp is dragged.

---

## ADR-051 — Wisp Holds the Island: Click to Open, Tuck Away When Idle

Date: 2026-10-02. Extends ADR-050 and ADR-043; replaces the left-edge card whenever Wisp is on.

### Decision

- **No more card at the left edge while Wisp is on.** The left edge is where other apps put their own hover panels, and the island collided with them. With Wisp on, the island never slides out of the left edge: status shows in Wisp's speech bubble (ADR-050) and the features panel opens beside Wisp. With Wisp switched off in Settings, the left-edge card works exactly as before.
- **Click or double-click Wisp to open the features panel** (Conversation, Status, Settings). It opens above Wisp, or below it near the top of the display, slides sideways to stay on screen, and follows Wisp if it is dragged. It grows out of Wisp and folds back into it. Another click on Wisp closes it; a double-click always leaves it open. Esc, a click in another app, the collapse button and ⌃⌥Z close or toggle it as before. Wisp stands still while the panel is open.
- **Double-click no longer sends Wisp home.** That moved to the right-click menu ("Back to the Dock"), which also gets "Tuck away".
- **Tuck away after a timeout** (Settings → Extras → Wisp → "Tuck away after": Never, 15 s, 30 s, 1 min, 5 min; default 1 min). After that long with no click, hover, shortcut or change in ZENO's state, Wisp slides to the nearer side edge of its display, at the height it was at, turned on its side so only its head shows past the edge. It never hides while dragged, reacting, holding the panel open, or under the pointer.
- **Coming back out:** pointing at the head slides it out a little more; a click opens the panel (Wisp stands up where it was). A shortcut, a dictation or anything ZENO has to show brings it out at once, with its bubble.
- **Two displays:** an edge that touches another display at Wisp's height is skipped, so Wisp is never half on the wrong screen. If neither edge is free it stays where it is.

### Reason

Keshab: the island collided with apps that use the display's edge, so Wisp should hold it, and Wisp should step out of the way when idle.

### Alternatives Considered

- **Keeping the edge card as a fallback while Wisp is on:** rejected; that is the collision this removes.
- **Hiding Wisp completely when idle:** rejected; a visible head shows ZENO is alive and gives something to point at.

### Verification

Unit tests cover the edge choice (nearer edge, neighbouring displays, neighbour above or at a different height), the idle timer (timeout, never, blocked), the click rules and the panel's placement (241 Swift tests). On the real screen, with two displays: Wisp tucked at the left edge, its window moved from x=1600 to x=-34 and its head stayed inside the display, the nearer right edge being skipped because it touches the second display; a dictation brought it back out with the bubble; real clicks on Wisp opened and closed the panel. Not yet checked by hand: the look of the tuck and the panel's grow-out animation, the panel following a dragged Wisp, and the hover nudge.

---

## ADR-052 — More Control in Settings: Wisp, Speech Bubble, Panel

Date: 2026-10-02. Extends ADR-051 and ADR-040.

### Decision

Settings gets three new cards, each a few rows of chips (never sliders: a few named choices read faster and are easier to test). Every change applies at once, with no restart, including while the panel is open. Defaults are exactly the old look.

- **Wisp:** Show Wisp; Size (Small 44, Medium 56, Large 72, Huge 92 pt); Glow (Off, Soft, Normal, Bright); Movement (Stay put, Calm, Normal, Lively); Falls asleep after (Never, 1, 3, 10 min); Tuck away after (existing).
- **Speech bubble:** Stays (1, 2, 4, 8 s after something finishes); Size (Small, Normal, Large); Background (Clear, Normal, Solid).
- **Panel:** Size (Compact 340×400, Normal 380×460, Large 440×580); Background (Glass, Solid).
- **Extras:** Sounds, and "Reset look and behaviour", which puts Wisp, bubble and panel back to defaults and leaves shortcuts, dictation, model and the on/off switches alone.

Everything around Wisp scales with its size: the click target, how far its head sticks out when tucked, and how high the bubble sits. Gesture choices ("which gestures it makes") are not built: Wisp has no peace-sign or pointing pose, because the redraw from the figurine image was dropped (see Reason).

### Reason

Keshab asked for more control in Settings. A new look for Wisp from a pasted figurine photo was also asked for, and then dropped by him ("lets not do image to 3js"), so the character's drawing is unchanged.

### Alternatives Considered

- **Sliders:** rejected; they need a number to mean something, and each of these has three or four useful values.
- **A separate Appearance window:** rejected; settings live inside the panel (ADR-040).

### Verification

241 → 252 unit tests: defaults equal the old look, choices survive a restart, an unknown stored value falls back to the default, changes count as changes, reset leaves the rest alone, Stay-put Wisp never moves and never naps with Never, Lively covers more ground than Calm, nap time follows the setting, tucking depth scales with size. On the real screen a demo changed settings while ZENO ran: Wisp's window went 84 → 138 → 66 pt as Medium → Huge → Small; the bubble became 432×96 pt (Large) with the tail clearing a huge Wisp's head; the panel resized in place from 380×460 to 440×580 to 340×400 while open. Keshab was also seen changing Wisp's size from the panel while the app ran. Not checked by eye: how each size looks side by side, and Clear and Solid backgrounds over a busy wallpaper.

---

## ADR-053 — Wisp Hides Leaning 35–50° With a Hand on the Edge

Date: 2026-10-02. Replaces the 90° sideways pose from ADR-051.

### Decision

When Wisp tucks away it no longer lies on its side. It stays on its feet, which sit 4 pt past the display edge, and leans from the feet toward the display. The body is cut off by the edge, so what shows is the head, both eyes glancing into the display, and a small three-finger hand lying over the edge. Pointing at Wisp slides it further out.

- **Hiding lean** is a new Settings → Wisp row: Slight 35°, Normal 42° (default), Deep 50°.
- The hand is drawn level with the edge whatever the lean (it counter-rotates), and the eyes and mouth shift toward the display as Wisp leans in.
- The click target now follows the leaning head, not a sideways body.

### Reason

Keshab: the 90° turn should be 35–50° and read as a "hide" posture, taking inspiration from the figurine reference sheet he pasted. The sheet has no peeking pose, only standing, looking-down, sleeping and jumping, so the lean and the hand are my reading of "peeking round a corner", not a copy of any pose in it.

### Follow-up (same day): 35% longer

Keshab asked for the hiding length to be 35% longer. Feet moved from 4 pt past the edge to 6 pt inside it, so the head sticks out 29 → 39 pt at the Normal lean (+34.5%, measured on the render; 26 → 36 and 31.5 → 41.5 at Slight and Deep). The hover nudge is 4 pt: anything larger pulled the body off the edge and left the hand holding on alone. The 35% applies to the resting pose; the hover nudge is not 35% longer.

### Verification

252 → 256 unit tests (lean stays in 35–50°, the pose follows the lean, feet sit just past the edge on both sides). Gallery render and real-screen pixels (second display's right edge, three leans): head tipped into the display, body cut off, hand at the edge, leans visibly different. Vision estimates of the real angles ran about 10° under the setting (15/25/35° against 35/42/50°) but are ±5° on a blurry crop; not measured another way.

---

## ADR-054 — Voice Computer Control Through Cua, and Pointing Second

Date: 2026-10-02. Status: planned, not started. Keshab chose this order ("first voice computer control through Cua, pointing second"), which moves part of Phase 3 ahead of the rest of Phase 0.5.

### Decision

ZENO will act on the Mac by voice command ("open Safari and search for X") through **Cua Driver** (`cua-driver`, MIT licence, `github.com/trycua/cua`), not through code written from scratch.

- **Engine.** `cua-driver mcp` is started by the runtime when a computer task begins and stopped when it ends. It reads the target app's Accessibility tree and acts on numbered elements (click, type, set value, hotkey, scroll, menus, drag, windows, screenshots). It works without bringing the app to the front or moving the user's cursor.
- **Where it lives.** A `computer` tool in `services/tool-engine/` (empty today). `services/core` gains tool calling. The model sees the tool; only the tool engine talks to Cua.
- **Models. Open.** The plan was Claude (best at choosing the right element), but Keshab decided on 2026-10-02 to skip the Anthropic pay-per-use plan for now, and the key in `.env` has no credit. So the model for computer control is undecided. The tool-calling code is provider-neutral: Claude and Gemini adapters both pass tools. Gemini Flash-Lite and Flash called `current_time` correctly on the real API (Task 0.6.1); whether they pick the right element on screen is untested. Until a model is chosen, computer control cannot be run live. Whichever model is used, ZENO refuses computer tasks on a model it has not been told can do them, instead of trying.
- **Approval.** ZENO asks, with the action named in Wisp's bubble, before anything that sends, buys, deletes, submits a form or changes an account. Rules are deterministic code in the tool engine, not the model's judgement (SECURITY.md).
- **Stop.** Esc or ⌃⌥Z ends the run at once. Every action is written to `logs/zeno.log`.
- **Untrusted content.** Text read from apps and web pages is data. It cannot change what ZENO does or approve anything. ZENO never types into password fields.
- **Wisp shows the work.** Each step appears in the speech bubble; Wisp is the visible actor (ADR-050). Cua's own agent cursor stays off.
- **Telemetry.** Cua's product telemetry is turned off (`cua-driver telemetry disable`, done 2026-10-02). ZENO also sets it off in the environment it launches Cua with, so an update cannot turn it back on silently.
- **Allowlist (ZENO code, not the model).** The model is offered only: `list_apps`, `list_windows`, `get_window_state`, `click`, `type_text`, `press_key`, `hotkey`, `scroll`, `invoke_menu`, `verify_state`, and (added 2026-10-03, Task 0.6.5) `set_value`, which writes a slider, stepper or menu choice directly instead of clicking toward it; it follows the same rules as click and type (blocked apps, approval labels, no secret fields). Left out until a task needs them: `clipboard_read` and `clipboard_write` (the read returns privacy-sensitive text), `set_window_frame`, `drag`, and every cursor tool. After an action, ZENO calls `verify_state` so it can say whether it worked.
- **Cua's permission mode.** Started with `CUA_DRIVER_PERMISSION_MODE=standard`. Never `unrestricted` or `--dangerously-bypass-approvals`, and never `--grant existing-profile` (it lets Cua attach to Keshab's logged-in browser). Cua draws no approval dialog of its own, so approval is ZENO's job (above). Cua's docs say the driver only protects against an agent limited to its protocol, which is why the allowlist lives in ZENO.
- **Left out on purpose.** The `cua-perception` extension (its icon detector is AGPL-3.0) and the nightly "Computer History" preview.
- **Permissions.** ZENO still asks for Microphone and Input Monitoring only. Cua holds Accessibility and Screen Recording itself (`com.trycua.driver`, granted with `cua-driver permissions grant`, which needs Keshab at the screen). SECURITY.md §Permissions ("Microphone and Input Monitoring. Not Accessibility, Screen Recording…") must be updated when Task 0.6.2 lands.
- **Pointing (second).** Once the model can read the screen, Wisp flies to a thing it names, in the way Clicky's `[POINT:x,y:label]` tag does. The screenshot stays on the Mac and is sent only on turns where it can help. Needs Screen Recording.

### Reason

- Read on 2026-10-02 from a clone of `trycua/cua` (MIT; the driver is `libs/cua-driver`, MCP over stdio since 0.28.0, which matches the installed 0.28.2). Cua has no approval dialog and no model of its own, so ZENO adds both.
- The original Clicky's computer control ran through Cua; its remaining files are in `~/Library/Application Support/Clicky`. The public repo (`farzaa/clicky`, last commit 2026-04-27) and the Raphael fork have **no computer-control code**, only screen reading and the pointer, so there is nothing to take from GitHub.
- `cua-driver` 0.28.2 is already installed on this Mac, and Hermes's macOS skill uses the same engine.
- Phase 3 was deferred (TASK.md §4). Keshab asked for it now. Phase 0.5.9 still has to pass first, because both features need the AI conversation switched on (`ZENO_VOICE_ONLY=1` is a test switch; normal runs already use the AI).

### Not decided yet

- "So it learns": whether Keshab means the pointer teaching him, or ZENO remembering what it got wrong. Left out until he says.
- How approval is spoken or clicked (bubble buttons, voice "yes", or both).

## ADR-055 — Claude on the User's Own Plan, Through the Claude Agent SDK

**Status:** Accepted (2026-10-03)

**Context.** Computer control makes several model calls per task. Through the API that bills per token; Keshab already pays for a Claude plan and wants to use it. Anthropic's docs (Legal and compliance; Agent SDK overview) say third-party apps may not offer claude.ai login or plan rate limits to their users, may not collect or store claude.ai credentials, and that this does not prevent a user signing in to the unmodified Claude Code binary with their own plan. The OpenClicky project does exactly that: its Node bridge runs the SDK, which runs the user's own `claude`.

**Decision.** Add a provider "Claude (my plan)" (`claude-plan`) next to "Claude" (API key) and "Gemini".

- It runs `@anthropic-ai/claude-agent-sdk`, which starts the user's own signed-in `claude` program. ZENO never reads, stores, copies or sends a login or token. It has no key: it is available when `claude` is found (`ZENO_CLAUDE_PATH`, `~/.local/bin`, Homebrew, PATH).
- **Single user only.** It is for one person on their own Mac. If ZENO is ever shared, this provider must be removed or replaced by API keys.
- **It must never silently bill per token.** `claude` starts with every `ANTHROPIC_*` variable, cloud-provider switch (`CLAUDE_CODE_USE_*`), OAuth variable and other providers' keys removed. A run stops at once if Claude Code reports an API key as its credential (`apiKeySource` other than `none`/`oauth`), and when it reports it is using "extra usage" beyond the plan.
- **Nothing of Claude Code's own.** No built-in tools (`tools: []`), no settings files, and `strictMcpConfig: true`, so the account's claude.ai connectors (Drive, Supabase) are not loaded: they cost about 40 000 tokens a request and would let Claude reach other services.
- **ZENO keeps the safety.** Claude Code runs the tool loop, but ZENO's own `computer` tool is given to it as an in-process server (`createSdkMcpServer`), so each call goes back through ZENO's tool engine: approvals, blocked apps, secret-field refusal and logging are unchanged, and the island still shows steps and the approval card. Only that tool is allowed (`allowedTools`).
- A failure after a tool has acted is never marked retryable, because a retry would do the task twice.
- Plan use (5-hour and 7-day, and whether extra usage is on) goes in the log as `plan.usage`, so what ZENO costs the plan is visible.

**Consequences.** Each request starts a `claude` process, which is slower than a direct API call. Plan limits are shared with the user's own Claude use. The Hermes project has reports of this kind of setup being billed as extra usage anyway, so the guards above are tested (fake SDK) and the first live runs were checked against the plan's own usage report. If Anthropic changes the terms, the provider can be removed without touching the rest of ZENO.

---

## Final Architectural Principle

> Preserve the future without prematurely implementing it.
