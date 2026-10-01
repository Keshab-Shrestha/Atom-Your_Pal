# Phase 0 — Voice Foundation: Task History

Completed 2026-10-02. Moved here from TASK.md when Phase 0.5 began, unchanged except for heading levels.

Current work is in TASK.md.

---

## 1. Phase

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

## 2. Phase 0 Objectives

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

## 3. Explicitly Deferred

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

## 4. Task Sequence

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

Update 2026-10-02 (ADR-032): default changed to `ggml-small.en.bin` (466 MB) with a vocabulary prompt (`ZENO_STT_VOCABULARY`). Word errors fell from 9.8% to 2.4% for about 0.3 s more per turn; see `docs/stt-benchmark.md`.

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

### Task 0.8 — TTS ✅ Done (2026-10-01)

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

Done (2026-10-01):

- `apps/mac/src/tts.ts`: `TextToSpeech` boundary (`warmUp()`, `speak(text, signal)`); the rest of ZENO depends only on this
- Kokoro-82M (ADR-029) through `kokoro-js`, running in a worker thread (`tts-worker.ts`). Synthesis is CPU-bound and froze the main thread for up to 2.4 s per sentence; in the worker the longest main-thread stall measured 18 ms
- Replies are spoken sentence by sentence into one continuous audio stream: playback starts once the first sentence is ready, and later sentences are synthesized while earlier ones play (synthesis runs at about 0.45× real time)
- Playback: raw samples piped to `ffmpeg -f audiotoolbox` (the macOS default output). `afplay` was tried first but adds ~1.5 s of latency per file and leaves gaps between sentences
- Interruption: aborting stops playback immediately (measured: returns within 2 ms of the abort). Starting a recording stops ZENO speaking
- Model: `q8` (~90 MB) by default, kept in `models/huggingface/` (git-ignored); downloaded on first run, then works offline. Voice and precision set by `ZENO_TTS_VOICE` (default `af_heart`) and `ZENO_TTS_DTYPE` (`q8` or `fp32`)
- `pnpm start` loads the voice in the background at startup (~0.4 s once downloaded); press `t` to hear a test sentence
- Install scripts for `onnxruntime-node` and `sharp` are denied (not needed on macOS arm64)
- Tests: 10 unit tests (fake synthesizer and audio output), 2 real-Kokoro tests that run when the model is present; 75/75 pass (plus 1 skipped live-provider test), typecheck passes

Measured on this Mac: first sound 2.3–2.5 s after the text arrives for a 17-word first sentence; a 12.1 s reply finished in 14.7 s.

### Task 0.9 — Connect Voice Loop ✅ Done (2026-10-01)

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

Done (2026-10-01):

- `apps/mac/src/voice-loop.ts`: one turn at a time (idle → listening → transcribing → thinking → speaking); `main.ts` only assembles the parts and prints events
- Controls: Space talks, sends, and interrupts; Esc cancels; `r` starts a new conversation; `t` tests the voice; `q` quits
- Interruption at every stage: pressing Space while ZENO is thinking cancels the model request (cancellation now runs through Core → gateway → provider, and is never retried); while speaking it stops the audio at once
- "Listening" is shown only once the microphone is actually capturing, so the start of speech is not lost
- Silence and accidental short presses give a notice instead of a request; every error names the stage that failed and the loop is ready again
- Speech starts sooner: a long first sentence is split at its first comma (first sound 3.2 s → 1.6 s after the reply in one measured case)
- `LOG_LEVEL=debug` prints per-stage timings
- Gemini: default model changed to `gemini-3.6-flash` (ADR-031 updated). On the test day, `gemini-3.5-flash` took about 9.5 s per reply on Google's side, and its free daily quota (20 requests) ran out; 3.6 Flash measured 1.4–1.6 s. Models that reject minimal thinking (3.7/3.8 Flash) now fall back to low automatically, and a used-up daily quota explains when it resets and what to do
- Tests: 12 voice-loop unit tests with fakes; `voice-loop.live.test.ts` runs the real chain (speech made with `say` → Whisper → Gemini → Kokoro → speakers) with a two-turn memory check. 90/90 unit tests pass, typecheck passes, both live tests pass

Measured end to end (live test): transcription 0.26–0.43 s, model 1.4 s, first sound 0.9 s after the reply, about 2.7 s from the end of speech to ZENO's first word.

Not verified by me: a person speaking into the real microphone in `pnpm start`. The app was driven with real key presses and the microphone opened and captured, but the default input could not hear the test audio (output goes to headphones). To verify: `pnpm start`, press Space, speak, press Space.

### Task 0.10 — Error Handling ✅ Done (2026-10-01)

Handle:

- microphone failure
- transcription failure
- provider failure
- timeout
- malformed response
- TTS failure
- configuration failure

Errors should be observable.

Done (2026-10-01). Each case was triggered for real and its message checked; every message names what failed and what to do, and ZENO is ready for the next turn afterwards:

| Case | How it was triggered | What ZENO says now |
|---|---|---|
| Microphone failure | device `:9` | the microphone is not available; press `d` to list microphones and set `ZENO_AUDIO_INPUT_DEVICE` (was raw ffmpeg output) |
| Microphone permission | unit test (cannot revoke safely) | allow the terminal app in System Settings → Privacy & Security → Microphone |
| Transcription failure | missing model file | the model is not found, with a download command for standard model names, or how to set `ZENO_STT_MODEL` (was a broken link for unknown names) |
| Provider failure | bad key, unreachable host, Claude without credits | auth / unavailable / bad request, naming the setting to check; unavailable is retried once |
| Timeout | 50 ms limit | no reply within the limit; `ZENO_LLM_TIMEOUT_MS` sets it |
| Malformed response | fake replies: empty, refused, cut off, unreadable | declined / cut off / no text, with the reason code (was a raw JavaScript error such as "Cannot read properties of null") |
| TTS failure | unknown voice | lists the available voices; Kokoro restarts by itself if it crashes |
| Configuration failure | provider `openai` | lists each bad setting and exits before starting |

Also fixed:

- Quitting (q or Ctrl+C) while ZENO was speaking crashed the app (ONNX runtime abort, exit 134). Kokoro now runs in its own process, which is killed cleanly; a Kokoro crash can no longer take ZENO down
- Replies with markdown or emoji are cleaned before speaking, so symbols are not read aloud
- An unexpected bug is logged and explained instead of printing a bare stack trace

Observable: `packages/shared/src/log.ts` writes a structured log (JSON Lines) to `logs/zeno.log` (`ZENO_LOG_FILE`, git-ignored): app start and quit, voice ready, each turn's request ID and stage timings, and each failure's stage, error kind and message. Following SECURITY.md §21, it records what happened, never what was said; checked by searching the log after a live conversation.

Tests: 100/100 unit tests pass (2 live tests skipped in the normal run), typecheck passes, both live tests pass (`pnpm test:live`).

### Task 0.11 — End-to-End Test ✅ Done (2026-10-02)

Verify the complete Phase 0 path.

The system must:

- accept voice input
- transcribe it
- process it
- call the LLM
- receive a response
- synthesize the response
- produce audible output

Done (2026-10-02). Verified two ways:

- By the user, speaking into the real microphone with `pnpm start` (Gemini 3.6 Flash). Four turns completed on 2026-10-02 00:34 JST; the user judged the speed very good and, after the fixes below, was satisfied with transcription and the microphone. Timings from `logs/zeno.log`:

| Turn | Speech | Transcription | Model | First sound |
|---|---|---|---|---|
| 1 | 4.9 s | 0.64 s | 1.36 s | 1.21 s |
| 2 | 2.8 s | 0.40 s | 2.38 s | 0.94 s |
| 3 | 1.7 s | 0.41 s | 1.68 s | 1.16 s |
| 4 | 1.9 s | 0.28 s | 1.62 s | 1.02 s |

- Automatically, by `pnpm test:live`: real Whisper, Core, gateway, Gemini and Kokoro on recorded speech, two turns with conversation memory ("What is my name?" → "Your name is Kesheb."). Last full pass 2026-10-02 00:46 JST.

Interrupting ZENO mid-reply is covered by unit tests and was checked with the real speaker in Task 0.8; the user did not report on it separately.

Issues found during the test and fixed:

| Issue | Fix |
|---|---|
| Transcription misheard names ("Kathmandu" → "Cartman do") | Whisper small.en plus a vocabulary prompt; word errors 9.8% → 2.4% (ADR-032) |
| Pressing Space before the microphone started gave a misleading error | Says to wait for "Listening… speak now" |
| ZENO stopped hearing the user mid-conversation: macOS switched its default input to a silent device | ZENO shows the microphone in use, warns within 2.5 s of listening to silence, and accepts devices by name (`ZENO_AUDIO_INPUT_DEVICE=:Webcam internal mic`) |
| The project's files became iCloud placeholders (iCloud storage full), freezing git and the type check | Files downloaded by the user; moving the project out of `~/Documents` is recommended |

Known limitations:

- Gemini's free tier allows about 20 requests per day per model; daily use needs billing or Claude credits (ADR-031). The live voice test was blocked by this quota on 2026-10-02 08:05 JST
- The Claude live check is still pending Anthropic credits
- Push-to-talk works only while the terminal window is focused

Tests: 106 unit tests pass (2 live tests skipped in the normal run), type check passes.
