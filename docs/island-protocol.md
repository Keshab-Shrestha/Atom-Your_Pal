# Island Protocol

The messages between **ATOM Island** (the Swift app, `apps/mac/island/`) and the **ATOM runtime** (`apps/mac/src/main.ts --island`). See ADR-034.

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
| `{"type":"talk.start"}` | Start listening. If ATOM is transcribing, thinking or speaking, that turn is interrupted first. Ignored while already listening |
| `{"type":"talk.send"}` | Stop listening and answer what was said. Ignored unless listening |
| `{"type":"talk.cancel"}` | Abandon the current turn (recording, request or speech) and return to idle. Nothing is sent. Ignored when idle |
| `{"type":"conversation.reset"}` | Cancel any turn and forget the conversation. Answered with a `conversation.reset` event. Same as `chat.new` without a project (ADR-107) |
| `{"type":"model.set","provider":"gemini","model":"gemini-3.6-flash"}` | Switch the AI model for the next request (ADR-040). Takes effect at once, without restarting; a request already in flight finishes with the old model. The conversation is kept. Saved to `config/island.json` and used at the next start. Answered with an `info` event, or an `error` with stage `settings` (unknown provider, no API key for it, a model id that is not in the list and is not a valid custom id) and nothing changes. The runtime keeps running |
| `{"type":"approval.answer","id":"a1","approved":true}` | The user's answer to an `approval.request` (ADR-054). `approved` must be a boolean. Optional `rememberFile` must be a boolean and takes effect only for an approved, file-specific request that offered it (ADR-136). An ordinary approval cannot become a file grant. An unknown or already-closed `id` is ignored. Any other command that ends the turn (`talk.cancel`, `talk.start`, `conversation.reset`) counts as "no" |
| `{"type":"brain.get"}` | Send the second brain's graph as a `brain` event. From then on a `brain` event also follows every change (a note saved, memory mirrored). |
| `{"type":"brain.note","id":N}` | Send one note as a `brain.note` event (its text, links and backlinks). An unknown id gets an `error` with stage `settings`. |
| `{"type":"brain.save","id"?:N,"title":"…","body":"…"}` | Save a note: new without `id`; with `id`, a change or a rename. Answered with `brain.note` and `brain`, or an `error` with stage `settings` (a title another note has, a body over 20000 characters). |
| `{"type":"brain.delete","id":N}` | Delete a note. A note others link to stays as a ghost. |
| `{"type":"brain.search","query":"…"}` | Search the notes (at most 12). Answered with `brain.hits`. |
| `{"type":"memory.list"}` | Send what ATOM keeps (ADR-058), as a `memory` event. From then on, a `memory` event also follows every change ATOM makes by itself (the `remember` and `forget` tools). An island that never sends it gets no `memory` events |
| `{"type":"memory.forget","id":3}` | Delete one memory for good. `id` must be a whole number. Answered with a `memory` event (an unknown id changes nothing) |
| `{"type":"memory.clear"}` | Delete every memory for good. Conversation notes are kept. Answered with a `memory` event |
| `{"type":"text.edit","id":"…","text":"…","selection"?:[start,end],"instruction":"…"}` | Ask ATOM (upgrades.md B3): rewrite some text as asked. `id` is 1 to 64 letters, digits, `_` or `-`. `text` is up to 100,000 characters. `selection` gives UTF-16 offsets; without it, or when empty, the whole text is the target. `instruction` is up to 500 characters. One model run on the Claude plan, without tools, memory or chat; up to 400 characters around a selection go along as context. Answered with `text.edit.result`. A new request with the same `id` stops the old one |
| `{"type":"text.edit.cancel","id":"…"}` | Stop that request. No answer is sent for it |
| `{"type":"brief.get"}` | Daily brief (upgrades.md C3): send the settings and the newest briefs as a `brief` event, and again after each change |
| `{"type":"brief.run"}` | Make a brief now. The runtime makes one brief at a time. The answer comes as `brief` events: one with `running: true`, one with the new brief |
| `{"type":"brief.set","change":{…}}` | Change some settings. `change` has only the fields to change: the booleans `enabled`, `events`, `reminders`, `weather`, `tasks`, `needsYou`, `notify`, `telegram`, `spoken`, and `minute` (a whole number from 0 to 1439, local time). A bad value gets an `error` with stage `settings` |
| `{"type":"suggestions.get"}` | Remembering by itself (upgrades.md C2): send the facts that wait for the user's answer as a `suggestions` event, and again after each change |
| `{"type":"suggestions.accept","id":N,"text"?:"…"}` | Keep the fact (`text` is the user's edit, at most 600 characters). It goes through the same checks as the `remember` tool: a password or card number, a fact over 300 characters, or full memory is refused with an `error` with stage `settings`, and the suggestion stays so it can be edited |
| `{"type":"suggestions.deny","id":N}` | Drop the fact and never suggest that text again |
| `{"type":"suggestions.set","enabled":true}` | Turn new suggestions on or off. Those that wait stay until answered |
| `{"type":"episode.forget","id":4}` | Delete one conversation note (ADR-059). Answered with a `memory` event |
| `{"type":"text.send","text":"…","files"?:["/full/path",…]}` | A typed request (up to 4000 characters): answered and spoken like a voice turn, with `transcript` (the text), `reply`, `turn.complete` (`speechMs` and `transcriptionMs` 0). Interrupts a turn in progress, like talking does. `files` (ADR-113): up to 5 full paths; the runtime checks each one (a real file, not a secret, text, code, PDF or image, up to 10 MB), copies it into ATOM's folder for the chat, and adds `[Attached: name — path]` to the request. A refused file gets an `error` with stage `settings` and nothing is asked. `text` may then be empty. A project chat refuses files. A text starting `/skill-name` uses that skill for the message (ADR-113) |
| `{"type":"episode.clear"}` | Delete every conversation note. Facts are kept. Answered with a `memory` event |
| `{"type":"memory.keepChat","id":"…"}` | ADR-097: keep a chat in memory. ATOM writes a summary, topic sections with a heading each, and the exact lines, and searches them for every request. The work continues in the background: the chat shows `indexing` in the next `memory` event and `kept` when it is done. An unknown chat gets an `error` with stage `settings` |
| `{"type":"memory.dropChat","id":"…"}` | ADR-097: remove a kept chat from memory. The chat itself stays in the chat list. Answered with a `memory` event; a chat that is not kept gets an `error` with stage `settings` |
| `{"type":"context.window","bundleId":"…","name":"…"}` | ATOM was dropped on this app's window with Option held (ADR-074). The runtime reads that app once (`front_window`'s rules, ADR-072) and holds the result for the next request only, for up to 30 s. Answered with `context.ready` |
| `{"type":"helpers.list"}` | Send the `helpers` event (ADR-081, Task 3.1) |
| `{"type":"helper.set","helper":"sid","app":"Brave Browser"}` | Give a helper its app. `helper` is a worker id (`sid`, `kame`, `puff`, `quill`, `penny`, `hana`, `tinker`); `app` is the exact name of an installed app (one of the `apps` in the `helpers` event), or `""` for none. Answered with `helpers`; an unknown helper or app is refused with an `error` (stage `settings`) and nothing changes |
| `{"type":"job.add","helper":"sid","task":"…","blockedBy":[1]}` | Give a helper a job (1–1000 characters after trimming). It joins that helper's queue. `blockedBy` (optional, ADR-087) lists tasks it waits for: it starts only when they are done, and receives their reports. Each must exist and must not have failed or been stopped; at most 6. Answered with `helpers`; refused like `helper.set` for an unknown or unavailable helper, an empty or long task, or bad blockers |
| `{"type":"job.block","id":5,"blockedBy":[1,2]}` | Change what a task that has not started waits for (ADR-087). A change that would make tasks wait for each other in a circle is refused. Answered with `helpers`; refused with an `error` (stage `settings`) |
| `{"type":"comment.add","id":5,"text":"…"}` | Add Keshab's note to a task (1–2000 characters). Notes added before the task runs are given to its worker. A note wakes the task (Task 3.6): an ended task runs again, continuing its last Claude session with the new notes; a running one runs once more when it ends (several notes meanwhile make one more run). Answered with `helpers`; refused with an `error` (stage `settings`) |
| `{"type":"job.steer","id":5,"text":"…"}` | ADR-098 item 3: Keshab's message to a task (1–2000 characters). A running worker run reads it at its next step, without a stop: it is kept as a note with `delivery: "live"`. When the run cannot take it (a plan, Manager or Tinker run, or a run that is ending), it is kept with `delivery: "after"` and the task runs once more after this run. A message the run gave no step to read before it ended becomes `"after"` too. For an interrupted task, the message resumes the same Claude session. For any other task it is an ordinary note (as `comment.add`). Answered with `helpers`; refused with an `error` (stage `settings`). The text is never logged |
| `{"type":"job.interrupt","id":5}` | ADR-110: a running native task cannot be interrupted by step; the runtime answers with an error that says to stop the task instead. Older text (ADR-098 item 3): stop the current step of a running task (Agent SDK `Query.interrupt()`). The task goes back to `queued` with `interrupted: true` and `held` "Interrupted — waiting for you."; Keshab's next `job.steer` or `comment.add` resumes the same session with his message. When a note already waits, the task runs again at once. `job.stop` still ends the task. Answered with `helpers`; refused with an `error` (stage `settings`) when the task does not run or its run cannot be interrupted || `{"type":"job.undo","id":5,"path":"src/a.ts","force":true}` | B3.4, ADR-101: undo the file edits a task's runs made. `path` (optional) is a `path` from the thread's `checkpoints`; without it, every `ready` file. `force` (optional) also puts back a file that changed after the run. The answer is the next `thread` event. A file that could not be put back (changed since the run, grant revoked, gone) also gives an `error` (stage `settings`) with words. A running or unknown task is refused with an `error` (stage `settings`) || `{"type":"thread.get","id":5}` | Send the `thread` event for one task. An unknown task is refused with an `error` (stage `settings`) |
| `{"type":"plan.approve","id":12}` | Approve a task's waiting plan (Task 3.8): its next run does the job, given the plan. Refused with an `error` (stage `settings`) when no plan waits. Answered with `helpers` |
| `{"type":"plan.reject","id":12}` | Reject a task's waiting plan: the task is stopped (and what waits for it fails). Refused when no plan waits. Answered with `helpers` |
| `{"type":"helper.planFirst","helper":"sid","on":true}` | Whether a worker's new tasks plan first (Task 3.8; default off). `job.add` may also carry `"planFirst": true or false` for one task. Answered with `helpers` |
| `{"type":"helper.browser","helper":"sid","on":true}` | ADR-098 item 4: turns the browser grant on or off for a worker (default off). With the grant, the worker's runs get ATOM's browser (Playwright, its own profile in `data/browser-profile/<id>`). A "think" worker never gets the browser. Answered with `helpers` |
| `{"type":"job.rate","id":12,"good":false,"comment":"Only one source"}` | Rate a finished (done or failed) task (Task 3.13); `comment` optional, at most 2000 characters. "Not good" asks Tinker to review it: a Tinker task appears (once per task). Refused with an `error` (stage `settings`) for an unfinished task or one of Tinker's. Answered with `helpers` |
| `{"type":"agent.create","name":"Rumi","role":"travel planner","kit":"research","personality":"…","howItWorks":"…","rules":"…"}` | Add an agent (ADR-088): ATOM writes `data/agents/<id>/soul.md`. `kit` is `research`, `folders` or `think` (what it may use, fixed in code). Refused with an `error` (stage `settings`) for a bad or taken name, a bad role (letters, at most 40, not `improver`), an empty personality, or more than 20 agents. Answered with `helpers` |
| `{"type":"agent.remove","id":"rumi"}` | Take an agent Keshab added out of the team: its folder moves to `data/agents-removed/` (never deleted) and its unfinished tasks stop. Refused for a built-in worker. Answered with `helpers` |
| `{"type":"job.open","id":12}` | Open a finished task's report in its worker's app (Task 3.14), by code: a browser opens the top 5 web sources as tabs (http and https only), Notes gets the report as a new note, any other app opens it as a text file. Refused with an `error` (stage `settings`) when the task has no report, the worker has no app, or a browser has no web sources to open. Answered with `helpers` |
| `{"type":"proposal.accept","id":4}` | Accept Tinker's proposal: the worker's soul gets a new version with the change. `proposal.reject` drops a pending one; `proposal.undo` restores the soul version from before an accepted one (as a new version). Refused when the proposal is not in that state. Answered with `helpers` |
| `{"type":"helper.skills","helper":"sid","skills":["pdf"]}` | The skills a worker may use (Task 3.12), the whole list; at most 10. Each must be one of Keshab's skills in `~/.claude/skills` or, ADR-094, one of ATOM's own in `data/skills`. Refused with an `error` (stage `settings`) for any other name. Answered with `helpers` |
| `{"type":"skill.make","id":12}` | ADR-094: asks Tinker to draft a skill from a done task (at most one draft per task; rating a done task good asks too). Refused with an `error` for an unknown, unfinished or Tinker task, or one that has its draft already. Answered with `helpers` |
| `{"type":"skill.approve","id":2}` | ADR-094: approves a pending skill draft: ATOM writes `data/skills/<name>/SKILL.md`. Refused when no draft waits there, or its name is already one of Keshab's skills or ATOM's. `skill.reject` marks a pending draft rejected. Answered with `helpers` |
| `{"type":"skill.hub.search","query":"pdf"}` | B3.5, ADR-102: searches the pinned skills repos by folder name. `query` has 1 to 60 characters. The hits (at most 10) arrive in `skillHub.results` of the next `helpers` event. A failure (GitHub limit, no answer, no hit) arrives as `skillHub.message`, not as `error`. Needs the network, so the answer comes later |
| `{"type":"skill.hub.preview","source":0,"path":"skills/pdf/SKILL.md"}` | B3.5: fetches one SKILL.md (`source` is the index of the repo in the list, `path` comes from a hit) and stores it as a waiting install. Nothing is written in `data/skills`. It arrives in `skillHub.pending`. Refused with an `error` for hidden characters, text over 16000 characters, a bad name, a skill that waits already, or a fourth waiting skill |
| `{"type":"skill.hub.approve","id":3}` | B3.5: writes the waiting skill (a new one, or an update) to `data/skills/<name>/SKILL.md`. Refused when the name is one of Keshab's skills or ATOM's, when 30 hub skills are installed, or when an update would overwrite a hand-edited file. The skill goes to no worker. `skill.hub.reject` drops a waiting skill and writes nothing. Answered with `helpers` |
| `{"type":"skill.hub.uninstall","name":"pdf","force":true}` | B3.5: removes the folder, the record and every worker's choice of that skill. Refused when the folder has been changed by hand, unless `force` is `true` |
| `{"type":"skill.hub.update","name":"pdf"}` | B3.5: reads the newest version of an installed skill. A different text becomes a waiting install with `kind` `update`; the same text gives `skillHub.message` "<name> is up to date." Never automatic |
| `{"type":"skill.edit.accept","id":5}` | ADR-094: accepts Tinker's edit to one of ATOM's skills (the steps from just before are kept). `skill.edit.reject` marks a pending edit; `skill.edit.undo` restores the steps from before an accepted one. Refused when the edit is not in that state, or the skill is not ATOM's own (skills in `~/.claude/skills` are never edited). Answered with `helpers` |
| `{"type":"testcase.save","jobId":7,"kind":"soul","target":"sid"}` | ADR-098 item 8: saves a done task as a test case. `kind` `soul` saves it for its agent (`target` is the agent's id); `kind` `skill` saves it for a ATOM-made skill its run used (`target` is the skill's name). ATOM keeps the task and its report (cut to 4000 characters). Refused for a task that is not done or has no report, another target, a task saved already for that target, or an 11th case (10 per target). `{"type":"testcase.delete","id":3}` deletes one. Answered with `helpers` |
| `{"type":"testcase.run","proposalKind":"soul","id":4}` | ADR-098 item 8: runs the test cases of a pending soul proposal (`soul`) or skill edit (`skill`) again: the newest 3 cases, each as two dry runs (no tools, effort low, Sonnet at most; old text, then new text) and a judge run. The tokens count on Tinker's task. When Claude's own rate limit stops a case, the rest are "Not run: plan limit". Each case's outcome comes with `helpers`; a refusal comes as an `error` |
| `{"type":"grant.add","helper":"kame","path":"/Users/k/Developer/app"}` | Grant a folder to a coder, designer or documenter (Task 3.11). Refused with an `error` (stage `settings`) for another role, more than 8 folders, or a folder that cannot be granted: the home folder itself, anything outside it except external drives under `/Volumes`, `~/Library`, and hidden folders such as `~/.ssh`. Saved as its real path. Answered with `helpers` Since ADR-122 an agent needs no grant to read or write files; the window no longer offers this command, and old grants are kept but not used for file work. |
| `{"type":"grant.remove","helper":"kame","path":"/Users/k/Developer/app"}` | Take a folder back. An unknown one is ignored. Answered with `helpers` |
| `{"type":"routine.delete","id":2}` | Remove a routine (Task 3.9). An unknown id is ignored. Answered with `helpers` |
| `{"type":"routine.pause","id":2,"paused":true}` | ADR-094: pause (`true`) or resume (`false`) a routine. A paused routine makes no tasks; a resumed one does not make up the times it missed. Refused (stage `settings`) for an unknown routine. Answered with `helpers` |
| `{"type":"routine.add","helper":"researcher","task":"Summarise networking news","kind":"daily","minute":480}` | ADR-097: make a routine from the Scheduled page. `kind` is `daily` or `weekly` (with `minute`, the minutes after local midnight; `weekly` also has `weekday`, 0 for Sunday to 6 for Saturday) or `hours` (with `every`, 1 to 168, and an optional `startAt`, the first time as ISO 8601, at most a year ahead). Refused (stage `settings`) for an unknown worker, a worker that takes no tasks, an empty or long task, bad numbers or more than 20 routines. Answered with `helpers` |
| `{"type":"routine.update","id":2,"helper":"researcher","task":"…","kind":"hours","every":4}` | ADR-097: change a routine's worker, task and schedule (the fields of `routine.add`). The routine counts from now: a changed time does not come due at once. A text change alone keeps an hourly routine's times. Refused (stage `settings`) as `routine.add`, and for an unknown routine. Answered with `helpers` |
| `{"type":"job.fresh","id":12}` | Forget a task's Claude session (Task 3.6): an ended task runs again from the start; a queued one starts fresh. A running task is refused with an `error` (stage `settings`). Answered with `helpers` |
| `{"type":"job.stop","id":12}` | Stop a queued or running job (it becomes `stopped`). An unknown or finished job is ignored. Answered with `helpers` |
| `{"type":"job.delete","id":12}` | Forget a job and its report (a running job is stopped first). An unknown id is ignored. Answered with `helpers` |
| `{"type":"helper.pin","helper":"sid","model":"claude-sonnet-…"}` | Pin a worker to one model (ADR-083), skipping Laya; `model` must be one of the `models` in the `helpers` event, or `""` to let Laya choose again. Answered with `helpers`; an unknown helper or model is refused with an `error` (stage `settings`) |
| `{"type":"helper.codex.pin","helper":"sid","model":"codex-default"}` | ADR-160: save a separate Codex worker pin from the available Codex provider's offered models in `info`; `""` clears it even if Codex is unavailable. Exact helper/model fields only, validated ids, host catalog checks. Answered with `helpers` carrying optional `codexPinnedModel`; refusal uses `error` stage `settings`. Does not select a provider or change running tasks. Unavailable pins refuse later Codex task admission without fallback. |
| `{"type":"helpers.settings","allowLarge":true}` | Allow or forbid the large model for worker jobs (ADR-083; default allowed). `false` caps every job at the medium tier. ADR-098 item 7: `codexFallback` (boolean; default `false`) is the Codex switch. ADR-110 N4: ATOM sets no plan limit now, so the switch starts no Codex run. Either field may be sent alone. ADR-110 N4 removed `planLimit` and `maxRunning`: a command with only these is refused with an `error`. Answered with `helpers` |
| `{"type":"soul.set","helper":"sid","soul":{"name":"Sid","personality":"…","howItWorks":"…","rules":"…","lessons":"…"}}` | Save a worker's edited soul as a new version (ADR-082, Task 3.3); used from its next job. All five fields are text; other fields in `soul` are dropped. Limits after trimming: name 1–20 letters (spaces, hyphens, apostrophes), unique among workers, not ATOM or Pal; personality 1–600; how it works and rules up to 1500; lessons up to 2000. An unchanged soul adds no version. Answered with `helpers`; refused with an `error` (stage `settings`) |
| `{"type":"soul.restore","helper":"sid","version":2}` | Make an older soul version current again, saved as a new version so the restore can be undone. Answered with `helpers`; an unknown version, or a name another worker now has, is refused with an `error` (stage `settings`) |
| `{"type":"quit"}` | Release the microphone, stop speech and exit with code 0 |

Holding Ctrl+Option maps to `talk.start` on press and `talk.send` on release. Pressing another key while holding, or Esc, maps to `talk.cancel` (ADR-035).

---

## 4. Events (runtime → island)

| Event | Fields | Meaning |
|---|---|---|
| `ready` | `protocol`, `provider`, `model`, `microphone`, `voice`, `telegram`?, `computer`? | Started. `voice` is `false` if the voice failed to load (an `error` with stage `speech` comes first); replies still arrive as text. ADR-098: `telegram` is `true` when ATOM's Telegram bot is set up in `.env` `computer` is `true` when computer control is on in this run (ADR-054, ADR-119); absent from an older runtime means off. |
| `state` | `state` | One of `idle`, `listening`, `transcribing`, `thinking`, `speaking` |
| `mic.ready` | — | The microphone is capturing. Speech from now on is recorded. The island shows a turn as "Listening…" until this arrives, then "Speak now": ATOM raises its arms with pixel sound bars (no bubble), and the card under the menu-bar icon says it when ATOM is off. |
| `mic.level` | `peak` | Loudest sample since the last `mic.level`, 0–1. At most 20 per second, only while listening |
| `mic.silent` | `microphone` | The microphone has heard only near-silence for 2.5 s while listening. Probably the wrong device. Sent once per turn |
| `transcript` | `text` | What the user said |
| `reply` | `text` | ATOM's full reply, sent before it is spoken |
| `turn.complete` | `speechMs`, `transcriptionMs`, `modelMs`, `firstSoundMs` | The reply finished playing. Timings in milliseconds; `firstSoundMs` may be missing |
| `notice` | `kind`, `message` | The turn ended without a request. Not a failure. `kind` is `too_short`, `mic_starting` or `no_speech`; `message` says what to do, worded for the island's controls |
| `conversation.reset` | `projectId`? | The conversation was forgotten. `projectId` is set when the new chat is in a project (ADR-107) |
| `info` | `provider`, `model`, `providers` | The model in use and the choices. Sent right after `ready` and after every successful `model.set`. `providers` is a list of `{ "id", "name", "available", "models" }`: `available` is `false` when the provider's API key is missing from `.env`; `models` is a list of `{ "id", "name" }` offered for that provider (the current model is always included). API keys are never sent |
| `computer.end` | none | The computer work is over: no step came for a few seconds and no approval waits (ADR-054, 2026-10-15). The island clears its work strip. Sent for every turn that used computer control, whoever started it (voice, the local API, Telegram, a goal). |
| `computer.step` | `text` | ATOM is about to do something on the Mac (computer control, ADR-054), in plain words such as "Typing in TextEdit". Sent only while a turn is running. Contains the app name and the kind of action, never typed text or screen content |
| `computer.point` | `x`, `y`, `w`, `h` (numbers), `label` | ATOM shows the user a place on screen (ADR-054, Task 0.6.4): ATOM flies to the element and the bubble says `label` (e.g. "the settings button"). The numbers are Cua's own: points, origin at the top-left of the main display, y down, across all displays. Sent only while a turn is running. `w` and `h` must be above 0 and every number finite, or the island reports a bad event. A place on no display is not flown to. ATOM stays about 7 s after arriving, then goes back; a new turn, a reset or an error also ends it. Contains the label only, never screen content |
| `settings.open` | — | Open the panel on its Settings page, as if the user had opened it (ADR-071: "open settings"). Already open there: nothing changes |
| `media.key` | `key` | Press the Mac's system media key once, down then up (ADR-071: "pause the video"). `key` is `"playpause"`; any other value is a bad event. It reaches whatever macOS has as Now Playing (YouTube in a browser, Spotify, Music) and is a toggle. Posting needs Accessibility; without it the island shows a notice instead and nothing is pressed |
| `approval.request` | `id`, `summary`, `reason` | ATOM will not do this until the user says yes: `summary` is the action ("Click \"Send\" in Mail"), `reason` is why it asks. One request at a time. The island shows Allow and Decline and answers with `approval.answer`. Optional `rememberFile: true` offers Allow for task and Allow for chat; only the latter answers with `rememberFile: true`. It permits one exact file in this chat across tasks/restarts, revocable with “Forget file permissions for this chat”. The runtime declines by itself after 60 s |
| `approval.closed` | `id` | That request is no longer waiting (answered, declined, timed out, or the turn was cancelled). The island removes the prompt |
| `timer` | `id`, `label`, `message` | A timer ended (ADR-061). The runtime has already chimed and spoken `message`; the island shows it. |
| `worker.line` | `line` | A line from the team (Task 3.15): a goal done, or a plan waiting for Keshab's OK. Sent when ATOM is idle, just before it says the line; the island shows it and ATOM flies to the menu-bar icon with it. |
| `brain` | `nodes`, `edges`, `omitted`, `tags` | The second brain's graph. `nodes`: `{ "id", "title", "kind" ("note", "memory", "episode", "chat", "project" or "entity"), "ghost", "tags", "degree", "updatedAt" }`, the most linked 400. `edges`: `{ "a", "b", "auto" }`. `omitted`: notes left out. `tags`: `{ "tag", "count" }`. Note titles and text are never logged. |
| `brain.note` | `note` | One note: `{ "id", "title", "body", "kind", "ghost", "tags", "links", "backlinks", "updatedAt" }`; `links` and `backlinks` hold `{ "id", "title", "kind", "ghost"?, "auto" }`. |
| `brain.hits` | `query`, `hits` | The answer to `brain.search`: `{ "id", "title", "kind", "snippet" }`. |
| `text.edit.result` | `id`, `answer`, `changed`, `error` | The answer to `text.edit`. `answer` is the new text for the target: it replaces the selection, or the whole text. `changed` is false when it is the same as the target. On a failure there is `error`, in words for the user, and no `answer`. The text is never logged |
| `brief` | `settings`, `history`, `running` | The daily brief. `settings` has the fields named in `brief.set`. `history` lists the newest briefs first, at most 14: `{ "id", "day" (YYYY-MM-DD), "createdAt" (ISO 8601), "lines", "source" ("model" or "template") }`. `source` "template" means the model was not available and the runtime saved a plain version. `running` is true while a brief is made. The lines are never logged |
| `suggestions` | `enabled`, `items` | Remembering by itself: whether new suggestions are made, and the facts that wait for an answer: `{ "id", "text", "createdAt" }`, at most 3, oldest first. A suggestion is not a memory until `suggestions.accept`. One expires after 14 days. Sent after `suggestions.get` and after each change. The text is never logged |
| `memory` | `enabled`, `count`, `memories`, `episodes` | What ATOM keeps (ADR-058), newest first: a list of `{ "id", "text", "createdAt" (ISO 8601), "source" ("voice" or "text") }`. `episodes` (ADR-059) lists conversation notes, newest first: `{ "id", "summary", "endedAt", "exchanges" }`; an island must accept it missing. `chats` (ADR-097) lists the newest 30 chats, then kept chats that are no longer in the chat list: `{ "id", "title", "updatedAt"? (ISO 8601), "messages", "kept", "indexing"?, "keptAt"? }`; an island must accept it missing. `enabled` is `false` (and the list empty) when memory is off (`ATOM_MEMORY=0`, or its file could not be opened). Sent only after `memory.list`, `memory.forget` or `memory.clear`, and after changes once the island has asked. Memory text is never logged |
| `capabilities` | `items` | What ATOM can do now (ADR-076): a list of `{ "title", "examples" }`, one per group of tools that are on, in the order tools are registered. Sent after `info`: at start, and again after every successful `model.set` (web search depends on the provider). The island replaces its list each time |
| `plan.usage` | `fiveHour`, `sevenDay`, `overage`, `resetAt`, `limited` | Last reported Claude plan information (ADR-076/155), all optional. Usage fractions outside 0–2 are dropped. `resetAt` is finite Unix seconds after zero and before 2100; `limited` comes from a known SDK status. An event with no valid fields is dropped. No automatic retry or proof of quota restoration |
| `context.ready` | `app`, `ok`, `message` | Answer to `context.window`. `ok: true`: the read is held, and the island opens the microphone for the question. `ok: false`: `message` says why (a blocked app, or reading turned off with `ATOM_FRONT_WINDOW=0`); nothing is held |
| `helpers` | `helpers`, `apps` | Every helper and its recent jobs (ADR-081). `helpers` is a list, in a fixed order, of `{ "id", "name", "available", "role", "soul", "soulVersion", "soulVersions", "app", "jobs" }`: `name` is the soul's name; `available` is `false` for a worker not ready for jobs yet (shown as "coming soon"; its soul can still be edited); `role` is fixed in code (`researcher`, `coder`, `designer`, `documenter`, `financial adviser`, `hr`, `improver`); `soul` is `{ "name", "personality", "howItWorks", "rules", "lessons" }`; `soulVersions` lists at most 10, newest first, each `{ "version", "createdAt" }` (all versions are kept); `app` is the app's name or `null`. `jobs` is newest first, at most 20, each `{ "id", "task", "state", "createdAt", "endedAt"?, "step"?, "partial"?, "title"?, "summary"?, "error"? }`: `state` is `queued`, `running`, `done`, `failed` or `stopped`; `step` is what a running job is doing in plain words; `title` and `summary` (one line) exist when a report does; `error` says why a job failed. `apps` lists installed app names for the app picker. Sent after every helper command, and whenever a job changes once the island has sent `helpers.list`. Each job also has `blockedBy` and `waitingFor` (task ids it waits for, and those not done yet), `comments` (how many notes), and `goal` and `parentId` when set (ADR-087). A task ATOM handed out (Task 3.5: the `delegate` tool, or "Sid, …" by voice) has `goalId`, and `goalEnded: true` once its goal has ended with its combined report. `resumable: true` means its next run continues the last run's Claude session (Task 3.6). `held` says why a runnable task waits for Keshab (a plan to approve, or an interrupted run); it belongs under "Needs you". ADR-110 N4: no budget, plan limit or run limit holds a task. Task 3.8: `planFirst` marks a task whose first run only plans; `planStatus` is `awaiting` (held for Keshab's OK) or `approved`, with `planSummary`; ADR-098 item 3: `interrupted: true` marks a queued task whose run Keshab interrupted (it waits for his message, with `held`); each helper has `planFirst` (its new tasks plan first). ADR-098 item 4: each helper has `browser` (`true` when its runs get the browser). ADR-088: each helper has `kit` (`research`, `folders` or `think`) and `custom` (an agent Keshab added, from its soul.md). Task 3.16: with Keshab's own Paperclip connected (`ATOM_PAPERCLIP_URL`, loopback only), the event has `paperclip`, `{ "issues" }`, each `{ "id", "identifier"?, "title", "agent", "status", "createdAt", "result"? }`: the tasks ATOM handed to Paperclip agents; absent when the connection is off. Task 3.13: jobs carry `rating` (`good` or `bad`) and, for a Tinker task, `reviews` (the task it reviews); each helper has `proposals`, every pending one and the newest few others, each `{ "id", "field", "text", "reason", "jobId", "state", "createdAt" }` (`state` is `pending`, `accepted`, `rejected` or `undone`). Task 3.12: each helper has `skills` (the names chosen for it), and the event has `skills`, the skills to choose from as `{ "name", "description", "source" }` (`source` is `yours` for `~/.claude/skills` or `zeno` for ATOM's own, ADR-094). ADR-094: the event has `skillDrafts`, each `{ "id", "jobId", "helper", "name", "description", "preview", "state", "createdAt" }` (`preview` is the start of the steps; `state` is `pending`, `approved` or `rejected`), and `skillEdits`, each `{ "id", "skill", "jobId", "reason", "before", "after", "state", "createdAt" }` (`before`/`after` a few lines from the first changed one; `state` is `pending`, `accepted`, `rejected` or `undone`): every pending one and the newest few others. ADR-098 item 8: a proposal and a skill edit with a test run have `tests`, `{ "better", "same", "worse", "notRun", "failed", "running", "results" }` (counts, for "Test cases: 2 better, 1 same"; `better` counts cases where the new text wins, `worse` where the old wins); each result is `{ "caseId", "task", "state", "better"?, "reason"?, "oldAnswer"?, "newAnswer"? }` (`state` is `running`, `done`, `failed` or `skipped`; `better` is `old`, `new` or `same`; `reason` is the judge's reason or why the case did not run; the task is cut to 200 characters and each answer to 800). The event has `testCases`, every saved test case, newest first, each `{ "id", "kind", "target", "jobId", "task", "createdAt" }` (the saved report is never sent). Tinker tasks that draft or edit a skill also have `reviews` (the task they are about). Task 3.11: each helper has `grants` (the folders it may work in, real paths). Task 3.9: each helper has `routines`, each `{ "id", "task", "when", "lastAt"?, "lastSkipped"? }` (`when` in words, such as "Every day at 8:00 AM"; `lastSkipped` when its last time came while the previous task was still going); ADR-094 adds `paused`? (`true` when paused) and `nextAt`? (ISO 8601, when it next comes due; absent while paused). ADR-097 adds `schedule`, the schedule as numbers for the edit form: `{ "kind", "minute"?, "weekday"?, "every"? }` (as in `routine.add`). ADR-094: a helper with wake-ups on has `wakeUp`, `{ "every", "when", "paused"?, "lastAt"?, "nextAt" }` (`every` is `15m`, `1h`, `4h` or `1d`; `when` in words, such as "Every hour"; absent when off), and the event has `teamTasks`, the team tasks waiting to be taken, oldest first, each `{ "id", "task", "role"?, "createdAt" }` (no `role`: anyone). ADR-110 N4: `budget`, `team`, `planLimit` and `maxRunning` are gone; the island reads them as absent. ADR-098 item 7: `codexFallback` (the Codex switch is on) and `codexReady` (Codex is found and signed in; the switch shows only then); both `false` from an older runtime. A job that ran on Codex has `model` `codex` and `modelReason` "Ran on Codex (Claude plan limit reached)". A queued task whose blocker fails or is stopped fails too. ADR-093: `agentProblems`, `[{ "id", "problem" }]`, lists agent folders whose `data/agents/<id>/soul.md` could not be loaded (folder name and why; the Board shows each as "<id>: <problem>"); absent when every agent loaded; ADR-095 adds an Agent whose `manager:` names no Manager (it works without one) and a Manager soul.md with a `kit`, `role` or `manager` (not loaded). ADR-095: each helper may have `manager` (its Manager's id; absent for Tinker or none), and the event has `managers` (absent when there are none), each `{ "id", "name", "mode", "soul", "soulVersion", "agents", "jobs" }`: `mode` is `plan` or `group`; `agents` lists its Agents' ids; `jobs` are its own runs (plan mode: one per part ATOM handed it), in the jobs' shape. With Managers, the Board and floor show one chip and one desk per Manager. ADR-095: a job may have `subAgents`, the sub-agents its runs started (the newest 12, oldest first; absent when none), each `{ "name", "state", "description", "result"? }`: `name` is `searcher`, `reader`, `coder` or `checker`; `state` is `started`, `done` or `failed`; `description` is what it was asked (at most 120 characters) and `result` its short answer (at most 200). B3.5, ADR-102: `source` of a skill can also be `hub` (installed from the skills hub). The event has `skillHub`, absent when there is nothing to show: `{ "results", "pending", "installed", "message"? }`. `results` is the last search, at most 10, each `{ "name", "description", "repo", "path", "sha", "source" }`. `pending` lists the skills that wait for an answer, each `{ "id", "kind", "name", "description", "repo", "path", "sha", "text", "flags" }`: `kind` is `new` or `update`; `text` is the whole file; `flags` is a list of `{ "kind", "severity", "excerpt" }` (`severity` is `warn` or `info`). `installed` lists `{ "name", "repo", "path", "sha" }`. The change event `{ "action": "skillHub", "id"?, "skill"?, "state"? }` has `state` `pending`, `approved`, `rejected`, `uninstalled`, `updated` or `undone`. Task text is the user's own words; it is never logged Since ADR-110 (N4 and N5) the fields `wakeUp`, `teamTasks`, `managers`, `subAgents`, `codexFallback` and `codexReady` are no longer sent. |
| `thread` | `id`, `comments`, `activity`, `report`? | One task's thread (ADR-087, Task 3.4), answering `thread.get`. `comments` are `{ "id", "text", "createdAt", "delivery"? }`, oldest first (ADR-098 item 3: `delivery` is `live` for a message the running task took, `after` for one kept for after the run); `activity` is `{ "kind", "at" }` with `kind` one of `created`, `waits`, `commented`, `woken`, `fresh`, `interrupted`, `running`, `done`, `failed`, `stopped`; `report` is `{ "title", "summary", "body", "sources" }` when there is one: `body` is plain text with paragraphs separated by blank lines; `sources` is a list of `{ "title", "url" }` (http or https only). `plan` (Task 3.8) is `{ "summary", "steps" }` once a plan-first run wrote one; activity kinds also include `planned`, `approved` and `rejected` (and, ADR-095, on a Manager's run, `split` and `revised`). `handOffs` (Task 3.10) lists the sub-tasks the task handed to other workers (activity `handed`); a sub-task's job carries `parentId`. ADR-098 item 8: `testSkills` lists the ATOM-made skills a done task's runs used (each can take the task as a test case); absent when none. `goal`, for a task ATOM handed out (Task 3.5), is `{ "id", "text", "ended", "tasks", "report"? }`: `tasks` are the goal's task ids and `report` the combined report once every task has ended (absent when none was done). Never logged. B3.1: `toolCalls`? is the run's activity timeline: the newest 100 tool calls, oldest first, each `{ "id", "agent"?, "tool", "input", "state", "result"?, "at", "ms"? }`. `agent` is the sub-agent's name (absent: the run itself). `input` is a short summary (at most 160 characters), never a write payload or typed text. `result` is at most 200 characters. Both are redacted before they are stored: secrets show as `[hidden]`, and a secret file shows as "(secret file, hidden)". `state` is `started`, `ok` or `error`. `at` is when the call started (ISO 8601). `ms` is its length, once it ended. The key is absent when no call was recorded (Codex and Manager runs record none). After each change to a task, the island sends the last thread it was asked for again, so a new call shows at once. B3.4: `checkpoints`? lists the files the task's runs changed in the agent's folders, oldest first, at most 100: `{ "path", "kind", "state", "reason"? }`. `path` is relative to its folder. `kind` is `modified` or `created`. `state` is `ready` (can be undone), `changed` (ready, but the file changed after the run: undo needs `force`), `undone`, or `skipped` (not kept: `reason` is such as "secret file", "too large", "too many files", "outside the folders"). The key is absent when there are none. `bashRan`? is `true` when the run called Bash and the task has a folder: what a command changes is not kept. Never logged |
|  |  | ADR-083 adds: top-level `allowLarge` (boolean) and `models` (the plan's offered models as `{ "id", "name", "tier" }`, `tier` one of `small`, `medium`, `large`; empty when the provider is not the Claude plan); per helper `pinnedModel` (model id or `null`); per job `model` (model id, once chosen) and `modelReason` (plain words: "Laya: trivial", "Laya: hard", "Pinned", "Laya unavailable", "Role minimum", "Large model off"). An island must accept all of them missing |
| `error` | `stage`, `message`, `kind`, `retryable` | Something failed. `kind` and `retryable` are present for model errors only |

`state` returns to `idle` after every turn, including turns that end in `notice` or `error`.

Computer control is off unless the runtime was started with `ATOM_COMPUTER=1`; without it none of the three computer events is ever sent. With the island closed or no `approval.answer` coming, an approval is a refusal, never a yes.

Fields not listed are ignored by both sides, and an unknown event or command type is ignored by the island and answered with a `protocol` error by the runtime. This keeps an older island working with a newer runtime.

### Model choice

The runtime picks its model in this order: `config/island.json` (written by `model.set`) if its provider has an API key, else `ATOM_LLM_PROVIDER` / `ATOM_LLM_MODEL` from `.env`. `config/island.json` is local and not in git:

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

`{"type":"speech.set","reports":true,"updates":false}`: whether ATOM says the team's reports, and timers and other updates, aloud. A muted line still shows (the island's card, ATOM's line); it is not chimed or spoken. ADR-097 adds `chime` (optional, default `true`): whether ATOM plays the chime before a spoken line. With `chime` `false`, ATOM speaks the line without the chime. The island sends it when ATOM connects and whenever Keshab changes it. No answer.

### helpers: usage (ADR-091)

The `helpers` event carries `usage`: `today` and `week` totals (`input`, `output`, `cacheRead`, `cacheWrite`, `dollars`, `runs`), `days` (the last 7, oldest first, each with `day` as a local `YYYY-MM-DD`), `byWorker` (`helper` id or null for ATOM's chat, and `name`) and `byModel` (`model`), and `chatCacheCold` (ADR-098 item 9: true when ATOM's last 3 chat answers read nothing from the cache). Counts and model ids only.

Token cost, job 4: `usage` has the optional `recent`: the newest 8 calls, newest first. Each has `at` (ISO time), `kind` (`turn`, `note` or `job`), `model`, `input`, `output`, `cacheRead`, `cacheWrite` and, when known, `gapMs` (milliseconds since the last call of the same chat and model). The Dashboard shows `input + output` as the main number and the two cache counts apart. It sums them from the existing totals, so `today`, `week`, `days`, `byWorker` and `byModel` do not change. An older runtime does not send `recent`: the Dashboard then shows no list of turns.

### Chats (ADR-091)

- `{"type":"chats.list"}` → `{"type":"chats","chats":[{"id","title","updatedAt","messages"}],"current":"<session id>"}`, newest first; sent again after every saved exchange, a new chat or a delete.
- `{"type":"chat.open","id":"…"}`: ATOM continues that chat (voice and typing go to it) → `{"type":"chat.opened","id":"…","messages":[{"role":"user"|"assistant","text":"…"}]}`, then `chats`.
- `{"type":"chat.delete","id":"…"}`: deletes it; if it was the current chat, ATOM starts a new one (`conversation.reset`), then `chats`.
- `conversation.reset` (New chat) is also followed by `chats` once the window has asked for them.

### Projects (ADR-107)

A project is a named folder and its chats. A project chat is an ordinary chat that has a `projectId`. It reads the folder with Read, Glob and Grep. It never writes. To change files, it hands the work to the project's Agent.

Commands. Every refusal is an `error` event with stage `settings`. Every success is answered with a `chats` event.

| Command | Meaning |
|---|---|
| `{"type":"project.add","name":"Haat","path":"/Users/me/Developer/haat"}` | Make a project. `path` is a full path with no `..`. The runtime checks the folder with the grant rules: it refuses the home folder, `~/Library`, hidden folders, and folders outside the home folder or `/Volumes`. It makes the project's Agent (or reuses it) and grants it the folder. The name has 1 to 60 characters on one line, and is unique without regard to case. At most 20 projects are open |
| `{"type":"project.rename","id":"p-1a2b3c4d","name":"New name"}` | Rename. The same name rules apply |
| `{"type":"project.remove","id":"…","deleteChats":false}` | Remove the project. `deleteChats` is optional and defaults to `false`: the chats stay as plain chats. The files are never touched. The project's Agent stays with its folder grant; Keshab removes it on its own page |
| `{"type":"project.archive","id":"…","archived":true}` | Archive or open again. An archived project takes no new chat. Archived projects do not count toward the 20 |
| `{"type":"project.model","id":"…","provider":"claude-plan","model":"opus"}` | The project's model. `""` and `""` clear it. The runtime checks it as it checks `model.set` |
| `{"type":"project.web","id":"…","web":true}` | Web search in the project's chats. Off by default |
| `{"type":"chat.new"}` or `{"type":"chat.new","projectId":"…"}` | A new chat, in a project when `projectId` is given. An unknown or archived project is refused and nothing resets. `conversation.reset` is the same command without a project |
| `{"type":"chat.rename","id":"…","title":"…"}` | Give a chat a title (1 to 60 characters, one line). The title stays when the chat is saved again. It works for every chat the window writes. The chats `telegram`, `api` and `api-<chatId>` are refused with the read-only message. A chat that is not saved yet is refused: send a message first |

Events.

- `chats` gets `projects`: `[{"id","name","folderLabel":"~/Developer/haat","missing":false,"archived":false,"chatCount":3,"web":false,"agent":"haat-coder","provider"?,"model"?}]`. The key is present when projects are on, also when the list is empty. `agent` is a worker id and is absent when the project has no Agent. `provider` and `model` are the project's own model and are absent when it has none. `missing` is `true` when the folder is gone or is no longer allowed: its chats open as text only.
- Each item of `chats.chats` may have `projectId`. Project chats stay in the list. Group them by `projectId`. The list holds the newest plain chats and the newest chats of each project.
- `chats` also has `currentProjectId` when the chat in use belongs to a project. This includes a new project chat that is not saved yet.
- `conversation.reset` has `projectId` when it follows `chat.new` with a project.
- `chat.opened` has `projectId` for a project chat. ADR-135: the full saved transcript is replayed. `trimmed` is retained for protocol compatibility but is no longer set to true; `messages` holds every saved turn. Provider context limits do not truncate the archive.
- The runtime also sends `chat.opened` again for the open chat when a goal posts its result into it (ADR-109). `messages` then ends with an assistant turn that has no user turn before it. Replace the shown turns. Show that turn as an answer without a question.
- The chat's model: the chat's own model wins, then the project's model, then the global model. `currentProvider` and `currentModel` show the one in use.
- Project chats support Claude and Codex with host-checked file tools (ADR-137). Text-only providers return a model-stage error asking the user to choose Claude or Codex.

### Git (ADR-091)

- `{"type":"git.list"}` → `{"type":"git","branches":[{"repo","repoName","branch":"atom/task-7","task":7,"title","base","commits":[{"sha","subject","at"}],"files":[{"path","added","removed"}],"remote","pushed":"no"|"yes"|"changed"}]}` for the repositories inside granted folders.
- `{"type":"git.push","repo":"/full/path","branch":"atom/task-7"}`: sent only after Keshab confirms; pushes that branch to `origin` (never forced), then `git` again; a refusal is an `error` with stage `settings`.
- `{"type":"git.diff","repo":"…","branch":"…"}` → `{"type":"git.diff","repo","branch","text","truncated"}`.

### AI tools (ADR-093)

The `info` event carries `tools`: each AI tool ATOM looked for on this Mac, `{"id","name","found","signedIn"?,"provider"?,"note"}` (`signedIn` absent when the tool cannot be asked; `provider` absent for tools ATOM does not use). `{"type":"tools.scan"}` looks again and is answered with `info`. Providers now include `codex` and `gemini-cli`.

### Model choice (ADR-097)

- The `info` event lists the live models of each provider in `providers[].models`.
  - Claude plan: the runtime asks the Agent SDK (`supportedModels()`) at start and on `model.refresh`. If the request fails, the runtime uses the last list or the built-in table.
  - Codex and the Gemini CLI: a known list. The first entry is the program's own model (`codex-default`, `gemini-default`).
  - The model in use is always in the list.
- `{"type":"model.refresh"}`: the runtime asks the Claude plan for its models again. The answer is `info`.
- `model.set` also accepts a custom model id. A custom model id has 1 to 100 characters: letters, digits, `.`, `_`, `:` or `-`.
- Codex receives the selected model through app-server `thread/start`; the Gemini CLI uses `--model`. The program's own model leaves the model field/flag unset. Codex workers currently use the chat's Codex model (ADR-137).
- `{"type":"chat.model","id":"…","provider":"codex","model":"gpt-5.5"}`: sets the model of one chat.
  - `id` is the chat id. Use `""` for the chat in use.
  - Use `""` for `provider` and `model` to use the default model again.
  - The runtime checks the model as it checks `model.set`. A refusal is an `error` with stage `settings`.
  - The answer is `chats`.
- The `chats` event has `currentProvider` and `currentModel` when the chat in use has its own model. They are absent when the chat uses the default model.
- A typed turn in a chat with its own model uses that model. Voice turns and new chats use the default model.

### Telegram (ADR-098)

- `{"type":"telegram.set","push":true}`: Settings' "Send to Telegram" switch.
  - With `push` `true`, ATOM sends new Needs you items and routine results to Telegram by itself.
  - With `push` `false`, ATOM sends only replies to Keshab's messages.
  - The island sends it when ATOM connects and when Keshab changes it. No answer. Without Telegram set up, the runtime does nothing.
- `routine.add` and `routine.update` take `notifyTelegram` (optional, `true` or `false`). With `true`, ATOM sends the result of each task the routine makes to Telegram. On `routine.update`, a missing `notifyTelegram` keeps the current choice.
- Each routine in the `helpers` event has `notifyTelegram: true` when it sends its result. The field is absent when it does not.
- The chat that holds the Telegram conversation has the id `telegram`. The `chats` event lists it with the title "Telegram".
- A chat that another surface writes has `readOnly: true` in the `chats` event. These are `telegram`, `api` and `api-<chatId>`. The field is absent on other chats. The window reads these chats and does not write them. A typed or spoken turn in one gets an `error` event (stage `model`) with the message "This chat is written from Telegram. Open it to read it only." (for the API chats: "…from the local API…"). `chat.open` still shows the messages.

### Local API (ADR-098 item 5)

- `{"type":"api.set","on":true}`: Settings' "Local API" switch.
  - With `on` `true`, the runtime listens on 127.0.0.1 at `ATOM_API_PORT` (default 4790). It makes `data/api-token` when the file is not there.
  - With `on` `false`, the runtime stops listening.
  - The island sends it when ATOM connects and when Keshab changes it. The answer is `api`.
- The `api` event has `on`, `port`, `tokenFile` and `error` (optional).
  - `tokenFile` is the full path of the token file. The island reads the file only when Keshab clicks "Copy token". The token is never in a protocol message.
  - `error` tells why the API does not listen, for example a port in use.
- `{"type":"api.regenerate"}`: Settings' "Regenerate" next to "Copy token" (2026-10-15). Deletes `data/api-token` and makes a new one (mode 0600). A running API takes the new token at once, and the old token stops working. Answered with an `api` event (`error` if the file cannot be changed). The token is never in the event or the log.
- `routine.add` and `routine.update` take `webhook` (optional, `true` or `false`). With `true`, `POST /v1/hooks/<id>` can start the routine. On `routine.update`, a missing `webhook` keeps the current choice.
- Each routine in the `helpers` event has `webhook: true` when a webhook can start it. The field is absent when it cannot.
- API chat turns go to the chat `api`, or `api-<chatId>` when the request has a `chatId`. The `chats` event lists them.

### Interrupted attempts and retries (ADR-139, 2026-10-18)

Jobs in `helpers` may include `recoveryNeeded: true`, `retryOf: <previous id>` and `retriedAs: <next id>`. Absent fields retain their previous meaning. `step` can be present on an interrupted failed attempt and means its last recorded step, not ongoing activity. The state remains `failed`; clients show “Interrupted · outcome unconfirmed” and review before retry.

`job.retry` creates a new linked attempt through the native dispatcher. Repeated delivery for one source does not dispatch again; retry the new failed attempt to explicitly try again. The source remains historical and is excluded from duplicate failure attention. A removed next attempt retains its parent-side id and cannot be resurrected. A task note does not automatically rerun an ended native attempt. Remote unknown-outcome attempts ask for Mac review instead of exposing Retry. See [recovery behavior](task-recovery.md); earlier legacy retry/wake descriptions do not override ADR-139.

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
  - Search everything (upgrades.md C1): the event can also have the groups `pages` (Second brain notes; `id` is the note id), `facts`, `notes` (conversation notes), `projects` (`id` is the project id), `agents` (`id` is the helper id), `skills` (`id` is the skill name) and `routines` (`id` is the routine id). Each has at most 8 results, ranked: a title that starts with the words first, then a title with a word that starts with them, then a title that has them, then a body that has them; a newer result wins a tie. Case and character width are ignored. The `at` of these results is optional. A runtime that does not know them sends none.
  - The runtime searches only on this Mac and sends nothing to a model. Remembered facts and conversation notes go only to the window.
  - The window searches Settings page names itself.
- `{"type":"job.label.add","id":5,"label":"…"}`: adds a label to a task.
  - A label has 1 to 24 characters: letters a to z, digits, dashes and spaces. The runtime changes capital letters to small letters.
  - A task has at most 6 labels.
  - The answer is `helpers`. A refusal is an `error` with stage `settings`.
- `{"type":"job.label.remove","id":5,"label":"…"}`: removes a label from a task. The answer is `helpers`.
- In the `helpers` event, each job has `labels` when it has labels. `labels` is sorted.
- The runtime does not log the query, the results or the labels. The log has the number of results of each kind only.


### Task lifetime and status (ADR-140, 2026-10-18)

Stop closes that task's pending approval ids immediately, including before native SDK task-id delivery. Late `approval.answer` messages for closed ids do nothing; other task requests stay valid. Cached decisions and grant creation also check host task lifetime.

Window task/retry turns contribute queued/running activity independently of the foreground voice/text loop. The runtime uses existing `state` messages for Thinking/idle and keeps a live approval when other work ends. It may re-present the same `approval.request` id and text after foreground work or another card ends; this is the original live request, not a new authorization. No new wire fields/event shapes are introduced. [Evidence](task-state-lifecycle.md).


## Saved conversation controls (ADR-155)

Private native pipe only; no new HTTP/model tool. Requests have `type:"chat.control"`, `action`, saved `id` and request UUID. Unknown/extra fields, invalid ids/UUIDs, noninteger cursors/versions and malformed revisions refuse. Correlated responses repeat type/action/id/request, with `ok` and either a result or `error`.

| Action | Request fields | Success payload |
| --- | --- | --- |
| `inspect` | none extra | SHA-256 `revision`; `info:{messages,archiveBytes,replayBytes,replayBudget,omitted,lastUser?}`. Counts are saved archive counts; bytes estimate fresh replay, not provider token/session usage |
| `page` | `message` (1 based), `offset` (UTF-16, zero based), optional `revision` | `revision`; `page:{messages:[{seq,role,offset,text}],nextMessage?,nextOffset?}`. Up to eight rows and 8 KiB JSON budget; continue with supplied cursor, retaining revision |
| `flags` | current `version`, optional boolean `pinned`/`archived` (at least one) | `metadata:{pinned,archived,version,previousPinned,previousArchived}`. Compare-and-set; inverse values with returned version implement conditional Undo |
| `fork` | `revision`, `kind:"fork"|"edit"|"retry"`, `through` | `branch:{id,kind,draft,created}`. Fork includes the first `through` messages (zero allowed); edit/retry require the `through` user message and copy only its preceding prefix |

Fork/archive changes require an idle foreground/source turn. Shared Telegram/routine/API writers cannot be archived. All saved-history actions require a saved row, including an empty fork; normal `chat.open` can reopen such a row. A changed revision refuses before copying. Forks over 20,000 source messages/16 MiB copied text or 128 KiB restored prompt refuse.

A fork creates `fork-<lowercase request UUID>` and its durable request record in one SQLite transaction. The host resumes it and emits `chat.opened`, then `chats`, then the control response. It never dispatches the draft to a model. Repeating the original request reopens the existing child with `created:false,draft:""`; a deleted child's tombstone refuses recreation. A failed/lost response is not proof that no child was saved. No external file/network effects are rolled back or replayed by these controls.

`chats.chats[]` adds optional `pinned`, `archived` and `flagsVersion` (defaults false/false/zero). Pins sort first. Normal summary limits are augmented by up to 500 pins and 500 archives; this is not an unlimited catalog. Archived native chats reject new text/voice turns until unarchived. `chat.opened.messages[]` adds optional authoritative saved `seq` (1 based); clients must not derive it from live turn counts because notices/failures may not be archived. Readers ignoring the new fields keep existing rendering.

Saved pages are read-only text. New forks inherit project/own model metadata, never source provider sessions, exact-file chat grants, attachment bytes, approvals or jobs. See [behavior and verification limits](conversation-controls.md).


## Foreground work and clarification (ADR-156)

`chat.work` is an ephemeral primary-window snapshot, not a durable task/permission record:

```json
{"type":"chat.work","chat":"<chat id>","turn":"<UUID>","startedAt":"<ISO date>","elapsedMs":1200,"state":"working","calls":[{"id":"<host UUID>","tool":"Read","state":"started"}],"omitted":0,"questions":[]}
```

Work state is working/completed/failed/stopped. Elapsed and optional call `ms` are finite monotonic durations clamped to 0–86,400,000. Up to 60 call rows have id/tool/state (started/ok/error/unknown), with no arguments/results; `omitted` counts additional observations. Claude main SDK messages and checked Codex foreground calls are observed; worker/internal/other-surface activity is excluded. Native clients attach only to the matching visible foreground turn, interpolate while working and freeze on disconnect. Replayed saved chats do not recreate work logs.

Up to four `questions` contain `{id,prompt,choices,state,answer?}`. Prompt is at most 600 UTF-16 units; up to four distinct suggestions are at most 100 units each; answered text is at most 2,000 units. State is pending/answered/skipped/expired. Only one card waits. Main foreground Claude/Codex ask_user supplies these records; worker/composed cores do not receive it. A capable native client sends {"type":"chat.work.watch"} after ready (no extra fields). Without that opt-in, cards refuse immediately with reply-based fallback; older UIs never wait on an invisible card. Cards settle on explicit answer/Skip, 90 seconds, enclosing-turn cancellation/timeout or bridge detach. No-answer never implies consent.

`{"type":"chat.question.answer","chat":"<chat id>","turn":"<UUID>","id":"<card UUID>","text":"<answer>"}` answers the current card; omit text to skip. Unknown keys, malformed ids, empty/oversized text refuse parsing. Valid but old/duplicate identities do nothing. The updated snapshot acknowledges settlement. This command is distinct from approval.answer and cannot modify grants/plans/settings. Successful saved exchanges append labeled JSON question/answer data to original user text; failed/cancelled exchanges retain the existing no-save behavior. Work snapshots and failed-turn answers are not a durable delivery protocol.

The inspect result `info.access` optionally contains `{provider,hostTools,project,fileGrants,computer,web}`. This is selected configuration and exact-file continuing-grant count, not effective full access, account health or macOS permission status. It reads no project file contents, writes no permission and can be stale until refreshed. Existing clients can ignore it. [Behavior and verification limits](chat-work-visibility.md).


## Durable foreground delivery and review (ADR-157)

Identified native text.send adds request UUID and chat (both required together). Native saves text/references under that id before sending; the host claims the id and payload signature in SQLite before attachment preparation/model dispatch. Identical repeated admission returns the existing receipt without another dispatch; conflicting reuse refuses. Source chat is checked again after waiting for an older turn to unwind. Legacy sends/voice receive generated host ids at the Core boundary.

foreground.receipt carries `{id,chat,state,archived}` after durable acceptance/state confirmation. States are prepared/running/completed/failed/stopped/interrupted. It does not prove external effects or that the UI displayed a reply. Completion linked to chat history is written with the full exchange transaction, including saved reply sequence/hash; a false archived flag can still have a retained reply fallback. Native may send `{type:"foreground.ack",id}` only to scrub content already linked to a completed archive. Metadata tombstones remain.

| Command | Fields | foreground.recovery success |
| --- | --- | --- |
| foreground.list | request UUID, pending UUID array, pendingAnswers array of `{id,digest}` (SHA-256 of exact accepted answer text); arrays max 2,000 | attempts (up to 100 metadata summaries), known delivery ids, knownAnswers with matching fingerprints |
| foreground.read | request UUID, id UUID, offset integer (0 initially; then supplied nextOffset) | record: original text/files/notes, source/provider/state metadata, accepted answers, reply part/offset/nextOffset? |
| foreground.dismiss | request UUID, id UUID | ok after confirmed non-running payload dismissal |

Every response repeats request and ok, with error on failure. Unknown fields/invalid ids/cursors refuse. Reply chunks use an 8 KiB JSON string budget and avoid splitting surrogate pairs. Original prompt storage is bounded to 128 KiB; fallback replies to 4 MiB, with 100 undismissed attempts and a 64 MiB payload admission budget. Completed archive replies are referenced rather than duplicated. Native correlates list/read/dismiss replies and keeps unknown local copies after timeouts; nothing is retried automatically.

Question-card answer intents persist locally before chat.question.answer; the host persists before an answered work snapshot/model delivery. Storage refusal leaves the question pending with optional bounded error text and permits retry/Skip. Successful exchanges retain clarification text in the saved user message as before; failed/cancelled accepted answers now remain in the recovery journal. On startup prepared/running records become interrupted. Partial stream text and external-operation reconciliation are not covered. The JSON input snapshot is v3 (loads v1/v2); all commands remain private-pipe only, with no new HTTP/model recovery route. [Behavior and verification limits](foreground-recovery.md).


ADR-164 (2026-10-18): native helper job entries may include optional `advisory: true` for tool-free review children. It defaults false when absent. Existing `parentId` and thread `handOffs` identify the display relationship; durable host advisory scope remains authoritative after parent deletion/unlinking. Native Board details label supplied-context-only advice, retain Stop, hide independent Retry/Interrupt/Start fresh and offer a listed parent link. Older clients may show generic rerun controls; the host refuses scoped independent Retry/Interrupt. No new command or approval is introduced by this flag.
