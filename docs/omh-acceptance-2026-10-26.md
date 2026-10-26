# OMH integration acceptance — 26 October 2026

Bounded acceptance of the local implementation on `codex/oh-my-hermes-inquiry`, against pre-OMH main `1b6cc685`. These results do not certify full OMH/Sentient parity. The before/after image describes implementation, with acceptance tracked here.

![ATOM architecture before and after](assets/atom-architecture-before-after.png)

[Editable SVG](assets/atom-architecture-before-after.svg). Both sides retain the existing chat/history, SQLite store, Gateway, workers, checked tools, Stop and permissions. The new architecture adds coordination and evidence inside those boundaries, without a Hermes runtime.

## Build and checks

- Fixed two TypeScript errors: new plan schemas supplied unsupported `enum` fields to the existing narrow ToolSpec. Kept the supported string schemas with explicit choices in descriptions; existing closed runtime validators still reject unsupported values. Removed the unused workflow-ID import.
- `pnpm typecheck` and `git diff --check` passed.
- `pnpm island:build` succeeded: AtomIsland release compilation 71.63 s; Calendar/Documents helpers built; packaged with ATOM Local Signing. `codesign --verify --deep --strict` passed.
- Existing warnings remain: IslandSettings generic choice isolation, main.swift implicit capture, and SwiftPM native-build-system deprecation.
- No Swift test suite, full repository suite, commit or push. No latency/token improvement is inferred.

## Actual native app and provider checks

Used a separate fictional chat, `9e353aa2-564e-42ca-b87a-bac62ed5b42b`, with Claude Haiku 5.5, thinking Off, Saved permissions. Existing chats, projects, notes and grants were retained. No continuing file permissions were created in this chat (read-only database count: zero). One later fictional edit resolved a one-time approval, detailed below. The app was inspected and operated through its real UI; targeted read-only database/log inspection corroborated task and plan state. This record was finalized on 27 October; the checks below ran on 26 October, Japan time.

1. **Direct chat passed.** Asked for the fictional Friday/blue-heron sentence, then asked for the same facts. Both correct, with zero observed tool calls and no worker dispatch.
2. **Contract storage and deferred start passed.** `plan_work` saved plan 1 with four contract fields and Quill P1. The Board showed it awaiting start with zero workers active. SQLite retained the versioned contract and host scope binding.
3. **Real contracted worker passed.** Explicitly started P1 with a deliberately wrong dispatch prompt (`Reply BANANA`). Host `plan.claim` and a protected contract context block were logged. Task 37 stored the original planned task, returned a Friday/blue-heron sentence, and recorded its own reported attempt `21ccd59d-819d-478f-8a87-955c2a78353b`. This is one Claude worker check, not Codex acceptance.
4. **Honest evidence UI passed.** Chat → Tasks → Review result showed the original report and said there were zero inspection records, no independent file-predicate verification and whole-task correctness was unverified. It did not promote worker self-checks to host certification. The model initially declined to expose the task ID in prose; the actual UI/status and database exposed #37 correctly. Treat that response as a presentation inconsistency, not a hidden or missing task.
5. **History isolation from execution passed in this chat.** Saved plan 2 without dispatch. `plan_history` plus explicit `plan_status(plan=1, portion=1)` inspected the older completed plan and left plan 2 current and unstarted. Cross-chat refusal was separately checked through the host integration harness below.
6. **Normal restart passed.** Entered `UNSENT Cedar OMH restart check: keep the blue heron.`, quit normally, verified ATOM exited, and relaunched. The exact draft, selected chat/history, model/access and pending plan survived. The catalog briefly showed its refresh placeholder, then restored Haiku/Off. Replaced only that test draft with a follow-up: correct recall, current plan still awaiting start, earlier report historical, no automatic worker dispatch. This trial had no saved file grant to independently certify grant reuse.

## Stop defect found during actual use

The first long Quill run (task 38) exposed a cancellation bug: after the parent reply completed, the visible Stop button only cancelled the idle foreground voice loop. The native background worker kept running. The worker eventually completed; that run is a failure to stop, not a successful cancellation trial.

The handler now cancels the foreground loop and stops all active native jobs owned by the current chat via an unbounded store lookup. Existing store notifications cancel the provider task and seal its tool gate. It does not stop another chat's workers. The native binary did not change for this TypeScript fix; the app host was restarted to load it.

Three focused command-handler checks passed: background state remains busy while a worker runs, repeated Stop affects only current-chat native workers after foreground idle, and recording cancellation still discards input. These are regression checks, separate from live UI acceptance.

**Corrected live Stop passed.** After restarting the host, task 42 (plan 7) used Kame for five sequential reads of a fictional note, with no edits or commands. The parent had already returned `Started` while the worker remained active. Clicking the composer's Stop returned ATOM to Ready. Both the job and its host attempt were recorded stopped at `2026-10-26T12:18:42.940Z` (job event followed at `.941Z`); the provider completion callback respected the existing stopped state instead of rewriting it to done. The Board showed `Unfinished work needs review`, `1 stopped`, a Review button and the explicit no-restart explanation, with zero workers active. No automatic retry was made.

Two intervening text-only reruns (tasks 39–40) finished before a usable Stop click; neither is counted as cancellation evidence. Task 39 reported that the short worker-report budget prevented its requested 1,200-item deliverable. This is a useful limitation of using a task report as the deliverable, not a passed large-output workflow.

An edit-wait trial (task 41, plan 6) changed only the newly created fictional note at `~/Documents/ATOM-OMH-Stop-Mjj9MG/Cedar fictional stop.txt` from Revision one to two. Host logs record Edit asked at `12:17:18.352Z` and allowed at `12:17:20.664Z`; the approval resolved before the next UI inspection. It therefore did not provide a stable cancellation wait. The parent model's statement that it did not see an approval was not authoritative: the host did ask. No continuing grant was recorded. The note and its correction checkpoint remain available for review; the file was not reverted or deleted.

Focused regression command:

```sh
node --disable-warning=ExperimentalWarning --test --test-name-pattern='talk.cancel stops background|a background turn ending|talk.cancel discards' apps/mac/src/island.test.ts
```

## Isolated host integration checks

Run `node --disable-warning=ExperimentalWarning scripts/omh-host-acceptance.mjs`. This creates and removes its own temporary database/files and uses the actual store/collector implementations, with controlled lifecycle inputs and policy callbacks. It uses no model, UI or product database. Six checks passed:

- Contracts reject injected permission fields.
- Retry is deduplicated, keeps its original contract and stays scoped to its chat; historical lookup cannot select another chat's plan.
- Repair binds the exact reviewed report, rejects a stale digest, retains the original failed task, unblocks only effective dependent state and is idempotent.
- Close/reopen preserves contracts/accepted repair and marks a running attempt interrupted without replay.
- The real bounded file reader matches a literal and returns unavailable for refused access, cancellation and symlinks.
- Disjoint declared paths remain compatible; rebinding to another project is refused.

These host checks do not establish actual provider hook working directories, native approval behavior, parallel real-worker race handling or full task correctness.

## Remaining acceptance

[27 October Claude follow-up](omh-claude-file-acceptance-2026-10-27.md) now covers actual isolated edit/readback, policy refusal, mismatch and Stop before collection. Codex and the narrower collection/workspace races below remain pending; the follow-up also records an open stopped-summary count discrepancy.

- Actual Claude and Codex project workers with host file predicates, policy refusal, changed workspace and Stop during readback; Codex inspection receipts across dirty/clean revisions.
- Real explicit retry plus fresh native repair approval/decline/stale review, and restored dependent report handoff. Repair never transfers or merges worktree files.
- Abrupt provider/runtime interruption and its unconfirmed-outcome branch, the Review button's complete navigation path, longer recovery and two-worker conflict/Stop races. The stopped-plan banner itself passed live as documented above.
- Saved exact-file grant reuse in this new build and memory-receipt UI across selection, reduction, cancellation and provider-session replay.
- Controlled context/cache/latency measurements. No speed or cost gain is established here. Cursor trials remain deferred.

Fictional chat/plans/reports are retained for review. No existing fixture or user data was deleted.
