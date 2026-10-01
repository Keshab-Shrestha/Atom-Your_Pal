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

## Final Architectural Principle

> Preserve the future without prematurely implementing it.
