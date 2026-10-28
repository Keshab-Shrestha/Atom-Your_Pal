# Interrupted tasks and explicit retries

Implemented 2026-10-18, ADR-139. This delivers task-attempt recovery, the first part of the broader work/input recovery roadmap.

## Behavior

If ATOM reopens with a running task, it marks the attempt **Interrupted · outcome unconfirmed**, preserves the last recorded step, tool history, checkpoints and existing reports, and explains that files may already have changed. A queued explicit retry left by the previous process also waits for review. Neither is replayed automatically. Identifiable older generic “ATOM was closed” failures receive the recovery marker; previously discarded steps cannot be reconstructed.

A lost Claude SDK session with host-dispatched work marks those attempts for review immediately. It blocks automatic fresh-session fallback, including the interval after the host accepted an Agent call but before its tool-use event arrived. Late reports cannot overwrite an interrupted attempt. This records an unknown outcome; it does not prove that a remote worker or file operation stopped at a particular instant.

Board → Needs you offers **Review attempt** for interrupted work. The task thread shows the last step and **Retry after review**. Inspect files, tool history and available file copies before retrying. Telegram/phone Needs you directs the user to the Mac with no Retry shortcut for these attempts; old remote Retry buttons are refused. Ordinary failed attempts can still request a retry.

Retry creates a new attempt with the original saved task brief. The original stays in history with a link to the new attempt and stops appearing as another unresolved failure. If the new attempt fails, retry that attempt to create the next one. Notes do not silently replay an ended native task.

## Durable dispatch

The store persists the queued attempt and source/child linkage in one transaction before native dispatch. Its task chat is `task-retry-<attempt id>`. Repeated requests for the same source return its existing attempt without another turn. The source retains its next-attempt id even if that attempt is removed, so delayed requests cannot resurrect it. Removed queued turns are skipped before model delivery; a missing reserved retry chat cannot create an ordinary task.

Only the original worker can claim a queued retry, once. The host supplies the saved brief and instructions to inspect actual files/results, avoid repeating completed work, and ask when context is insufficient. A provider failure before worker start becomes a visible failed attempt rather than remaining queued. A subsequent attempt requires another explicit request. UI, API and Telegram share this dispatcher. Legacy test stores without it retain their legacy behavior.

The host follows persisted retry ancestry to the source chat's current provider, project and read-only attachment context. An explicit model choice made before the first answer is also durable; it is not lost if the backend stops before the first transcript save. An explicit provider choice on the retry chat takes precedence. A matching chat name alone conveys no authority. Exact-file/chat grants, pending approvals and task-local permission caches are not copied. Current policy, protected-file, plan and file-approval checks still run. Retrying can ask for permission again in its new chat. This is a fresh worker attempt, not restoration of SDK/worktree execution position. Saved briefs retain the existing task-length limit.

This deduplicates retry dispatch. It does **not** provide exactly-once file/network effects, a per-operation effect journal, automatic reconciliation of unknown writes, durable main-chat turn delivery, or exact provider-limit/reset scheduling. Those remain separate work.

## Migration

Startup adds nullable integer `recovery_needed`, `retry_of` and `retry_next` columns to `jobs`, plus the partial unique `jobs_retry_of` index. The memory store adds `pending_chat_models` for explicit model choices made before a transcript exists. The first transcript save promotes that choice into the chat row in the same transaction; reset/removal clears it. Choosing a model creates no invented chat messages or empty transcript in the sidebar. Task/report content is retained. Startup recovery and retry linkage use transactions; completed recovery is not timestamped again on reopening. The parent-side link intentionally survives child removal.

The old minimal helpers schema and private SQLite backups of the actual helpers and memory databases migrated successfully. The memory migration preserved saved chat models, messages and file permissions; pending-choice reopen/save/reset/removal regressions pass. Task/report content and row counts were reconciled, nullable columns/index checked, and SQLite integrity passed. The private copy was removed afterward; the source was opened read-only for backup. Do not use manual SQL to alter production attempts. Rollback is forward-only: keep additive columns/index/data and fix behavior in a later release. Avoid reverting to a runner that ignores pending retry identities.

## Evidence and limits

- Abrupt subprocess exit after an actual fictional file write: reopening retained the file, last step and unknown outcome without replay; another reopening retained the end time.
- Actual Core/Gateway/host router with scripted Codex JSON-RPC and local file operations: three deliveries of one retry produced one checked worker and one write, preserving the original record. This is not a live-provider crash/retry test.
- Store/dispatch tests cover migration, queued-retry restart, wrong-worker/second claims, removed attempts, explicit next attempts, notes and pre-worker provider failure. SDK/Board tests cover lost connection before the tool-use event, late reports and one-time cleanup. Telegram tests cover review-only recovery.
- Full checks: 1,054 TypeScript tests passed, eight opt-in model tests skipped; typecheck passed. The full suite passed with `--test-concurrency=2`; its first default-concurrency run hit the existing Telegram retry-timing flake (NaN timing), with no production Telegram change in this pass. All 733 Swift tests in 134 suites passed. Signed release build passed. All 75 gallery images and 12 existing golden comparisons passed; the interruption card was inspected in Void, Daylight and Lantern.
- Real signed-in Codex interruption/retry passed in the actual app on fictional files; details follow. Earlier signed-in Codex history/file evidence is documented separately.

The gallery has an existing overlapping sidebar sample-data artifact; this pass inspected the interruption card, not every unrelated layout.

## Live acceptance on 2026-10-18

The first real attempt exposed a provider persistence defect: task #24 ran on Codex, but after an abrupt backend stop its first-turn chat had no saved transcript or durable model choice, so retry #25 used the global Claude default. That retry was stopped, its outstanding file request declined, and the second fictional file remained unchanged. The defect was fixed by persisting pending chat choices in the memory store; the old lost choice is not guessed or backfilled.

A fresh retest used `~/Documents/ATOM-Recovery-Retest-cyq1t0qf/cedar.txt` and `review.txt`. Kame task #26 ran on signed-in Codex (`gpt-6-astra` reported), read/wrote the first file after **Allow for task**, then waited for separate approval to change the second. Fault injection verified the runtime PID, checkout, sole running task and actual file contents before stopping only ATOM's backend. No task state was seeded or altered by test SQL.

The app supervisor restarted the backend. Board showed **Interrupted · outcome unconfirmed**, last step **Using Write**, and **Review attempt**. The task thread showed its original brief, interruption activity and first-file checkpoint. The actual first file retained its saved content, and the second retained its original content; no automatic replay occurred.

Clicking **Retry after review** created exactly one linked task #27. Its source model choice survived even though the original chat still had no completed transcript. The retry used Codex, read both files, skipped the already-correct first file, and requested task-only approval for the remaining file. After approval it saved the second file and completed with an actual report. The first file's content and nanosecond modification time were unchanged across retry; #26's File changes listed only `cedar.txt`, while #27's listed only `review.txt`. The original remained Interrupted/Retried with its link, and SQLite contained one child.

This proves this two-file fixture and the real review/retry/approval/report path, not generic exactly-once effects or arbitrary crash points. Repeated transport delivery remains covered by scripted host-router tests rather than repeated live Retry clicks. The source user turn still is not a durable main-chat input journal. The Codex task's Tool calls panel currently shows zero entries despite file operations; file-change checkpoints and direct file verification supplied the review evidence here. During the stopped Claude attempt an outstanding approval card remained until declined; cancellation of that native approval path needs a separate check. Fictional files and task records remain available for inspection.

A further UI limitation observed after the successful retry: the header stayed “Thinking” even though the retry transcript/report and `task.turn` success were saved and no tasks were running. Work-status and stopped-approval cleanup should be checked before starting durable input upgrades.

After a further normal app quit/relaunch, ATOM opened Ready with no pending/failed-attention/running tasks. The original #26 → completed #27 link and single-child count persisted, both files were unchanged and the first file retained its modification time. Restarting cleared the stale header; it does not count as a fix for that UI status defect.

## Task-state follow-up (ADR-140)

The stopped-approval and stale Thinking issues recorded above are now fixed and live checked. Native Stop immediately closed task #28’s pending file card without changing the fixture or creating a grant. Its explicitly selected Codex retry #29 completed the approved save/report and returned Ready without restart. Policy/island tests also cover delayed approval/grant races and concurrent foreground/card state. [Scope, evidence and limits](task-state-lifecycle.md). Codex’s missing per-tool timeline and durable chat input/turn delivery remain separate.
