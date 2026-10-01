# ZENO Roadmap

The roadmap describes the direction of ZENO.

It is not a strict task queue.

Implementation should follow TASK.md.

---

## Phase 0 — Foundation / Voice

Goal:

Establish the smallest working ZENO loop.

```text
Microphone
 ↓
Whisper
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

## Phase 0.5 — Desktop Island

Give ZENO a permanent place on the Mac (ADR-033).

- a panel hidden above the top-centre of the screen, revealed by hovering
- hold Ctrl+Option in any app to talk
- live status and replies in the panel
- the Phase 0 voice loop, unchanged, as the runtime behind it

```text
ZENO Island (Swift)
 ↕ JSON lines over stdin / stdout
ZENO runtime (Phase 0 voice loop)
```

---

## Phase 1 — Memory

Introduce persistent memory.

Potential capabilities:

- remember
- recall
- update
- forget
- provenance
- confidence
- importance
- memory scopes

---

## Phase 2 — Mac Tools

Allow ZENO to interact with controlled Mac capabilities.

Potential capabilities:

- filesystem
- applications
- browser
- notifications
- basic automation

---

## Phase 3 — Computer Control

Introduce controlled UI interaction.

Potential capabilities:

- mouse
- keyboard
- windows
- applications
- visual interaction

Security remains deterministic.

---

## Phase 4 — Decision Engine

Introduce a formal Decision Engine.

Purpose:

- ambiguity resolution
- routing
- action selection
- capability selection

---

## Phase 5 — Laya / Jev

Evaluate Laya/Jev as Decision Engine implementations.

Requirements:

- measurable latency
- resource monitoring
- replaceable interface
- no mandatory invocation for every request

---

## Phase 6 — Knowledge

Introduce:

- document ingestion
- retrieval
- project knowledge
- personal knowledge
- provenance
- authorization-aware retrieval

---

## Phase 7 — iOS Node

Introduce iPhone as a ZENO device node.

Capabilities may include:

- microphone
- notifications
- mobile-specific actions
- communication with ZENO Core

---

## Phase 8 — Windows Node

Introduce Windows as another ZENO node.

---

## Phase 9 — Teams

Introduce:

- shared spaces
- team knowledge
- permissions
- collaboration
- shared tasks

---

## Phase 10 — ZENO Cloud

Introduce cloud infrastructure for:

- identity
- synchronization
- memory
- knowledge
- tasks
- devices

---

## Phase 11 — Multi-Device Synchronization

Enable seamless synchronization across:

- Mac
- iPhone
- Windows
- Web

---

## Phase 12 — Multi-User Platform

Introduce:

- accounts
- organizations
- teams
- personal data isolation
- shared data
- authorization

---

## Phase 13 — Capability Discovery

Introduce controlled capability acquisition.

Example:

> "Zeno, give yourself a calendar."

The system should:

1. discover capability
2. validate it
3. inspect permissions
4. sandbox it
5. install/register it
6. test it
7. version it
8. audit it

---

## Phase 14 — Advanced Intelligence

Potential future capabilities:

- advanced planning
- long-running tasks
- complex workflows
- richer memory
- stronger reasoning
- autonomous but permissioned behavior
- capability composition
- advanced device coordination

---

## Roadmap Principle

The roadmap should change as evidence changes.

Do not implement future phases merely because they appear here.

> Preserve the future without prematurely implementing it.
