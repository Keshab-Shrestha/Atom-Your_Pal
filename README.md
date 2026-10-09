# ZENO

ZENO is a voice assistant for the Mac: a menu-bar app with a small companion, Wisp, that you talk to by holding two keys. Speech is turned into text and back on your Mac; the thinking is done by a remote AI model you choose.

## Quick start

### 1. Prerequisites

- macOS 14 or later (the app's minimum).
- Xcode Command Line Tools: `xcode-select --install`.
- Node.js 22.18 or later (`engines` in `package.json`; ZENO runs TypeScript directly). The app build prefers Homebrew's Node: `brew install node`.
- pnpm (the repo pins `pnpm@12.6.0`).
- ffmpeg and whisper.cpp, for the microphone and speech-to-text: `brew install ffmpeg whisper-cpp`.

### 2. Install and models

```sh
pnpm install
mkdir -p models
curl -L -o models/ggml-small.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
```

- **Whisper** (`models/ggml-small.en.bin`, about 470 MB) hears what you say to ZENO. Set `ZENO_STT_MODEL` in `.env` to use another file, e.g. the faster, less accurate `ggml-base.en.bin`.
- **Kokoro** (ZENO's voice, about 330 MB) downloads itself into `models/huggingface/` the first time ZENO speaks.
- **Parakeet** (dictation, about 450 MB) downloads itself the first time you dictate.

`pnpm voice:check` tests speech output and input on their own, with no AI: Kokoro speaks, Whisper transcribes it, then Whisper transcribes you. Its first run also downloads Kokoro.

### 3. Choose the AI

ZENO works with one of three providers. Pick one in the app under Settings → AI model, or set `ZENO_LLM_PROVIDER` in `.env` (`cp .env.example .env`). A choice made in Settings is saved in `config/island.json` and wins over `.env`.

| Provider | `ZENO_LLM_PROVIDER` | What it needs |
|---|---|---|
| Claude on your own Claude plan | `claude-plan` | No key. Claude Code installed and signed in (`claude auth login`). Set `ZENO_CLAUDE_PATH` if `claude` is not found. |
| Gemini | `gemini` | `GEMINI_API_KEY` in `.env` |
| Claude API (the default) | `claude` | `ANTHROPIC_API_KEY` in `.env` |

Only the selected provider needs a key. Keys stay in `.env`, which git ignores.

### 4. Build and open the app

Once per Mac, create a local signing identity, so macOS keeps ZENO's permissions across rebuilds:

```sh
apps/mac/island/make-signing-identity.sh
```

Then build and open:

```sh
pnpm island:build   # makes apps/mac/island/build/ZENO.app
pnpm island:open    # builds, then opens it
```

Without the signing identity the app is signed ad hoc, and macOS asks for every permission again after each rebuild. `ZENO.app` records where the project folder and Node.js are; rebuild it if either moves. ZENO has no Dock icon: look for its icon in the menu bar.

To run ZENO in the terminal without the app, use `pnpm start`.

### 5. Permissions

macOS asks for each one the first time ZENO needs it:

| Permission | When ZENO uses it |
|---|---|
| Microphone | Only while you hold the Talk keys or dictate. Speech is transcribed on this Mac and never recorded. |
| Input Monitoring | To notice the Talk and dictation keys in any app. It only listens; it cannot block or change keys. |
| Accessibility | Only to type dictated text into the app you were in. Without it, the text is left on the clipboard. |
| Automation | When you ask: Music or Spotify (play, pause, skip), Notes (add a note), and Chrome, Arc, Edge or Brave (the open tab's title and address). macOS asks once per app. |
| Calendar and Reminders | When you ask about your schedule or reminders, or ask ZENO to add a reminder. |

Talking to ZENO needs no Accessibility or Screen Recording. Computer control (off unless `ZENO_COMPUTER=1`) uses Cua Driver, which holds its own Accessibility and Screen Recording permissions.

### 6. First words

- Hold **Control + Option**, talk, and let go. ZENO answers out loud.
- Hold **Right ⌘ + Right ⌥** to dictate into any text field.
- Both shortcuts can be changed in Settings → Shortcuts. You can also type to ZENO in the Conversation tab.

Things to try:

- "Open Safari."
- "What's the weather in Tokyo?"
- "Set a timer for ten minutes."
- "Take a note: buy milk."
- "What's this page?" with Chrome or Brave in front.
- "Play some music." / "Pause the music."
- "What's on my calendar tomorrow?"
- "Remember that my project uses PostgreSQL."

### 7. Tests

```sh
pnpm test           # TypeScript tests (node --test)
pnpm typecheck      # tsc
pnpm island:test    # Swift tests for the app
pnpm test:live      # live tests against real models; need a key in .env
```

---

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

Phase 0.5 put that loop behind a desktop app, `ZENO.app` (`apps/mac/island/`, Swift): a menu-bar icon with a panel, Wisp, push-to-talk by holding Ctrl+Option in any app, and dictation. Phase 1 added memory, calendar and reminders, timers and weather; Phase 2 adds more things to do. See the Quick start above to build it, and STATUS.md and TASK.md for where things stand.

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

Supporting documents live in `docs/`: the Phase 0 task history, the speech-to-text benchmark, the dictation research, and the island protocol.

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
