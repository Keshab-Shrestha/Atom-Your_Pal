# Everyday workflows and conversation continuity — 2026-10-17

Requirement: ATOM should feel like the same assistant throughout a chat, retain decisions and explicit file permissions, and perform real work with the selected Codex model.

The implementation is in place. The three everyday workflows are **not yet fully verified end to end**.

## Current implementation

- Chat and project replay preserve the entire saved transcript. The old 20-exchange truncation, and the project archive's 2,000-message cap, are removed. A regression saves 25 exchanges to the real memory store, opens a new Core, changes provider and verifies the first fact is still in context and storage. Already-discarded messages cannot be recovered. Provider context windows still apply: there is no new retrieval or summary fallback for an archive too large for a model request.
- File approval cards distinguish **Allow for task** from **Allow for chat**. The latter saves one exact canonical file for that chat across tasks and restarts. Other files and chats still ask; protected-file checks always apply. Earlier approvals are not silently upgraded. Say **Show file permissions for this chat** to inspect grants, or **Forget file permissions for this chat** to revoke them. Removing or pruning a chat removes its grants.
- Codex chats now use a persistent signed-in app-server session with ATOM's checked host tools. Delegation creates a real Board task, runs the worker, returns its report and supports Stop. File agents use ATOM's policy, approvals and undo checkpoints; project workers use task worktrees. Native Codex execution and imported MCP tools cannot bypass that policy.
- Ask ATOM and quick-action editing follow the active chat's provider. With no active chat override they follow the default choice. They send only the edit request, with no chat history or memory; there is no fallback to Claude. Codex edits use a separate session with no registered host tools and native tools disabled. Claude retains its existing small-model editing route.

Codex workers currently have checked text-file tools only for the folders kit. Shell, web, browser, external MCP, assigned Claude skill plugins, worker model pins and nested workers are not implemented for this route. Workers use the chat's Codex model; unloaded skills are not counted as used. Background conversation summaries still use the existing Claude route. This is not complete provider parity.

## Verification results

| Workflow | Evidence | Remaining live check |
| --- | --- | --- |
| Chat → delegate → review → later rewrite | Real signed-in Codex, through the Core and host router, delegated an edit of a temporary fictional Cedar file; the file changed, the task completed and its report was returned. A subsequent tool-free answer recalled Cedar and Wednesday. Local integration tests run two real file writes through scripted Codex RPC, produce Board reports and reuse exactly one explicit grant. | The final natural-language rewrite has not passed with the latest prompt. Earlier live attempts inferred denial from Codex's native read-only sandbox without trying ATOM's host write tool. Tool descriptions and worker instructions now explain the separate host permissions. The next live run passed the first edit and recall, then Codex's **account usage limit** blocked the third turn. |
| Note → Ask ATOM → review/save | A fictional note was saved in the real UI. Provider-routing tests verify Codex receives only the edit target/instruction, closes its isolated session and never falls back to Claude on failure. Swift review/edit tests pass. | A real Codex note rewrite, review and save through the rebuilt UI. |
| Selected text → quick action → replace | Swift capture/edit/review tests compile and pass. The runtime uses the same provider-aware edit route as Ask ATOM. | The physical shortcut, Codex rewrite and replacement in TextEdit. Synthetic ⌃⌥K previously inserted a control character instead of opening the picker; text was restored. That does not establish whether a physical shortcut works. |

The live Core/router test uses a temporary file and in-memory stores, not a user's project file. Its approval callback supplies the explicit chat choice for that fixture; it does not test clicking the real card. The approval card is rendered separately in the gallery. The earlier fictional UI chat, Second brain note and TextEdit scratch document remain available for inspection.

Repeat the focused signed-in check once Codex capacity is available:

```sh
ATOM_LIVE_CODEX_TESTS=1 node --test tests/codex.live.test.ts
```

It asserts the first edit, remembered project/day, second edit, one approval, two completed jobs and six archived messages. It is opt-in because it uses real signed-in model capacity. Do not mark it passed when it skips or stops on an account limit.

## Original diagnosis, before these changes

Five real Codex turns in the app retained short Cedar context through reopening, but Kame did not run: the old route supplied no ATOM tools. Note editing was hardwired to Claude.

A no-model diagnostic sent 22 exchanges. The next request had 41 messages and no first fact; the persistence callback received only 40 messages and no first fact. The store replaced its saved messages with that truncated payload. Task-local file approval caches were also deleted when a worker ended. These were ATOM integration problems; they did not prove that Codex itself could not remember or edit files.

Architecture and scope: ADR-135 through ADR-137 in [DECISIONS.md](../DECISIONS.md). Current check totals are in [STATUS.md](../STATUS.md).
