# ZENO Project Status

Last updated: 2026-10-01

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

Progress: Tasks 0.1–0.4 (Repository Foundation, Configuration, Audio Input, Whisper Adapter) are complete. Next: Task 0.5 (ZENO Core).

---

## 3. Current Phase

### Phase 0 — Voice Foundation

Target:

```text
Microphone
    ↓
Whisper.cpp
    ↓
ZENO Core
    ↓
LLM Gateway
    ↓
Remote LLM
    ↓
TTS
    ↓
Speaker
```

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

## 5. Phase 0 Required Components

The immediate implementation requires:

- microphone input
- Whisper.cpp adapter
- ZENO Core
- LLM Gateway
- one remote provider
- TTS adapter
- audio output
- configuration
- logging
- error handling
- tests

---

## 6. Explicitly Deferred

The following remain future work:

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

---

## 8. Phase 0 Definition of Done

Phase 0 is complete when:

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

## 9. Immediate Development Order

Recommended sequence:

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

Phase 0 technical decisions are made. Tasks 0.1–0.4 are complete. The next task is Task 0.5 — ZENO Core.

The next implementation task should be selected from TASK.md.

Do not start future phases until Phase 0 has been verified.

---

## Final Principle

> Build the smallest system that can become the larger system.
