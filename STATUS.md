# ZENO Project Status

Renamed ZENO -> ATOM on 2026-10-13; entries below keep the name they were written under.

Last updated: 2026-10-15

Phase 1 (Memory) has started at Keshab's request, with Phase 0.5's hands-on checks deferred, not dropped. Task 1.1 (ADR-058): ZENO keeps facts the user asks it to remember in a local SQLite file, uses them in every request, and forgets them on request; Settings → Memory lists and deletes them. Checked live in text on the Claude plan, across a restart. Task 1.2 (ADR-059): ZENO notes each conversation in two sentences in the background so a new one can pick up the thread, and offers to remember facts mentioned in passing. Task 1.3 (ADR-060): Calendar and Reminders through an EventKit helper inside ZENO.app; read the schedule, list reminders, add one. Task 1.4 (ADR-061): timers, spoken and shown when they end. Task 1.5 (ADR-062): weather. Task 1.6: answers 4–6 s instead of up to 19 s (thinking off, weather cached), and typing to ZENO in the Conversation tab. Next: Keshab allows Calendar and Reminders when macOS asks, and tries all of it by voice.

Keshab's end-to-end check (Task 0.5.9, 2026-10-03): talk, follow-up, interrupt, dictation, Settings and the Decline card all passed. Opening the panel made Wisp jump, and pointing near corners had no room for the bubble, so ADR-056 gives each part a fixed home: the panel hangs under a new menu-bar icon, Mac work shows in a strip above the Dock (step, Stop, Allow/Decline), and Wisp only points with a short label (Task 0.5.10). It is built and tested (301 Swift tests) but not yet seen on screen, because the Mac was locked. Next: Keshab's live look at 0.5.10, then pointing by voice.

Next idea, planned and not started (2026-10-05): shortcuts, so plain commands skip the model (ADR-071, Task 2.x); waits for Keshab's starting list.

Built (2026-10-10): a read-only `front_window` tool that gives the front app, plus the page title and address in Chrome, Arc, Edge and Brave, with no Accessibility (ADR-072, Task 2.y; idea from Coucou, MIT). It is on by default, and Safari gives its name only. Tested and read once on the real Mac from the terminal; not yet tried by voice. Task 2.x (shortcuts) still waits for Keshab's starting list.

Planned, not started (2026-10-10), ideas from Coucou (MIT): Wisp notices you, with eyes that follow the pointer and small reactions to clicks (ADR-073, Task 2.z; built and tested, not yet seen on the real screen), and dropping Wisp on a window with Option held to ask about it (ADR-074, Task 2.w; built and tested, not yet tried on the real screen). Both accepted as proposed. Task 2.w also waits for ADR-067's voice check. Keshab will do the voice checks (Task 2.y, ADR-067) later. Shortcuts (ADR-071, Task 2.x, 2026-10-10): built and tested with Keshab's list (open settings, open an app, play/pause, search YouTube or Google); not yet tried by voice.

Planned (2026-10-10): Phase 4, the Lantern redesign (ADR-084): one look grown from Wisp, rolled out screen by screen; 4.1–4.9 built and tested (colours and motion, menu-bar Wisp, header and tabs, Settings with "now", conversation, open and close, bubble, work strip, Helpers window); then the Void theme (ADR-086, flat black after Resend's style) became the default; avatars waiting for Keshab's images; 4.10 sounds not started.

Planned (2026-10-10): Phase 3, Helpers (ADR-081, revised by ADR-082): Wisp manages a team of seven workers with roles and souls (Sid researcher, Kame coder, Puff designer, Quill documenter, Penny financial information, Hana HR, Tinker improver), folder grants, skills, and Tinker proposing improvements you approve. Task 3.1 (store and Helpers window) built and tested, not yet opened on the real screen; 3.2 (jobs run: Sid researches on the Claude plan) built, tested and run once live; 3.2b (Laya chooses each job's model, ADR-083) built and tested, Laya checked live; 3.3–3.9 not started.

Planned (2026-10-10): orchestration after Paperclip (ADR-087): tasks with blockers and a task board, Wisp delegating a task tree, wake-ups and memory across runs, budgets, plan-first approval, routines, hand-offs between workers, and last an optional connection to a Paperclip Keshab installs himself (loopback only). Tasks 3.4–3.16 replace the earlier 3.4–3.9; 3.3 (souls) comes first. Then 3.17–3.22, each after its own ADR: companies and logins, a secrets manager, cloud sandboxes, team templates, a mobile web app, Codex and Hermes as workers. Task 3.3 (the team of seven and their souls, editable with versions) Task 3.4 (tasks that wait for each other, a board and a thread per task) , Task 3.5 (Wisp the manager: the `delegate` tool, "Sid, …" by voice, the combined report and one spoken line) , Task 3.6 (wake-ups and resumed sessions, "Start fresh") , Task 3.7 (daily budgets per worker and team, a plan limit) , Task 3.8 (plan first, approved by voice, card or window) , Task 3.9 (routines: daily, weekly or every N hours, one catch-up, overlaps skipped) , Task 3.10 (hand-offs between workers, checked in code) , Task 3.11 (folder grants; Kame, Puff and Quill in their folders, sandboxed, on their own branch, never pushed) , Task 3.12 (skills per worker) , Task 3.13 (ratings; Tinker's soul proposals, accepted, rejected or undone) , Task 3.14 (open a report in the worker's app) , Task 3.15 (workers at work on the island card; Wisp flies over with the team's line) , Task 3.16 (an optional, loopback-only connection to Keshab's own Paperclip) and new agents with their own roles, kits and soul.md (ADR-088) are built and tested (2026-10-11), not yet tried on the real screen or by voice.

Built (2026-10-11): one ZENO window and Pal (ADR-089): Wisp is now Pal, with eight premium characters drawn from JSON (Pal from Keshab's Strobi copy), and chat, board, team and settings in one window with a sidebar. Then ADR-090, after OpenMausBot and munder-difflin: an Overview page (counts, who is at work, goals, budget and plan use), a Needs you inbox, Issues with Retry (one automatic retry for failures a second try may fix), Plugins (MCP servers per worker: saved off, tested, every call asks on Pal's card unless trusted; skills at a glance), and an office floor on the Board (pals at desks or in the lounge, Pal at the manager's desk, envelopes on hand-offs). All built and tested; not yet tried on the real screen, and no real MCP server added yet.

Built (2026-10-11): ADR-092: ZENO runs on Keshab's Claude plan only (Gemini and the Claude API removed); published as a source release (v0.9.0), no app binary.

Built (2026-10-11): ADR-091, after Keshab's look at the window: roles instead of "No app", renaming pals, a top bar, the floor fitting the window, chat sound switches; macOS notifications (needs you, done, failed, budget and plan use); tokens recorded for every run and chat answer with a Dashboard; chats saved and listed in the sidebar in place of the team (the team moved to the Board); the team's git branches like pull requests with Push on his confirmed click; and an app icon. All built and tested; not yet tried on the real Mac.

Built (2026-10-12): ADR-095 packages 1–2: tasks run in parallel (Runs at once 1–10 in Settings, default 6; several tasks per worker), Pal is called ATOM on screen and in speech, and Managers (one per domain, "plans and reviews" or "group only") with Agents under them, on the Board, the floor and in Needs you. Built and tested; not yet tried on the real screen.

Built (2026-10-12): ADR-095 package 3: Sub-Agents: an Agent's run may start up to 4 helpers inside its own Claude Code run (searcher and reader for web work, coder and checker for folders), each with no more than the Agent's own tools, grants and skills; their cost counts toward its budget, and the task's thread lists them with their state and short result. ADR-095 is done. Built and tested; not yet tried with the real Claude Code.

Built (2026-10-12): ADR-096: the ZENO window has Back (the arrow, ⌘[ and the mouse back button) and a Save button on each typed field. Leaving with unsaved edits asks first. It builds; no tests ran, and Keshab has not tried it yet.

Built (2026-10-13, finished 2026-10-14): ADR-110 Phase N1, the native engine: with `ATOM_ENGINE=native`, each chat keeps one long-lived Claude Code session, so later turns read the prompt and tools from the cache. Off by default. Built and tested with a fake SDK; one small live probe (plain prefix 2.3k tokens, project 4.6k). Not yet tried in the real app.

Built (2026-10-14): ADR-110 Phase N2: with `ATOM_ENGINE=native`, ATOM's workers are Claude Code sub-agents with Board rows, kit and grant checks in hooks, and Bash only in project chats. Built and tested with a fake SDK; one live probe ran a Sid task end to end (prefix 3.8k plain, 5.7k project, 2.5k sub-agent). Not yet tried in the real app.

Built (2026-10-14): ADR-110 Phase N3: with `ATOM_ENGINE=native`, a later reply from an agent is spoken in the voice chat (not in a Quiet chat) and sent to Telegram for its chat. Routines and local API goals are main-agent turns, and the Board shows each agent's model. Built and tested with fakes. Not yet tried in the real app.

Fixed (2026-10-15), after Keshab used the app: Settings pages go back with the top-bar arrow. The window chat draws Markdown (tables, lists, code) and copies a table as HTML. A message typed in the window may get a structured reply; voice replies stay short and plain. Job token counts were too high (one message counted two or three times); new rows are right. `test:live` ends and passes. Built and tested (836 TypeScript, 584 Swift tests). Keshab tried the app by hand before these fixes; he has not yet tried the fixes.

Fixed and built (2026-10-15), after Keshab's try of the Daylight build: the Chats list loads when the runtime is ready; the composer's voice button has its own corner and the model menu moved left; the Skills menu is names only; Plugins → Skills is a dropdown with an editor (ADR-114). Built and tested (588 Swift tests, 424 TypeScript tests in `apps/mac`); not yet tried by hand. The sidebar pages are draggable (any order, top or bottom group), and only the Chats list scrolls (2026-10-15; tested with a real drag). Second brain has a HUD look and Memory is its second tab (Settings → Memory is gone). Next: MCP like Claude Desktop.

Built (2026-10-15): a new theme, Daylight (Settings → Appearance): Void's flat look in light, from Keshab's UI playground. Void stays the default. Built and tested (585 Swift tests); not yet tried on the real screen. Next from the playground: the sidebar order and compact rows, then the chat, then browser automation.

Fixed (2026-10-15): skills that improve themselves (ADR-094 A) had no trigger in the native engine, because nothing recorded which skill a task used. An agent's `Skill` call is now recorded, so a failed or badly rated task asks Tinker for an edit to that skill, and Keshab decides. Built and tested; not yet tried live (no ATOM skill has been used by an agent yet).

Built (2026-10-14): ADR-110 Phase N4: budgets, the plan limit that ATOM set and "Runs at once" are gone in both engines. Tasks start at once and wait only for Keshab (a plan to approve, an interrupted run). Old budget rows stay in the database, unread. Built and tested. Not yet tried in the real app. Phase N5 not started.

Built (2026-10-14): ADR-110 Phase N5: `native` is the only engine and the legacy engine, the job runner, Managers, team tasks, wake-ups and the Codex fallback are deleted. Typecheck is clean; no test ran. Not yet tried in the real app.

Built (2026-10-14): ADR-111 work plans (a big goal split across specific agents; code keeps the order and writes each brief), ADR-112 the second brain (linked notes and a graph), `search_chats`, `propose_skill`, an audit log, and a UI pass (Stop, Copy, Try again, New chat). Quality pass the same day (`revise-task.md`): dead code removed, more tests; the whole TypeScript suite passes in the cloud (815 tests). All Swift is uncompiled. Not yet tried in the real app.

Built (2026-10-14): ADR-113: a chat keeps its context when the provider changes (Claude, Codex, Gemini CLI), files can be attached to a message (text, code, PDFs, images), skills work in a chat (`/name`, the Skills menu, `use_skill`), and the model menu sits next to the input. TypeScript tested; Swift not compiled; not yet tried in the real app.

Planned (2026-10-10): four polish batches taken from Clicky, Coucou and a review of ZENO's setup: setup and errors (ADR-075, Task 2.A; built and tested, not yet tried on the real Mac), everyday polish (ADR-076, 2.B; built and tested, not yet tried on the real Mac), Wisp and voice polish (ADR-077, 2.C; built and tested, not yet seen on the real screen), Wisp's home display (ADR-078, 2.D; built and tested, not yet tried on two displays), settings tidy-up (ADR-079, 2.E; built and tested). Pointing from a screenshot (ADR-080, 2.F): built and tested, Cua only (main display), so it needs computer control on; not yet tried by voice.

---

## 1. Product

### Name

ZENO

### Positioning

> ZENO — The Intelligence Layer for Your Digital World.

---

## 2. Current Stage

### Architectural / Foundation Stage

The product architecture and development philosophy have been defined.

The implementation priority is now Phase 0.

Progress: **Phase 0 is complete (2026-10-02).** All tasks 0.1–0.11 are done; the voice loop was verified by the user speaking into the real microphone and by the live test suite (history: `docs/phase-0-tasks.md`). Open items from Phase 0: Claude live check (needs Anthropic credits); Gemini free-tier quota (about 20 requests per day).

**Current phase: Phase 0.5 — Desktop Island** (ADR-033 to ADR-042), planned 2026-10-02. Task 0.5.1 is done: the project now lives at `~/Developer/zeno`, outside iCloud. Task 0.5.2 is done: the runtime can be driven over JSON lines (`main.ts --island`, `docs/island-protocol.md`). Task 0.5.3 is done: `ZENO.app` (`pnpm island:build`) runs as a background app and supervises the runtime: starts it, restarts it after a crash, stops it on quit. Task 0.5.4 is done: a panel hidden above the top-centre that slides down on hover. Keshab then redirected the design: the top-centre is crowded by other apps, so the island moves to the left edge below the menu bar (ADR-037), and it gets real content: a live state with a level meter, and an expanded view with Conversation, Status and Settings (AI provider and model) in dark glass (ADR-038). Task 0.5.4b is built: a dark glass card at the left edge below the menu bar, showing ZENO's state with the model name and a live waveform while listening; it comes out by itself during a turn and for problems. Keshab then asked for settings inside the island, changeable shortcuts, FluidVoice-style dictation and a walking pet (ADR-039 to ADR-042). Tasks 0.5.5 to 0.5.8 are built (settings, shortcuts and signing, dictation, the pet). Dictation (ADR-047) runs inside the app with Parakeet and Right ⌘ + Right ⌥, and Keshab finds it satisfactory for now. ADR-053 changed hiding from a 90° sideways pose to a 35–50° lean with a hand on the edge (255 tests). ADR-052 added Wisp, speech bubble and panel controls to Settings (size, glow, movement, nap, bubble stay, panel size and background, with a reset; 252 tests). ADR-051 then made Wisp hold the island: no left-edge card while Wisp is on, a click on Wisp opens the features panel beside it, and Wisp tucks to a side edge after an idle timeout (built, tested and measured on screen; waits for Keshab's look). ADR-050 adds tap-to-start modes, a live preview, "um" removal and Wisp's speech bubble (built and tested; Keshab likes them and closed the rest of the FluidVoice list, so dictation is finished unless he asks for more). The voice conversation is switched off while dictation and speech are tuned (`ZENO_VOICE_ONLY=1` is a test mode that skips the AI). Next: Task 0.5.9 (End-to-End Island Test), which needs the conversation on.

---

## 3. Current Phase

### Phase 0.5 — Desktop Island

Target:

```text
Ctrl+Option held (any app)  /  pointer at left edge
    ↓
ZENO Island (Swift, apps/mac/island)
    ↕ JSON lines over stdin / stdout
ZENO runtime (Phase 0, apps/mac/src)
    ↓
Microphone → Whisper → Core → LLM Gateway → LLM → Kokoro → Speaker
```

### Next: Phase 1 — Memory (started 2026-10-04, Task 1.1 built)

### Completed

- Phase 0 — Voice Foundation (2026-10-02)

---

## 4. Current Architectural State

The following concepts have been defined:

- ZENO Core
- Identity
- Context
- Deterministic Router
- Decision Engine
- Laya / Jev integration point
- LLM Gateway
- Memory
- Knowledge
- Capability System
- Capability Manager
- Device Registry
- Device Manager
- Policy Engine
- Tasks
- Events
- Multi-device architecture
- Multi-user architecture
- Team knowledge
- Cloud architecture
- Provenance
- Observability

These are architectural definitions.

They do not necessarily mean all corresponding software modules currently exist.

---

## 5. Phase 0.5 Required Components

The current phase requires:

- a runtime mode driven by JSON lines over stdin / stdout
- the island app (Swift), which starts and supervises the runtime
- the hidden panel with hover reveal
- global push-to-talk (Ctrl+Option)
- live status, transcript and reply in the panel
- an expanded conversation view
- permission guidance (microphone, Input Monitoring)

Phase 0 components (microphone, Whisper, Core, LLM Gateway, providers, Kokoro, configuration, logging, error handling, tests) are built and reused unchanged.

---

## 6. Explicitly Deferred

The following remain future work (Phase 0.5 deferrals are listed in TASK.md):

- automatic memory (summaries, extraction without being asked), embeddings
- RAG
- knowledge graph
- team knowledge
- multi-user system
- cloud synchronization
- iOS node
- Windows node
- Mac computer control
- capability acquisition
- autonomous agent system
- multi-agent architecture
- Kubernetes
- microservices
- local general-purpose LLM
- Ollama

---

## 7. Architectural Decisions

Current major decisions:

- ZENO is a system, not a chatbot.
- LLM providers are replaceable.
- Voice processing can be local.
- General reasoning initially uses remote models.
- Ollama is not required.
- Deterministic routing comes first.
- Decision Engine is optional.
- Decision Engine is replaceable.
- Initial architecture is a modular monolith.
- Devices are nodes.
- Permissions are deterministic.
- Capabilities define controlled actions.
- Least privilege is mandatory.
- Knowledge is independent from the LLM.
- Memory is independent from conversation history.
- Provenance is important.
- Tasks and events are distinct.
- User should not need to select execution device.
- Phase 0 must remain small.
- Future architecture should not force premature implementation.

Phase 0 technical choices (ADR-026 to ADR-030):

- TypeScript / Node.js, pnpm workspace
- Push-to-talk input
- Claude as the first provider
- Kokoro-82M on ONNX (local) for TTS
- Session-only conversation history, nothing saved to disk

Later Phase 0 changes: Gemini as a second provider (ADR-031); Whisper small.en with a vocabulary prompt (ADR-032).

Phase 0.5 decisions (ADR-033 to ADR-042):

- A desktop island comes before Memory
- Native Swift app for the island; the Node runtime runs as its child process, talking JSON lines over stdin / stdout
- Hold Ctrl+Option to talk, from any app (listen-only key reading, Input Monitoring permission)
- The panel hangs below ZENO's menu-bar icon (ADR-056; was the left edge, ADR-037, then beside Wisp, ADR-051); ZENO's work on the Mac shows in a strip above the Dock
- Compact view: live state and level meter; expanded: Conversation, Status, Settings (provider and model); dark glass (ADR-038)
- Three looks, chosen in Settings → Appearance (ADR-057): Theme (Quiet Native, Luminous, Warm) for every surface and Wisp (Ghost, Orb, Companion), independently; text contrast tested in every theme

---

## 8. Phase 0 Definition of Done (met 2026-10-02)

Phase 0 was complete when:

```text
User speaks
    ↓
Microphone captures audio
    ↓
Whisper transcribes
    ↓
ZENO Core receives request
    ↓
LLM Gateway routes request
    ↓
Remote LLM responds
    ↓
ZENO receives response
    ↓
TTS generates audio
    ↓
Speaker produces response
```

The complete loop must be tested and observable.

---

## 9. Development Order

Phase 0.5 order: Tasks 0.5.1 to 0.5.8 in TASK.md, one at a time.

Phase 0 order, completed:

```text
0.1 Repository Foundation
        ↓
0.2 Configuration
        ↓
0.3 Audio Input
        ↓
0.4 Whisper Adapter
        ↓
0.5 ZENO Core
        ↓
0.6 LLM Gateway
        ↓
0.7 First Remote Provider
        ↓
0.8 TTS
        ↓
0.9 Voice Loop
        ↓
0.10 Error Handling
        ↓
0.11 End-to-End Test
```

Only one task should be actively implemented at a time.

---

## 10. Development Rule

Think about the entire system. Build only the next piece.

The existence of future architecture does not authorize implementing it early.

---

## 11. Current Success Criterion

The immediate goal is not to build the entire ZENO platform.

The immediate goal is:

> Build a small, reliable voice intelligence loop that can become the foundation of the larger ZENO system without requiring a rewrite.

---

## 12. Next Action

The code is built through ADR-105 (2026-10-13), the rename of ZENO to ATOM.

Next, in this order:

1. Keshab does the hand checks of built work. The tasks marked "not yet seen" or "not yet tried" in TASK.md list them. After the rename, Keshab grants the macOS permissions again for the new app.
2. The folder and repository rename happens later. Then the `ZENO_*` fallback goes.
3. B3.3 (WhatsApp) is skipped. B3.6 (smaller gaps: image and video generation, remote terminals) is open.

Older steps are in TASK.md.

---

## Final Principle

> Build the smallest system that can become the larger system.

**ADR-089 (2026-10-11):** Wisp is now Pal, in the app, its words and the code (saved settings keep their stored `zeno.wisp.*` names). Earlier entries above say Wisp as written then. Pal and every worker are now drawn from avatar definitions (Pal is Keshab's "Strobi copy"), and chat, the board and agents, and Settings are in one ZENO window.
