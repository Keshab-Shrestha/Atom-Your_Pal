<p align="center">
  <img src="docs/images/icon.png" width="128" alt="ZENO's icon: Pal on a black tile">
</p>

<h1 align="center">ZENO</h1>

<p align="center"><b>Your Pal on the Mac, and the team it runs for you.</b><br>
Talk to Pal. Pal does the small things itself and hands the bigger ones to a team of AI workers.<br>
You approve what matters. Everything stays on your Mac.</p>

---

## What ZENO is for

ZENO is a personal assistant for the Mac, built around one idea: **one companion you talk to, with a team behind it that you stay in charge of.**

- **Pal** lives on your screen. Hold two keys and talk; it answers out loud. It opens apps, sets timers, checks your calendar, remembers what you tell it, and dictates into any text field.
- **The team** is a set of AI workers, each with its own role and personality: Sid researches, Kame codes, Puff designs, Quill writes, Penny handles money questions, Hana handles HR questions, and Tinker suggests how they can improve. You can add your own.
- **You stay in charge.** Workers only touch the folders you grant, ask before anything risky, never push code, and stay inside the budgets you set. The model proposes; ZENO's code decides.

ZENO is not a chatbot. The language model is one part of it, reached through a gateway that can switch between providers. Permissions, memory, budgets and safety live in ordinary code that a model cannot talk its way around.

## See it

<p align="center">
  <img src="docs/images/office-floor.png" width="820" alt="The office floor: pixel-art pals at their desks and in the lounge, Pal in its own office">
  <br><sub>The office floor: workers at work sit at a PC with their step in a bubble; the rest wait in the lounge; Pal runs the floor.</sub>
</p>

<p align="center">
  <img src="docs/images/window.png" width="820" alt="The ZENO window: sidebar with chats, the Board with each worker">
  <br><sub>One window: Overview, Dashboard, Needs you, Issues and the Board, your chats in the sidebar, and the team on the Board.</sub>
</p>

<p align="center">
  <img src="docs/images/dashboard.png" width="410" alt="Dashboard: tokens today, the last 7 days and a bar per day">
  <img src="docs/images/dashboard-team-git.png" width="410" alt="Dashboard: plan use, tokens by worker and model, and a worker's git branch with Push">
  <br><sub>The Dashboard: every token used, by day, worker and model; the team's git branches, like pull requests. (Sample data.)</sub>
</p>

## What it does today

**Talk and dictate**
- Push-to-talk from any app (Control + Option); ZENO answers out loud in a natural voice.
- Dictation into any text field (Right ⌘ + Right ⌥), transcribed on your Mac.
- Calendar, reminders, timers, weather, music, notes, opening apps, and "what's this page?" for the browser in front.
- Memory: ZENO keeps facts you ask it to remember and picks up earlier conversations.
- Chats: every conversation is saved; continue any of them by voice or text.

**A team that works for you**
- Workers with souls: each has a role, a personality, rules and lessons in a `soul.md` you can edit, rename, or version.
- Kits decide tools in code: research (the web), folders (files in folders you grant, sandboxed, on its own git branch), or think (no tools).
- Pal as manager: say "Sid, find…" or give Pal a goal; it splits the work, hands parts to the right workers, and reports back in one line.
- Tasks that wait for each other, plans for your OK before work starts, routines (daily, weekly, every few hours), hand-offs between workers, and one automatic retry for failures a retry may fix.
- Skills and MCP servers per worker. MCP servers are saved switched off and tested first, and every tool call asks you unless you trust that server.

**You stay in charge**
- **Needs you**: one inbox for plans, held tasks, proposals and approvals.
- **Budgets**: a daily cap per worker and for the team, and a limit on your Claude plan's use.
- **Dashboard**: tokens used today and this week, by worker and model.
- **Notifications**: something needs you, a task is done or failed, or a budget or the plan is nearly used up.
- **Git**: see the team's branches with their commits and changes, and push one only when you click and confirm. Workers never push.

## Safety, by design

| Rule | How it is enforced |
|---|---|
| The model is never the authority | Permissions, budgets, folders and approvals are checked in code before anything runs. |
| Workers only touch what you grant | Folder grants (never your home folder, `~/Library` or hidden folders), a sandbox, and a check on every file tool and command. |
| Risky steps ask first | Deleting, installing, untrusted MCP tools, and controlling the computer each wait for your OK on Pal's card. |
| Code never leaves on its own | Workers commit to their own `zeno/task-<id>` branch. Only you can push, from the Dashboard, never forced. |
| Your words stay yours | Speech is transcribed on the Mac. Logs hold ids, states and timings, never your text. Memory, chats and tokens stay in local files. |
| Secrets stay secret | API keys live in `.env` (ignored by git). MCP tokens are never logged or shown in full. |

Full details: [SECURITY.md](SECURITY.md).

## How it works

```text
You (voice, text, the window)
  │
  ▼
ZENO.app (Swift): Pal, the island, the ZENO window, notifications
  │  line-delimited JSON (docs/island-protocol.md)
  ▼
ZENO runtime (Node.js, TypeScript)
  ├── Speech: Whisper (hearing), Kokoro (voice), Parakeet (dictation), all on the Mac
  ├── ZENO Core: requests, chats, tools, memory
  ├── Helpers: workers, souls, tasks, budgets, routines, grants (SQLite)
  ├── LLM Gateway: Claude on your plan, the Claude API, or Gemini
  └── Policy in code: folder checks, approvals, budgets, the sandbox
```

## Quick start

### 1. Prerequisites

- macOS 14 or later.
- Xcode Command Line Tools: `xcode-select --install`.
- Node.js 22.18 or later (ZENO runs TypeScript directly). The app build prefers Homebrew's Node: `brew install node`.
- pnpm (the repo pins `pnpm@12.6.0`).
- ffmpeg and whisper.cpp for the microphone and speech-to-text: `brew install ffmpeg whisper-cpp`.

### 2. Install and models

```sh
pnpm install
mkdir -p models
curl -L -o models/ggml-small.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
```

- **Whisper** (`models/ggml-small.en.bin`, about 470 MB) hears what you say. Set `ZENO_STT_MODEL` in `.env` to use another file.
- **Kokoro** (ZENO's voice, about 330 MB) downloads itself the first time ZENO speaks.
- **Parakeet** (dictation, about 450 MB) downloads itself the first time you dictate.

`pnpm voice:check` tests speech output and input on their own, with no AI.

### 3. Choose the AI

Pick a provider in the app under Settings → AI model, or set `ZENO_LLM_PROVIDER` in `.env` (`cp .env.example .env`).

| Provider | `ZENO_LLM_PROVIDER` | What it needs |
|---|---|---|
| Claude on your own Claude plan (what the team runs on) | `claude-plan` | No key. Claude Code installed and signed in (`claude auth login`). Set `ZENO_CLAUDE_PATH` if `claude` is not found. |
| Gemini | `gemini` | `GEMINI_API_KEY` in `.env` |
| Claude API | `claude` | `ANTHROPIC_API_KEY` in `.env` |

Only the selected provider needs a key. Keys stay in `.env`, which git ignores.

### 4. Build and open the app

Once per Mac, create a local signing identity so macOS keeps ZENO's permissions across rebuilds:

```sh
apps/mac/island/make-signing-identity.sh
```

Then:

```sh
pnpm island:open    # builds apps/mac/island/build/ZENO.app and opens it
```

`ZENO.app` records where the project folder and Node.js are; rebuild it if either moves. `scripts/make-icon.sh` remakes the app icon. To run ZENO in the terminal without the app: `pnpm start`.

### 5. Permissions

macOS asks for each one the first time ZENO needs it:

| Permission | When ZENO uses it |
|---|---|
| Microphone | Only while you hold the Talk keys or dictate. Speech is transcribed on this Mac and never recorded. |
| Input Monitoring | To notice the Talk and dictation keys in any app. It only listens. |
| Accessibility | Only to type dictated text into the app you were in. |
| Automation | When you ask: Music or Spotify, Notes, and the open browser tab. |
| Calendar and Reminders | When you ask about your schedule or reminders. |
| Notifications | To tell you when something needs you, a task ends, or a budget is nearly used. |

### 6. First words

- Hold **Control + Option**, talk, and let go. Pal answers out loud.
- Hold **Right ⌘ + Right ⌥** to dictate into any text field.
- Open the ZENO window from the menu bar for chats, the team, the Board and the Dashboard.

Things to try:

- "What's the weather in Tokyo?"
- "Set a timer for ten minutes."
- "Remember that my project uses PostgreSQL."
- "Sid, find the three best reviews of the new Mac mini."
- "Quill, write a one-page summary of today's meeting notes and save it in a folder named Notes."

### 7. Tests

```sh
pnpm test           # TypeScript tests (node --test)
pnpm typecheck      # tsc
pnpm island:test    # Swift tests for the app
pnpm test:live      # live tests against real models; need a key in .env
```

## Status

ZENO is a **personal prototype**, built and used on one Mac. Every feature has tests (about 650 TypeScript and 510 Swift), but many of the newest ones have not been tried live yet, and the app is not packaged for other Macs (no Developer ID signing or notarization). Running the team on your Claude plan is meant for your own use on your own Mac.

Where things stand: [STATUS.md](STATUS.md) and [TASK.md](TASK.md). Every design decision is recorded in [DECISIONS.md](DECISIONS.md).

## Principles

> See the whole mountain. Climb only the next step.

ZENO is designed as a system (identity, context, memory, knowledge, decisions, tools, devices and policy) and built one capability at a time, each tested before the next. The long-term vision, one intelligence across all your devices with one continuous context, is in [docs/VISION.md](docs/VISION.md). The engineering rules are in [CLAUDE.md](CLAUDE.md).

## Documentation

| Document | What it covers |
|---|---|
| [STATUS.md](STATUS.md) | What is built and what is next |
| [TASK.md](TASK.md) | Each task as built, with its tests |
| [DECISIONS.md](DECISIONS.md) | Every architecture decision (ADRs) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the parts fit |
| [SECURITY.md](SECURITY.md) | What ZENO may and may not do, and how that is enforced |
| [docs/island-protocol.md](docs/island-protocol.md) | The app ↔ runtime protocol |
| [docs/VISION.md](docs/VISION.md) | The long-term vision and principles |
