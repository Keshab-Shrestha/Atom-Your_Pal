# Claude file-verification acceptance — 27 October 2026

Actual native-app/provider checks in the signed local ATOM build, following the [first cumulative acceptance](omh-acceptance-2026-10-26.md). No product source changed in this step. No build, unit/Swift suite, commit or push was needed. The model workers were explicitly forbidden to run commands/tests, install, commit, push, merge, change original files or write memory.

## Setup and independent evidence

Used the existing fictional **Cedar Live Acceptance** project with a separate new chat, `7b5b6d49-376b-4b58-90a9-9139d5676d75`. Main chat: Claude Haiku 5.5, thinking Off, Saved permissions. The actual worker models recorded by the SDK were Opus 5.5 for tasks 43/45/46 and Sonnet 5.5 for 44/47; this was not a fixed-model performance comparison.

Source project: `~/Documents/ATOM-live-acceptance-vmh7kxvb/Cedar Numbers`, clean at `c1d4b5afdc2c42407f4af57b049c2a6266229e9f`. Its baseline `fruitTotal` subtracts instead of adding. Every worker got a new ATOM-managed task worktree on `atom/task-<id>`; earlier copies were retained.

The app UI, host event log, read-only SQLite queries, independent file hashing and Git status supplied distinct evidence. [Saved content-free evidence snapshot](evidence/omh-claude-file-checks-2026-10-27.json) includes attempt/receipt IDs, result enums, tool lifecycle metadata, file hashes and Git state for only these fictional tasks. Log timestamps are UTC on 26 October; all checks occurred on 27 October in Japan.

## Observed results

| Case | Plan / task | Actual host outcome |
| --- | --- | --- |
| Bounded edit and readback | 8 / 43 | Corrected only `fruit.mjs` in task-43. Two predicates matched: the addition literal and the unchanged test-file SHA-256. |
| Protected-path refusal | 9 / 44 | Ordinary source literal matched; `.env` predicate was unavailable with `policy_refused`, without a snapshot. No files changed. |
| Stop attempt completed too soon | 10 / 45 | CUA rejected the stale action before a usable Stop click. Worker finished its isolated edit and both checks matched. **Not cancellation evidence.** |
| Successful Stop with declared checks | 11 / 46 | After the parent replied Started, Stop ended the worker. Job and attempt stayed stopped; no verification receipt was recorded. Worktree unchanged. |
| Deliberately wrong expectation | 12 / 47 | New worktree still subtracted. Addition literal recorded `not-matched / literal_missing`, with the baseline file snapshot. No earlier successful receipt reused, no edit or retry. |

### Positive edit and independent readback

Task 43 changed line 2 from `return apples - pears;` to `return apples + pears;`. Independent Git status showed only ` M fruit.mjs`, zero commits beyond the baseline and no staged changes. `fruit.test.mjs` remained SHA-256 `105d951ccd8441ada5620ff99ec509cfeb8b3bd160464dd3bcbc3eee3e5cdef7`.

Attempt `cc5e4cc2-3898-43a3-b57d-f05874ad5d44` received host receipt `4c9efc04-a9a7-4b98-917a-bccaa2aacf04` at `2026-10-26T16:36:06.492Z`. The fixed workspace digest identifies task-43, not the original project. The real Claude hook/worktree path was sufficiently corroborated for collection; this is positive provider-path acceptance, not merely a collector callback fixture.

Chat → Tasks → Review result showed `2 matched, 0 did not match, 0 unavailable`, explicitly labelled historical file observations rather than tests or proof of whole-task correctness. The worker report truthfully left its own uncomputed SHA check unverified; the host supplied independent evidence separately.

### Refusal and mismatch

Task 44 used a fresh read-only worktree. `.env` was only a declared refusal sentinel; no credential file was created or opened for the test. Host policy refused Read before file observation, producing no snapshot or contents. The result panel showed `1 matched, 0 did not match, 1 unavailable`, and chat named the policy refusal correctly.

Task 47 declared the same addition literal that had succeeded in the earlier edited copy, but it read an untouched fresh copy. Its distinct attempt `7bad4535-978e-4d74-acb9-fb1ed06d020d` and workspace received receipt `34c3f8b9-78c0-4a14-b5a9-897a398b639c` with `not-matched / literal_missing`. Chat reported the actual mismatch without fixing the file or retrying. This checks that completion and prior successes do not manufacture a positive result for a new attempt.

### Stop and late completion

Task 46 had declared file predicates and a deliberately long sequence of read-only calls so Stop could be exercised. The parent had already acknowledged Started. The fresh visible Stop control returned ATOM to Ready and the task row became stopped.

Host tool history contains five completed Read calls before Stop. The attempt `a848576e-307d-4b4a-ba7f-b976f25e42ad` stopped at `2026-10-26T16:40:06.438Z`; the provider callback at `.480Z` respected the stopped row. Subsequent inspection still found no task verification, no later tool calls and no active workers in this chat. Its worktree retained the unchanged baseline. This is Stop **before collection**, not proof of the narrow race while host readback is already running.

**Summary discrepancy found during this acceptance:** the model's unprompted chat summary said one read completed and a second had begun, apparently using the worker's partial note. The host tool table records five successful reads. The durable task state, unchanged files and absence of verification agree; the narrative count does not. Do not use a partial model note as the authoritative execution count. A bounded follow-up should ground stopped-task summaries in host activity, or explicitly withhold counts that have not been checked. This was observed and recorded in this acceptance. The subsequent [stopped-summary correction](stopped-task-summaries.md) now passes the controlled five-read regression and an actual three-read Stop/follow-up trial; the original historical message remains untouched.

## Preserved state and limits

- Original source project still clean at the same commit; baseline subtraction and both original file hashes unchanged.
- Task 43 and the too-fast-to-stop task 45 retain only their uncommitted `fruit.mjs` edits in separate copies. Tasks 44/46/47 are clean. No fixture, worktree, report or existing user data deleted.
- No worker Bash/command/test/Git tool call is in the recorded histories for these jobs. Host-owned worktree setup/read-only Git inspection is separate from worker execution.
- No continuing file grant was created in the new chat, and access/model selection was retained. This does not independently certify grant reuse after an interruption.
- The new chat is idle with an empty composer and all reports retained. The Cedar project filter remains selected for review.
- No speed/token improvement, whole-task verification, full parity or release readiness is inferred from these checks.

Follow-up: the [stopped-summary count discrepancy is corrected](stopped-task-summaries.md). Next repeat bounded file-readback cases with Codex, then exercise native retry/repair approvals. Separate remaining cases include workspace replacement/ambiguous cwd, Stop during host collection, approval decline/stale grant, abrupt crash and concurrent admission races.
