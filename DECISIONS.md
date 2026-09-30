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

`ZENO_LLM_PROVIDER` selects the provider (`claude` by default, or `gemini`). Only the selected provider's key is required. Default Gemini model: `gemini-3.5-flash`.

### Reason

Proves the gateway is provider-independent (ADR-002) and gives a working path while one provider is unavailable (e.g. no credits).

Voice processing (Whisper, Kokoro) is local and exchanges only text with the Core, so it is unaffected by the provider choice (ADR-003).

### Notes

- On Google's free tier, prompts may be used to improve Google products. Since ZENO sends what the user says, the paid tier is preferable for private use.
- ADR-028 still holds: Claude remains the default provider.

---

## Final Architectural Principle

> Preserve the future without prematurely implementing it.
