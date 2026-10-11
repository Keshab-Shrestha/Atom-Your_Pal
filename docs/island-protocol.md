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
| `{"type":"memory.clear"}` | Delete every memory for good. Conversation notes are kept. Answered with a `memory` event |
| `{"type":"episode.forget","id":4}` | Delete one conversation note (ADR-059). Answered with a `memory` event |
| `{"type":"text.send","text":"…"}` | A typed request (up to 4000 characters): answered and spoken like a voice turn, with `transcript` (the text), `reply`, `turn.complete` (`speechMs` and `transcriptionMs` 0). Interrupts a turn in progress, like talking does |
| `{"type":"episode.clear"}` | Delete every conversation note. Facts are kept. Answered with a `memory` event |
| `{"type":"context.window","bundleId":"…","name":"…"}` | Pal was dropped on this app's window with Option held (ADR-074). The runtime reads that app once (`front_window`'s rules, ADR-072) and holds the result for the next request only, for up to 30 s. Answered with `context.ready` |
| `{"type":"helpers.list"}` | Send the `helpers` event (ADR-081, Task 3.1) |
| `{"type":"helper.set","helper":"sid","app":"Brave Browser"}` | Give a helper its app. `helper` is a worker id (`sid`, `kame`, `puff`, `quill`, `penny`, `hana`, `tinker`); `app` is the exact name of an installed app (one of the `apps` in the `helpers` event), or `""` for none. Answered with `helpers`; an unknown helper or app is refused with an `error` (stage `settings`) and nothing changes |
| `{"type":"job.add","helper":"sid","task":"…","blockedBy":[1]}` | Give a helper a job (1–1000 characters after trimming). It joins that helper's queue. `blockedBy` (optional, ADR-087) lists tasks it waits for: it starts only when they are done, and receives their reports. Each must exist and must not have failed or been stopped; at most 6. Answered with `helpers`; refused like `helper.set` for an unknown or unavailable helper, an empty or long task, or bad blockers |
| `{"type":"job.block","id":5,"blockedBy":[1,2]}` | Change what a task that has not started waits for (ADR-087). A change that would make tasks wait for each other in a circle is refused. Answered with `helpers`; refused with an `error` (stage `settings`) |
| `{"type":"comment.add","id":5,"text":"…"}` | Add Keshab's note to a task (1–2000 characters). Notes added before the task runs are given to its worker. A note wakes the task (Task 3.6): an ended task runs again, continuing its last Claude session with the new notes; a running one runs once more when it ends (several notes meanwhile make one more run). Answered with `helpers`; refused with an `error` (stage `settings`) |
| `{"type":"thread.get","id":5}` | Send the `thread` event for one task. An unknown task is refused with an `error` (stage `settings`) |
| `{"type":"plan.approve","id":12}` | Approve a task's waiting plan (Task 3.8): its next run does the job, given the plan. Refused with an `error` (stage `settings`) when no plan waits. Answered with `helpers` |
| `{"type":"plan.reject","id":12}` | Reject a task's waiting plan: the task is stopped (and what waits for it fails). Refused when no plan waits. Answered with `helpers` |
| `{"type":"helper.planFirst","helper":"sid","on":true}` | Whether a worker's new tasks plan first (Task 3.8; default off). `job.add` may also carry `"planFirst": true or false` for one task. Answered with `helpers` |
| `{"type":"job.rate","id":12,"good":false,"comment":"Only one source"}` | Rate a finished (done or failed) task (Task 3.13); `comment` optional, at most 2000 characters. "Not good" asks Tinker to review it: a Tinker task appears (once per task). Refused with an `error` (stage `settings`) for an unfinished task or one of Tinker's. Answered with `helpers` |
| `{"type":"agent.create","name":"Rumi","role":"travel planner","kit":"research","personality":"…","howItWorks":"…","rules":"…"}` | Add an agent (ADR-088): ZENO writes `data/agents/<id>/soul.md`. `kit` is `research`, `folders` or `think` (what it may use, fixed in code). Refused with an `error` (stage `settings`) for a bad or taken name, a bad role (letters, at most 40, not `improver`), an empty personality, or more than 20 agents. Answered with `helpers` |
| `{"type":"agent.remove","id":"rumi"}` | Take an agent Keshab added out of the team: its folder moves to `data/agents-removed/` (never deleted) and its unfinished tasks stop. Refused for a built-in worker. Answered with `helpers` |
| `{"type":"job.open","id":12}` | Open a finished task's report in its worker's app (Task 3.14), by code: a browser opens the top 5 web sources as tabs (http and https only), Notes gets the report as a new note, any other app opens it as a text file. Refused with an `error` (stage `settings`) when the task has no report, the worker has no app, or a browser has no web sources to open. Answered with `helpers` |
| `{"type":"proposal.accept","id":4}` | Accept Tinker's proposal: the worker's soul gets a new version with the change. `proposal.reject` drops a pending one; `proposal.undo` restores the soul version from before an accepted one (as a new version). Refused when the proposal is not in that state. Answered with `helpers` |
| `{"type":"helper.skills","helper":"sid","skills":["pdf"]}` | The skills from `~/.claude/skills` a worker may use (Task 3.12), the whole list; at most 10. Refused with an `error` (stage `settings`) for a name that is not one of Keshab's skills. Answered with `helpers` |
| `{"type":"grant.add","helper":"kame","path":"/Users/k/Developer/app"}` | Grant a folder to a coder, designer or documenter (Task 3.11). Refused with an `error` (stage `settings`) for another role, more than 8 folders, or a folder that cannot be granted: the home folder itself, anything outside it except external drives under `/Volumes`, `~/Library`, and hidden folders such as `~/.ssh`. Saved as its real path. Answered with `helpers` |
| `{"type":"grant.remove","helper":"kame","path":"/Users/k/Developer/app"}` | Take a folder back. An unknown one is ignored. Answered with `helpers` |
| `{"type":"routine.delete","id":2}` | Remove a routine (Task 3.9). An unknown id is ignored. Answered with `helpers` |
| `{"type":"job.fresh","id":12}` | Forget a task's Claude session (Task 3.6): an ended task runs again from the start; a queued one starts fresh. A running task is refused with an `error` (stage `settings`). Answered with `helpers` |
| `{"type":"job.stop","id":12}` | Stop a queued or running job (it becomes `stopped`). An unknown or finished job is ignored. Answered with `helpers` |
| `{"type":"job.delete","id":12}` | Forget a job and its report (a running job is stopped first). An unknown id is ignored. Answered with `helpers` |
| `{"type":"report.get","id":12}` | Send the `report` event for that job. A job with no report is answered with an `error` (stage `settings`) |
| `{"type":"helper.pin","helper":"sid","model":"claude-sonnet-…"}` | Pin a worker to one model (ADR-083), skipping Laya; `model` must be one of the `models` in the `helpers` event, or `""` to let Laya choose again. Answered with `helpers`; an unknown helper or model is refused with an `error` (stage `settings`) |
| `{"type":"helpers.settings","allowLarge":true}` | Allow or forbid the large model for worker jobs (ADR-083; default allowed). `false` caps every job at the medium tier. Task 3.7: `planLimit` (a whole percent, 10–100; default 80) sets the plan's five-hour use above which new runs wait (100: never); either field may be sent alone. Answered with `helpers`; a bad limit is refused with an `error` (stage `settings`) |
| `{"type":"helper.budget","helper":"sid","cap":5}` | A worker's daily budget in dollars of API-equivalent use (Task 3.7; what the work would cost on the API, which the plan does not charge), more than 0 and at most 1000; `null` for no cap; `"helper":"team"` sets the whole team's. Defaults: $5 a worker, $15 the team. Answered with `helpers`; refused with an `error` (stage `settings`) |
| `{"type":"soul.set","helper":"sid","soul":{"name":"Sid","personality":"…","howItWorks":"…","rules":"…","lessons":"…"}}` | Save a worker's edited soul as a new version (ADR-082, Task 3.3); used from its next job. All five fields are text; other fields in `soul` are dropped. Limits after trimming: name 1–20 letters (spaces, hyphens, apostrophes), unique among workers, not Pal or ZENO; personality 1–600; how it works and rules up to 1500; lessons up to 2000. An unchanged soul adds no version. Answered with `helpers`; refused with an `error` (stage `settings`) |
| `{"type":"soul.restore","helper":"sid","version":2}` | Make an older soul version current again, saved as a new version so the restore can be undone. Answered with `helpers`; an unknown version, or a name another worker now has, is refused with an `error` (stage `settings`) |
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
| `computer.point` | `x`, `y`, `w`, `h` (numbers), `label` | ZENO shows the user a place on screen (ADR-054, Task 0.6.4): Pal flies to the element and the bubble says `label` (e.g. "the settings button"). The numbers are Cua's own: points, origin at the top-left of the main display, y down, across all displays. Sent only while a turn is running. `w` and `h` must be above 0 and every number finite, or the island reports a bad event. A place on no display is not flown to. Pal stays about 7 s after arriving, then goes back; a new turn, a reset or an error also ends it. Contains the label only, never screen content |
| `settings.open` | — | Open the panel on its Settings page, as if the user had opened it (ADR-071: "open settings"). Already open there: nothing changes |
| `media.key` | `key` | Press the Mac's system media key once, down then up (ADR-071: "pause the video"). `key` is `"playpause"`; any other value is a bad event. It reaches whatever macOS has as Now Playing (YouTube in a browser, Spotify, Music) and is a toggle. Posting needs Accessibility; without it the island shows a notice instead and nothing is pressed |
| `approval.request` | `id`, `summary`, `reason` | ZENO will not do this until the user says yes: `summary` is the action ("Click \"Send\" in Mail"), `reason` is why it asks. One request at a time. The island must show it with Allow and Decline and answer with `approval.answer`. The runtime declines by itself after 60 s |
| `approval.closed` | `id` | That request is no longer waiting (answered, declined, timed out, or the turn was cancelled). The island removes the prompt |
| `timer` | `id`, `label`, `message` | A timer ended (ADR-061). The runtime has already chimed and spoken `message`; the island shows it. |
| `worker.line` | `line` | A line from the team (Task 3.15): a goal done, or a plan waiting for Keshab's OK. Sent when ZENO is idle, just before it says the line; the island shows it and Pal flies to the menu-bar icon with it. |
| `memory` | `enabled`, `count`, `memories`, `episodes` | What ZENO keeps (ADR-058), newest first: a list of `{ "id", "text", "createdAt" (ISO 8601), "source" ("voice" or "text") }`. `episodes` (ADR-059) lists conversation notes, newest first: `{ "id", "summary", "endedAt", "exchanges" }`; an island must accept it missing. `enabled` is `false` (and the list empty) when memory is off (`ZENO_MEMORY=0`, or its file could not be opened). Sent only after `memory.list`, `memory.forget` or `memory.clear`, and after changes once the island has asked. Memory text is never logged |
| `capabilities` | `items` | What ZENO can do now (ADR-076): a list of `{ "title", "examples" }`, one per group of tools that are on, in the order tools are registered. Sent after `info`: at start, and again after every successful `model.set` (web search depends on the provider). The island replaces its list each time |
| `plan.usage` | `fiveHour`, `sevenDay`, `overage` | How much of the Claude plan is used (ADR-076), as fractions (0.42 = 42%), each field optional; values outside 0–2 are dropped, and an event with nothing left is not sent. Sent whenever the Claude plan provider reports usage. Nothing else from the plan is passed on |
| `context.ready` | `app`, `ok`, `message` | Answer to `context.window`. `ok: true`: the read is held, and the island opens the microphone for the question. `ok: false`: `message` says why (a blocked app, or reading turned off with `ZENO_FRONT_WINDOW=0`); nothing is held |
| `helpers` | `helpers`, `apps` | Every helper and its recent jobs (ADR-081). `helpers` is a list, in a fixed order, of `{ "id", "name", "available", "role", "soul", "soulVersion", "soulVersions", "app", "jobs" }`: `name` is the soul's name; `available` is `false` for a worker not ready for jobs yet (shown as "coming soon"; its soul can still be edited); `role` is fixed in code (`researcher`, `coder`, `designer`, `documenter`, `financial adviser`, `hr`, `improver`); `soul` is `{ "name", "personality", "howItWorks", "rules", "lessons" }`; `soulVersions` lists at most 10, newest first, each `{ "version", "createdAt" }` (all versions are kept); `app` is the app's name or `null`. `jobs` is newest first, at most 20, each `{ "id", "task", "state", "createdAt", "endedAt"?, "step"?, "partial"?, "title"?, "summary"?, "error"? }`: `state` is `queued`, `running`, `done`, `failed` or `stopped`; `step` is what a running job is doing in plain words; `title` and `summary` (one line) exist when a report does; `error` says why a job failed. `apps` lists installed app names for the app picker. Sent after every helper command, and whenever a job changes once the island has sent `helpers.list`. Each job also has `blockedBy` and `waitingFor` (task ids it waits for, and those not done yet), `comments` (how many notes), and `goal` and `parentId` when set (ADR-087). A task Pal handed out (Task 3.5: the `delegate` tool, or "Sid, …" by voice) has `goalId`, and `goalEnded: true` once its goal has ended with its combined report. `resumable: true` means its next run continues the last run's Claude session (Task 3.6). `held` says why a runnable task waits (Task 3.7: its worker's or the team's budget is used up, or the plan is above its limit); it belongs under "Needs you". Task 3.8: `planFirst` marks a task whose first run only plans; `planStatus` is `awaiting` (held for Keshab's OK) or `approved`, with `planSummary`; each helper has `planFirst` (its new tasks plan first). ADR-088: each helper has `kit` (`research`, `folders` or `think`) and `custom` (an agent Keshab added, from its soul.md). Task 3.16: with Keshab's own Paperclip connected (`ZENO_PAPERCLIP_URL`, loopback only), the event has `paperclip`, `{ "issues" }`, each `{ "id", "identifier"?, "title", "agent", "status", "createdAt", "result"?, "told"? }`: the tasks ZENO handed to Paperclip agents; absent when the connection is off. Task 3.13: jobs carry `rating` (`good` or `bad`) and, for a Tinker task, `reviews` (the task it reviews); each helper has `proposals`, every pending one and the newest few others, each `{ "id", "field", "text", "reason", "jobId", "state", "createdAt" }` (`state` is `pending`, `accepted`, `rejected` or `undone`). Task 3.12: each helper has `skills` (the names chosen for it), and the event has `skills`, Keshab's skills as `{ "name", "description" }`. Task 3.11: each helper has `grants` (the folders it may work in, real paths). Task 3.9: each helper has `routines`, each `{ "id", "task", "when", "lastAt"?, "lastSkipped"? }` (`when` in words, such as "Every day at 8:00 AM"; `lastSkipped` when its last time came while the previous task was still going). Each helper has `budget` (`{ "cap", "spent" }`, cap `null` for none, spent today), and the event has `team` (the same shape) and `planLimit` (percent). A queued task whose blocker fails or is stopped fails too. Task text is the user's own words; it is never logged |
| `thread` | `id`, `comments`, `activity`, `report`? | One task's thread (ADR-087, Task 3.4), answering `thread.get`. `comments` are `{ "id", "text", "createdAt" }`, oldest first; `activity` is `{ "kind", "at" }` with `kind` one of `created`, `waits`, `commented`, `woken`, `fresh`, `running`, `done`, `failed`, `stopped`; `report` is `{ "title", "summary", "body", "sources" }` when there is one. `plan` (Task 3.8) is `{ "summary", "steps" }` once a plan-first run wrote one; activity kinds also include `planned`, `approved` and `rejected`. `handOffs` (Task 3.10) lists the sub-tasks the task handed to other workers (activity `handed`); a sub-task's job carries `parentId`. `goal`, for a task Pal handed out (Task 3.5), is `{ "id", "text", "ended", "tasks", "report"? }`: `tasks` are the goal's task ids and `report` the combined report once every task has ended (absent when none was done). Never logged |
|  |  | ADR-083 adds: top-level `allowLarge` (boolean) and `models` (the plan's offered models as `{ "id", "name", "tier" }`, `tier` one of `small`, `medium`, `large`; empty when the provider is not the Claude plan); per helper `pinnedModel` (model id or `null`); per job `model` (model id, once chosen) and `modelReason` (plain words: "Laya: trivial", "Laya: hard", "Pinned", "Laya unavailable", "Role minimum", "Large model off"). An island must accept all of them missing |
| `report` | `id`, `title`, `summary`, `body`, `sources` | One job's report, after `report.get`: `body` is plain text with paragraphs separated by blank lines; `sources` is a list of `{ "title", "url" }` (http or https only). Never logged |
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

### speech.set (ADR-091)

`{"type":"speech.set","reports":true,"updates":false}`: whether ZENO says the team's reports, and timers and other updates, aloud. A muted line still shows (the island's card, Pal's line); it is not chimed or spoken. The island sends it when ZENO connects and whenever Keshab changes it. No answer.

### helpers: usage (ADR-091)

The `helpers` event carries `usage`: `today` and `week` totals (`input`, `output`, `cacheRead`, `cacheWrite`, `dollars`, `runs`), `days` (the last 7, oldest first, each with `day` as a local `YYYY-MM-DD`), `byWorker` (`helper` id or null for ZENO's chat, and `name`) and `byModel` (`model`). Counts and model ids only.

### Chats (ADR-091)

- `{"type":"chats.list"}` → `{"type":"chats","chats":[{"id","title","updatedAt","messages"}],"current":"<session id>"}`, newest first; sent again after every saved exchange, a new chat or a delete.
- `{"type":"chat.open","id":"…"}`: ZENO continues that chat (voice and typing go to it) → `{"type":"chat.opened","id":"…","messages":[{"role":"user"|"assistant","text":"…"}]}`, then `chats`.
- `{"type":"chat.delete","id":"…"}`: deletes it; if it was the current chat, ZENO starts a new one (`conversation.reset`), then `chats`.
- `conversation.reset` (New chat) is also followed by `chats` once the window has asked for them.
