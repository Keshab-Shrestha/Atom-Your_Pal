# ZENO Task Plan

## Prime Rule

> Build ZENO one capability at a time.

The existence of a large architecture does not mean the entire architecture should be implemented now.

---

## 1. Development Loop

Every task follows:

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

Do not automatically continue to another task.

---

## 2. Current Phase

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

## 3. Phase 0 Objectives

The system must support:

- microphone input
- speech-to-text
- ZENO Core
- request processing
- LLM Gateway
- one remote LLM provider
- response generation
- text-to-speech
- audio output
- configuration
- logging
- error handling
- tests

---

## 4. Explicitly Deferred

Do not implement these during Phase 0 unless a task explicitly requires them:

- persistent memory
- RAG
- knowledge graph
- team knowledge
- multi-user infrastructure
- cloud synchronization
- iOS node
- Windows node
- Mac computer-control system
- capability acquisition
- autonomous agent orchestration
- Kubernetes
- microservices
- distributed architecture
- local general-purpose LLM
- Ollama

---

## 5. Task Sequence

### Task 0.1 — Repository Foundation ✅ Done (2026-10-01)

Create the minimum repository structure.

Requirements:

- project metadata
- git repository, with a `.gitkeep` in each empty placeholder folder
- Phase 0 code placed in the existing scaffold (see PROJECT_STRUCTURE.md §5)
- test directory
- configuration mechanism
- basic documentation

Definition of done:

- project starts
- test framework works
- repository is clean

Completed:

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.json` (TypeScript 7, strict, runs `.ts` directly on Node 22)
- `pnpm start` runs `apps/mac/src/main.ts`, loading `.env` if present
- `pnpm test` runs `node:test` (built into Node, no test dependency); smoke test passes
- `pnpm typecheck` passes
- `.gitignore` excludes `node_modules/` and `.env`; `.env.example` added
- git initialized on `main`, 20 `.gitkeep` placeholders, nothing committed yet

Known limitations: configuration mechanism is only `.env` loading; Task 0.2 adds validated configuration.

### Task 0.2 — Configuration ✅ Done (2026-10-01)

Implement centralized configuration.

Requirements:

- environment support
- provider configuration
- audio configuration
- logging configuration

Do not hard-code credentials.

Completed:

- `packages/shared/src/config.ts`: `loadConfig()` reads environment variables into one typed `Config` (`llm`, `audio`, `log`)
- Only `ANTHROPIC_API_KEY` is required; defaults: model `claude-sonnet-5`, timeout 30 s, input device `:0`, 16 kHz, log level `info`
- Invalid values are validated and all problems are reported at once in one `ConfigError`; secret values never appear in errors
- `apps/mac` loads configuration at startup and exits with code 1 and a clear message if it is invalid
- `.env.example` documents every variable
- Tests: 5 unit tests for configuration, 2 startup tests (valid / invalid configuration); 7/7 pass, typecheck passes

Known limitations: logging configuration is only the level setting; the logger itself is built when first needed.

### Task 0.3 — Audio Input ✅ Done (2026-10-01)

Implement microphone input.

Requirements:

- detect microphone
- capture audio
- provide audio data to the speech layer
- handle device errors

Completed:

- `apps/mac/src/audio.ts`: `startRecording()` captures the microphone through ffmpeg (AVFoundation) as mono 16-bit PCM at the configured sample rate (16 kHz, what Whisper expects); `stop()` returns an `AudioClip` (`pcm`, `sampleRate`, `durationMs`) for the speech layer
- `listAudioDevices()` detects microphones; `peakLevel()` reports input level
- Errors are `AudioError`s with actionable messages: ffmpeg missing (install hint), device unavailable (ffmpeg's error + permission hint), no audio captured. Failures during recording are reported immediately, not only on stop
- If ffmpeg does not exit after an interrupt, it is killed after 2 s (some devices, e.g. Continuity microphones, can stall)
- Default input device changed from `:0` to `:default` (the macOS default input), since device indexes change when devices connect
- `pnpm start` is interactive: Space starts/stops recording (push-to-talk as a toggle, see ADR-027), `d` lists microphones, `q` quits
- Tests: 8 unit tests with a fake ffmpeg process (15/15 total pass, typecheck passes). Verified by hand against the real microphone: recording, device listing and an invalid-device error

Known limitations: push-to-talk is a key toggle, because a terminal cannot detect a held key. True hold-to-talk needs the native Mac app.

### Task 0.4 — Whisper Adapter

Integrate Whisper.cpp.

Requirements:

```text
Audio
 ↓
Whisper Adapter
 ↓
Text
```

The rest of ZENO should not depend directly on Whisper implementation details.

### Task 0.5 — ZENO Core

Create the central request/response boundary.

Responsibilities:

- receive user input
- establish request context
- route the request
- return a response

Keep it small.

### Task 0.6 — LLM Gateway

Create provider-independent LLM access.

Target:

```text
ZENO Core
 ↓
LLM Gateway
 ↓
Provider Adapter
```

The Core should not contain provider-specific API calls.

### Task 0.7 — First Remote Provider

Implement one remote LLM provider.

The provider must be behind the LLM Gateway.

Credentials must remain outside source code.

### Task 0.8 — TTS

Implement text-to-speech.

Target:

```text
ZENO Response
 ↓
TTS Adapter
 ↓
Audio
```

Keep TTS implementation replaceable.

### Task 0.9 — Connect Voice Loop

Connect:

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

### Task 0.10 — Error Handling

Handle:

- microphone failure
- transcription failure
- provider failure
- timeout
- malformed response
- TTS failure
- configuration failure

Errors should be observable.

### Task 0.11 — End-to-End Test

Verify the complete Phase 0 path.

The system must:

- accept voice input
- transcribe it
- process it
- call the LLM
- receive a response
- synthesize the response
- produce audible output

---

## 6. Definition of Done

A task is done only when:

- implementation exists
- relevant tests pass
- behavior is verified
- no unrelated changes remain
- documentation is updated if necessary
- STATUS.md reflects reality
- TASK.md reflects progress

---

## 7. Task Completion Template

```text
Task:
Objective:

Files changed:

Implementation:

Tests:

Verification:

Known limitations:

Documentation updated:

Next task:

STOP
```

---

## 8. Rules

Never:

- implement several unrelated tasks simultaneously
- refactor unrelated code
- introduce speculative infrastructure
- add unnecessary dependencies
- claim tests passed without running them
- claim functionality works without verifying it

---

## 9. Current Priority

The only priority is:

Establish a reliable Phase 0 voice loop.

Everything else waits.
