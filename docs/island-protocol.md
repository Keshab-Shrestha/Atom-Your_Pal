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
| `error` | `stage`, `message`, `kind`, `retryable` | Something failed. `kind` and `retryable` are present for model errors only |

`state` returns to `idle` after every turn, including turns that end in `notice` or `error`.

### Error stages

| Stage | Source |
|---|---|
| `microphone` | Could not record |
| `transcription` | Whisper failed |
| `model` | The LLM request failed. `kind` is one of the gateway error kinds (e.g. `rate_limit`, `timeout`, `auth`) |
| `speech` | Kokoro or audio playback failed |
| `config` | Configuration is invalid. The runtime exits with code 78 |
| `protocol` | A command was malformed or unknown. Nothing else happens |
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
