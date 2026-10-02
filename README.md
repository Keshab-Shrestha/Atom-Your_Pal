# ZENO

## The Intelligence Layer for Your Digital World

ZENO is an AI-native personal intelligence system designed to sit between a person and their digital world.

ZENO is not intended to be merely a chatbot or voice assistant.

It is designed to become a unified intelligence layer that can understand requests, maintain context and memory, reason over knowledge, make decisions, use capabilities, interact with devices, execute tasks, and coordinate activity across a user's digital environment.

The long-term goal is:

> One intelligence. Multiple devices. One continuous context.

---

## 1. Vision

ZENO should eventually allow a person to interact with their digital world through one consistent intelligence.

For example:

> "Hey Zeno, what was I working on yesterday?"

> "Zeno, remember that this project uses PostgreSQL."

> "Zeno, open the project."

> "Zeno, create a reminder for tomorrow."

> "Zeno, send this to my computer."

> "Zeno, handle this."

The user should not need to understand which model, device, service, application, or internal capability performs the work.

ZENO should determine the appropriate path.

---

## 2. What ZENO Is

ZENO combines several systems:

- Voice interface
- Text interface
- Identity
- Context
- Memory
- Knowledge
- Reasoning
- Decision making
- LLM routing
- Tools
- Applications
- Tasks
- Events
- Devices
- Permissions
- Capabilities
- Synchronization
- Team knowledge
- Cloud services
- Observability
- Provenance

The system should gradually grow into these capabilities rather than implementing everything at once.

---

## 3. Core Philosophy

ZENO follows one fundamental development principle:

> See the whole mountain. Climb only the next step.

The architecture should account for the eventual system.

The implementation should only contain what the current capability requires.

This prevents both:

- short-term hacks that make future development painful
- premature complexity that slows development

---

## 4. System Principles

### 4.1 ZENO is a system, not a chatbot

The LLM is one component inside ZENO.

It is not ZENO itself.

### 4.2 LLMs are reasoning engines

LLMs should not be treated as:

- the source of truth
- the authorization system
- the database
- the identity system
- the permission system

### 4.3 Deterministic systems come first

If a request can be handled deterministically, ZENO should not invoke a probabilistic reasoning system unnecessarily.

### 4.4 Providers are replaceable

ZENO should not be architecturally dependent on one LLM provider.

The system should support:

- Claude
- OpenAI
- future providers

through a common LLM Gateway.

### 4.5 Security is outside the model

The model can propose an action.

The system decides whether the action is allowed.

### 4.6 Devices are nodes

A Mac, iPhone, Windows PC, or future device should be treated as a node in the ZENO system.

The user should not need to manually choose which device performs an operation.

---

## 5. High-Level Architecture

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

This is the long-term architecture.

It is not the Phase 0 implementation.

---

## 6. Phase 0

The first implementation should be intentionally small.

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

Phase 0 establishes the fundamental ZENO request/response loop. It is complete (2026-10-02).

Phase 0.5 (current) puts that loop behind a desktop island: a dark glass island hidden past the left edge of the screen below the menu bar, revealed by hovering, with push-to-talk by holding Ctrl+Option in any app. See ROADMAP.md and TASK.md.

The island app is built from `apps/mac/island/` (Swift; needs the Xcode Command Line Tools):

```sh
pnpm island:build   # makes apps/mac/island/build/ZENO.app
pnpm island:open    # build and launch it
pnpm island:test    # Swift tests
```

`ZENO.app` records where the project folder and Node.js are; rebuild it if either moves. Push the pointer against the left edge of the screen, just below the menu bar, and the island slides in showing ZENO's state and model; move away and it slides back. Talking from the island arrives with Task 0.5.5.

---

## 7. Phase 0 Goals

Phase 0 should provide:

- microphone input
- local speech-to-text
- ZENO Core
- LLM Gateway
- one remote LLM provider
- text response
- text-to-speech
- audio output
- configuration
- logging
- error handling
- basic tests

Phase 0 should remain small.

---

## 8. Local and Remote AI

ZENO intentionally separates local and remote intelligence.

Initial design:

### Local

- microphone processing
- Whisper.cpp
- TTS
- device interaction
- deterministic routing
- security
- permissions

### Remote

- frontier LLM reasoning

ZENO does not require a local general-purpose LLM.

Ollama is not a required dependency.

---

## 9. Decision Engine

ZENO may eventually contain a Decision Engine.

The Decision Engine exists for situations where deterministic routing is insufficient.

Potential implementations include:

- Laya
- Jev
- future decision systems

The Decision Engine should not be invoked for every request.

A typical flow is:

```text
Request
  ↓
Deterministic Router
  ↓
Can this be decided deterministically?
  ├── Yes → route directly
  └── No
       ↓
Decision Engine
       ↓
Determine appropriate path
```

---

## 10. Memory

ZENO should maintain memory independently of the LLM.

Memory may include:

- user facts
- preferences
- project information
- important events
- previous decisions
- relationships
- long-term context

Memory should not simply be a transcript of every conversation.

Memory should have:

- provenance
- timestamp
- confidence
- importance
- scope
- permissions
- lifecycle

---

## 11. Knowledge

Knowledge and memory are related but different.

Knowledge may belong to:

- user
- project
- team
- organization
- platform

A possible scope hierarchy is:

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

Authorization must happen before private information enters model context.

---

## 12. Devices

ZENO should eventually support:

- macOS
- iOS
- Windows
- Web
- Cloud

Each device can become a ZENO node.

For example:

```text
iPhone
  ↓
ZENO
  ↓
Device Registry
  ↓
Mac
  ↓
Execute Action
  ↓
Result
  ↓
ZENO
  ↓
iPhone
```

The user should not need to know that the Mac performed the action.

---

## 13. Capabilities

ZENO should eventually have a capability system.

Example:

"Hey Zeno, give yourself a calendar."

This should not mean that the AI receives unrestricted access.

Capabilities must be:

- controlled
- validated
- sandboxed
- permissioned
- versioned
- auditable

A capability can contain:

```text
Capability
├── Identity
├── Description
├── Actions
├── Permissions
├── Credentials
├── Devices
├── Dependencies
├── Version
└── Health Status
```

---

## 14. Security

The fundamental security principle is:

The model can request. The system decides.

ZENO should use:

- least privilege
- deterministic authorization
- explicit permissions
- capability boundaries
- credential isolation
- audit logs
- provenance
- confirmation for sensitive actions

ZENO should not provide unrestricted root or administrator access by default.

---

## 15. Multi-User Future

The long-term product is not necessarily limited to one person.

ZENO should eventually support:

- multiple users
- personal knowledge
- personal memory
- team spaces
- organization spaces
- shared knowledge
- permissions
- invitations
- cloud synchronization

Personal data should remain separate unless explicitly shared.

---

## 16. Cloud

The long-term ZENO platform can contain:

```text
ZENO Cloud
├── Identity
├── Authentication
├── User Data
├── Memory
├── Knowledge
├── Tasks
├── Events
├── Device Registry
├── Capability Registry
├── LLM Gateway
├── Synchronization
└── Policy
```

Cloud services should coordinate devices without automatically receiving unrestricted control over them.

---

## 17. Development Philosophy

ZENO should initially be a modular monolith.

Do not begin with:

- Kubernetes
- dozens of microservices
- distributed systems
- complex orchestration
- unnecessary databases
- premature cloud infrastructure

Build the smallest system that can evolve into the larger system.

---

## 18. Documentation

The canonical ZENO documentation set is:

- README.md
- CLAUDE.md
- TASK.md
- PRD.md
- ARCHITECTURE.md
- ROADMAP.md
- SECURITY.md
- PROJECT_STRUCTURE.md
- DECISIONS.md
- STATUS.md

These documents should remain consistent.

Supporting documents live in `docs/`: the Phase 0 task history, the speech-to-text benchmark, and (from Phase 0.5) the island protocol.

---

## 19. Phase 0 Definition of Success

Phase 0 is successful when a user can:

```text
Speak
  ↓
Whisper transcribes
  ↓
ZENO receives request
  ↓
LLM Gateway sends request
  ↓
Remote LLM responds
  ↓
ZENO receives response
  ↓
TTS generates speech
  ↓
User hears response
```

The implementation should be reliable, observable, testable, and small.

---

## 20. Final Principle

Build the smallest system that can become the larger system.
