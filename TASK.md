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

### Task 0.4 — Whisper Adapter ✅ Done (2026-10-01)

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

Completed:

- `apps/mac/src/stt.ts`: `SpeechToText` interface (`transcribe(clip) → text`) and `createWhisperStt()`, which runs the local `whisper-cli` (Homebrew `whisper-cpp`) on a temporary WAV file that is always deleted afterwards
- Whisper's non-speech markers (`[BLANK_AUDIO]`, `(music)`) are stripped; silence returns `""`
- Model: `ggml-base.en.bin` (148 MB) in `models/`, which is git-ignored. Configurable with `ZENO_STT_MODEL` and `ZENO_STT_LANGUAGE`
- Errors are `SttError`s: model missing (with the exact download command), whisper-cli missing (install hint), timeout, and whisper failures with its error message
- `pnpm start` now transcribes each recording and prints the text and how long it took
- Tests: 7 new tests (22/22 total pass, typecheck passes), including one that runs real whisper.cpp on speech generated by `say` (skipped if the model is absent). Verified by hand: microphone → text in 0.4 s for a 1.8 s clip

Setup on a new machine: `brew install whisper-cpp` and download the model into `models/` (the error message prints the command).

Known limitations: base.en misspells unusual names (e.g. "Zeno" → "Zino"). A larger model or a vocabulary prompt can fix this later if it matters.

### Task 0.5 — ZENO Core ✅ Done (2026-10-01)

Create the central request/response boundary.

Responsibilities:

- receive user input
- establish request context
- route the request
- return a response

Keep it small.

Completed:

- `packages/contracts/src/index.ts`: shared types only — `ZenoInput` (normalized input with `source`), `RequestContext`, `ZenoResponse`, `Message`, and the `LanguageModel` interface the LLM Gateway will implement
- `services/core/src/core.ts`: `createCore({ model })` returns a `Core` with `handle(input)`, `history()` and `reset()`
  - establishes a `RequestContext` per request (request id, session id, source, time)
  - routes to the language model (the only route in Phase 0), sending a short system prompt written for spoken replies plus the session history
  - keeps session-only history (ADR-030), bounded to the last 20 exchanges; failed requests are not recorded
  - rejects empty input, empty replies, and a second request while one is in flight; a reply arriving after `reset()` is not added to the new session
- The Core depends only on `@zeno/contracts`; it knows nothing about Claude, Whisper or audio
- Tests: 8 tests with a fake model (30/30 total pass, typecheck passes)

Not yet wired into `apps/mac`: the Core needs a real model, which arrives with the LLM Gateway (Tasks 0.6–0.7). The full chain is connected in Task 0.9.

### Task 0.6 — LLM Gateway ✅ Done (2026-10-01)

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

Completed:

- `services/llm-gateway/src/gateway.ts`: `createGateway({ provider, timeoutMs })` implements the Core's `LanguageModel` interface on top of any `ProviderAdapter`
- `ProviderAdapter` is the contract every provider implements (`name`, `complete(request, signal)`); all provider-specific code stays inside adapters
- Timeout: each call is aborted after `ZENO_LLM_TIMEOUT_MS` (default 30 s); timeouts are not retried
- Retry: one extra attempt, with a short delay, for transient failures (rate limits, network/provider outages); auth and bad-request errors fail immediately
- Errors: adapters throw `ProviderError` with a provider-independent kind (`auth`, `rate_limit`, `unavailable`, `timeout`, `bad_request`, `unknown`); only `GatewayError` leaves the gateway, and its message is scrubbed of anything that looks like an API key or bearer token
- Tests: 7 tests with a fake provider (37/37 total pass, typecheck passes)

Not yet usable end to end: no real provider exists until Task 0.7.

### Task 0.7 — First Remote Provider ✅ Done (2026-10-01) — verified live with Gemini; Claude live check pending credits

Implement one remote LLM provider.

The provider must be behind the LLM Gateway.

Credentials must remain outside source code.

Completed:

- `services/llm-gateway/src/providers/claude.ts`: `createClaudeAdapter({ apiKey, model })` implements `ProviderAdapter` with the official `@anthropic-ai/sdk` (0.129). All Anthropic-specific code lives in this one file
- The SDK's own retries are disabled; timeout and retry are handled once, by the gateway. The gateway's abort signal cancels the HTTP request
- Anthropic errors map to gateway error kinds: 401/403 → `auth` (hint: check `ANTHROPIC_API_KEY`), 429 → `rate_limit`, 5xx/529 → `unavailable`, other 4xx → `bad_request` (404 hints at `ZENO_LLM_MODEL`), network failure → `unavailable`. Only Anthropic's human-readable message is kept, never headers or request details
- The key is read from `.env` (git-ignored, now `chmod 600`) and never logged
- Tests: 11 unit tests with a fake client (48/48 total pass, typecheck passes), plus `pnpm test:live`, which calls the real API and is skipped in the normal test run

Live check result: the key authenticates, but the Anthropic account has no API credits (`HTTP 400: Your credit balance is too low`). The error surfaces correctly as a clear, non-retried `bad_request`. Remaining step: add credits in the Anthropic Console, then run `pnpm test:live`.

Gemini added as a second provider (ADR-031):

- `services/llm-gateway/src/providers/gemini.ts`: `createGeminiAdapter()` with the official `@google/genai` SDK (2.24); maps the assistant role to Gemini's `model` role, disables SDK retries, and maps Google errors to gateway kinds (an invalid key, which Google reports as HTTP 400, becomes `auth`; blocked replies are reported with their reason)
- `providers/index.ts`: `createProviderAdapter()` picks the adapter from configuration — the only code that knows every provider
- Configuration: `ZENO_LLM_PROVIDER` (`claude` default, or `gemini`); only the selected provider's key (`ANTHROPIC_API_KEY` or `GEMINI_API_KEY`) is required; default models `claude-sonnet-5` / `gemini-3.5-flash`
- Install scripts for `@google/genai` and `protobufjs` are denied in `pnpm-workspace.yaml` (not needed)
- `pnpm test:live` now tests whichever provider is configured
- Tests: 12 Gemini unit tests, 2 new config tests (61/61 pass, 1 live test skipped, typecheck passes)

Gemini live check: passed (2026-10-01) with `gemini-3.5-flash` on the free tier. Verified through Core → Gateway → Gemini, including multi-turn memory within the session ("What is my name?" → "Your name is Keshab.") and a clear error for an unknown model.

Latency (measured): with default thinking, replies took 2.5–12 s. The adapter now sets thinking to MINIMAL, which brings typical replies to about 1.3–2.2 s with correct answers. Occasionally a first request after a pause takes ~20 s on the free tier; this is on Google's side and stays within the 30 s timeout. Free-tier limit: 5 requests per minute for this model. Quota errors are trimmed to Google's first line.

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
