# ATOM Engineering Constitution

This document defines how ATOM should be built.

It is intended for Claude Code and other coding agents working on the repository.

---

## 1. Prime Directive

> See the whole mountain. Climb only the next step.

Understand the complete ATOM architecture before making architectural decisions.

However, implement only the smallest capability required by the current task.

Do not prematurely implement future systems.

---

## 2. Build ATOM as a System

ATOM is not a chatbot.

Do not structure the project around a single LLM call.

The architecture must preserve boundaries between:

- Core
- Identity
- Context
- Routing
- Memory
- Knowledge
- Decision Engine
- LLM Gateway
- Tools
- Capabilities
- Devices
- Tasks
- Events
- Policy
- Permissions

Only implement the boundary when the current capability requires it.

---

## 3. One Capability at a Time

This is non-negotiable.

Do not combine unrelated capabilities into one implementation task.

For every task:

```text
Understand
↓
Define
↓
Implement
↓
Test
↓
Verify
↓
Document
↓
Stop
```

Do not continue automatically into unrelated work.

---

## 4. Before Coding

Before changing code, identify:

- What is the exact objective?
- What is the smallest change required?
- Which files need modification?
- What must remain unchanged?
- How will the change be tested?
- What could break?
- What future architectural boundary must be preserved?

If these questions cannot be answered, inspect the repository first.

---

## 5. Minimal Change Principle

Prefer:

- small changes
- isolated changes
- reversible changes
- understandable changes

Avoid:

- unnecessary refactors
- broad rewrites
- unrelated cleanup
- speculative abstractions
- large dependency additions

Do not modify code merely because it could be cleaner.

---

## 6. Long-Term Architecture vs Current Implementation

Always distinguish:

```text
Future Architecture
        ↓
Current Required Capability
        ↓
Minimum Implementation
```

Do not implement the entire future architecture merely because it has already been designed.

Architecture is a map.

It is not a checklist of things that must immediately exist.

---

## 7. LLM Architecture

All LLM access must go through an LLM Gateway.

Do not scatter provider-specific API calls throughout the codebase.

Preferred architecture:

```text
ATOM
  ↓
LLM Gateway
  ├── Claude
  ├── OpenAI
  └── Future Providers
```

Provider implementations must be replaceable.

---

## 8. LLMs Are Not the System of Record

Never use the LLM as the authoritative source for:

- permissions
- identity
- security
- memory
- configuration
- authorization
- device ownership
- capability access

The LLM can reason.

Deterministic software must decide.

---

## 9. Deterministic First

Prefer deterministic logic whenever it is sufficient.

Example:

```text
Request
 ↓
Deterministic Router
 ↓
Known operation?
 ├── Yes → execute
 └── No → continue
```

Do not invoke an LLM or Decision Engine unnecessarily.

---

## 10. Decision Engine

The Decision Engine is optional.

Potential implementations:

- Laya
- Jev
- future decision systems

Do not hard-code ATOM around one decision model.

Use an abstraction.

The Decision Engine should only be used when probabilistic decision-making provides meaningful value.

---

## 11. Local AI Policy

ATOM does not require a local general-purpose LLM.

Do not introduce Ollama or another local LLM runtime unless a future architectural decision explicitly requires it.

Local AI may still be used for:

- speech recognition
- speech synthesis
- deterministic processing
- device automation

Initial general-purpose reasoning should use remote providers.

---

## 12. Security

Never allow an LLM to directly bypass policy.

Preferred flow:

```text
LLM
 ↓
Proposed Action
 ↓
Policy Engine
 ↓
Permission Check
 ↓
Capability
 ↓
Device
 ↓
Execution
```

The model is not the authorization layer.

---

## 13. Privileged Operations

Do not use unrestricted:

- sudo
- root
- administrator
- system-level

access by default.

Use least privilege.

Sensitive actions should have explicit controls.

---

## 14. Secrets

Never hard-code:

- API keys
- tokens
- passwords
- private keys
- credentials

Never commit secrets.

Use environment configuration or an appropriate secret-management system.

---

## 15. Errors

Errors must be:

- explicit
- actionable
- observable
- structured where appropriate

Do not silently swallow failures.

Do not use broad exception handling merely to make tests pass.

---

## 16. Observability

Important operations should eventually provide:

- structured logs
- request identifiers
- task identifiers
- error information
- provenance
- execution information

Do not overbuild observability in Phase 0.

Implement only what the current system requires.

---

## 17. Testing

Every meaningful capability must have tests appropriate to its risk.

Prefer:

- unit tests
- integration tests
- end-to-end tests
- security tests

Do not claim completion without verification.

---

## 18. Dependencies

Before adding a dependency:

1. Determine whether the standard library is sufficient.
2. Determine whether an existing dependency already solves the problem.
3. Evaluate maintenance and security implications.
4. Add only when justified.

Do not add dependencies for convenience alone.

---

## 19. Git Discipline

Before finishing work:

```text
git status
git diff
```

Inspect the actual changes.

Do not commit unrelated changes.

Do not rewrite history unless explicitly requested.

---

## 20. Documentation Discipline

When architecture or behavior changes:

Update the relevant documentation.

At minimum consider:

- TASK.md
- STATUS.md
- DECISIONS.md
- ARCHITECTURE.md
- SECURITY.md

Do not update documents merely to create noise.

---

## 21. Completion Protocol

Every task ends with:

```text
STOP
↓
Run tests
↓
Verify behavior
↓
Inspect git diff
↓
Update TASK.md
↓
Update STATUS.md
↓
Update relevant architecture/security docs
↓
Identify the next task
↓
STOP
```

Do not automatically begin the next task.

---

## 22. Architecture Rule

Do not create a subsystem until the current capability needs it.

Examples:

- Do not build a knowledge graph before knowledge is required.
- Do not build distributed services before distribution is required.
- Do not build multi-user infrastructure before multi-user behavior is required.
- Do not build capability acquisition before capabilities exist.

---

## 23. Code Quality

Prefer code that is:

- boring
- obvious
- testable
- modular
- explicit
- easy to delete
- easy to replace

Avoid cleverness unless it solves a real problem.

---

## 24. ATOM Development Mentality

Think like a senior engineer operating under a strict complexity budget.

Ask:

What is the simplest implementation that preserves the architecture?

Then ask:

What is the smallest test proving it works?

Then stop.

---

## 25. Final Rule

Preserve the future without prematurely implementing it.
