# ZENO Architecture

---

## 1. Architectural Vision

ZENO is a distributed-capable intelligence system.

The architecture must eventually support:

- one user identity
- multiple devices
- multiple models
- multiple capabilities
- memory
- knowledge
- tasks
- events
- permissions
- cloud synchronization
- team collaboration

However, implementation should begin as a modular monolith.

---

## 2. Long-Term Architecture

```text
USER
  ↓
Voice / Text / UI / API
  ↓
ZENO CORE
  ↓
Identity / Context / Events
  ↓
Deterministic Router
  ├── Memory
  ├── Knowledge
  ├── Decision Engine
  │      └── Laya / Jev
  └── LLM Gateway
         ├── Claude
         ├── OpenAI
         └── Future Providers
  ↓
Capability Manager
  ↓
Policy / Permissions
  ↓
Mac / iPhone / Windows Nodes
  ↓
Tasks / Events / Results
  ↓
ZENO
```

---

## 3. Phase 0 Architecture

Phase 0 intentionally simplifies the architecture.

```text
Audio Input
    ↓
Whisper Adapter
    ↓
ZENO Core
    ↓
LLM Gateway
    ↓
Provider Adapter
    ↓
TTS Adapter
    ↓
Audio Output
```

---

### Phase 0.5: Desktop Island

Phase 0.5 adds an interface process in front of the same pipeline (ADR-033 to ADR-036):

```text
ZENO Island (Swift app)                      ZENO runtime (Node)
  hover reveal, Ctrl+Option, panel UI          voice loop → Core → LLM Gateway
        │  commands: talk.start, talk.send…         ▲
        └──────── stdin (JSON lines) ───────────────┘
        ┌──────── stdout (JSON lines) ──────────────┐
        ▼  events: state, mic.level, reply…         │
```

- The island is display and input only. It holds no conversation state and makes no model calls.
- The runtime is the Phase 0 program in island mode. The Core does not know which interface drives it.
- The island starts the runtime as its child process, restarts it if it exits, and stops it on quit.
- The message format is defined in `docs/island-protocol.md` and is the boundary between the two.

This is an interface for the Mac node only. It is not the future device protocol (`packages/protocol/`, Phase 7+).

---

## 4. Input Layer

Input sources may eventually include:

- microphone
- keyboard
- application UI
- mobile UI
- API
- external events

All input should eventually enter a normalized ZENO request model.

---

## 5. ZENO Core

The Core is the central orchestration boundary.

Responsibilities may include:

- request lifecycle
- context assembly
- routing
- task creation
- event handling
- response generation
- coordination

The Core should not become a giant class containing every subsystem.

---

## 6. Identity

Identity establishes:

- user
- account
- session
- device
- authorization context

Identity must be deterministic.

The LLM should not determine who the user is.

---

## 7. Context

Context may contain:

- User
- Session
- Conversation
- Task
- Project
- Device
- Permissions
- Relevant Memory
- Relevant Knowledge

Only authorized context should be provided to a model.

---

## 8. Deterministic Router

The router should determine whether a request can be handled directly.

Example:

```text
Request
 ↓
Router
 ├── deterministic capability
 ├── memory
 ├── knowledge
 ├── decision engine
 └── LLM
```

The router should avoid unnecessary model calls.

---

## 9. Decision Engine

The Decision Engine exists between deterministic logic and expensive/general reasoning.

Example:

```text
Request
 ↓
Deterministic Router
 ↓
Ambiguous?
 ↓
Decision Engine
 ↓
Select Path
```

Potential implementations:

- Laya
- Jev

The Decision Engine must be replaceable.

---

## 10. LLM Gateway

The LLM Gateway isolates ZENO from model providers.

```text
LLM Gateway
├── Claude Adapter
├── OpenAI Adapter
└── Future Adapter
```

Provider-specific logic belongs inside adapters.

---

## 11. Memory

Memory is persistent user-specific information.

Possible memory records:

```text
Memory
├── ID
├── Type
├── Content
├── Provenance
├── Confidence
├── Importance
├── Scope
├── Created At
├── Updated At
└── Lifecycle
```

Memory is separate from raw conversation history.

---

## 12. Knowledge

Knowledge represents information available to ZENO.

Knowledge may be:

- personal
- project
- team
- organization
- platform

Knowledge retrieval must respect permissions.

---

## 13. Knowledge Scope

```text
Platform
↓
Organization
↓
Team
↓
Project
↓
User
↓
Assistant
↓
Device
↓
Session
```

More specific scopes should not automatically override authorization boundaries.

---

## 14. Capability System

Capabilities represent controlled operations.

Example:

```text
calendar.create_event
calendar.list_events
calendar.update_event
calendar.delete_event
```

Capabilities contain metadata about:

- permissions
- devices
- credentials
- dependencies
- version
- health

---

## 15. Capability Manager

The Capability Manager:

- registers capabilities
- validates capabilities
- exposes available actions
- checks dependencies
- manages versions
- tracks health

It should not bypass the Policy Engine.

---

## 16. Policy Engine

The Policy Engine determines whether an action is allowed.

```text
Proposed Action
 ↓
Policy
 ↓
Permission
 ↓
Capability
 ↓
Device
 ↓
Execution
```

Policy decisions must not depend solely on an LLM.

---

## 17. Device Manager

The Device Manager maintains information about ZENO nodes.

Example:

```text
Device
├── Identity
├── Platform
├── Capabilities
├── Permissions
├── Connection
├── Health
└── Version
```

---

## 18. Device Registry

Example:

```text
Devices

Mac Mini
├── filesystem
├── applications
├── browser
└── audio

iPhone
├── microphone
├── notifications
└── mobile capabilities

Windows PC
├── filesystem
├── applications
└── desktop
```

Actual permissions depend on the device.

---

## 19. Tasks

Tasks represent work that can span multiple operations or time.

Example:

```text
Task
├── ID
├── User
├── Objective
├── Status
├── Steps
├── Permissions
├── Devices
├── Results
└── Provenance
```

---

## 20. Events

Events represent occurrences.

Examples:

- task completed
- calendar event approaching
- device connected
- application state changed

Events can trigger tasks or notifications where authorized.

---

## 21. Conversation vs Task

These concepts must remain separate.

A conversation is communication.

A task is work.

Example:

```text
Conversation:
"Can you prepare my report?"

Task:
Prepare report
├── find files
├── analyze
├── draft
└── save result
```

---

## 22. Multi-Device Execution

The user should not need to select the execution device.

Example:

```text
iPhone
 ↓
ZENO
 ↓
Capability Registry
 ↓
Mac
 ↓
Action
 ↓
Result
 ↓
ZENO
 ↓
iPhone
```

---

## 23. Cloud Architecture

Future:

```text
          ZENO CLOUD
               │
  ┌────────────┼────────────┐
  │            │            │
Memory      Knowledge    Tasks
  │            │            │
  └────────────┼────────────┘
               │
         Device Registry
               │
  ┌────────────┼────────────┐
  │            │            │
 Mac         iPhone       Windows
```

Cloud coordinates.

Local devices retain controlled authority.

---

## 24. Multi-User Architecture

Future hierarchy:

```text
Organization
 ├── Teams
 │    ├── Projects
 │    └── Shared Knowledge
 │
 └── Users
      ├── Personal Memory
      ├── Personal Knowledge
      └── Devices
```

Data must remain isolated by authorization scope.

---

## 25. Modular Monolith

Initial architecture should be modular.

Possible logical modules:

- Core
- Memory
- Knowledge
- Decision
- LLM
- Tools
- Capabilities
- Devices
- Policy
- Tasks
- Events

These do not need to be separate processes.

---

## 26. Future Distributed Architecture

Only when scale requires it may modules become services.

Potential future:

- API
- Core
- Memory Service
- Knowledge Service
- LLM Gateway
- Decision Service
- Capability Service
- Device Service
- Task Service
- Event Service
- Policy Service

This is future architecture, not Phase 0.

---

## 27. Observability

Eventually track:

- request ID
- task ID
- device ID
- provider
- model
- latency
- errors
- actions
- provenance

Sensitive data should not be logged unnecessarily.

---

## 28. Architectural Rule

Do not implement an architectural component until the current capability requires it.

The architecture describes where ZENO is going.

The task system determines what is built now.
