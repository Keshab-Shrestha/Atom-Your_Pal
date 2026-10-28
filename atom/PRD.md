# ATOM Product Requirements Document

## Product

ATOM

---

## Positioning

> ATOM — The Intelligence Layer for Your Digital World.

---

## 1. Product Vision

ATOM is an AI-native intelligence layer designed to connect a person with their digital world.

It should eventually understand:

- who the user is
- what they are doing
- what they know
- what ATOM remembers
- what devices are available
- what capabilities exist
- what actions are allowed
- which model should reason
- which device should execute
- what happened previously

The user should interact with ATOM as one continuous intelligence rather than a collection of disconnected applications.

---

## 2. Problem

Modern AI assistants are often fragmented.

A user may have:

- one chatbot
- another voice assistant
- separate automation tools
- separate applications
- separate memories
- separate devices
- separate AI providers

These systems often lack a unified identity, context, memory, and execution layer.

ATOM aims to provide that missing layer.

---

## 3. Product Principle

ATOM should become:

```text
One Intelligence
+
One Identity
+
One Context
+
One Memory
+
Many Capabilities
+
Many Devices
+
Many Models
```

---

## 4. Users

Initial user:

A technically capable individual using a Mac and other personal devices.

Long-term users:

- individuals
- professionals
- developers
- teams
- organizations

---

## 5. Core User Experience

The user should be able to communicate naturally.

Examples:

- "Hey ATOM."
- "Remember that this project uses PostgreSQL."
- "What was I working on yesterday?"
- "Open my project."
- "Create a reminder for tomorrow."
- "Handle this."

ATOM should determine the appropriate internal path.

---

## 6. Core Functional Areas

### Identity

ATOM knows which authenticated user is making a request.

### Context

ATOM understands relevant:

- session context
- task context
- device context
- project context
- user context

### Memory

ATOM stores useful long-term information.

Memory must have:

- provenance
- confidence
- timestamp
- importance
- scope
- permissions
- lifecycle

### Knowledge

ATOM can access knowledge from:

- personal sources
- projects
- teams
- organizations
- authorized external systems

### Reasoning

ATOM may use LLMs for:

- language understanding
- reasoning
- summarization
- planning
- interpretation
- generation

### Decision Making

ATOM may use a Decision Engine when deterministic routing is insufficient.

Potential systems:

- Laya
- Jev
- future systems

### Tools

ATOM can eventually interact with applications and services.

Examples:

- calendar
- email
- browser
- filesystem
- terminal
- productivity applications

### Tasks

A task represents work that may take time or multiple actions.

Example:

- "Prepare the project report."

### Events

An event represents something that happened or should trigger behavior.

Examples:

- scheduled event
- device event
- application event
- task completion

### Devices

Devices become ATOM nodes.

Potential devices:

- Mac
- iPhone
- Windows PC
- Web
- future devices

---

## 7. Device Abstraction

The user should not need to choose the execution device.

Example:

```text
User
 ↓
iPhone
 ↓
ATOM
 ↓
Capability Registry
 ↓
Mac
 ↓
Execute
 ↓
Result
 ↓
ATOM
 ↓
iPhone
```

---

## 8. Capability System

Capabilities represent controlled functionality.

Example:

```text
calendar
├── list_events
├── create_event
├── update_event
└── delete_event
```

Capabilities must specify:

- actions
- permissions
- devices
- credentials
- dependencies
- version
- health

---

## 9. Security Requirements

The system must enforce:

- least privilege
- deterministic authorization
- credential isolation
- device authorization
- capability permissions
- auditability
- provenance

LLMs must not directly control authorization.

---

## 10. Multi-User Requirements

Long-term ATOM must support:

- multiple accounts
- isolated personal data
- team spaces
- organization spaces
- shared knowledge
- permissions
- invitations

---

## 11. Provider Requirements

ATOM must not be coupled to a single LLM provider.

Initial provider:

- one remote provider

Future providers:

- Claude
- OpenAI
- others

All should use the LLM Gateway.

---

## 12. Phase 0 Product

Phase 0 is deliberately narrow.

```text
Voice
 ↓
Whisper
 ↓
ATOM Core
 ↓
LLM Gateway
 ↓
Remote LLM
 ↓
TTS
 ↓
Voice
```

---

## 13. Phase 0 Acceptance Criteria

A user can speak a request and hear a generated response.

The system must:

- reliably capture audio
- transcribe it
- process the request
- call the remote provider
- generate a response
- synthesize speech
- play the result

---

## 13a. Phase 0.5 Product — Desktop Island

Phase 0.5 makes the Phase 0 loop usable day to day (ADR-033).

The user can:

- hold Ctrl+Option in any app, speak, and release to send
- see ATOM's state (listening with a level meter, thinking, speaking) in a small dark glass island at the left edge of the screen, below the menu bar
- reveal the island by pushing the pointer against that edge, and click it to read the conversation, see status details, and choose the AI provider and model

When idle, nothing is on screen. ATOM's intelligence is unchanged from Phase 0.

---

## 14. Non-Goals for Phase 0

Phase 0 does not include:

- persistent memory
- RAG
- teams
- multi-user
- cloud synchronization
- iOS
- Windows
- computer control
- autonomous capability acquisition
- multi-agent systems
- Kubernetes
- microservices
- local general-purpose LLM

---

## 15. Product Evolution

ATOM should evolve approximately:

```text
Voice Foundation
 ↓
Memory
 ↓
Mac Tools
 ↓
Computer Control
 ↓
Decision Engine
 ↓
Laya / Jev
 ↓
Knowledge
 ↓
iOS
 ↓
Windows
 ↓
Teams
 ↓
Cloud
 ↓
Multi-Device
 ↓
Multi-User
 ↓
Capability Discovery
 ↓
Advanced Intelligence
```

This is directional rather than a strict schedule.

---

## 16. Product Success

Long-term success means the user can interact with their digital environment through one consistent intelligence while maintaining:

- control
- privacy
- security
- portability
- model independence
- device independence
- understandable system behavior
