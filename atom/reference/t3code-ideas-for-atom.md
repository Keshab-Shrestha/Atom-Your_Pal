# T3 Code: ideas for ATOM

> Review update (2026-10-17): [second source review](t3code-second-review-2026-10-17.md) records corrections and pinned evidence. Use the [combined roadmap](../docs/upgrade-roadmap.md) for current ATOM status. Detailed observations below retain the earlier snapshot unless updated explicitly.

This is the short list. It comes from the four topic files in this folder.
Each idea says where the detail is: `S` = sessions and providers, `G` = git and source control, `T` = settings and key bindings, `P` = right panel, devices and shell.
The numbers in brackets are the idea numbers in that file.

Read this first: nobody ran T3 Code. All facts come from reading its files at commit `2fbd4318`. A claim marked "unverified" in a topic file stays unverified here.
Size: S is under one day, M is a few days, L is a week or more. Every idea needs its own ADR and task (CLAUDE.md section 3). Stop after each task.

## Your questions, answered first

**Sessions for an AI model.** T3 Code keeps a thread as an event log with history paging, fork, rename, archive, pin, rewind and a context meter. It moves context between providers with a budgeted selection of messages (`docs/user/portable-handoffs.md`). ATOM already does the base of this in ADR-113. The new ideas are 24 (edit and ask again), 25 (fork), 26 (context meter and Compact), 27 (pin and archive), 28 (continue after a usage limit) and 16 (account line).

**Git source control.** T3 Code does much more than ATOM: pull requests, checks, per-turn checkpoints, base branch, ahead and behind. ATOM is stricter on purpose: it never pushes by itself. The best fits are 1 (hardening), 2 (open pull request page), 3 (branch list scope), 4 (base and behind), 29 (discard branch) and 30 (per-file diff).

**Settings, and the Providers section with auto select and typed API keys.**
- T3 Code has no global "auto select provider" switch (`S`/`T` 2.4). The word "auto" appears for a binary path, for an authentication method, and for load balancing across machines.
- A typed API key in T3 Code is a masked "Sensitive" field. People use it for routers and custom endpoints (`T` 2.5).
- ATOM must not copy a typed model key. It breaks the money rule (ADR-092, ADR-055). Idea 23 gives a safe variant and needs your decision.
- Two safe ideas give you the same feel: 20 ("Auto" chat tool that moves to Codex or Gemini when the plan runs out) and 19 (masked secret fields in Keychain for tokens that are not model keys). Idea 23 is the typed model key itself, with the safe design.

**Key bindings.** T3 Code uses one JSON file of `{ key, command, when }` rules, where the last match wins, and a command palette. ATOM has fixed global shortcuts. See ideas 17 (command table), 32 (command palette) and 37 (shortcut file).

**Connections and devices.** In T3 Code the "Devices" tab of the right panel is an iOS Simulator and Android Emulator viewer. The list of paired phones is in Settings, Connections, "Authorized clients" (`P` summary). See ideas 5 (Tailscale row), 34 (one token per device) and 35 (pairing code).

**Right panel: Files, Open in, Changes.** See ideas 6 (Open in), 22 (right panel with Changes), 36 (Files tab, read only) and 21 (open Changes after a turn).

## The ranked list

### Group A: small and safe (size S, mostly one change each)

| # | Idea | From | Why now | Fit with ATOM's rules |
| --- | --- | --- | --- | --- |
| 1 | Git hardening pack: `safe.bareRepository=explicit`, `GIT_OPTIONAL_LOCKS=0`, `--no-ext-diff --no-textconv`, `GCM_INTERACTIVE=never`, `SSH_ASKPASS_REQUIRE=never`, strip control characters from errors | `G` 6.1, [4] | Cheap. Each item closes a hang or an attack | Least privilege. No change the user can see |
| 2 | "Open pull request" button after a confirmed push. It opens the host's compare page in the browser. Build the address in code from the cleaned remote. `https` only. GitHub and GitLab first | `G` [1] | ATOM stops at the push today | No token, no API. The click only opens an address |
| 3 | Fix the Dashboard branch list: it lists repositories from helper grants only, but ADR-122 removed per-agent grants. Refresh after each commit | `G` [2] | A probable bug (marked unverified at run time) | Read only |
| 4 | Save the base branch when the task branch is made. Show "behind N" | `G` [3] | Today the base is guessed when you look, so a diff can change | Read only git |
| 5 | Tailscale row in Settings: read `tailscale status --json`, show the `.ts.net` name and the exact command | `P` [5] | ADR-121 asks the user to find the name by hand | Read only. No raw stderr shown or logged |
| 6 | "Open in..." split button for a project folder (Cursor, VS Code, Zed, Xcode, Terminal, Finder). Fixed list in code. `open -a` through `execFile`, no shell | `P` [2] | The most liked small control | Folder must be a registered project. Extends `open-in-app.ts` |
| 7 | Better commit message: use the task's report title as the subject (first line, no final dot, 72 characters) | `G` [6] | `ATOM task 7` tells a reviewer nothing | No new model call. The user sees it before any push |
| 8 | Long paste (4000 characters or more) becomes a file attachment | `S` [5] | `text.send` refuses over 4000 characters | Uses the ADR-113 attachment checks. Decide what a project chat does |
| 9 | Provider capability table in the `info` event: `tools`, `attachments`, `projectChats`, `resume` | `S` [6] | The window can hide an option before it fails | Deterministic data. Toward the Provider boundary |
| 10 | Local conflict preview with `git merge-tree --write-tree` ("may conflict") | `G` [9] (not from T3 Code) | No host call needed | Read only. Needs git 2.38 or newer. Unverified here |
| 11 | Tool health card in "Found on this Mac": version, sign-in label, last check time, a Check button | `T` [3] | One clear headline per tool | ATOM already asks `claude auth status`. It never reads a login file |
| 12 | Model list: favourite and hide buttons | `T` [8] | Short menu | Store ids in `UserDefaults` |
| 13 | Dock badge with the number of Needs you cards while the window is open | `P` [8] | `Notifier.swift` has the data | `NSApp.dockTile`. No new permission |
| 14 | Row reset dot and "Reset to default" on each changed setting | `T` [10] | ATOM has reset only per page | Small helper in `IslandSettings.swift` |
| 15 | Settings schema discipline: defaults in one place, clamped ranges, unknown values ignored | `T` [11] | Prevents bad stored values | Tests only plus small helpers |

### Group B: medium (size M), each with a clear first step

| # | Idea | From | What it needs |
| --- | --- | --- | --- |
| 16 | **Account line and billing check before the first turn.** Start the SDK query with a prompt that never yields, call `initializationResult()`, read `account` (`apiKeySource`). No model request | `S` [1] | Check that ATOM's SDK version has `initializationResult()`. It would make the money rule visible: "Signed in, Max plan" or a warning if a credential would bill per token |
| 17 | **Window command table with shortcut hints.** One table: id, title, default key. Show the key in menus and tooltips | `T` [5] | Pure Swift. No user editing yet |
| 18 | **Settings search** (a box on Settings home) | `T` [1] | A `SettingsCatalog` of rows. Pure logic |
| 19 | **Masked secret field in Keychain.** Shows "Stored secret, enter a new value to replace". Never shows or logs the value | `T` [2] | Use it for the Telegram token first. NOT for model keys |
| 20 | **"Auto" chat tool.** A fourth entry in the Provider menu. Uses Claude Code. When the plan is used up, it answers chats on Codex or the Gemini CLI as plain text and says which tool answered | `T` [4] | An ADR. All three tools are subscription tools with keys removed (ADR-093). It never falls back to a key or to extra usage |
| 21 | **Open Changes by itself after a turn** (off by default) | `P` [7] | Needs idea 22 |
| 22 | **Right panel in the ATOM window**, Changes tab first. Toggle key, saved width, minimum 320 pt. Reuses `TextDiff`, `EditReviewView` and `GitFile` | `P` [1] | An ADR. A `RightPanelState` in `AtomIslandCore` |
| 23 | **Typed API key or custom endpoint** | `S` [10], `T` 2.5 | **Breaks the money rule.** Needs a new ADR and your decision. See "Decisions" below |
| 24 | **Edit an earlier message and ask again.** Cut the saved turns and clear the session reference. The next turn reopens with the transcript, as ADR-113 does | `S` [3] | `ChatStore.truncate`, then a `chat.rewind` command |
| 25 | **Fork a chat from a message** | `S` [4] | After idea 24. `ChatStore.fork` |
| 26 | **Context meter and Compact** | `S` [2] | Unverified that `/compact` works through ATOM's streaming input. Start with the meter |
| 27 | **Pin and archive chats with a 5 second Undo** | `S` [7] | Two columns and two commands |
| 28 | **Continue after a usage limit.** Show the reset time. Offer "Send again after the reset" | `S` [8] | Uses the rate-limit event `planGuard` already reads. Never switches to a key |
| 29 | **Discard a task branch** on a confirmed click. Refuse a dirty tree. No `--force` | `G` [5] | ATOM never removes worktrees, so they pile up |
| 30 | **Per-file diff and hide-whitespace** | `G` [7] | Split `branchDiff` by `diff --git` headers |
| 31 | **Read only pull request status through `gh`** | `G` [8] | Fixed arguments. ATOM never reads the token. Show nothing if `gh` is missing |
| 32 | **Command palette on ⌘K** | `T` [6] | After ideas 17 and 18. Check the ⌘K plan for Ask ATOM first |
| 33 | **Depth per chat** (quick, normal, deep) and **plan mode for a plain chat** | `S` [9], [11] | Unverified that the SDK version supports the options. Measure the cache effect |
| 34 | **One token per phone, with name, last seen and Revoke** | `P` [3] | An ADR (it revisits ADR-121). Store a hash only |
| 35 | **Pairing code and QR for the phone page** (5 minutes, one use, secret in the URL fragment) | `P` [4] | After idea 34. QR through CoreImage (unverified) |
| 36 | **Files tab, read only** with "Add to chat" | `P` [6] | After idea 22. Hide secret-like files |

### Group C: large or later (size L)

| # | Idea | From | Note |
| --- | --- | --- | --- |
| 37 | Shortcut file `config/keybindings.json` with `when` contexts | `T` [7] | Only after ideas 17 and 32 |
| 38 | Private checkpoint refs for tasks with several runs | `G` [10] | Not needed while one task makes one commit |
| 39 | Hand-off prompts "Resolve conflicts" and "Fix review findings" | `G` [11] | After idea 31 |
| 40 | History paging for long chats | `S` 12 | Measure the largest `chat.opened` event first |
| 41 | "Allow for this chat" on approvals | `S` 12 | Built for one exact file/chat in ADR-136; restart/revoke and policy tests pass, full live verification remains |
| 42 | Steer a running turn | `S` 12 | ADR-127 chose stop and send |

## Not recommended now

- A provider and a source control host interface for six hosts. ATOM needs one link builder first.
- Host API tokens stored in ATOM. They add secrets to handle.
- Model-written branch names. ATOM's push rule depends on the strict `atom/task-<id>` pattern.
- Running repository hooks. They would run outside the sandbox.
- Auto pull, auto merge, stack merge, `--force-with-lease`. Each acts without a fresh click.
- A watcher that starts an agent on pull request events. Text from other people would start work.
- The V2 orchestration objects (runs, attempts, nodes). CLAUDE.md section 22 says to build them only when needed.
- Many instances of one provider, one prompt to several models, a remote model manifest.
- The Devices (simulator) tab, T3 Connect cloud relay, per-token scopes, several routes with failover, a terminal tab, an in-app browser tab, a tray menu.
- Theme editor, VS Code theme import, SnapShots, load balancing across machines.

## Suggested order

Each step is its own task and ADR. Stop after each.

1. **Quick safety and bug batch:** 1, 3, 4. Then 2 and 7. (Git, no UI risk, mostly testable on Linux.)
2. **Money rule made visible:** 16, then 11. (The user can see "Signed in, plan" and the tools' state.)
3. **Settings:** 18 (search) and 17 (command table), then 19 (Keychain for Telegram), then 14 and 15.
4. **Window layout:** 6 (Open in), then an ADR for 22 and 36 (right panel), then 21.
5. **Sessions:** 24 (edit and ask again), 8 (long paste), 27 (pin and archive), then 25 and 26.
6. **Phones:** 5, then an ADR for 34 and 35.
7. **Auto tool:** an ADR for 20, then build it.

## Decisions I need from you

1. **Typed API key (idea 23).** Do you want a "Billed: API key" provider at all? The safe design is in `t3code-sessions-and-providers.md`: off by default, Keychain, separate provider, visible "Billed" label, monthly cap, never a fallback. Without your yes, ATOM stays plan only.
2. **Per-device tokens (ideas 34, 35).** This revisits ADR-121 ("left out until a second user"). A second phone is enough reason, but it is your call.
3. **Auto tool (idea 20).** Do you want chats to move to Codex or Gemini when the Claude plan runs out, or to stop and wait for the reset (idea 28)? Both can exist; the order matters.
4. **The first batch.** Do you want order 1 to 7 as written, or another order?

## What I did not cover

`apps/marketing`, billing, Clerk sign-in, analytics, Linux and Windows packaging, and the T3 Connect relay internals.
Idea 10 and the "probable" bug in idea 3 come from reading ATOM's code, not from running it.
