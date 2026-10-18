# Everyday workflows and conversation continuity — 2026-10-17

Requirement: ATOM should feel like the same assistant throughout a chat, retain decisions and explicit file permissions, and perform real work with the selected Codex model.

All three everyday workflows now pass in the real UI on fictional test data: chat/file continuity, note edit/review/save and selected-text quick-action replacement. The additional password-field refusal check also passed live using an isolated native secure field containing fictional data.

## Current implementation

- Chat and project replay preserve the entire saved transcript. The old 20-exchange truncation, and the project archive's 2,000-message cap, are removed. A regression saves 25 exchanges to the real memory store, opens a new Core, changes provider and verifies the first fact is still in context and storage. Already-discarded messages cannot be recovered. ADR-138 now adds bounded replay and own-chat retrieval; provider context windows still apply beyond that conservative conversation budget. See [long-chat recovery](long-chat-history.md).
- File approval cards distinguish **Allow for task** from **Allow for chat**. The latter saves one exact canonical file for that chat across tasks and restarts. Other files and chats still ask; protected-file checks always apply. Earlier approvals are not silently upgraded. Say **Show file permissions for this chat** to inspect grants, or **Forget file permissions for this chat** to revoke them. Removing or pruning a chat removes its grants.
- Codex chats now use a persistent signed-in app-server session with ATOM's checked host tools. Delegation creates a real Board task, runs the worker, returns its report and supports Stop. File agents use ATOM's policy, approvals and undo checkpoints; project workers use task worktrees. Native Codex execution and imported MCP tools cannot bypass that policy.
- Ask ATOM and quick-action editing follow the active chat's provider. With no active chat override they follow the default choice. They send only the edit request, with no chat history or memory; there is no fallback to Claude. Codex edits use a separate session with no registered host tools and native tools disabled. Claude retains its existing small-model editing route.

Codex workers have checked text-file tools for the folders kit. ADR-158 adds bounded explicit loading of assigned SKILL.md instructions for every kit and host-call activity in the existing Board timeline; only successful instruction returns count as use. ADR-159 adds checked known-URL public HTTPS page reading for research workers when web access is enabled. These additions are typechecked/static-reviewed only, with tests/live checks skipped. Search, shell, browser, external MCP, skill plugin/script/supporting-file execution, worker model pins and nested workers remain unsupported. Workers use the chat's Codex model. Background conversation summaries still use the existing Claude route. This is not complete provider parity. [Worker scope](codex-worker-capabilities.md), [Page-reading limits](codex-public-pages.md).

## Verification results

| Workflow | Evidence | Remaining live check |
| --- | --- | --- |
| Chat → delegate → review → later rewrite | The signed-in Core/router regression passes both edits, Cedar/Wednesday recall, exactly one approval, two completed jobs and six archived messages. The rebuilt real UI saved the fixture after clicking **Allow for chat** on Board → Needs you, recalled the project/day, and completed a later rewrite without another approval. After quitting/relaunching and reopening the chat, the inspection command listed the exact file; a fresh worker saved another rewrite without another card. Revoking removed one grant; the next edit asked again. Decline left the actual file unchanged and the worker reported no save. | Passed for the fictional fixture. Other-file/chat isolation and protected-file checks are covered by local regressions. |
| Note → Ask ATOM → review/save | The fictional “Workflow check — Cedar” note was rewritten through Ask ATOM using the active chat’s Codex model (`gpt-6-astra` in usage). The real UI showed four changes; Accept all updated the editor, Done closed review and Save persisted the note. Leaving and reopening showed exactly “Cedar launches Wednesday. Doors open at noon. Fictional workflow test.” Provider-routing regressions verify isolation and no Claude fallback. | Passed for the fictional note. |
| Selected text → quick action → replace | Keshab’s physical ⌃⌥K captured exactly “Cedar launch on Wednesday. The doors opens at noon.” from TextEdit. Fix spelling and grammar used Codex (`gpt-6-astra` in usage), proposed two changes and showed **Replace in TextEdit**. Accept all enabled Replace. Clicking it updated the actual TextEdit document to “Cedar launches on Wednesday. The doors open at noon.” An earlier capture targeted an ATOM report and was not replaced. | Passed for the fictional TextEdit selection. A separate native secure-field fixture also passed: the physical shortcut showed “A password field is focused. ATOM does not read it.” with no action buttons. No real password was used. Synthetic shortcut input remains unsuitable for this physical check. |

The live Core/router test uses a temporary file and in-memory stores, not a user's project file. Its approval callback supplies the explicit chat choice for that fixture; it does not test clicking the real card. The actual Board card click has now been checked separately; the card also renders in the gallery. The first real UI attempts expired unanswered, correctly refused the write and reported no saved changes. This exposed a separate Board omission: it offered only Allow/Decline even for a continuing file request. Board now offers the same task/chat/decline choices as the work strip. The earlier fictional UI chat, Second brain note and TextEdit scratch document remain available for inspection.

The secure-field fixture was a temporary AppKit app outside the repository, containing a standard `NSSecureTextField` and fictional text only, with no account or network code. Accessibility identified the focused element as a secure text field before the shortcut. After the refusal was verified, the fixture app was closed. This checks the native secure-field case; it is not a claim about every browser or custom password control.

The focused signed-in check passed on 2026-10-17 (one test, no skips, 51 seconds). Repeat it with:

```sh
ATOM_LIVE_CODEX_TESTS=1 node --test tests/codex.live.test.ts
```

It asserts the first edit, remembered project/day, second edit, one approval, two completed jobs and six archived messages. It is opt-in because it uses real signed-in model capacity. Do not mark it passed when it skips or stops on an account limit.

## Original diagnosis, before these changes

Five real Codex turns in the app retained short Cedar context through reopening, but Kame did not run: the old route supplied no ATOM tools. Note editing was hardwired to Claude.

A no-model diagnostic sent 22 exchanges. The next request had 41 messages and no first fact; the persistence callback received only 40 messages and no first fact. The store replaced its saved messages with that truncated payload. Task-local file approval caches were also deleted when a worker ended. These were ATOM integration problems; they did not prove that Codex itself could not remember or edit files.

Architecture and scope: ADR-135 through ADR-137 in [DECISIONS.md](../DECISIONS.md). Current check totals are in [STATUS.md](../STATUS.md).
