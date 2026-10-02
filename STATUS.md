# ZENO Project Status

Last updated: 2026-10-02

---

## 1. Product

### Name

ZENO

### Positioning

> ZENO — The Intelligence Layer for Your Digital World.

---

## 2. Current Stage

### Architectural / Foundation Stage

The product architecture and development philosophy have been defined.

The implementation priority is now Phase 0.

Progress: **Phase 0 is complete (2026-10-02).** All tasks 0.1–0.11 are done; the voice loop was verified by the user speaking into the real microphone and by the live test suite (history: `docs/phase-0-tasks.md`). Open items from Phase 0: Claude live check (needs Anthropic credits); Gemini free-tier quota (about 20 requests per day).

**Current phase: Phase 0.5 — Desktop Island** (ADR-033 to ADR-042), planned 2026-10-02. Task 0.5.1 is done: the project now lives at `~/Developer/zeno`, outside iCloud. Task 0.5.2 is done: the runtime can be driven over JSON lines (`main.ts --island`, `docs/island-protocol.md`). Task 0.5.3 is done: `ZENO.app` (`pnpm island:build`) runs as a background app and supervises the runtime: starts it, restarts it after a crash, stops it on quit. Task 0.5.4 is done: a panel hidden above the top-centre that slides down on hover. Keshab then redirected the design: the top-centre is crowded by other apps, so the island moves to the left edge below the menu bar (ADR-037), and it gets real content: a live state with a level meter, and an expanded view with Conversation, Status and Settings (AI provider and model) in dark glass (ADR-038). Task 0.5.4b is built: a dark glass card at the left edge below the menu bar, showing ZENO's state with the model name and a live waveform while listening; it comes out by itself during a turn and for problems. Keshab then asked for settings inside the island, changeable shortcuts, FluidVoice-style dictation and a walking pet (ADR-039 to ADR-042). Current: Task 0.5.5 (Expanded Island With Settings).

---

## 3. Current Phase

### Phase 0.5 — Desktop Island

Target:

```text
Ctrl+Option held (any app)  /  pointer at left edge
    ↓
ZENO Island (Swift, apps/mac/island)
    ↕ JSON lines over stdin / stdout
ZENO runtime (Phase 0, apps/mac/src)
    ↓
Microphone → Whisper → Core → LLM Gateway → LLM → Kokoro → Speaker
```

### Completed

- Phase 0 — Voice Foundation (2026-10-02)

---

## 4. Current Architectural State

The following concepts have been defined:

- ZENO Core
- Identity
- Context
- Deterministic Router
- Decision Engine
- Laya / Jev integration point
- LLM Gateway
- Memory
- Knowledge
- Capability System
- Capability Manager
- Device Registry
- Device Manager
- Policy Engine
- Tasks
- Events
- Multi-device architecture
- Multi-user architecture
- Team knowledge
- Cloud architecture
- Provenance
- Observability

These are architectural definitions.

They do not necessarily mean all corresponding software modules currently exist.

---

## 5. Phase 0.5 Required Components

The current phase requires:

- a runtime mode driven by JSON lines over stdin / stdout
- the island app (Swift), which starts and supervises the runtime
- the hidden panel with hover reveal
- global push-to-talk (Ctrl+Option)
- live status, transcript and reply in the panel
- an expanded conversation view
- permission guidance (microphone, Input Monitoring)

Phase 0 components (microphone, Whisper, Core, LLM Gateway, providers, Kokoro, configuration, logging, error handling, tests) are built and reused unchanged.

---

## 6. Explicitly Deferred

The following remain future work (Phase 0.5 deferrals are listed in TASK.md):

- persistent memory
- RAG
- knowledge graph
- team knowledge
- multi-user system
- cloud synchronization
- iOS node
- Windows node
- Mac computer control
- capability acquisition
- autonomous agent system
- multi-agent architecture
- Kubernetes
- microservices
- local general-purpose LLM
- Ollama

---

## 7. Architectural Decisions

Current major decisions:

- ZENO is a system, not a chatbot.
- LLM providers are replaceable.
- Voice processing can be local.
- General reasoning initially uses remote models.
- Ollama is not required.
- Deterministic routing comes first.
- Decision Engine is optional.
- Decision Engine is replaceable.
- Initial architecture is a modular monolith.
- Devices are nodes.
- Permissions are deterministic.
- Capabilities define controlled actions.
- Least privilege is mandatory.
- Knowledge is independent from the LLM.
- Memory is independent from conversation history.
- Provenance is important.
- Tasks and events are distinct.
- User should not need to select execution device.
- Phase 0 must remain small.
- Future architecture should not force premature implementation.

Phase 0 technical choices (ADR-026 to ADR-030):

- TypeScript / Node.js, pnpm workspace
- Push-to-talk input
- Claude as the first provider
- Kokoro-82M on ONNX (local) for TTS
- Session-only conversation history, nothing saved to disk

Later Phase 0 changes: Gemini as a second provider (ADR-031); Whisper small.en with a vocabulary prompt (ADR-032).

Phase 0.5 decisions (ADR-033 to ADR-042):

- A desktop island comes before Memory
- Native Swift app for the island; the Node runtime runs as its child process, talking JSON lines over stdin / stdout
- Hold Ctrl+Option to talk, from any app (listen-only key reading, Input Monitoring permission)
- Hidden past the left edge, below the menu bar (moved from the top-centre, ADR-037); revealed on hover and while talking
- Compact view: live state and level meter; expanded: Conversation, Status, Settings (provider and model); dark glass (ADR-038)

---

## 8. Phase 0 Definition of Done (met 2026-10-02)

Phase 0 was complete when:

```text
User speaks
    ↓
Microphone captures audio
    ↓
Whisper transcribes
    ↓
ZENO Core receives request
    ↓
LLM Gateway routes request
    ↓
Remote LLM responds
    ↓
ZENO receives response
    ↓
TTS generates audio
    ↓
Speaker produces response
```

The complete loop must be tested and observable.

---

## 9. Development Order

Phase 0.5 order: Tasks 0.5.1 to 0.5.8 in TASK.md, one at a time.

Phase 0 order, completed:

```text
0.1 Repository Foundation
        ↓
0.2 Configuration
        ↓
0.3 Audio Input
        ↓
0.4 Whisper Adapter
        ↓
0.5 ZENO Core
        ↓
0.6 LLM Gateway
        ↓
0.7 First Remote Provider
        ↓
0.8 TTS
        ↓
0.9 Voice Loop
        ↓
0.10 Error Handling
        ↓
0.11 End-to-End Test
```

Only one task should be actively implemented at a time.

---

## 10. Development Rule

Think about the entire system. Build only the next piece.

The existence of future architecture does not authorize implementing it early.

---

## 11. Current Success Criterion

The immediate goal is not to build the entire ZENO platform.

The immediate goal is:

> Build a small, reliable voice intelligence loop that can become the foundation of the larger ZENO system without requiring a rewrite.

---

## 12. Next Action

Phase 0 is complete. Phase 0.5 (Desktop Island) is planned in TASK.md.

Tasks 0.5.1–0.5.4b are done: the island lives at the left edge and shows ZENO's live state. Keshab then asked for settings inside the island, changeable shortcuts, FluidVoice-style dictation and a pet (ADR-039 to ADR-042). Designs from FluidVoice and Vorssaint are re-implemented, never copied (both GPL-3.0).

Task 0.5.5 (expanded island with settings) is done. Task 0.5.6 (shortcuts in every app) is coded and partly checked live; hand checks remain. Voice testing is paused at Keshab's request, so Task 0.5.7 (Dictation) waits and Task 0.5.8 (Wisp) is built and waits for Keshab's look on the real desktop.

Do not start Phase 1 (Memory) until Phase 0.5 has been verified.

---

## Final Principle

> Build the smallest system that can become the larger system.
