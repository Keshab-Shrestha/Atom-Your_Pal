# Full access for one chat (ADR-181)

Requested by Keshab as a separate upgrade after checked access modes. Full access is an explicit opt-in in the existing lock menu, supported by Claude and Codex. It applies to the chat and its delegated tasks, not the entire app or all projects.

## What it changes

Full access skips the routine confirmation for overwriting existing ordinary files, commands classified as asking by ATOM's command policy, opening worker-browser sites, and calls to already-enabled plugins granted to the worker. It does not create continuing exact-file grants. Returning to Saved permissions restores the original overwrite policy, with the user's earlier grants intact.

This is the scope of ATOM's available tools. It adds no native provider shell, administrator privilege, new worker kit, plugin grant or macOS permission. ATOM's protected-path/secret checks, command refusals (including delete/push/admin/network), sandbox, project boundaries, file-read and resource budgets, external-content safeguards, cancellation and undo behavior remain. Resource-limit consent still asks. A plugin can act outside ATOM's file sandbox, so only already-granted plugins participate; external-data taint still forces fresh consent.

Plan-first approval, browser interactions/submissions/uploads and unknown/secret targets, computer-action approvals, agent creation, disposable-shell preview consent and full file-edit review remain separate. The confirmation explains these limits before enabling the mode. Full access is not a promise of arbitrary filesystem or external-account authority.

## Enabling and persistence

Selecting Full access requests a separate host-owned confirmation; the menu remains on the previous mode until Allow. The expanded native card shows the complete scope and an explicit Enable Full access button, with Decline beside it. It is larger than an ordinary approval and its reason has no one-line truncation. The bounded complete reason is tested against the bridge's 600-character budget. The Board also retains its ordinary complete approval detail.

The host checks the exact current writable local chat, previous mode and idle state before asking and again after consent. A new turn, navigation, model/access change, cancellation or quit aborts pending activation. Late Allow, declined/unavailable confirmation and newly active work cannot enable it. Runtime checks source-chat jobs and provider compatibility before storage; selection never sends a prompt or edits a draft. The model cannot enable this mode through a tool.

Once confirmed, Full access persists for this chat across restart/provider changes. Gemini CLI cannot enforce it and refuses before launching; its Full access row is disabled. Old/new chats default to Saved permissions. A fork copies conversation and normal preferences but replaces Full access with Saved permissions, so a branch needs its own explicit opt-in. Existing chat history, brief, draft and exact-file permissions are retained.

The SQLite mode constraint is upgraded transactionally, including preferences saved before a first reply. Chat-deletion cleanup remains. No global access flag, credential or new dependency is introduced.

## Verification

- Old-table migration retains checked modes and unsaved preferences; Full access survives restart, drops to checked on fork and cleans up on deletion.
- A controlled real worker overwrites a temporary fictional file without a card or new grant. Switching back asks again. Protected writes, delete/push/admin commands and cancellation remain refused; checkpoint hooks still run and resource-consent remains.
- Native worker checks retain plan-first and unknown-server refusal; external-content taint forces fresh MCP consent despite Full access. Browser tests waive navigation consent while retaining interaction, submission and upload consent.
- Host activation tests cover Allow, Decline, changed chat, newly busy work, changed prior mode and late approval after cancellation. Extra command fields cannot forge consent. Gemini refuses all non-checked modes before starting its CLI.
- Native tests decode Full access and the explicit expanded-card flag, retaining old compact cards. The gallery adds one complete-scope confirmation scene; no old reference is deliberately changed.

Final TypeScript suite: 1,140 passed / eight normal opt-in skips (`/tmp/atom-full-all-tests-final.log`). Typecheck and 758 Swift tests / 141 suites pass. Signed release build and strict signature verification pass (`/tmp/atom-full-build.log`). All 90 gallery scenes and 22 visual comparisons pass (`/tmp/atom-full-gallery-verified.log`); only the new reviewed complete-scope confirmation reference was added.

Live 21 October: the fictional notebook chat's menu includes Full access. Selecting it produced a pending confirmation while the selector stayed Saved permissions, disabled until the card settled. The Board showed the entire scope, including plugin sandbox limits, retained approvals, restart persistence and new/fork defaults. An attempted Decline action was interrupted by a human app change; the refreshed authoritative UI showed Full access enabled. Acceptance is observed in-app, not attributed to automation. Preserve this confirmed user choice on the fictional notebook chat. Controlled tests separately prove Decline/cancellation and actual temporary-file execution.

With the confirmed Full access mode, typed exactly `Cedar full access check — unsent.`, switched to the movie chat (still Saved permissions), returned and verified the exact draft, Full access label and original notebook transcript. Cleared only that test draft and restored the original movie chat (Haiku 5.5 / Off / Saved permissions / empty composer / Ready), with zero pending approvals/tasks. No prompt, provider completion, model-driven host tool call or new exact-file grant was requested in the live check. The final app remains running with its main window visible. The Full access upgrade is local after the prior work was published as bce4193.
