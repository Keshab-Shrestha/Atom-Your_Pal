# Daily chat and interruption recovery acceptance

Actual native-app checks on 24 October 2026, Japan time (log timestamps are 23 October UTC). Continued the existing fictional Cedar daily chat, UUID `97263cad-9415-4545-b439-16d33b0cfd0c`, in the signed local build. The initial checks below changed no application code and ran no build or test suite. The later runtime/grant follow-up includes one UI correction and a signed rebuild, documented separately below. No commit/push occurred. Cursor trials remain deferred at Keshab's request.

## Observed results

1. **Normal reopen passed.** Entered `UNSENT Cedar recovery 24 October: bring the blue blanket.`, quit normally and verified the process exited. Relaunch opened the full window with the exact draft, same chat, Opus 5.5, thinking Off and Saved permissions. The model catalog briefly displayed its unavailable-thinking placeholder during refresh, then restored Off without intervention. Replaced only the test draft with an explicit recall request. ATOM correctly answered Saturday, south gate, 19 pieces of fruit, with zero observed tool calls.
2. **Quit during generation passed.** Started a cancellable, tool-free fictional checklist request, queued one identifiable follow-up, and entered a separate unsent draft. Quit while the work row showed eight seconds of generation. On relaunch the full window was Ready; the exact unsent draft survived and the follow-up appeared under Held messages, requiring review. The original request appeared as Stopped in Recovery with its full prompt and selected provider/model. It was not presented as completed chat history.
3. **Explicit restoration passed.** Restore was disabled while the preserved draft occupied the composer. Cleared only that test draft, opened Recovery and chose Restore to current empty draft. The full original prompt appeared unsent in the composer; ATOM remained Ready. No generation or tool work restarted. The recovery copy was not dismissed.
4. **Continuation with held input passed.** Replaced only the restored test prompt with an explicit new recall request. ATOM answered the same corrected picnic facts. A subsequent warm follow-up did too. The earlier queued message stayed held through both answers. A read-only journal query found zero attempts for its unique prompt, independently checking that it had not been dispatched.

Both relaunches preserved the displayed access mode. This fixture has no saved file grants, so this trial does **not** independently certify a previously granted file operation after interruption. No history, permission records, recovery records, projects or files were deleted or modified by the model requests.

## Timing observations

Existing content-free `turn.complete` instrumentation measures from the voice-loop's start immediately before `core.handle` to the first nonempty text delta. It includes Core/provider setup; it excludes time before that boundary and native rendering delay. Model completion is the duration of `core.handle`, excluding subsequent speech playback. Runtime readiness is the native supervisor's existing readiness measurement.

| Observation | First text | Model completion | Request ID |
| --- | ---: | ---: | --- |
| Recall after first normal relaunch | 5.783 s | 6.028 s | `C4836A83-2293-4D84-8201-64D4B401A20D` |
| Recall after quitting during generation and relaunching | 5.360 s | 5.696 s | `138680CA-9303-4498-BD48-7F6E3EAFDE37` |
| Warm follow-up using the first recall prompt again | 2.651 s | 2.880 s | `E1F7DC26-561C-4AB9-86C5-5DF704E78A90` |

Runtime readiness was 2.104 s and 1.835 s on the two relaunches. Both first provider requests logged `session.open` with `resume:true`. These are individual Opus 5.5 observations from a growing saved conversation, not a controlled benchmark, cache-stability result, cold fresh-chat comparison, percentile or proof of an optimization. No instructions, tools, history or permission state were trimmed.

## Remaining acceptance

Normal quitting cancels work gracefully; it does not exercise an unexpected host/native crash or power loss. Provider failure, repeated crash cycles, saved file-grant continuity and a fixed repeated latency benchmark remain open. Existing generic held-input uncertainty wording is conservative; the independent journal check here found no dispatch for the queued fixture. No new recovery defect requiring a code change was found in this bounded check.

App left Ready in the fictional daily chat with an empty composer, one held fictional follow-up and its stopped checklist request retained in Recovery. Nothing was automatically retried. Broader workflow evidence and cursor limitations remain in [workflow fixes](workflow-fixes.md).

## Follow-up: unexpected runtime exit and exact-file permission

**Unexpected runtime recovery passed in two bounded trials.** Activity Monitor was used to Force Quit only ATOM's runtime process, after independently matching its PID and parent to the native supervisor's logged child. The first answer completed before the interruption; that run is idle recovery evidence only. Its unrequested exit 137 at 15:51:36.300Z was followed by a one-second restart delay and readiness at 15:51:39.333Z (3.033 seconds total).

For the second run the confirmation was staged before starting the request. ATOM displayed Thinking at zero seconds, and its runtime was stopped less than one second after durable admission. The host journal records request `AEC4063B-78FA-4423-A22F-2D6E0C699934`, accepted 15:53:00.014Z, as Interrupted at 15:53:02.493Z, not archived or dismissed. Runtime exit 137 at 15:53:00.859Z was followed by readiness at 15:53:03.707Z (2.848 seconds total). The full window stayed open, its exact `UNSENT Cedar in-flight recovery draft 24 October.` survived, and the existing queued fixture remained held with zero dispatched attempts. Recovery visibly listed Interrupted and showed the correct original prompt. Neither run blamed settings or automatically repeated the request. This is not power-loss or repeated long-duration crash certification.

**Exact-file grant continuity passed.** Created only the fictional `Cedar permission continuity 24 October.txt` in the existing Documents acceptance fixture, outside this chat's project root. Task 33 used Read/Edit/Read; the Edit displayed the expected exact-file approval. Chose Allow for chat, then independently verified `Revision: two` and one canonical file-permission record. After both unexpected exits, task 34 changed it to `Revision: three` without another approval. Host diagnostics show its Edit allowed, not asked; independent file inspection matched and preserved the first line. Both jobs finished Done and logged `committed:false`. No commands, pushes or computer tools were requested by these workers. The same exact grant persisted through the later signed rebuild. No other file or folder was granted.

**One Recovery UI defect corrected and live-verified.** The sheet retained a previous restore's success notice when reviewing another request, and kept the old detail visible while a new read was pending. `ForegroundRecoveryModel` now clears the notice when refreshing and clears the previous detail/notice before a new review. The existing request-ID response matching is unchanged. Release compilation succeeded (48.89 seconds); packaging used ATOM Local Signing, and strict signature verification passed. No Swift or TypeScript suite ran. Existing implicit-strong-capture and native-build-system deprecation warnings remain.

In the rebuilt app, reviewed Interrupted, restored it to the empty composer without sending, then reviewed the earlier Stopped request. The success notice disappeared and the accessibility tree contained the Stopped request's own prompt. Closed the sheet, verified the interrupted prompt remained unsent, then cleared only that test draft. The source recovery records were not dismissed. The signed app is Ready with an empty composer, both fictional task reports, one held follow-up, and the exact-file grant/fixture preserved.

Next remaining acceptance: provider failures, longer crash/recovery cycles and a fixed repeated latency benchmark. Cursor usefulness and physical motion/return acceptance remain last.
