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
| `{"type":"model.set","provider":"gemini","model":"gemini-3.6-flash"}` | Switch the AI model for the next request (ADR-040). Takes effect at once, without restarting; a request already in flight finishes with the old model. The conversation is kept. Saved to `config/island.json` and used at the next start. Answered with an `info` event, or an `error` with stage `settings` (unknown provider, no API key for it, a model id that is not in the list and is not a valid custom id) and nothing changes. The runtime keeps running |
| `{"type":"approval.answer","id":"a1","approved":true}` | The user's answer to an `approval.request` (ADR-054). `approved` must be a boolean. An unknown or already-closed `id` is ignored. Any other command that ends the turn (`talk.cancel`, `talk.start`, `conversation.reset`) counts as "no" |
| `{"type":"memory.list"}` | Send what ZENO keeps (ADR-058), as a `memory` event. From then on, a `memory` event also follows every change ZENO makes by itself (the `remember` and `forget` tools). An island that never sends it gets no `memory` events |
| `{"type":"memory.forget","id":3}` | Delete one memory for good. `id` must be a whole number. Answered with a `memory` event (an unknown id changes nothing) |
| `{"type":"memory.clear"}` | Delete every memory for good. Conversation notes are kept. Answered with a `memory` event |
| `{"type":"episode.forget","id":4}` | Delete one conversation note (ADR-059). Answered with a `memory` event |
| `{"type":"text.send","text":"…"}` | A typed request (up to 4000 characters): answered and spoken like a voice turn, with `transcript` (the text), `reply`, `turn.complete` (`speechMs` and `transcriptionMs` 0). Interrupts a turn in progress, like talking does |
| `{"type":"episode.clear"}` | Delete every conversation note. Facts are kept. Answered with a `memory` event |
| `{"type":"memory.keepChat","id":"…"}` | ADR-097: keep a chat in memory. ZENO writes a summary, topic sections with a heading each, and the exact lines, and searches them for every request. The work continues in the background: the chat shows `indexing` in the next `memory` event and `kept` when it is done. An unknown chat gets an `error` with stage `settings` |
| `{"type":"memory.dropChat","id":"…"}` | ADR-097: remove a kept chat from memory. The chat itself stays in the chat list. Answered with a `memory` event; a chat that is not kept gets an `error` with stage `settings` |
| `{"type":"context.window","bundleId":"…","name":"…"}` | ATOM was dropped on this app's window with Option held (ADR-074). The runtime reads that app once (`front_window`'s rules, ADR-072) and holds the result for the next request only, for up to 30 s. Answered with `context.ready` |
| `{"type":"helpers.list"}` | Send the `helpers` event (ADR-081, Task 3.1) |
| `{"type":"helper.set","helper":"sid","app":"Brave Browser"}` | Give a helper its app. `helper` is a worker id (`sid`, `kame`, `puff`, `quill`, `penny`, `hana`, `tinker`); `app` is the exact name of an installed app (one of the `apps` in the `helpers` event), or `""` for none. Answered with `helpers`; an unknown helper or app is refused with an `error` (stage `settings`) and nothing changes |
| `{"type":"job.add","helper":"sid","task":"…","blockedBy":[1]}` | Give a helper a job (1–1000 characters after trimming). It joins that helper's queue. `blockedBy` (optional, ADR-087) lists tasks it waits for: it starts only when they are done, and receives their reports. Each must exist and must not have failed or been stopped; at most 6. Answered with `helpers`; refused like `helper.set` for an unknown or unavailable helper, an empty or long task, or bad blockers |
| `{"type":"job.block","id":5,"blockedBy":[1,2]}` | Change what a task that has not started waits for (ADR-087). A change that would make tasks wait for each other in a circle is refused. Answered with `helpers`; refused with an `error` (stage `settings`) |
| `{"type":"comment.add","id":5,"text":"…"}` | Add Keshab's note to a task (1–2000 characters). Notes added before the task runs are given to its worker. A note wakes the task (Task 3.6): an ended task runs again, continuing its last Claude session with the new notes; a running one runs once more when it ends (several notes meanwhile make one more run). Answered with `helpers`; refused with an `error` (stage `settings`) |
| `{"type":"job.steer","id":5,"text":"…"}` | ADR-098 item 3: Keshab's message to a task (1–2000 characters). A running worker run reads it at its next step, without a stop: it is kept as a note with `delivery: "live"`. When the run cannot take it (a plan, Manager or Tinker run, or a run that is ending), it is kept with `delivery: "after"` and the task runs once more after this run. A message the run gave no step to read before it ended becomes `"after"` too. For an interrupted task, the message resumes the same Claude session. For any other task it is an ordinary note (as `comment.add`). Answered with `helpers`; refused with an `error` (stage `settings`). The text is never logged |
| `{"type":"job.interrupt","id":5}` | ADR-098 item 3: stop the current step of a running task (Agent SDK `Query.interrupt()`). The task goes back to `queued` with `interrupted: true` and `held` "Interrupted — waiting for you."; Keshab's next `job.steer` or `comment.add` resumes the same session with his message. When a note already waits, the task runs again at once. `job.stop` still ends the task. Answered with `helpers`; refused with an `error` (stage `settings`) when the task does not run or its run cannot be interrupted || `{"type":"job.undo","id":5,"path":"src/a.ts","force":true}` | B3.4, ADR-101: undo the file edits a task's runs made. `path` (optional) is a `path` from the thread's `checkpoints`; without it, every `ready` file. `force` (optional) also puts back a file that changed after the run. The answer is the next `thread` event. A file that could not be put back (changed since the run, grant revoked, gone) also gives an `error` (stage `settings`) with words. A running or unknown task is refused with an `error` (stage `settings`) || `{"type":"thread.get","id":5}` | Send the `thread` event for one task. An unknown task is refused with an `error` (stage `settings`) |
| `{"type":"plan.approve","id":12}` | Approve a task's waiting plan (Task 3.8): its next run does the job, given the plan. Refused with an `error` (stage `settings`) when no plan waits. Answered with `helpers` |
| `{"type":"plan.reject","id":12}` | Reject a task's waiting plan: the task is stopped (and what waits for it fails). Refused when no plan waits. Answered with `helpers` |
| `{"type":"helper.planFirst","helper":"sid","on":true}` | Whether a worker's new tasks plan first (Task 3.8; default off). `job.add` may also carry `"planFirst": true or false` for one task. Answered with `helpers` |
| `{"type":"helper.browser","helper":"sid","on":true}` | ADR-098 item 4: turns the browser grant on or off for a worker (default off). With the grant, the worker's runs get ZENO's browser (Playwright, its own profile in `data/browser-profile/<id>`). A "think" worker never gets the browser. Answered with `helpers` |
| `{"type":"job.rate","id":12,"good":false,"comment":"Only one source"}` | Rate a finished (done or failed) task (Task 3.13); `comment` optional, at most 2000 characters. "Not good" asks Tinker to review it: a Tinker task appears (once per task). Refused with an `error` (stage `settings`) for an unfinished task or one of Tinker's. Answered with `helpers` |
| `{"type":"agent.create","name":"Rumi","role":"travel planner","kit":"research","personality":"…","howItWorks":"…","rules":"…"}` | Add an agent (ADR-088): ZENO writes `data/agents/<id>/soul.md`. `kit` is `research`, `folders` or `think` (what it may use, fixed in code). Refused with an `error` (stage `settings`) for a bad or taken name, a bad role (letters, at most 40, not `improver`), an empty personality, or more than 20 agents. Answered with `helpers` |
| `{"type":"manager.create","name":"Travel","mode":"plan"}` | Add a Manager (ADR-095): ZENO writes `data/agents/<id>/soul.md` with `kind: manager`. `mode` is `plan` (plans and reviews: short no-tools runs split ATOM's part across its Agents and review their reports, one revision at most) or `group` (the default: no model calls, ATOM assigns to its Agents directly). Refused with an `error` (stage `settings`) for a bad or taken name or more than 12 Managers. Answered with `helpers` |
| `{"type":"manager.rename","id":"travel","name":"Trips"}` | Rename a Manager (a new soul version). Refused for an unknown Manager or a bad or taken name. Answered with `helpers` |
| `{"type":"manager.mode","id":"travel","mode":"group"}` | Switch a Manager's mode (`plan` or `group`). Answered with `helpers` |
| `{"type":"manager.delete","id":"travel"}` | Take a Manager out: its folder moves to `data/agents-removed/` (never deleted) and its unfinished runs stop. Refused while it has Agents. Answered with `helpers` |
| `{"type":"agent.manager","helper":"sid","manager":"research"}` | Put an Agent under a Manager (ADR-095): an agent Keshab added gets `manager:` in its soul.md (recorded as a soul version), a built-in worker a setting. Refused for an unknown Agent or Manager, or Tinker. A Manager's daily cap is set with `helper.budget` and its id. Answered with `helpers` |
| `{"type":"agent.remove","id":"rumi"}` | Take an agent Keshab added out of the team: its folder moves to `data/agents-removed/` (never deleted) and its unfinished tasks stop. Refused for a built-in worker. Answered with `helpers` |
| `{"type":"job.open","id":12}` | Open a finished task's report in its worker's app (Task 3.14), by code: a browser opens the top 5 web sources as tabs (http and https only), Notes gets the report as a new note, any other app opens it as a text file. Refused with an `error` (stage `settings`) when the task has no report, the worker has no app, or a browser has no web sources to open. Answered with `helpers` |
| `{"type":"proposal.accept","id":4}` | Accept Tinker's proposal: the worker's soul gets a new version with the change. `proposal.reject` drops a pending one; `proposal.undo` restores the soul version from before an accepted one (as a new version). Refused when the proposal is not in that state. Answered with `helpers` |
| `{"type":"helper.skills","helper":"sid","skills":["pdf"]}` | The skills a worker may use (Task 3.12), the whole list; at most 10. Each must be one of Keshab's skills in `~/.claude/skills` or, ADR-094, one of ZENO's own in `data/skills`. Refused with an `error` (stage `settings`) for any other name. Answered with `helpers` |
| `{"type":"skill.make","id":12}` | ADR-094: asks Tinker to draft a skill from a done task (at most one draft per task; rating a done task good asks too). Refused with an `error` for an unknown, unfinished or Tinker task, or one that has its draft already. Answered with `helpers` |
| `{"type":"skill.approve","id":2}` | ADR-094: approves a pending skill draft: ZENO writes `data/skills/<name>/SKILL.md`. Refused when no draft waits there, or its name is already one of Keshab's skills or ZENO's. `skill.reject` marks a pending draft rejected. Answered with `helpers` |
| `{"type":"skill.edit.accept","id":5}` | ADR-094: accepts Tinker's edit to one of ZENO's skills (the steps from just before are kept). `skill.edit.reject` marks a pending edit; `skill.edit.undo` restores the steps from before an accepted one. Refused when the edit is not in that state, or the skill is not ZENO's own (skills in `~/.claude/skills` are never edited). Answered with `helpers` |
| `{"type":"testcase.save","jobId":7,"kind":"soul","target":"sid"}` | ADR-098 item 8: saves a done task as a test case. `kind` `soul` saves it for its agent (`target` is the agent's id); `kind` `skill` saves it for a ZENO-made skill its run used (`target` is the skill's name). ZENO keeps the task and its report (cut to 4000 characters). Refused for a task that is not done or has no report, another target, a task saved already for that target, or an 11th case (10 per target). `{"type":"testcase.delete","id":3}` deletes one. Answered with `helpers` |
| `{"type":"testcase.run","proposalKind":"soul","id":4}` | ADR-098 item 8: runs the test cases of a pending soul proposal (`soul`) or skill edit (`skill`) again: the newest 3 cases, each as two dry runs (no tools, effort low, Sonnet at most; old text, then new text) and a judge run. The cost counts on Tinker's task. When the plan is above its limit, or Tinker's or the team's budget is used up, each case is "Not run". Each case's outcome comes with `helpers`; a refusal comes as an `error` |
| `{"type":"grant.add","helper":"kame","path":"/Users/k/Developer/app"}` | Grant a folder to a coder, designer or documenter (Task 3.11). Refused with an `error` (stage `settings`) for another role, more than 8 folders, or a folder that cannot be granted: the home folder itself, anything outside it except external drives under `/Volumes`, `~/Library`, and hidden folders such as `~/.ssh`. Saved as its real path. Answered with `helpers` |
| `{"type":"grant.remove","helper":"kame","path":"/Users/k/Developer/app"}` | Take a folder back. An unknown one is ignored. Answered with `helpers` |
| `{"type":"routine.delete","id":2}` | Remove a routine (Task 3.9). An unknown id is ignored. Answered with `helpers` |
| `{"type":"routine.pause","id":2,"paused":true}` | ADR-094: pause (`true`) or resume (`false`) a routine. A paused routine makes no tasks; a resumed one does not make up the times it missed. Refused (stage `settings`) for an unknown routine. Answered with `helpers` |
| `{"type":"routine.add","helper":"researcher","task":"Summarise networking news","kind":"daily","minute":480}` | ADR-097: make a routine from the Scheduled page. `kind` is `daily` or `weekly` (with `minute`, the minutes after local midnight; `weekly` also has `weekday`, 0 for Sunday to 6 for Saturday) or `hours` (with `every`, 1 to 168, and an optional `startAt`, the first time as ISO 8601, at most a year ahead). Refused (stage `settings`) for an unknown worker, a worker that takes no tasks, an empty or long task, bad numbers or more than 20 routines. Answered with `helpers` |
| `{"type":"routine.update","id":2,"helper":"researcher","task":"…","kind":"hours","every":4}` | ADR-097: change a routine's worker, task and schedule (the fields of `routine.add`). The routine counts from now: a changed time does not come due at once. A text change alone keeps an hourly routine's times. Refused (stage `settings`) as `routine.add`, and for an unknown routine. Answered with `helpers` |
| `{"type":"team.add","task":"…","role":"researcher"}` | ADR-094: post a task to the team instead of one worker; `role` (optional, a role some worker has) limits who may take it, absent or empty means anyone. It waits, unassigned, until a worker with wake-ups on wakes and takes it. Refused (stage `settings`) for an empty or long task, a role no worker has, or 50 waiting already. Answered with `helpers` |
| `{"type":"team.delete","id":3}` | ADR-094: take back a team task still waiting. A taken or unknown one is ignored. Answered with `helpers` |
| `{"type":"helper.wakeUp","helper":"sid","every":"1h"}` | ADR-094: a worker's wake-ups: `every` is `15m`, `1h`, `4h`, `1d`, or `off` (the default). The next wake is one interval from now. On waking, if it runs nothing, is within its and the team's daily budget and the plan is below its limit, it takes the oldest team task its role may do (one per wake) as its own task. Refused (stage `settings`) for an unknown worker or one that takes no tasks (Tinker). Answered with `helpers` |
| `{"type":"helper.wakeUp.pause","helper":"sid","paused":true}` | ADR-094: pause or resume a worker's wake-ups (resumed: the next wake is one interval from now). Refused (stage `settings`) when it has none. Answered with `helpers` |
| `{"type":"job.fresh","id":12}` | Forget a task's Claude session (Task 3.6): an ended task runs again from the start; a queued one starts fresh. A running task is refused with an `error` (stage `settings`). Answered with `helpers` |
| `{"type":"job.stop","id":12}` | Stop a queued or running job (it becomes `stopped`). An unknown or finished job is ignored. Answered with `helpers` |
| `{"type":"job.delete","id":12}` | Forget a job and its report (a running job is stopped first). An unknown id is ignored. Answered with `helpers` |
| `{"type":"helper.pin","helper":"sid","model":"claude-sonnet-…"}` | Pin a worker to one model (ADR-083), skipping Laya; `model` must be one of the `models` in the `helpers` event, or `""` to let Laya choose again. Answered with `helpers`; an unknown helper or model is refused with an `error` (stage `settings`) |
| `{"type":"helpers.settings","allowLarge":true}` | Allow or forbid the large model for worker jobs (ADR-083; default allowed). `false` caps every job at the medium tier. Task 3.7: `planLimit` (a whole percent, 10–100; default 80) sets the plan's five-hour use above which new runs wait (100: never). ADR-095: `maxRunning` (a whole number, 1–10; default 6) sets "Runs at once", how many tasks the team runs at the same time (a worker may run several); a change applies to the next start, and lowering it stops nothing already running. ADR-098 item 7: `codexFallback` (boolean; default `false`) turns on "Use Codex when the Claude plan limit is reached": a task held only by the plan's limit runs on Codex. Any one field may be sent alone. Answered with `helpers`; a bad limit is refused with an `error` (stage `settings`) |
| `{"type":"helper.budget","helper":"sid","cap":5}` | A worker's daily budget in dollars of API-equivalent use (Task 3.7; what the work would cost on the API, which the plan does not charge), more than 0 and at most 1000; `null` for no cap; `"helper":"team"` sets the whole team's. Defaults: $5 a worker, $15 the team. Answered with `helpers`; refused with an `error` (stage `settings`) |
| `{"type":"soul.set","helper":"sid","soul":{"name":"Sid","personality":"…","howItWorks":"…","rules":"…","lessons":"…"}}` | Save a worker's edited soul as a new version (ADR-082, Task 3.3); used from its next job. All five fields are text; other fields in `soul` are dropped. Limits after trimming: name 1–20 letters (spaces, hyphens, apostrophes), unique among workers, not ATOM, Pal or ZENO; personality 1–600; how it works and rules up to 1500; lessons up to 2000. An unchanged soul adds no version. Answered with `helpers`; refused with an `error` (stage `settings`) |
| `{"type":"soul.restore","helper":"sid","version":2}` | Make an older soul version current again, saved as a new version so the restore can be undone. Answered with `helpers`; an unknown version, or a name another worker now has, is refused with an `error` (stage `settings`) |
| `{"type":"quit"}` | Release the microphone, stop speech and exit with code 0 |

Holding Ctrl+Option maps to `talk.start` on press and `talk.send` on release. Pressing another key while holding, or Esc, maps to `talk.cancel` (ADR-035).

---

## 4. Events (runtime → island)

| Event | Fields | Meaning |
|---|---|---|
| `ready` | `protocol`, `provider`, `model`, `microphone`, `voice`, `telegram`? | Started. `voice` is `false` if the voice failed to load (an `error` with stage `speech` comes first); replies still arrive as text. ADR-098: `telegram` is `true` when ZENO's Telegram bot is set up in `.env` |
| `state` | `state` | One of `idle`, `listening`, `transcribing`, `thinking`, `speaking` |
| `mic.ready` | — | The microphone is capturing. Speech from now on is recorded. The island shows a turn as "Listening…" until this arrives, then "Speak now": ATOM raises its arms with pixel sound bars (no bubble), and the card under the menu-bar icon says it when ATOM is off. |
| `mic.level` | `peak` | Loudest sample since the last `mic.level`, 0–1. At most 20 per second, only while listening |
| `mic.silent` | `microphone` | The microphone has heard only near-silence for 2.5 s while listening. Probably the wrong device. Sent once per turn |
| `transcript` | `text` | What the user said |
| `reply` | `text` | ZENO's full reply, sent before it is spoken |
| `turn.complete` | `speechMs`, `transcriptionMs`, `modelMs`, `firstSoundMs` | The reply finished playing. Timings in milliseconds; `firstSoundMs` may be missing |
| `notice` | `kind`, `message` | The turn ended without a request. Not a failure. `kind` is `too_short`, `mic_starting` or `no_speech`; `message` says what to do, worded for the island's controls |
| `conversation.reset` | — | The conversation was forgotten |
| `info` | `provider`, `model`, `providers` | The model in use and the choices. Sent right after `ready` and after every successful `model.set`. `providers` is a list of `{ "id", "name", "available", "models" }`: `available` is `false` when the provider's API key is missing from `.env`; `models` is a list of `{ "id", "name" }` offered for that provider (the current model is always included). API keys are never sent |
| `computer.step` | `text` | ZENO is about to do something on the Mac (computer control, ADR-054), in plain words such as "Typing in TextEdit". Sent only while a turn is running. Contains the app name and the kind of action, never typed text or screen content |
| `computer.point` | `x`, `y`, `w`, `h` (numbers), `label` | ZENO shows the user a place on screen (ADR-054, Task 0.6.4): ATOM flies to the element and the bubble says `label` (e.g. "the settings button"). The numbers are Cua's own: points, origin at the top-left of the main display, y down, across all displays. Sent only while a turn is running. `w` and `h` must be above 0 and every number finite, or the island reports a bad event. A place on no display is not flown to. ATOM stays about 7 s after arriving, then goes back; a new turn, a reset or an error also ends it. Contains the label only, never screen content |
| `settings.open` | — | Open the panel on its Settings page, as if the user had opened it (ADR-071: "open settings"). Already open there: nothing changes |
| `media.key` | `key` | Press the Mac's system media key once, down then up (ADR-071: "pause the video"). `key` is `"playpause"`; any other value is a bad event. It reaches whatever macOS has as Now Playing (YouTube in a browser, Spotify, Music) and is a toggle. Posting needs Accessibility; without it the island shows a notice instead and nothing is pressed |
| `approval.request` | `id`, `summary`, `reason` | ZENO will not do this until the user says yes: `summary` is the action ("Click \"Send\" in Mail"), `reason` is why it asks. One request at a time. The island must show it with Allow and Decline and answer with `approval.answer`. The runtime declines by itself after 60 s |
| `approval.closed` | `id` | That request is no longer waiting (answered, declined, timed out, or the turn was cancelled). The island removes the prompt |
| `timer` | `id`, `label`, `message` | A timer ended (ADR-061). The runtime has already chimed and spoken `message`; the island shows it. |
| `worker.line` | `line` | A line from the team (Task 3.15): a goal done, or a plan waiting for Keshab's OK. Sent when ZENO is idle, just before it says the line; the island shows it and ATOM flies to the menu-bar icon with it. |
| `memory` | `enabled`, `count`, `memories`, `episodes` | What ZENO keeps (ADR-058), newest first: a list of `{ "id", "text", "createdAt" (ISO 8601), "source" ("voice" or "text") }`. `episodes` (ADR-059) lists conversation notes, newest first: `{ "id", "summary", "endedAt", "exchanges" }`; an island must accept it missing. `chats` (ADR-097) lists the newest 30 chats, then kept chats that are no longer in the chat list: `{ "id", "title", "updatedAt"? (ISO 8601), "messages", "kept", "indexing"?, "keptAt"? }`; an island must accept it missing. `enabled` is `false` (and the list empty) when memory is off (`ZENO_MEMORY=0`, or its file could not be opened). Sent only after `memory.list`, `memory.forget` or `memory.clear`, and after changes once the island has asked. Memory text is never logged |
| `capabilities` | `items` | What ZENO can do now (ADR-076): a list of `{ "title", "examples" }`, one per group of tools that are on, in the order tools are registered. Sent after `info`: at start, and again after every successful `model.set` (web search depends on the provider). The island replaces its list each time |
| `plan.usage` | `fiveHour`, `sevenDay`, `overage` | How much of the Claude plan is used (ADR-076), as fractions (0.42 = 42%), each field optional; values outside 0–2 are dropped, and an event with nothing left is not sent. Sent whenever the Claude plan provider reports usage. Nothing else from the plan is passed on |
| `context.ready` | `app`, `ok`, `message` | Answer to `context.window`. `ok: true`: the read is held, and the island opens the microphone for the question. `ok: false`: `message` says why (a blocked app, or reading turned off with `ZENO_FRONT_WINDOW=0`); nothing is held |
| `helpers` | `helpers`, `apps` | Every helper and its recent jobs (ADR-081). `helpers` is a list, in a fixed order, of `{ "id", "name", "available", "role", "soul", "soulVersion", "soulVersions", "app", "jobs" }`: `name` is the soul's name; `available` is `false` for a worker not ready for jobs yet (shown as "coming soon"; its soul can still be edited); `role` is fixed in code (`researcher`, `coder`, `designer`, `documenter`, `financial adviser`, `hr`, `improver`); `soul` is `{ "name", "personality", "howItWorks", "rules", "lessons" }`; `soulVersions` lists at most 10, newest first, each `{ "version", "createdAt" }` (all versions are kept); `app` is the app's name or `null`. `jobs` is newest first, at most 20, each `{ "id", "task", "state", "createdAt", "endedAt"?, "step"?, "partial"?, "title"?, "summary"?, "error"? }`: `state` is `queued`, `running`, `done`, `failed` or `stopped`; `step` is what a running job is doing in plain words; `title` and `summary` (one line) exist when a report does; `error` says why a job failed. `apps` lists installed app names for the app picker. Sent after every helper command, and whenever a job changes once the island has sent `helpers.list`. Each job also has `blockedBy` and `waitingFor` (task ids it waits for, and those not done yet), `comments` (how many notes), and `goal` and `parentId` when set (ADR-087). A task ATOM handed out (Task 3.5: the `delegate` tool, or "Sid, …" by voice) has `goalId`, and `goalEnded: true` once its goal has ended with its combined report. `resumable: true` means its next run continues the last run's Claude session (Task 3.6). `held` says why a runnable task waits (Task 3.7: its worker's or the team's budget is used up, or the plan is above its limit); it belongs under "Needs you". Task 3.8: `planFirst` marks a task whose first run only plans; `planStatus` is `awaiting` (held for Keshab's OK) or `approved`, with `planSummary`; ADR-098 item 3: `interrupted: true` marks a queued task whose run Keshab interrupted (it waits for his message, with `held`); each helper has `planFirst` (its new tasks plan first). ADR-098 item 4: each helper has `browser` (`true` when its runs get the browser). ADR-088: each helper has `kit` (`research`, `folders` or `think`) and `custom` (an agent Keshab added, from its soul.md). Task 3.16: with Keshab's own Paperclip connected (`ZENO_PAPERCLIP_URL`, loopback only), the event has `paperclip`, `{ "issues" }`, each `{ "id", "identifier"?, "title", "agent", "status", "createdAt", "result"? }`: the tasks ZENO handed to Paperclip agents; absent when the connection is off. Task 3.13: jobs carry `rating` (`good` or `bad`) and, for a Tinker task, `reviews` (the task it reviews); each helper has `proposals`, every pending one and the newest few others, each `{ "id", "field", "text", "reason", "jobId", "state", "createdAt" }` (`state` is `pending`, `accepted`, `rejected` or `undone`). Task 3.12: each helper has `skills` (the names chosen for it), and the event has `skills`, the skills to choose from as `{ "name", "description", "source" }` (`source` is `yours` for `~/.claude/skills` or `zeno` for ZENO's own, ADR-094). ADR-094: the event has `skillDrafts`, each `{ "id", "jobId", "helper", "name", "description", "preview", "state", "createdAt" }` (`preview` is the start of the steps; `state` is `pending`, `approved` or `rejected`), and `skillEdits`, each `{ "id", "skill", "jobId", "reason", "before", "after", "state", "createdAt" }` (`before`/`after` a few lines from the first changed one; `state` is `pending`, `accepted`, `rejected` or `undone`): every pending one and the newest few others. ADR-098 item 8: a proposal and a skill edit with a test run have `tests`, `{ "better", "same", "worse", "notRun", "failed", "running", "results" }` (counts, for "Test cases: 2 better, 1 same"; `better` counts cases where the new text wins, `worse` where the old wins); each result is `{ "caseId", "task", "state", "better"?, "reason"?, "oldAnswer"?, "newAnswer"? }` (`state` is `running`, `done`, `failed` or `skipped`; `better` is `old`, `new` or `same`; `reason` is the judge's reason or why the case did not run; the task is cut to 200 characters and each answer to 800). The event has `testCases`, every saved test case, newest first, each `{ "id", "kind", "target", "jobId", "task", "createdAt" }` (the saved report is never sent). Tinker tasks that draft or edit a skill also have `reviews` (the task they are about). Task 3.11: each helper has `grants` (the folders it may work in, real paths). Task 3.9: each helper has `routines`, each `{ "id", "task", "when", "lastAt"?, "lastSkipped"? }` (`when` in words, such as "Every day at 8:00 AM"; `lastSkipped` when its last time came while the previous task was still going); ADR-094 adds `paused`? (`true` when paused) and `nextAt`? (ISO 8601, when it next comes due; absent while paused). ADR-097 adds `schedule`, the schedule as numbers for the edit form: `{ "kind", "minute"?, "weekday"?, "every"? }` (as in `routine.add`). ADR-094: a helper with wake-ups on has `wakeUp`, `{ "every", "when", "paused"?, "lastAt"?, "nextAt" }` (`every` is `15m`, `1h`, `4h` or `1d`; `when` in words, such as "Every hour"; absent when off), and the event has `teamTasks`, the team tasks waiting to be taken, oldest first, each `{ "id", "task", "role"?, "createdAt" }` (no `role`: anyone). Each helper has `budget` (`{ "cap", "spent" }`, cap `null` for none, spent today), and the event has `team` (the same shape), `planLimit` (percent) and, ADR-095, `maxRunning` ("Runs at once", 1–10). ADR-098 item 7: `codexFallback` (the Codex switch is on) and `codexReady` (Codex is found and signed in; the switch shows only then); both `false` from an older runtime. A job that ran on Codex has `model` `codex` and `modelReason` "Ran on Codex (Claude plan limit reached)". A queued task whose blocker fails or is stopped fails too. ADR-093: `agentProblems`, `[{ "id", "problem" }]`, lists agent folders whose `data/agents/<id>/soul.md` could not be loaded (folder name and why; the Board shows each as "<id>: <problem>"); absent when every agent loaded; ADR-095 adds an Agent whose `manager:` names no Manager (it works without one) and a Manager soul.md with a `kit`, `role` or `manager` (not loaded). ADR-095: each helper may have `manager` (its Manager's id; absent for Tinker or none), and the event has `managers` (absent when there are none), each `{ "id", "name", "mode", "soul", "soulVersion", "budget", "agents", "jobs" }`: `mode` is `plan` or `group`; `budget` is `{ "cap", "spent" }` (cap by default the team's; its plan and review runs count toward it); `agents` lists its Agents' ids; `jobs` are its own runs (plan mode: one per part ATOM handed it), in the jobs' shape. With Managers, the Board and floor show one chip and one desk per Manager. ADR-095: a job may have `subAgents`, the sub-agents its runs started (the newest 12, oldest first; absent when none), each `{ "name", "state", "description", "result"? }`: `name` is `searcher`, `reader`, `coder` or `checker`; `state` is `started`, `done` or `failed`; `description` is what it was asked (at most 120 characters) and `result` its short answer (at most 200). Task text is the user's own words; it is never logged |
| `thread` | `id`, `comments`, `activity`, `report`? | One task's thread (ADR-087, Task 3.4), answering `thread.get`. `comments` are `{ "id", "text", "createdAt", "delivery"? }`, oldest first (ADR-098 item 3: `delivery` is `live` for a message the running task took, `after` for one kept for after the run); `activity` is `{ "kind", "at" }` with `kind` one of `created`, `waits`, `commented`, `woken`, `fresh`, `interrupted`, `running`, `done`, `failed`, `stopped`; `report` is `{ "title", "summary", "body", "sources" }` when there is one: `body` is plain text with paragraphs separated by blank lines; `sources` is a list of `{ "title", "url" }` (http or https only). `plan` (Task 3.8) is `{ "summary", "steps" }` once a plan-first run wrote one; activity kinds also include `planned`, `approved` and `rejected` (and, ADR-095, on a Manager's run, `split` and `revised`). `handOffs` (Task 3.10) lists the sub-tasks the task handed to other workers (activity `handed`); a sub-task's job carries `parentId`. ADR-098 item 8: `testSkills` lists the ZENO-made skills a done task's runs used (each can take the task as a test case); absent when none. `goal`, for a task ATOM handed out (Task 3.5), is `{ "id", "text", "ended", "tasks", "report"? }`: `tasks` are the goal's task ids and `report` the combined report once every task has ended (absent when none was done). Never logged. B3.1: `toolCalls`? is the run's activity timeline: the newest 100 tool calls, oldest first, each `{ "id", "agent"?, "tool", "input", "state", "result"?, "at", "ms"? }`. `agent` is the sub-agent's name (absent: the run itself). `input` is a short summary (at most 160 characters), never a write payload or typed text. `result` is at most 200 characters. Both are redacted before they are stored: secrets show as `[hidden]`, and a secret file shows as "(secret file, hidden)". `state` is `started`, `ok` or `error`. `at` is when the call started (ISO 8601). `ms` is its length, once it ended. The key is absent when no call was recorded (Codex and Manager runs record none). After each change to a task, the island sends the last thread it was asked for again, so a new call shows at once. B3.4: `checkpoints`? lists the files the task's runs changed in the agent's folders, oldest first, at most 100: `{ "path", "kind", "state", "reason"? }`. `path` is relative to its folder. `kind` is `modified` or `created`. `state` is `ready` (can be undone), `changed` (ready, but the file changed after the run: undo needs `force`), `undone`, or `skipped` (not kept: `reason` is such as "secret file", "too large", "too many files", "outside the folders"). The key is absent when there are none. `bashRan`? is `true` when the run called Bash and the task has a folder: what a command changes is not kept. Never logged |
|  |  | ADR-083 adds: top-level `allowLarge` (boolean) and `models` (the plan's offered models as `{ "id", "name", "tier" }`, `tier` one of `small`, `medium`, `large`; empty when the provider is not the Claude plan); per helper `pinnedModel` (model id or `null`); per job `model` (model id, once chosen) and `modelReason` (plain words: "Laya: trivial", "Laya: hard", "Pinned", "Laya unavailable", "Role minimum", "Large model off"). An island must accept all of them missing |
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

`{"type":"speech.set","reports":true,"updates":false}`: whether ZENO says the team's reports, and timers and other updates, aloud. A muted line still shows (the island's card, ATOM's line); it is not chimed or spoken. ADR-097 adds `chime` (optional, default `true`): whether ZENO plays the chime before a spoken line. With `chime` `false`, ZENO speaks the line without the chime. The island sends it when ZENO connects and whenever Keshab changes it. No answer.

### helpers: usage (ADR-091)

The `helpers` event carries `usage`: `today` and `week` totals (`input`, `output`, `cacheRead`, `cacheWrite`, `dollars`, `runs`), `days` (the last 7, oldest first, each with `day` as a local `YYYY-MM-DD`), `byWorker` (`helper` id or null for ZENO's chat, and `name`) and `byModel` (`model`), and `chatCacheCold` (ADR-098 item 9: true when ZENO's last 3 chat answers read nothing from the cache). Counts and model ids only.

### Chats (ADR-091)

- `{"type":"chats.list"}` → `{"type":"chats","chats":[{"id","title","updatedAt","messages"}],"current":"<session id>"}`, newest first; sent again after every saved exchange, a new chat or a delete.
- `{"type":"chat.open","id":"…"}`: ZENO continues that chat (voice and typing go to it) → `{"type":"chat.opened","id":"…","messages":[{"role":"user"|"assistant","text":"…"}]}`, then `chats`.
- `{"type":"chat.delete","id":"…"}`: deletes it; if it was the current chat, ZENO starts a new one (`conversation.reset`), then `chats`.
- `conversation.reset` (New chat) is also followed by `chats` once the window has asked for them.

### Git (ADR-091)

- `{"type":"git.list"}` → `{"type":"git","branches":[{"repo","repoName","branch":"zeno/task-7","task":7,"title","base","commits":[{"sha","subject","at"}],"files":[{"path","added","removed"}],"remote","pushed":"no"|"yes"|"changed"}]}` for the repositories inside granted folders.
- `{"type":"git.push","repo":"/full/path","branch":"zeno/task-7"}`: sent only after Keshab confirms; pushes that branch to `origin` (never forced), then `git` again; a refusal is an `error` with stage `settings`.
- `{"type":"git.diff","repo":"…","branch":"…"}` → `{"type":"git.diff","repo","branch","text","truncated"}`.

### AI tools (ADR-093)

The `info` event carries `tools`: each AI tool ZENO looked for on this Mac, `{"id","name","found","signedIn"?,"provider"?,"note"}` (`signedIn` absent when the tool cannot be asked; `provider` absent for tools ZENO does not use). `{"type":"tools.scan"}` looks again and is answered with `info`. Providers now include `codex` and `gemini-cli`.

### Model choice (ADR-097)

- The `info` event lists the live models of each provider in `providers[].models`.
  - Claude plan: the runtime asks the Agent SDK (`supportedModels()`) at start and on `model.refresh`. If the request fails, the runtime uses the last list or the built-in table.
  - Codex and the Gemini CLI: a known list. The first entry is the program's own model (`codex-default`, `gemini-default`).
  - The model in use is always in the list.
- `{"type":"model.refresh"}`: the runtime asks the Claude plan for its models again. The answer is `info`.
- `model.set` also accepts a custom model id. A custom model id has 1 to 100 characters: letters, digits, `.`, `_`, `:` or `-`.
- The runtime gives the model to Codex and the Gemini CLI with `--model`. The runtime does not give a model for the program's own model.
- `{"type":"chat.model","id":"…","provider":"codex","model":"gpt-5.5"}`: sets the model of one chat.
  - `id` is the chat id. Use `""` for the chat in use.
  - Use `""` for `provider` and `model` to use the default model again.
  - The runtime checks the model as it checks `model.set`. A refusal is an `error` with stage `settings`.
  - The answer is `chats`.
- The `chats` event has `currentProvider` and `currentModel` when the chat in use has its own model. They are absent when the chat uses the default model.
- A typed turn in a chat with its own model uses that model. Voice turns and new chats use the default model.

### Telegram (ADR-098)

- `{"type":"telegram.set","push":true}`: Settings' "Send to Telegram" switch.
  - With `push` `true`, ZENO sends new Needs you items, finished goals and schedule results to Telegram by itself.
  - With `push` `false`, ZENO sends only replies to Keshab's messages.
  - The island sends it when ZENO connects and when Keshab changes it. No answer. Without Telegram set up, the runtime does nothing.
- `routine.add` and `routine.update` take `notifyTelegram` (optional, `true` or `false`). With `true`, ZENO sends the result of each task the routine makes to Telegram. On `routine.update`, a missing `notifyTelegram` keeps the current choice.
- Each routine in the `helpers` event has `notifyTelegram: true` when it sends its result. The field is absent when it does not.
- The chat that holds the Telegram conversation has the id `telegram`. The `chats` event lists it with the title "Telegram".

### Local API (ADR-098 item 5)

- `{"type":"api.set","on":true}`: Settings' "Local API" switch.
  - With `on` `true`, the runtime listens on 127.0.0.1 at `ZENO_API_PORT` (default 4790). It makes `data/api-token` when the file is not there.
  - With `on` `false`, the runtime stops listening.
  - The island sends it when ZENO connects and when Keshab changes it. The answer is `api`.
- The `api` event has `on`, `port`, `tokenFile` and `error` (optional).
  - `tokenFile` is the full path of the token file. The island reads the file only when Keshab clicks "Copy token". The token is never in a protocol message.
  - `error` tells why the API does not listen, for example a port in use.
- `routine.add` and `routine.update` take `webhook` (optional, `true` or `false`). With `true`, `POST /v1/hooks/<id>` can start the routine. On `routine.update`, a missing `webhook` keeps the current choice.
- Each routine in the `helpers` event has `webhook: true` when a webhook can start it. The field is absent when it cannot.
- API chat turns go to the chat `api`, or `api-<chatId>` when the request has a `chatId`. The `chats` event lists them.

### Search and labels (ADR-098)

- `{"type":"search","query":"…"}`: searches chats, tasks and reports.
  - The query has at most 200 characters. A longer query is refused with a protocol `error`.
  - All words must match. Each word also matches as the start of a longer word.
  - The runtime removes FTS syntax. Only letters and digits are searched.
  - Chats: the runtime searches the messages. A chat title is the first words of the chat, so the title is searched too.
  - Tasks: the runtime searches the task text, the notes and the labels.
  - Reports: the runtime searches the title, the summary and the body.
  - The answer is `search.results`.
- The `search.results` event has `query`, `chats`, `tasks` and `reports`.
  - `query` is the query that the runtime answers. Ignore results for an older query.
  - Each list has at most 20 results, best first.
  - Each result is `{ "id", "title", "snippet", "at" }`. `at` is ISO 8601.
  - In `chats`, `id` is the chat id (a string). Open the chat with `chat.open`.
  - In `tasks` and `reports`, `id` is the task id (a number). Open the task with `thread.get`.
  - A task snippet from a note starts with `Note:`. A task snippet from a label starts with `Label:`.
- `{"type":"job.label.add","id":5,"label":"…"}`: adds a label to a task.
  - A label has 1 to 24 characters: letters a to z, digits, dashes and spaces. The runtime changes capital letters to small letters.
  - A task has at most 6 labels.
  - The answer is `helpers`. A refusal is an `error` with stage `settings`.
- `{"type":"job.label.remove","id":5,"label":"…"}`: removes a label from a task. The answer is `helpers`.
- In the `helpers` event, each job has `labels` when it has labels. `labels` is sorted.
- The runtime does not log the query, the results or the labels. The log has the number of results of each kind only.
