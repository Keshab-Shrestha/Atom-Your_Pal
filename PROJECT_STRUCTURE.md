# ZENO Project Structure

This document describes the project organization and where code belongs.

The top-level scaffold exists from the start so every piece of code has an obvious home.

Folders are filled only when the current task needs them.

---

## 1. Current Scaffold

These folders exist now. Most are empty placeholders.

```text
zeno/
│
├── apps/
│   ├── mac/
│   ├── ios/
│   ├── windows/
│   └── web/
│
├── services/
│   ├── core/
│   ├── memory/
│   ├── knowledge/
│   ├── retrieval/
│   ├── decision-engine/
│   ├── llm-gateway/
│   ├── tool-engine/
│   ├── capability-manager/
│   ├── device-manager/
│   └── api/
│
├── packages/
│   ├── contracts/
│   ├── protocol/
│   ├── database/
│   ├── auth/
│   └── shared/
│
├── infrastructure/
├── docs/
├── tests/
│
├── CLAUDE.md
├── README.md
├── PRD.md
├── TASK.md
├── ARCHITECTURE.md
├── ROADMAP.md
├── SECURITY.md
├── PROJECT_STRUCTURE.md
├── DECISIONS.md
└── STATUS.md
```

---

## 2. Placeholder Rule

An empty folder is a reserved location, not a commitment to build it.

- Do not add code to a folder until the current task requires it.
- Do not delete placeholder folders because they are empty.
- Do not create new top-level folders without recording a decision in DECISIONS.md.
- Sub-folders are created only when needed.

Git does not track empty folders. Each placeholder receives a `.gitkeep` file when the repository is initialized (Task 0.1).

---

## 3. Services Are Modules, Not Processes

`services/` contains logical modules of one modular monolith (see ADR-008).

A folder under `services/` does not mean a separate process, server, or deployment.

Modules may become separate services later only when scale requires it.

---

## 4. Folder Responsibilities

### apps/ — device and user interfaces

| Folder | Responsibility | Phase |
|---|---|---|
| `apps/mac/` | Mac node: microphone, speaker, local STT and TTS, voice loop entry point (`src/`, TypeScript) | 0 |
| `apps/mac/island/` | ZENO Island: the native Swift app (panel, hover reveal, Ctrl+Option push-to-talk) that runs the Mac node as its child process | 0.5 |
| `apps/ios/` | iPhone node | 7 |
| `apps/windows/` | Windows node | 8 |
| `apps/web/` | Web interface | Later |

### services/ — ZENO modules

| Folder | Responsibility | Phase |
|---|---|---|
| `services/core/` | Request/response orchestration, context, routing | 0 |
| `services/llm-gateway/` | Provider-independent LLM access and provider adapters | 0 |
| `services/memory/` | Persistent memory | 1 |
| `services/tool-engine/` | Controlled tool execution | 2 |
| `services/capability-manager/` | Capability registration, validation, health | 2+ |
| `services/decision-engine/` | Decision Engine abstraction (Laya / Jev) | 4–5 |
| `services/knowledge/` | Knowledge ownership and scopes | 6 |
| `services/retrieval/` | Authorization-aware retrieval | 6 |
| `services/device-manager/` | Device registry and nodes | 7+ |
| `services/api/` | External API | Later |

### packages/ — shared code

| Folder | Responsibility | Phase |
|---|---|---|
| `packages/shared/` | Configuration loading, logging, errors — until they earn their own package | 0 |
| `packages/contracts/` | Shared types and interfaces between modules (e.g. request/response models) | 0 |
| `packages/protocol/` | Device-to-ZENO communication protocol | 7+ |
| `packages/database/` | Persistence layer | 1 |
| `packages/auth/` | Identity and authentication | Later |

### Other

| Folder | Responsibility |
|---|---|
| `infrastructure/` | Deployment, monitoring, cloud. Empty until cloud is required (Phase 10). |
| `docs/` | Supporting documentation beyond the root documents. |
| `tests/` | Cross-module integration and end-to-end tests. Unit tests may live beside the code they test. |

---

## 5. Phase 0 Placement

Phase 0 uses only these folders:

```text
zeno/
├── apps/mac/                 microphone, Whisper.cpp adapter, TTS adapter, speaker, voice loop
├── services/core/            ZENO Core
├── services/llm-gateway/     LLM Gateway + first provider adapter
├── packages/contracts/       request / response models
├── packages/shared/          configuration, logging, errors
└── tests/                    end-to-end voice loop test
```

Every other folder stays empty during Phase 0.

Audio, STT and TTS live in `apps/mac/` because they are local device functions (see ADR-003).

The Core must not depend on Whisper, TTS, or provider details directly.

```text
apps/mac  →  services/core  →  services/llm-gateway  →  provider adapter
```

The exact language/framework may change.

---

## 5a. Phase 0.5 Placement

Phase 0.5 adds one folder and one document:

```text
zeno/
├── apps/mac/island/          Swift Package: island app, its tests, and the script that builds ZENO.app
├── apps/mac/src/             gains island mode (JSON lines over stdin / stdout); voice loop unchanged
└── docs/island-protocol.md   the commands and events between the island and the runtime
```

`apps/mac/island/` is a sub-folder of the Mac node, not a new top-level folder: the island is the Mac node's interface (ADR-034).

Build output (`.build/`, `ZENO.app`) is git-ignored.

---

## 6. LLM Gateway Layout

Example:

```text
services/llm-gateway/
├── gateway
├── interface
├── claude
└── openai
```

Provider-specific code belongs only in its adapter.

The exact structure may evolve.

---

## 7. Configuration

Configuration should centralize:

- provider settings
- API configuration
- audio settings
- runtime options
- logging

Secrets should not live in source code.

---

## 8. Tests

Tests may eventually be organized into:

```text
tests/
├── unit/
├── integration/
├── end-to-end/
└── security/
```

During Phase 0, a simpler structure is acceptable.

---

## 9. Structural Rule

The folder tree shows where code will go. It does not show what is built.

STATUS.md is the source of truth for what actually exists and works.

Never add code merely to make the project look complete.

---

## 10. Guiding Principle

The architecture can be larger than the implementation.

The implementation should contain only what is justified by the current phase.
