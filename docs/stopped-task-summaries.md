# Host-grounded stopped-task summaries — 27 October 2026

Fix for the discrepancy found during [Claude file-verification acceptance](omh-claude-file-acceptance-2026-10-27.md): task 46's automatic chat summary claimed one successful Read while the host tool history recorded five. The actual stopped state, unchanged files and absence of verification were correct; the model had summarized an incomplete worker note.

Before this correction, the cumulative OMH work and evidence were committed/pushed as `e907917a5a3c791ec9151e1077aa4c284741dcab` on `codex/oh-my-hermes-inquiry` and fast-forwarded/pushed to `main`, as requested. The correction is subsequent work on `codex/stopped-task-summary`.

## Change and boundaries

- The Gateway passes bounded, structured SDK task-notification IDs/statuses with a self-started result. These are not parsed from generated prose. Each result consumes its notifications once; foreground results clear notifications they consumed so later wakes cannot inherit stale task associations.
- The existing Board retains a bounded task-ID → host-job lookup after completion cleanup. This is notification correlation, never an admission/resume lookup.
- For a correlated stopped task, the native core replaces the model's automatic follow-up with a deterministic, chat-owned host summary. Mixed notifications retain other task result links without repeating an inseparable model paragraph containing an incorrect stopped count.
- Successful calls count only when their recorded start and end fit the current stopped attempt and finish before Stop. Pending, failed, late and older-attempt calls are excluded. Tool inputs/results, file paths and partial worker prose are not copied into the notice. Counts are explicitly **recent recorded activity**, because tool history is bounded; they are not a completeness claim for arbitrary execution.
- Missing attempt/history metadata withholds counts and directs the user to task history. A missing/foreign task record reveals no task ID or contents from another chat. No claim that zero recorded calls proves no effects is made.
- The host notice warns that files may already have changed and requires review before an explicit Retry. It starts no work, creates no approval, changes no grants/model and never creates verification evidence.
- The provider retained its own generated answer. The host correction therefore also joins the existing catch-up context for the next ordinary turn, with no extra model request. Displayed history saves the corrected notice; old chat messages and worker reports are not rewritten.
- Diagnostic logging cannot prevent delivery of the corrected notice.

The replacement is scoped to automatic task-result wakes with structured notification context. It does not promise that every later free-form model summary is mechanically certified, or rewrite the earlier task-46 discrepancy in saved history.

## Verification

`pnpm typecheck`, `git diff --check` and 64 targeted checks passed:

```sh
node --disable-warning=ExperimentalWarning --test --test-reporter=dot \
  apps/mac/src/native-core.test.ts \
  apps/mac/src/native-board.test.ts \
  apps/mac/src/stopped-task-summary.test.ts \
  services/llm-gateway/src/providers/claude-session.test.ts
```

Coverage includes the original five-versus-one regression through Core/Gateway/storage, correction persistence and next-turn catch-up, a throwing diagnostic logger, pending/error/late/old-attempt exclusion, unavailable evidence, mixed outcomes, foreign-chat isolation, completed-task correlation and notification consumption alongside a foreground turn. No Swift or full repository suite ran.

### Actual app/provider rerun

The [saved host evidence](evidence/stopped-task-summary-2026-10-27.json) contains only this fictional task's state and recorded activity metadata.

Restarted the idle signed app to load the host-only change; no Swift source/binary changed. Existing chats, model/access choices and project filter survived. Used the same fictional Cedar acceptance chat `7b5b6d49-376b-4b58-90a9-9139d5676d75`, with a new read-only task and isolated copy.

Plan 13 / task **48** read `fruit.mjs` sequentially until Stop. Host history records three successful reads, ending at `16:57:15.633Z`, `16:57:17.698Z` and `16:57:20.042Z`. The attempt stopped at `2026-10-26T16:57:22.045Z` (job event `.047Z`; provider end callback `.094Z`). These are UTC timestamps; the local date was 27 October in Japan.

The real UI displayed:

> Task #48 stopped.
>
> Recent host history records successful calls before Stop: Read × 3.

It also showed the file-effects/review/no-restart explanation. Host log `agent.stopped_summary` recorded one associated update; task and attempt remained stopped. A subsequent tool-free question about this notice answered that **three successful Read calls** were recorded, with zero observed tool calls. This demonstrates actual SDK notification correlation and provider catch-up, in addition to the controlled regressions.

The task-48 copy and original Cedar project remained clean; no file was edited, no worker command/test/Git operation ran, and no task restarted. Fictional reports/worktrees were retained. The one-line diagnostic-failure guard added after the live check was rechecked by the targeted Core regression; it does not alter the ordinary live path above.

This is a factual-reporting correction, not a speed/token benchmark or full release certification. Codex file-verification and native retry/repair acceptance remain next independent steps.
