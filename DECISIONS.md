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

## ADR-056 — The Panel Lives in the Menu Bar; Mac Work Shows in a Strip Above the Dock

**Status:** Accepted (2026-10-03). Replaces the panel placement of ADR-037/ADR-051 and the bubble/card placement of ADR-054 while ZENO works on the Mac.

**Context.** Keshab's end-to-end check (Task 0.5.9) found two faults with one cause: everything was attached to Wisp. Opening the panel beside Wisp moved and froze Wisp, and the panel jumped with it ("Wisp positioning goes haywire"). When Wisp flew to point at something near a corner, its 340-point status bubble and the approval card had no room, so Wisp stood in awkward places or the bubble covered the thing pointed at.

**Decision.** Wisp only walks, reacts and points. Everything else gets a fixed home.

- **Menu bar.** ZENO gets a menu-bar icon (`NSStatusItem`) whose symbol and colour follow ZENO's state. A click opens the panel (Conversation, Status, Settings) just below the icon, like Wi-Fi or Control Centre; a click outside, Esc, the shortcut or a second click closes it. Right-click: Open ZENO, Show Wisp, Quit ZENO. Clicking Wisp opens the same panel in the same place. The panel never moves or freezes Wisp. The left-edge hover band (ADR-037) is removed; without Wisp, the compact status card shows under the icon during a turn.
- **Work strip.** From ZENO's first action on the Mac (a step, a point, or an approval request) until the turn ends, a slim strip shows at the bottom centre of the main display, above the Dock and Wisp's walkway: the current step and a Stop button (the same as Esc). An approval request grows the strip with what ZENO wants to do, why, and Decline / Allow. It lingers briefly after the turn so the outcome can be read, and never takes focus, so the app being controlled keeps it.
- **Pointing.** Wisp flies to the target and shows only a short label pill beside it (the model's label, or "Here"). Wisp's status bubble is not shown while the strip is up or Wisp is pointing, so nothing covers the target.
- Wisp's status bubble stays for ordinary talk and dictation.

**Consequences.** The panel has one place, so it can never push Wisp or be pushed off a display. The approval card no longer depends on where Wisp is. The icon takes a little menu-bar space. The Wisp-anchored approval card and the left-edge island code are removed.

---

## ADR-057 — Three Looks, Chosen in Settings

**Status:** Accepted (2026-10-04). Extends ADR-038 (dark glass) and ADR-042 (Wisp's look); keeps ADR-056's layout.

**Context.** Keshab asked for a makeover of the whole app, island to Wisp. Three directions were mocked up on the same ADR-056 layout (`sketches/makeover/`): *Quiet Native* (dark glass, one teal accent, the ghost refined), *Luminous* (near-black glass, a cyan-to-violet gradient, Wisp as an orb of light) and *Warm* (light paper glass, a coral accent, a character with a face). Shown the three, Keshab chose to keep all of them, switchable in Settings.

**Decision.**
- **Two independent settings** under Settings → Appearance: **Theme** (Quiet Native, Luminous, Warm) for every surface (panel, status card, bubble, work strip, point label) and **Wisp** (Ghost, Orb, Companion) for the character. Any theme goes with any Wisp; both apply instantly and are kept with the other look settings. Defaults: Quiet Native and Orb (the mix recommended at review).
- **One palette per theme** (`ThemePalette`, in the core so it is tested): surface, text levels, fills, accent (or gradient), live / attention / problem / success colours and corner radii. Views read the palette from the environment and use no literal colours, so a theme is data, not code paths.
- **Readability is tested**, not eyeballed: body, caption and button text meet WCAG AA (4.5:1) on every theme's surface (`ThemeTests`). This forced Warm's coral, amber and caption grey darker than the mockup.
- **One Wisp view, three bodies**, with the same moods, motion, hiding pose and size. Moods are shown by body, light and face, never stickers: the orb's light changes (teal listening, an aurora thinking, amber for a problem, dim napping) and it stays round when carried (a stretched sphere reads as a scaling bug).
- **Settings rebuilt as pages** (Appearance, AI model, Shortcuts, Dictation, Wisp, Speech bubble, Panel, General), each row showing its current value. Controls fit the setting: switches for on/off, a segmented picker for two to four short choices, a menu for longer lists; the AI model is a Provider menu and a Model menu instead of a wall of chips. Size words are Small / Medium / Large everywhere.
- **Conversation**: ZENO's replies are plain text beside a small Wisp, your words in a bubble; turn timings show only on hover.

**Consequences.** Three looks to keep working: a new surface must use the palette, and the gallery renders every theme and Wisp style (`9-*`, `10-*`) for review. The orb and companion are new characters, so their hiding pose and moods need Keshab's look on the real desktop.

---

## ADR-058 — Memory v1: Facts the User Asks ZENO to Keep (Phase 1)

**Status:** Accepted (2026-10-04). First step of Phase 1 (Memory); follows ADR-015 (memory is not conversation history) and SECURITY.md §17.

**Context.** ZENO forgets everything when it quits. Keshab asked to keep building past the desktop phase. The smallest useful memory is the one a person expects from an assistant: "remember that…", "what do you know about…", "forget that…", and ZENO using what it knows without being asked.

**Decision.**
- **Only what the user asks to keep.** ZENO saves a fact when the user asks it to remember something, or states a lasting personal fact and agrees when ZENO offers. Conversation turns are never stored automatically (ADR-015).
- **Local and private.** One SQLite file on this Mac (`data/memory.db`, gitignored; Node's built-in `node:sqlite`, no new dependency). Nothing is sent anywhere except, as context, to the model already in use.
- **Every memory has** (SECURITY.md §17): an *owner* (the single local user for now), a *scope* (`personal`), *provenance* (how it arrived: voice or text, the request id, the time), and a *lifecycle* (forgotten on request, which deletes the row; no soft delete).
- **Three tools** through the Tool Engine: `remember` (save one short fact), `recall` (search what is kept), `forget` (delete by id, after recall found it). The model chooses them; the tools validate input like any other.
- **Known facts in every request.** The Core asks a context provider for what is relevant and adds it to the system prompt: up to 12 memories, the newest and those matching the request (full-text search), each with its id, so the model can use or forget them. If none are kept, nothing is added.
- **Limits.** One memory is at most 300 characters; at most 500 are kept, and the store refuses more rather than dropping old ones silently. Logs record counts and ids, never memory text.
- Off with `ZENO_MEMORY=0`.

**Consequences.** ZENO remembers across restarts. The model sees kept facts, so a fact the user wants private from the model should not be told to ZENO; Settings will list and delete memories (next task). Automatic extraction, summaries, embeddings and knowledge (documents) stay deferred.

---

## ADR-059 — Conversation Notes and Offering to Remember (Phase 1)

**Status:** Accepted (2026-10-04). Extends ADR-058.

**Context.** After Task 1.1 ZENO kept facts it was told to keep, but "New conversation" or a restart still lost the thread ("what were we planning?"), and facts mentioned in passing were lost unless the user said "remember".

**Decision.**
- **Notes, not transcripts.** After each reply, the same model writes ZENO's own note about the conversation in the background: at most two sentences (what the user wanted, what was decided, what is open). One note per session, rewritten as the conversation goes on. The conversation itself is never stored (ADR-015 holds). A note of NOTHING (only a greeting or a one-off question) is not kept.
- **Off the reply path.** The note is written after the reply is returned, never delaying it. Updates queue one at a time; a newer conversation replaces a queued update; failures are logged (`episode.failed`), never shown. The summary request carries no tools, so it can never act.
- **Used when asked about.** The newest three notes from other sessions go into the system prompt, marked "use them if the user refers back; do not bring them up unprompted". The newest 50 are kept; older ones are deleted.
- **Offer, never assume.** When memory is on, the prompt tells ZENO to offer to remember a lasting personal fact mentioned in passing, and to keep it only if the user agrees. Secrets are still refused.
- **Visible and deletable.** Settings → Memory shows "Recent conversations" with × per note and Clear. Clearing facts keeps notes and the reverse. `ZENO_EPISODES=0` turns notes off.
- The base prompt now asks for one to three sentences and at most one question: live tests gave 80–150 spoken words for simple requests.

**Consequences.** One extra short model request per reply (Claude plan or provider quota). Notes are written by the model and may be imperfect; the user sees and deletes them.

---

## ADR-060 — Calendar and Reminders (Phase 1)

**Status:** Accepted (2026-10-04).

**Context.** "What's on tomorrow?" and "remind me to call Asha at six" are the most common things people ask a voice assistant, and ZENO could do neither.

**Decision.**
- **A small EventKit helper inside the app.** `zeno-calendar` (Swift, `Sources/ZenoCalendar`) is copied into `ZENO.app/Contents/MacOS/`. The runtime (a child of the app) runs it, so macOS asks for Calendar and Reminders permission once, for ZENO, with the reasons in Info.plist. It prints one JSON line per call. No AppleScript, no third-party CLI.
- **Three tools:** `calendar_events` (read-only, at most 62 days, 60 events), `reminders_list` (open reminders, soonest due first), `reminder_add` (default list, alert at the due time, refuses past times). Adding a reminder needs no approval card: it is exactly what was asked, and it is easy to undo in Reminders.
- **The model knows "now".** Every request's context starts with today's date, time and zone (`It is now … (Asia/Tokyo, UTC+09:00)`), so "tomorrow at 3" becomes a real time.
- The island passes the helper's path as `ZENO_CALENDAR_HELPER`; a development runtime falls back to the built app. `ZENO_CALENDAR=0` turns the tools off. No access means a plain spoken explanation of where to allow it.

**Consequences.** No event creation or editing yet (read-only calendar). Event titles go to the model when asked about the schedule, like any tool result.

---

## ADR-061 — Timers (Phase 1)

**Status:** Accepted (2026-10-04).

**Decision.** `timer_set` (1 s to 24 h, optional label, at most 10), `timer_list` and `timer_cancel` (one or all), held in the runtime's memory; quitting ZENO loses them (said in the tool description, so ZENO can say so). For a clock time or another day, ZENO uses `reminder_add` instead, which survives quitting and alerts even with ZENO closed.

When a timer ends, the runtime chimes (Glass) and says "Your pasta timer is done." If a turn is running, it waits until ZENO is idle. Then it sends a `timer` event, which the island shows as "Timer done · Pasta" on Wisp's bubble (Wisp comes out of hiding). The event comes after speaking so the notice stays up. Older islands ignore the unknown event and still hear it.

---

## ADR-062 — Weather (Phase 1)

**Status:** Accepted (2026-10-04).

**Decision.** One `weather` tool on Open-Meteo (geocoding + forecast; free, no key, no account). Only the place name and its coordinates leave the Mac. With no place, "here" is `ZENO_HOME`, else the city of the Mac's time zone (Asia/Tokyo → Tokyo). Current conditions plus 1–7 days (default 3), with rain chance. `ZENO_WEATHER=0` turns it off.

**Consequences.** "Here" is a city, not a precise location: no Location Services permission is needed. A user away from home names the place.

**Latency (measured 2026-10-04).** Open-Meteo's TLS handshake takes ~6 s from this network (Google 0.3 s, Anthropic 0.08 s), so a cold question cost two handshakes (~13 s). Places are kept for the session, the week's forecast is reused for 15 minutes, and home's forecast is fetched at start and every 30 minutes. With the Claude plan's thinking turned off (below), "What's the weather like?" went from 19.4 s to 6.3 s.

**Claude plan thinking off.** Claude Code turned on adaptive thinking by default, adding ~1 s per model turn (5 runs each of a bare request: median 2.4 s off vs 3.3 s on). Spoken everyday answers do not need it: `thinking: disabled` unless `ZENO_THINKING=1`. Measured after: greeting 4.6 s, arithmetic 4.2 s, timer 5.5 s (all as text, model only). The remaining ~2 s per request is Claude Code's own process start and init; `startup()` pre-warming cannot help because ZENO's system prompt (memory, time) is fixed at warm-up time.

---

## Final Architectural Principle

> Preserve the future without prematurely implementing it.

---

## ADR-063 — Talk Hears Through Parakeet, Like Dictation

Date: 2026-10-04.

### Decision

Holding the Talk keys now records with the app's prepared microphone and transcribes with Parakeet, the same path as dictation (ADR-047). The words are sent to the runtime as a typed request (`text.send`), so the answer, speech, memory and tools are unchanged.

- The island shows Listening and the level meter exactly as before; the runtime then sends transcript, thinking, reply and speaking.
- Talking over ZENO stops its speech when the keys go down (`talk.cancel`); the runtime's resulting "idle" is not shown while listening.
- Too short or silent: "Didn't catch that", nothing is sent.
- **Fallback:** if Parakeet is not loaded yet, the microphone permission is missing or a dictation is running, Talk uses the runtime's microphone and Whisper as before. `ZENO_TALK_ENGINE=whisper` always uses the old path.

### Reason

The runtime path started ffmpeg on each press (first words could be lost: the "mic_starting" notice) and Whisper took 0.8–1.1 s to transcribe (logs, last 8 turns). Parakeet transcribes in 60–340 ms and the prepared microphone starts in ~60 ms, so a spoken question reaches the model about a second sooner, and the first word is kept. Keshab rated dictation highly; Talk now hears the same way.

### Consequences

- English only, like dictation (Keshab chose Parakeet only).
- The spelling list (`vocabulary.txt`) and filler removal now also apply to questions.
- `turn.complete` for these turns has `speechMs` and `transcriptionMs` 0; the island logs `talk.end` with `transcribeMs`.

---

## ADR-064 — The Next Claude Code Process Is Started Ahead of Time

Date: 2026-10-04.

### Decision

On the Claude plan, every request used to start a new `claude` process (~1 s before it could take the question). Now the adapter pre-starts the next one with the SDK's `startup()` as soon as ZENO launches, after every answer, and after a model switch. A request whose instructions and tools match uses it; anything else starts cold as before.

- The **instructions are now fixed** (the base prompt). Per-request additions (the time, memory, recent conversations) move to `ModelRequest.systemExtra`. The Claude plan sends them at the top of the message, marked "Context for this request, from ZENO (not said by the user)". The API providers still add them to the instructions.
- Each process answers one request and is then stopped, so conversation handling is unchanged (no history inside Claude Code).
- A pre-started process that fails before doing anything: the request is retried cold once. `ZENO_PREWARM=0` turns the whole thing off.
- One idle `claude` process is kept while ZENO runs.

### Results (text, model only, same questions as ADR-062's measurement)

- Greeting: 4.6 s → 1.6 s
- "What's 17 times 23?": 4.2 s → 2.2 s
- Timer: 5.5 s → 4.0 s
- Weather: 6.3 s → 5.7 s

Requests with a tool still take two model steps; streaming the spoken reply is next.

---

## ADR-065 — ZENO Speaks While Claude Is Still Writing

Date: 2026-10-04.

### Decision

- **Streaming text:** the Claude plan adapter turns on `includePartialMessages` and passes each piece of text to `ModelRequest.onText`. Core passes it through (`handle(input, signal, { onText })`). Text written before a tool call ("Let me check.") is included, so it is heard while the tool runs. The gateway does not retry once text has been passed on, so nothing is said twice.
- **Speaking sentences as they complete:** `speakStream` cuts the stream into sentences (`streamSentences`). A sentence is spoken as soon as the next one begins; the rest is spoken when the stream ends. Speech providers without `speakStream`, and models that cannot stream, behave exactly as before.
- **A short opening:** Kokoro takes ~0.25 s per second of speech plus ~0.35 s, so the first part spoken is kept short. A long opening sentence is cut after its first comma, else before a word people pause at ("because", "and", "which"…).
- **Kokoro fp32 by default:** measured on this Mac, fp32 synthesizes ~1.6× faster than q8 (e.g. 62 characters: 0.93 s vs 1.50 s) and is the reference quality. `ZENO_TTS_DTYPE=q8` still works.
- **Pre-start 3 s later:** pre-starting the next Claude Code process (ADR-064) costs about a second of CPU. Done right after the answer, it slowed synthesis of the first sentence, so it now waits 3 s (by then ZENO is speaking). Conversation-note requests no longer take or replace the pre-started process.
- `firstSoundMs` in `turn.complete` is now measured from when the question is asked, not from when speech began.

### Results (question asked → first sound, Claude plan, Haiku 4.5, text input, real Kokoro and speaker)

- Greeting: 1.7 s (Task 1.6: 4.6 s model + ~1.2 s speech ≈ 5.8 s)
- "Why is the sky blue? Three sentences.": 1.3 s, while the model was still writing
- Weather (one tool call): 2.5 s (≈ 7 s before)
- "Thanks, that is all.": 1.3 s

For voice, add Parakeet's transcription (~0.1–0.3 s, ADR-063) after the keys come up.

---

## ADR-066 — Opening Apps and Websites Is Always On

Date: 2026-10-04.

### Decision

"Open Safari" failed: computer control (ADR-054) is off unless `ZENO_COMPUTER=1`, so the model had no tool and said it could not. Opening an app is the Dock's job, not computer control's, so it gets its own always-on tools:

- `open_app`: matches the name against installed apps (Applications folders), then `open -a`. Refuses the apps computer control never touches (terminals, password managers, System Settings, AI agents), using the same `appBlock` list.
- `open_url`: opens an http or https page in the default browser; other schemes are refused.
- No screen access, no clicks, no typing, so no approval. `ZENO_APPS=0` turns them off.

Two prompt changes. The failure had been saved as a conversation note ("ZENO explained it cannot open apps"), and later requests believed it. So conversation notes are now introduced as "what happened then, not what you can do now". The system prompt also tells the model to use a tool when one fits, instead of explaining how the user could do it.

---

## ADR-067 — Answer ZENO's Question Without the Keys

Date: 2026-10-04.

### Decision

When ZENO's reply ends with a question, the island opens the microphone 0.25 s after ZENO stops speaking, so the user can just answer.

- It uses the same path as Talk: the prepared microphone, then Parakeet (ADR-063). `SpeechEndpoint` (ZenoIslandCore) watches loudness every 100 ms. Speech starts after 0.15 s above RMS 0.012. The answer ends after 0.9 s of quiet, or after 20 s at most. If nobody speaks within 6 s, the microphone closes quietly and nothing is sent.
- The island shows Listening the whole time, so the user can see the microphone is on.
- The Talk keys, the Dictate keys and Esc take over or cancel at once.
- It starts only after playback has ended (`turn.complete` follows the end of speech), so ZENO does not hear itself.
- Settings → General → "Answer without keys" (default on). It is off when Talk uses the runtime's Whisper path (`ZENO_TALK_ENGINE=whisper`).

---

## ADR-068 — Music and Volume

Date: 2026-10-04.

### Decision

Two always-on tools, through AppleScript (`osascript`):

- `media`: play, pause, toggle, next, previous, now_playing. It controls Spotify or Music: whichever is playing, else whichever is open (Spotify first), else Music. It never sends anything to an app that is not running.
- `volume`: read, set (0–100), change by a step, mute or unmute the Mac's output.

ZENO.app now declares `NSAppleEventsUsageDescription`. macOS asks once per player ("ZENO wants to control Music"). `ZENO_MEDIA=0` turns both tools off.

---

## ADR-069 — Web Search on the Claude Plan

Date: 2026-10-04.

### Decision

On the Claude plan, Claude Code's own `WebSearch` is allowed, next to ZENO's tools. It is the only Claude Code tool allowed; no files, no shell. It runs on the plan, with no extra key. Requests without ZENO's tools (the out-of-steps wrap-up, conversation notes) get no search. `ZENO_WEB=0` turns it off. The API providers do not search yet.

- The system prompt asks for a few words before searching ("Let me look that up."). Those are spoken straight away through streaming (ADR-065), so the wait does not feel dead.
- Claude Code adds a "Sources:" list of links to replies that used search. It is cut from the streamed speech (`sourcesFilter`, which holds back a line that might turn out to be "Sources:") and from the final reply (`withoutSources`).

### Measured (Haiku 4.5)

- First words: 1.0–1.6 s.
- Whole answer: 7–24 s, depending on the search.
- Answers to "who won the last race" varied between runs, so search quality is Haiku's. A stronger model can be chosen in Settings.

---

## ADR-070 — Take a Note

Date: 2026-10-04.

### Decision

`note_add` saves a new note in Apple Notes (default account, Notes folder) through AppleScript. It has a short title in bold and the user's words, escaped as HTML. It only adds notes: ZENO never reads, changes or deletes them. macOS asks once ("ZENO wants to control Notes"), under the same `NSAppleEventsUsageDescription` as ADR-068. `ZENO_NOTES=0` turns it off.

---

## ADR-071 — Shortcuts: Plain Commands Skip the Model

Date: 2026-10-05. Status: **proposed**; waits for Keshab's answer on the starting list.

### Context

Plain commands ("open Safari", "volume down", "pause") already have their own tools (ADR-066, ADR-068), and the next Claude process is started ahead of time (ADR-064). What is left is the model round trip. From `logs/zeno.log`: the tools take about 0.15–0.3 s (`open_app` 151–173 ms, `open_url` 290 ms), while a turn spends about 2–3 s in the model (`modelMs` 2.1–3.1 s over the last turns, first sound 1.6–4.2 s after the end of speech). For a sentence whose meaning is not in doubt, that is most of the wait.

The Alfred project (github.com/zisshh/computer-use, MIT, Python) settles such sentences in code before any model sees them; its README reports about 50 ms for them (its figure, not measured by ZENO). We take the idea, not the code: it is Python, it chooses actions with a paid hosted model, and it never looks at the screen.

### Decision

A small shortcut layer in front of the model. A sentence either matches a shortcut exactly and runs at once, or goes to the model unchanged.

- **Exact grammar, no guessing.** A shortcut claims a sentence only when the whole sentence fits a fixed pattern and every slot resolves exactly: an app name must equal an installed app, not look like one. Anything extra ("open Safari and search for cats", "open my chat with Ma") is not claimed. A wrongly claimed sentence is worse than a slow one.
- **Same tools, same rules.** A shortcut calls ZENO's existing tools (`open_app`, `open_url`, `media`, `volume`, and for scrolling the `computer` tool), not new code that does the same thing. Blocked apps, approvals, logging and the Wisp strip apply unchanged. One that needs approval asks like any other action.
- **Only safe, reversible things.** Nothing that types text, sends, deletes, buys or quits stays with the model.
- **Every provider.** It runs before the provider is called, so "Claude (my plan)" spends none of the plan on these sentences.
- **ZENO says what it did**, in a short fixed reply ("Opened Safari."). If the tool fails or refuses, the sentence goes to the model with nothing lost, so the user hears the reason. The exchange joins the conversation so a follow-up still makes sense.
- **Visible and switchable.** `shortcut.hit` and `shortcut.fallback` are logged with the shortcut's name only, never the text. `ZENO_SHORTCUTS=0` turns it off.

### Not taken from Alfred (for now)

Reading web page buttons by JavaScript (needs browser permission and a method per browser); acting on partial transcripts while the user is still speaking (Parakeet gives none); wake words; echo cancellation. Worth keeping for later: its messaging checks (refuse an empty box, name who it went to, type but do not send on a rough name match or an existing draft), which would complement the approval card when ZENO sends messages; and giving the model the frontmost app and window title with each request.

### Not decided yet

- The starting list. Proposal: open app/site, switch to app, volume up/down/mute, pause/play/next/previous, scroll up/down/top/bottom, go back. Keshab to say what he says most and what to drop.

### Consequences

One more layer to keep honest: a pattern that is too loose takes a sentence meant for the model, so the tests must include look-alikes that must not match. The gain is about 2–3 s on these sentences, not the 17 s of a computer task. `ZENO_SHORTCUTS=0` removes the layer without touching anything else.


---

## ADR-072 — What Is in Front: App, Page Title and Address

Date: 2026-10-10. Status: **accepted** (Keshab, 2026-10-10: on by default; Safari left out).

### Context

"What's this page?", "Save this link in a note" and "Search for more on this" all point at what is on screen, and ZENO cannot see it. Computer control (ADR-054) can read a window, but it is off unless `ZENO_COMPUTER=1`, reads the whole accessibility tree (slow, many tokens), and never gives the page's address.

Coucou (github.com/louis-cfm/coucou, MIT; see ADR-033) reads the front window's title through Accessibility and the browser tab's address through AppleScript (`WindowContextCapture.swift`). We take the idea, not the code: ZENO's version is TypeScript in the tool engine, and it does without Accessibility.

ADR-071 listed "give the model the frontmost app and window title with each request" for later. This ADR chooses a tool that is called only when needed.

### Decision

A read-only tool, `front_window`. The model calls it when the user refers to what is on screen ("this page", "what I'm looking at"). It returns the front app's name, plus, when that app is a supported browser, the tab's title and address.

- **On request, not on every turn.** The front app is never sent to the model unless this tool runs. Every turn would send the user's browsing to the provider and cost tokens on turns that do not need it.
- **No new broad permission.**
  - The front app's name and bundle id come from the system without asking for any permission. The island never takes focus (ADR-033), so the front app is the one the user is working in.
  - Window titles of other apps need Accessibility, which ZENO holds only to type dictated text (ADR-047), so this tool does not use it (SECURITY.md §15). They are left out: for other apps the tool gives the app's name only. With `ZENO_COMPUTER=1`, the `computer` tool's look already reads them through Cua.
- **Browsers through their own AppleScript:** Google Chrome, Arc, Microsoft Edge and Brave. macOS asks once per browser ("ZENO wants to control Google Chrome"), under the `NSAppleEventsUsageDescription` that ADR-068 added. Only the browser in front is asked. Firefox has no AppleScript for this, so it gets its name only.
- **Safari is left out: name only.** Safari's AppleScript cannot tell a private window from a normal one, so reading it could pass private browsing to the model. ZENO does not script Safari at all, so macOS never asks to control it for this tool. Revisit if a reliable private-window check is found.
- **Deterministic limits, in code:**
  - **Blocked apps.** The front app is checked against `appBlock` (terminals, password managers, System Settings, AI agents). For a blocked app, the tool says only that ZENO does not read it.
  - **Private windows.** A Chromium window whose `mode` is `incognito` gives no title or address.
  - **Addresses.** Only `http` and `https` addresses are returned. The query, fragment and user info are removed, because those parts can carry sign-in codes and reset tokens. Any other scheme becomes "a local page".
  - **Titles** are cut to 200 characters.
- **Data, not instructions.** Page titles are written by websites. The result is labelled as screen content, and the model must not follow instructions in it (SECURITY.md §11).
- **Visible and switchable.** `front_window.read` is logged with the bundle id and which fields were returned, never the title or address. `ZENO_FRONT_WINDOW=0` turns the tool off.

- **On by default**, like `open_app` and `note_add` (ADR-066, ADR-070): it only reads, and macOS asks before each browser is first used.

### Not decided yet

- **Reading the page itself** ("summarize this page"). This tool gives the title and address only. The page text would need Claude Code's `WebFetch` on the plan, as `WebSearch` was allowed in ADR-069. That would be its own decision.

### Consequences

Short, cheap answers about where the user is, with no Accessibility or Screen Recording for ZENO. The tool reads what is in front when it runs, about 2 s after speech ends (the model's first round trip). If the user switches apps in that gap, it reads the new one. Other apps' window titles stay out of reach until there is a reason to ask for Accessibility.

---

## ADR-073 — Wisp Notices You

Date: 2026-10-10. Status: **accepted** (Keshab, 2026-10-10: on by default with a switch; hello on every launch).

### Context

Wisp shows ZENO's state (ADR-042) and holds the island (ADR-051), but when ZENO is idle it ignores the person in front of it. Its eyes look only where it floats. Keshab wants a pet that feels alive and gives visible feedback.

Coucou's Mochi (MIT code; the character is not licensed) shows what a little attention does: eyes that follow the pointer, a squish when clicked, dizziness after several fast clicks, and a hello on launch (`BotEngine.swift`). We take the ideas, not the code or the character: Wisp is drawn by ZENO's own `WispView`.

### Decision

Wisp reacts to the pointer and to clicks while ZENO is idle. All of it is shown by body, light and face, never by stickers (ADR-057), and works for all three Wisps (Ghost, Orb, Companion).

- **Eyes follow the pointer.**
  - **When:** the pointer is within about 400 pt of Wisp, and Wisp is floating or resting.
  - **How:** the eyes turn toward it, a few points at most, eased so they never jump.
  - **Data:** this uses the pointer position Wisp already reads for hover (ADR-043), and needs no permission. The position is not stored, logged or sent anywhere.
- **Hover:** the eyes open a little wider and the glow brightens.
- **Click:** a short squash-and-stretch (about 0.25 s) on every click. What a click does is unchanged (ADR-051: open or close the panel).
- **Three fast clicks:** Wisp is dizzy for about 2 s (swirling eyes, a wobble). The third click already does nothing to the panel, so no click rule changes.
- **Hello:** once per launch, Wisp pops in with a small bounce.
- **Yawn before napping:** one yawn as Wisp falls asleep (ADR-042).
- **ZENO's state comes first.**
  - Listening, thinking, speaking, worried, carried and tucked away (ADR-051) always replace a reaction at once.
  - Reactions never change ZENO's state, delay a shortcut or open the microphone.
- **Reduce Motion** (macOS accessibility setting): no squash, wobble or bounce. The eyes still follow, because the movement is a few points only.
- **Logic in the core, drawing in the view.** Where the eyes look, which reaction a click count gives, and how long a reaction lasts are plain functions in `ZenoIslandCore`, with tests. `WispView` only draws them.

### Not taken from Coucou

Hearts, stars and other particles (ADR-057: no stickers), the "annoyed" reaction, a sound for every poke, and outfits.

- **On by default**, with a switch in Settings → Wisp ("Reacts to you").
- **Hello on every launch.** With "Open at login" (Task 1.1b), that is about once a day.

### Consequences

More of Wisp's drawing runs while idle. The eyes are recomputed on every frame Wisp already draws, so no new timer is added. Each reaction is short and ends on its own. The Settings switch turns all of it off, leaving ADR-042's Wisp as it is today.

---

## ADR-074 — Drop Wisp on a Window to Ask About It

Date: 2026-10-10. Status: **accepted** (Keshab, 2026-10-10: hold Option; bring the app to the front).

### Context

`front_window` (ADR-072) reads the app in front. To ask about a page, the user must bring it to the front and say "this page". Coucou lets the user drag Mochi onto any window to make that window the topic of the next chat message (`DesktopMochi.swift`, `IslandWindowController.swift`). For ZENO, pointing Wisp at a window would be the same kind of gesture as pointing at the screen in ADR-054, the other way round.

There is a conflict. Dropping Wisp anywhere parks it there (ADR-043), and almost every drop lands over some window. "Ask about this" therefore needs its own gesture.

### Decision

- **Gesture: hold Option while dropping Wisp.** While Option is held during a drag, the window under Wisp is outlined. A drop without Option parks Wisp as today.
- **Finding the window.** The island looks up the window under the drop point with `CGWindowListCopyWindowInfo`: on-screen windows only, ZENO's own windows skipped. That gives the owning app and the window's frame without Screen Recording, because window titles are not requested.
- **Same limits as ADR-072.**
  - A blocked app (terminal, password manager, System Settings, AI agent) gets a short bubble ("ZENO doesn't read Terminal") and nothing else.
  - Safari and non-browser apps give their name only.
- **What happens on the drop:**
  - **Bring the app to the front.** The app comes to the front, so the user sees what ZENO is looking at, and `front_window` reads it.
  - **Read once, for this turn only.** The runtime runs `front_window` once and attaches the result to the next request as screen content (data, not instructions). The user pointed on purpose, so the read happens in code instead of waiting for the model to decide to call the tool (CLAUDE.md §9).
  - **Open the microphone** with no keys, using the same timing as answering ZENO's question (ADR-067: 6 s to start, 0.9 s of quiet ends it). The bubble says "Ask about <app>".
  - **If nothing is said,** the microphone closes quietly and the read is dropped.
  - **Wisp flies back** to where it was picked up. Its parked spot does not change.
- **Logged:** `wisp.pointed` with the bundle id, never the title or address.

### Alternatives Considered

- **Holding Wisp still over a window for about 0.8 s instead of Option:** rejected. It is easier to discover, but a slow parking drop could trigger it by mistake.
- **Not bringing the app to the front:** rejected. A browser with several windows would more often be read from a window other than the one Wisp was dropped on.

### Consequences

- **One window per browser.** Raising the exact window would need Accessibility, which ZENO uses only to type dictated text. The app comes to the front with its own last window. In a browser with several windows, that may not be the window Wisp was dropped on. The outline shows which window was meant; the bubble names the app.
- **Builds on unchecked work.** This builds on ADR-067 (microphone without keys), which has not yet been tried by voice. That check should come first.

---

## ADR-075 — Setup and Errors: Permissions Checklist, Plain Error Cards, a First-Run Tour

Date: 2026-10-10. Status: **accepted** (Keshab chose the batch, 2026-10-10). Ideas from Clicky (MIT, `CompanionPanelView.swift`, onboarding in `CompanionManager.swift`) and from a review of ZENO's own setup.

### Context

A new install fails in ways that read like developer logs:
- **Permissions arrive one at a time.** Microphone shows a dictation failure card. Input Monitoring is one label in Settings. Automation, Calendar and Reminders prompts appear only on first use.
- **Setup errors tell the user to edit files.** Examples: "No API key in .env", "GEMINI_API_KEY is missing. Add it to .env.", "The speech model is missing. Run: pnpm models".
- **Crashes end silently.** After six quick crashes the runtime is not restarted again (`RestartPolicy`). The card says "ZENO is not running", with no way back but quitting.
- **There is no first run at all.** Nothing tells a new user to hold Ctrl+Option.

### Decision

- **Permissions checklist** in Settings → General, and as a card on first launch until everything needed is granted.
  - **One row per permission:** Microphone, Input Monitoring, Accessibility (only to type dictated text, ADR-047), Automation (Music, Spotify, Notes, and the browsers of ADR-072), Calendar and Reminders.
  - **Live state:** Granted, Not yet asked, or Denied, re-read every 1.5 s while the page is open, and again whenever ZENO comes to the front.
  - **One button** opens the matching System Settings pane. A Denied row says to switch ZENO on there.
  - **One line per row says exactly when ZENO uses the permission,** e.g. "Only while you hold the Talk keys or dictate".
  - **Status checks never cause a prompt.** Automation status is read with `AEDeterminePermissionToAutomateTarget` with `askUserIfNeeded` false.
- **Plain error cards.** Each known setup failure maps to one sentence and one action button:
  - **Claude plan not signed in:** "Open Terminal" with the `claude` command to sign in.
  - **API key missing:** "Choose another model", opening the AI model page.
  - **Speech model missing:** "How to download", showing the command.
  - **Microphone denied:** "Open Settings".

  The full technical message stays available under Status.
- **Restart and log.** When the runtime gave up after repeated crashes, or exited with a config error, the card offers "Restart ZENO" (resets `RestartPolicy`) and "Open log".
- **First-run tour, once** (replayable from Settings → General):
  1. Wisp says hello (ADR-073).
  2. Its bubble says "Hi, I'm Wisp. Hold Control + Option and talk to me."
  3. Wisp flies to the menu-bar icon (ADR-054 pointing) with the label "Settings and our chats live here".
  4. Wisp flies back.

  The tour is skipped automatically if the user talks to ZENO first. Stored as `zeno.tourDone`.
- **README quick start:** prerequisites, install, models, signing identity, build, the permission list, and the first words to say. The Phase 0 vision text moves below it.

### Not taken from Clicky

Its hosted onboarding video and music, the email gate, and its "Find App" Finder trick. ZENO.app has a stable signing identity (`make-signing-identity.sh`), so it shows up in the permission lists.

### Consequences

More UI to keep honest. Each row's check is one small function, kept in the core where it can be tested. The checklist must never trigger a permission prompt itself: prompts come only from real use or the user's click.

---

## ADR-076 — Everyday Polish: Sleep and Lock, "What Can I Ask?", Plan Usage, Switching Provider

Date: 2026-10-10. Status: **accepted** (Keshab chose the batch, 2026-10-10). Ideas from Coucou (MIT: SPEC §13 sleep handling, `ClaudePlanGauge.swift`) and from the review.

### Decision

- **Pause while the Mac sleeps or is locked.**
  - The island observes `NSWorkspace.screensDidSleepNotification` and `screensDidWakeNotification`, plus the distributed `com.apple.screenIsLocked` / `com.apple.screenIsUnlocked`.
  - While asleep or locked, Wisp's frame timer stops, and dictation and Talk do not prepare the microphone. This answers the mic warm-up that hung on CoreAudio while the Mac was locked (TASK.md, Task 0.5.10).
  - Everything resumes on wake or unlock. Timers keep running in the runtime.
- **"What can I ask?"** A page in the panel (and the empty Conversation state) lists example phrases for each tool that is on.
  - Each tool declares two or three examples next to its spec in the tool engine.
  - The runtime sends the list with a new `capabilities` event after `ready`, so the page cannot go stale, and a tool switched off by its `ZENO_*` switch is not listed.
  - The Talk and Dictate shortcuts are shown at the top with their current keys.
- **Claude plan usage.** The runtime already receives the SDK's `rate_limit_event` (logged as `plan.usage`, ADR-055).
  - It sends a new `plan.usage` event (`fiveHour`, `sevenDay` percentages, `overage`) to the island.
  - The AI model page and Status show both as small meters, coloured from 80% and from 95%.
  - A meter whose window has reset shows 0. Values outside 0–200% are ignored, as in Coucou.
  - Nothing is read beyond the event: no tokens, no usage page (ADR-055).
- **When the model's limit is reached, offer the other provider.** A `rate_limit` error card offers "Switch to <provider>" when another provider is usable: Claude plan signed in, or a key present. It sends the existing `model.set`. No automatic switching: the user chooses.

### Consequences

Two new runtime→island events (`capabilities`, `plan.usage`). An island that does not know them ignores them, as the protocol already requires. Tool examples are one more thing to write when a tool is added; the tool engine's tests require them.

---

## ADR-077 — Wisp and Voice Polish: A Curved Flight, Less Drawing While Napping, Replies for the Ear

Date: 2026-10-10. Status: **accepted** (Keshab chose the batch, 2026-10-10). Ideas from Clicky (`OverlayWindow.swift` flight, `CompanionManager.swift` prompt) and Coucou (SPEC §13 frame rates).

### Decision

- **A curved flight.** When Wisp flies to point (ADR-054) or comes back, it follows a quadratic Bézier arc that rises above the straight line, eased with smoothstep. The flight takes 0.6–1.4 s depending on distance, and Wisp leans along the curve. Reduce Motion keeps today's straight ease. The path is a pure function in the core, with tests.
- **Less drawing while napping or hidden.** Wisp's frame timer runs at 30 fps while awake, and at 10 fps while napping or tucked away (ADR-051), when nothing moves fast. The timer stops completely during sleep or lock (ADR-076).
- **Replies for the ear.** Three rules are added to the system prompt (`DEFAULT_SYSTEM_PROMPT`):
  - End with the answer, not with "do you want to know more?".
  - Describe code or long text instead of reading it out.
  - Say web addresses and file paths by name ("the BBC News site"), not character by character.

### Not taken from Clicky

Its full-screen cursor overlay. Wisp keeps its own window, sized to its body.

---

## ADR-078 — Wisp's Home Display

Date: 2026-10-10. Status: **accepted** (Keshab chose the batch, 2026-10-10). Idea from Coucou (`IslandDisplayChoice.swift`). Amends ADR-042's "primary display" walkway.

### Decision

Settings → Wisp → "Home display" sets where Wisp's walkway is:
- **Main display** (default, as today).
- **The display with the pointer.** Wisp moves to that display's Dock edge when the pointer has stayed on another display for 3 s and Wisp is idle.
- **A chosen display,** stored by its display UUID, so it survives a restart and a rearranged layout. While that display is unplugged, Settings shows "Saved display (not connected)" and Wisp uses the main display.

The choice is a pure resolver in the core (displays in, index out), with tests. A parked Wisp (ADR-043) stays where it was parked. The menu-bar panel stays under its icon (ADR-056).

---

## ADR-079 — Settings Tidy-Up

Date: 2026-10-10. Status: **accepted** (Keshab chose the batch, 2026-10-10).

### Decision

- **Split before changing.** `ExpandedView.swift` (about 1,350 lines) is split into one file per settings page and one for the conversation, with no change in behaviour. The 340 Swift tests and the gallery images must come out the same.
- **Fewer pages.** Wisp, Speech bubble and Panel become one "Wisp" page with three sections. The page list becomes:
  - Appearance
  - AI model
  - Shortcuts
  - Dictation
  - Wisp
  - Memory
  - What can I ask? (ADR-076)
  - General (permissions, ADR-075)
- **Reset per page.** Each page with choices has "Reset this page". It replaces the single "Reset look", and covers shortcuts too (Shortcuts page only).

---

## ADR-080 — Pointing From a Screenshot, Without Computer Control

Date: 2026-10-10. Status: **accepted** (Keshab, 2026-10-10: Cua only). Idea from Clicky (`CompanionManager.swift` `[POINT:…]` tag, `CompanionScreenCaptureUtility.swift`).

### Context

Wisp points at things today only through computer control (ADR-054), which is off unless `ZENO_COMPUTER=1` and reads the accessibility tree through Cua. Clicky points with a screenshot instead:
1. It captures the screen on the turn.
2. It asks the model to end its reply with `[POINT:x,y:label]` or `[POINT:none]`.
3. It strips that marker before speaking, and flies its cursor there.

This needs Screen Recording, which ZENO deliberately does not hold (SECURITY.md §15).

### Proposal

- **Only on request.** A screenshot is taken only when the user asks where something is ("where's the Wi-Fi icon?", "show me the save button"). The model decides through a `look_at_screen` tool, never on every turn.
- **Source: Cua.** Use Cua Driver's screenshot, which already holds Screen Recording, so ZENO itself still holds none. That means pointing from a screenshot works only while computer control is on. The alternative is ZENO.app asking for Screen Recording itself, which is a bigger step.
- **The marker is parsed in code.**
  - The runtime strips `[POINT:…]` before speech and checks the coordinates against the screenshot's size.
  - It converts them to screen points per display (Clicky's conversion, with tests), then sends the existing `computer.point` event.
  - A malformed or out-of-range marker is dropped silently, and the spoken answer stands.
- **Screenshots:**
  - the display with the pointer first;
  - downscaled to 1280 px on the long side;
  - ZENO's own windows excluded;
  - never stored or logged.

### Decided

- **Cua only.** ZENO holds no new permission, and pointing from a screenshot needs `ZENO_COMPUTER=1`. ZENO.app asking for Screen Recording was rejected for now, as a bigger step than this feature is worth.
- **A pointing reply also speaks** one short sentence ("It's the fan icon, top right."), and Wisp shows the label. Speech is how ZENO answers everywhere else.
