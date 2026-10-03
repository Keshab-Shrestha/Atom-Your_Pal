# Island Protocol

The messages between **ZENO Island** (the Swift app, `apps/mac/island/`) and the **ZENO runtime** (`apps/mac/src/main.ts --island`). See ADR-034.

Protocol version: **1**.

---

## 1. Transport

The island starts the runtime as its child process:

```text
node --env-file-if-exists=.env apps/mac/src/main.ts --island
```

The working directory is the project root, so `.env`, `models/` and `logs/` resolve as with `pnpm start`.

| Stream | Direction | Content |
|---|---|---|
| stdin | island → runtime | commands |
| stdout | runtime → island | events |
| stderr | runtime → island | human-readable diagnostics only (startup lines, warnings) |

- Every message is one JSON object on one line, UTF-8, ending with `\n`.
- Line breaks inside text are escaped by JSON, so a message never spans lines.
- stdout carries only protocol events. Anything else the runtime prints goes to stderr.
- Commands longer than 4 KB are rejected. Events have no fixed limit; replies can be long.
- Unknown fields are ignored on both sides, so fields can be added without a version change.
- Blank lines are ignored.

---

## 2. Lifecycle

1. The island starts the runtime.
2. The runtime loads its configuration and the voice, then sends `ready`. Commands sent before `ready` are still handled.
3. The island sends commands; the runtime sends events.
4. The runtime exits when it receives `quit`, when stdin closes (the island went away), or on `SIGTERM`. It releases the microphone and stops speech first.

### Exit codes

| Code | Meaning | Island should |
|---|---|---|
| 0 | Normal exit | Do nothing if the island asked it to quit; otherwise restart |
| 78 | Configuration error (e.g. missing API key). An `error` event with stage `config` is sent first | Show the message; do not restart until the user fixes it |
| Other | Unexpected failure. An `error` event with stage `runtime` is sent first when possible | Restart, with increasing delay |

The island (`RestartPolicy`, `RuntimeSupervisor` in `apps/mac/island/`) waits 1, 2, 5, 10, then 30 s between restarts. A run of 30 s or more resets the delays. After 5 restarts in a row that each failed quickly, it stops and explains. On quit it sends `quit`, closes stdin, then sends SIGTERM after 3 s and SIGKILL after 5 s if the runtime is still running.

---

## 3. Commands (island → runtime)

| Command | Effect |
|---|---|
| `{"type":"talk.start"}` | Start listening. If ZENO is transcribing, thinking or speaking, that turn is interrupted first. Ignored while already listening |
| `{"type":"talk.send"}` | Stop listening and answer what was said. Ignored unless listening |
| `{"type":"talk.cancel"}` | Abandon the current turn (recording, request or speech) and return to idle. Nothing is sent. Ignored when idle |
| `{"type":"conversation.reset"}` | Cancel any turn and forget the conversation. Answered with a `conversation.reset` event |
| `{"type":"model.set","provider":"gemini","model":"gemini-3.6-flash"}` | Switch the AI model for the next request (ADR-040). Takes effect at once, without restarting; a request already in flight finishes with the old model. The conversation is kept. Saved to `config/island.json` and used at the next start. Answered with an `info` event, or an `error` with stage `settings` (unknown provider, no API key for it, a model not offered for that provider) and nothing changes. The runtime keeps running |
| `{"type":"approval.answer","id":"a1","approved":true}` | The user's answer to an `approval.request` (ADR-054). `approved` must be a boolean. An unknown or already-closed `id` is ignored. Any other command that ends the turn (`talk.cancel`, `talk.start`, `conversation.reset`) counts as "no" |
| `{"type":"memory.list"}` | Send what ZENO keeps (ADR-058), as a `memory` event. From then on, a `memory` event also follows every change ZENO makes by itself (the `remember` and `forget` tools). An island that never sends it gets no `memory` events |
| `{"type":"memory.forget","id":3}` | Delete one memory for good. `id` must be a whole number. Answered with a `memory` event (an unknown id changes nothing) |
| `{"type":"memory.clear"}` | Delete every memory for good. Answered with a `memory` event |
| `{"type":"quit"}` | Release the microphone, stop speech and exit with code 0 |

Holding Ctrl+Option maps to `talk.start` on press and `talk.send` on release. Pressing another key while holding, or Esc, maps to `talk.cancel` (ADR-035).

---

## 4. Events (runtime → island)

| Event | Fields | Meaning |
|---|---|---|
| `ready` | `protocol`, `provider`, `model`, `microphone`, `voice` | Started. `voice` is `false` if the voice failed to load (an `error` with stage `speech` comes first); replies still arrive as text |
| `state` | `state` | One of `idle`, `listening`, `transcribing`, `thinking`, `speaking` |
| `mic.ready` | — | The microphone is capturing. Speech from now on is recorded. Shown as "speak now" |
| `mic.level` | `peak` | Loudest sample since the last `mic.level`, 0–1. At most 20 per second, only while listening |
| `mic.silent` | `microphone` | The microphone has heard only near-silence for 2.5 s while listening. Probably the wrong device. Sent once per turn |
| `transcript` | `text` | What the user said |
| `reply` | `text` | ZENO's full reply, sent before it is spoken |
| `turn.complete` | `speechMs`, `transcriptionMs`, `modelMs`, `firstSoundMs`, `requestId` | The reply finished playing. Timings in milliseconds; `firstSoundMs` and `requestId` may be missing |
| `notice` | `kind`, `message` | The turn ended without a request. Not a failure. `kind` is `too_short`, `mic_starting` or `no_speech`; `message` says what to do, worded for the island's controls |
| `conversation.reset` | — | The conversation was forgotten |
| `info` | `provider`, `model`, `providers` | The model in use and the choices. Sent right after `ready` and after every successful `model.set`. `providers` is a list of `{ "id", "name", "available", "models" }`: `available` is `false` when the provider's API key is missing from `.env`; `models` is a list of `{ "id", "name" }` offered for that provider (the current model is always included). API keys are never sent |
| `computer.step` | `text` | ZENO is about to do something on the Mac (computer control, ADR-054), in plain words such as "Typing in TextEdit". Sent only while a turn is running. Contains the app name and the kind of action, never typed text or screen content |
| `computer.point` | `x`, `y`, `w`, `h` (numbers), `label` | ZENO shows the user a place on screen (ADR-054, Task 0.6.4): Wisp flies to the element and the bubble says `label` (e.g. "the settings button"). The numbers are Cua's own: points, origin at the top-left of the main display, y down, across all displays. Sent only while a turn is running. `w` and `h` must be above 0 and every number finite, or the island reports a bad event. A place on no display is not flown to. Wisp stays about 7 s after arriving, then goes back; a new turn, a reset or an error also ends it. Contains the label only, never screen content |
| `approval.request` | `id`, `summary`, `reason` | ZENO will not do this until the user says yes: `summary` is the action ("Click \"Send\" in Mail"), `reason` is why it asks. One request at a time. The island must show it with Allow and Decline and answer with `approval.answer`. The runtime declines by itself after 60 s |
| `approval.closed` | `id` | That request is no longer waiting (answered, declined, timed out, or the turn was cancelled). The island removes the prompt |
| `memory` | `enabled`, `count`, `memories` | What ZENO keeps (ADR-058), newest first: a list of `{ "id", "text", "createdAt" (ISO 8601), "source" ("voice" or "text") }`. `enabled` is `false` (and the list empty) when memory is off (`ZENO_MEMORY=0`, or its file could not be opened). Sent only after `memory.list`, `memory.forget` or `memory.clear`, and after changes once the island has asked. Memory text is never logged |
| `error` | `stage`, `message`, `kind`, `retryable` | Something failed. `kind` and `retryable` are present for model errors only |

`state` returns to `idle` after every turn, including turns that end in `notice` or `error`.

Computer control is off unless the runtime was started with `ZENO_COMPUTER=1`; without it none of the three computer events is ever sent. With the island closed or no `approval.answer` coming, an approval is a refusal, never a yes.

Fields not listed are ignored by both sides, and an unknown event or command type is ignored by the island and answered with a `protocol` error by the runtime. This keeps an older island working with a newer runtime.

### Model choice

The runtime picks its model in this order: `config/island.json` (written by `model.set`) if its provider has an API key, else `ZENO_LLM_PROVIDER` / `ZENO_LLM_MODEL` from `.env`. `config/island.json` is local and not in git:

```json
{ "llm": { "provider": "gemini", "model": "gemini-3.6-flash" } }
```

A missing or broken file is ignored (logged as a warning), never fatal.

### Error stages

| Stage | Source |
|---|---|
| `microphone` | Could not record |
| `transcription` | Whisper failed |
| `model` | The LLM request failed. `kind` is one of the gateway error kinds (e.g. `rate_limit`, `timeout`, `auth`) |
| `speech` | Kokoro or audio playback failed |
| `config` | Configuration is invalid. The runtime exits with code 78 |
| `protocol` | A command was malformed or unknown. Nothing else happens |
| `settings` | A settings change (`model.set`) was refused. Nothing changes; the runtime keeps running |
| `runtime` | An unexpected bug. The runtime exits |

`message` is plain language, already free of credentials, and says how to fix the problem where possible.

---

## 5. Example

A complete turn:

```text
→ {"type":"talk.start"}
← {"type":"state","state":"listening"}
← {"type":"mic.ready"}
← {"type":"mic.level","peak":0.012}
← {"type":"mic.level","peak":0.284}
→ {"type":"talk.send"}
← {"type":"state","state":"transcribing"}
← {"type":"transcript","text":"What is the capital of Japan?"}
← {"type":"state","state":"thinking"}
← {"type":"reply","text":"The capital of Japan is Tokyo."}
← {"type":"state","state":"speaking"}
← {"type":"turn.complete","speechMs":1840,"transcriptionMs":560,"modelMs":1420,"firstSoundMs":910}
← {"type":"state","state":"idle"}
```

---

## 6. Privacy

- The transcript and reply travel only over this private pipe between two processes of the same app. No port or socket is opened.
- Neither side writes the transcript or reply to a log (SECURITY.md). stderr never contains them.
- The same holds for memory text: the logs record memory ids and counts only.
