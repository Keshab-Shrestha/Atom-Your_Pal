# Provider rejection recovery and repeated chat latency

Actual native-app checks, 24 October 2026 Japan time (23 October UTC in logs), continuing the fictional Cedar daily chat `97263cad-9415-4545-b439-16d33b0cfd0c`. No application code changed, build or test suite ran, or commit/push occurred in this batch. Existing history, exact-file permission and held input were preserved. Cursor testing remains deferred.

## Provider rejection and explicit retry

Temporarily selected the deliberately unavailable custom model `cedar-nonexistent-recovery-model-20261024` for this fictional chat only, through the existing model picker. No credentials, network settings, global model choice or provider software changed.

The fictional request failed visibly after two seconds with `claude-plan: Claude rejected the request (model_not_found).` The host classified it at stage `model`, kind `bad_request`, `retryable:false`. Request `A8F0A67F-F016-4679-9C71-7EBFA4720137` remains Failed, unarchived and undismissed in the recovery journal. Its full original prompt and acceptance model were retained. The composer preserved `UNSENT Cedar provider-failure draft 24 October.` and the existing queued fixture stayed held.

Restored Opus 5.5 through the chat picker. Review retry refused to replace the occupied composer and showed “Keep or clear the existing draft before preparing a retry.” After clearing only that fictional draft, Review retry restored the original failed prompt **without sending it**. Explicitly clicking Send produced `CEDAR_PROVIDER_READY`, with zero observed calls. The new request, `91AC5F88-850B-4F00-A1E4-3A0FAAA89175`, completed on `claude-opus-5-5`; first text was 4.408 seconds, Core/model completion 4.453 seconds. The failed record was not overwritten by the new attempt.

This verifies an actual provider model-rejection response and recovery in a resumed chat. It does not certify network timeouts, rate limits, expired authentication, partial-stream failure, all providers or automatic retry safety.

## Fixed repeated latency observations

Sent the following identical fictional prompt ten times through the native composer, serially, on the existing saved chat with Opus 5.5, thinking Off and Saved permissions:

> Cedar fixed latency trial 24 October. Calculate 11 + 7 and reply with only the number. Do not use tools, save memory or change files.

The expected reply was exactly `18`. Kept all history and prompt/tool definitions intact. This was an already-running provider session: no `session.open` occurred during these ten samples. There were no active background jobs. Completion IDs were matched to the foreground journal's chat/model and saved assistant reply. The existing content-free `usage.turn` immediately preceding each serial completion supplied the token counts; it has no request ID, so this association depends on that idle, serial scope. Native work rows supplied observed-call counts.

First-text timing is the existing `turn.complete.firstTextMs`: from immediately before `core.handle` to the first nonempty text delta. It includes Core/provider setup but excludes earlier native admission and final native rendering. These are warm follow-ups in one growing conversation, **not fresh chats, a Codex comparison, a cost estimate or a before/after optimization experiment**.

| Measure | All 10 samples | 9 compliant samples |
| --- | ---: | ---: |
| Median first text | 2.516 s | 2.300 s |
| First-text range | 2.058–8.587 s | 2.058–5.326 s |
| Median Core/model completion | 2.549 s | 2.337 s |
| Exact-output compliance | 9/10 | 9/9 |
| Aggregate reported cache-read share | 98.43% | 98.40% |

Cache-read share is `cacheRead / (input + cacheRead + cacheWrite)`, not a dollar saving or a prefix-identity guarantee. All ten samples reported nonzero cache reads; no earlier zero-cache follow-up was reproduced. Across all ten: 288,772 cache-read tokens, 4,588 cache-write tokens, 22 uncached input tokens and 379 output tokens. Provider usage can aggregate multiple model calls inside a turn; these totals are not the size of one prompt.

**The first sample failed instruction compliance and remains in the results.** It returned `18` plus an apology for loading the clock tool despite “no tools.” The work row reported one observed call; it loaded a tool description rather than running the clock action. It took 8.587 seconds to first text and reported 341 output tokens. The following nine returned exactly `18` with zero observed calls. The failed sample is not silently excluded from the all-sample figures, and a correct arithmetic answer alone is not counted as a pass. This exposes a model behavior limit in Saved permissions; the existing explicit Chat only mode is the host-enforced tool-free option, with saved grants suspended rather than removed. That mode was not selected during this baseline.

[Raw per-request timing/token samples](live-latency-samples-2026-10-24.csv) retain every sample and its compliance flag. With only ten serial samples, do not present a population percentile, broad reliability score or causal speed improvement.

## State and next step

ATOM is Ready in the same fictional chat, with an empty composer, Opus 5.5, thinking Off and Saved permissions. The held follow-up still has zero journaled attempts; the exact-file grant remains and its fictional file still reads `Revision: three`. The failed provider request and prior interrupted request remain available for review. No fixture was deleted and no request was automatically replayed.

Next bounded check: verify the existing explicit Chat only mode blocks tool use while preserving history and saved file grants, then restore Saved permissions. Remaining broader acceptance includes transient provider failures, longer recovery cycles, fresh-chat speed and the deferred cursor usefulness/physical-motion check. This batch does not certify release readiness or an overall 8/10 rating.

## Follow-up: Chat only and saved-grant reactivation

Completed later on 24 October Japan time, with UTC log timestamps around 20:46–20:49 on 23 October. Used the same fictional chat, Opus 5.5 and thinking Off. No application code, builds or test suites changed/ran, and nothing was committed or pushed.

1. Selected **Chat only** through the composer access menu. Explicitly requested the current-time tool and a worker edit to the already-granted fictional file, while requiring Chat only to remain selected. ATOM refused both actions in one sentence, explaining that the mode blocks them. The native row showed zero observed calls; independent inspection found no new worker (only earlier tasks 33/34), the file unchanged at `Revision: three`, and its one exact-file grant still present.
2. Entered `UNSENT Cedar Chat only restart draft 24 October.`, quit normally, verified process exit and reopened. The full window, same chat, Chat only mode and exact draft survived. The model catalog completed its normal refresh back to Opus 5.5/thinking Off.
3. Replaced only the test draft with a history question. ATOM correctly recalled **Saturday, south gate, 19 pieces of fruit**, with zero observed calls. The original corrected facts were not repeated in this request. The file grant remained stored after reopening.
4. Repeated the earlier fixed arithmetic prompt once in Chat only. The answer was exactly `18`, with zero observed calls. First text took 1.649 seconds and completion 1.704 seconds for request `B09B945C-29E6-47A7-9CDE-49741057D408`. This single follow-up is functional evidence, not a controlled speed improvement over Saved permissions. The boundary refusal's first text was 3.549 seconds (`3A0401E2-3ED0-431D-8B54-991CD56ABEF0`); post-reopen recall was 2.778 seconds (`633F1818-B4B5-41AE-8D8B-DA66D57D81AF`).
5. Restored **Saved permissions** through the access menu and verified persisted mode `checked`. Requested the next exact-file edit. Task 35 used Read/Edit/Read, all allowed without another approval, and changed only the fixture to `Revision: four`, preserving its first line. Independent file inspection matched, the exact grant remained, and the host logged Done/`committed:false`. No commands, pushes or computer actions were requested in the task.

This matches the existing host boundary: Chat only omits project/file context, exposes no ATOM tool specs or worker team, and its access policy refuses tool calls before ordinary native-tool admission. The actual model refused rather than attempting a bypass, so the live result is not a new adversarial security audit or cross-provider certification. Switching modes suspends grants; it does not delete them. A natural-language “no tools” request in Saved permissions remains different from selecting this explicit host-enforced mode.

The app is Ready, the fictional chat's composer is empty, and its original Opus 5.5/thinking Off/Saved permissions configuration is restored. The initial Settings → AI model view was restored without changing global model settings. Retained recovery records were not dismissed; no fixture was deleted. Held-message UI retention was not retested in this batch.

Next: transient-provider failure handling, longer recovery cycles and fresh-chat latency acceptance. The earlier noncompliant Saved-permissions sample remains a recorded model-behavior limitation; this check does not silently change defaults or claim that it is fixed in that mode. Cursor usefulness and physical-motion acceptance remain last.

## Follow-up: three fresh chats and a provider-process interruption

Actual UI checks later on 24 October Japan time, around 20:52–20:57 UTC on 23 October. Created three fictional chats in the existing Cedar Live Acceptance project. Each used the same fixed arithmetic prompt, Opus 5.5, thinking Off and Saved permissions, with a first request and immediate identical follow-up. The six replies were exactly `18`, each with zero observed calls. No application code changed, build or suite ran, or commit/push occurred.

| Fresh chat | First text, first request | First text, follow-up | First-request input tokens | Follow-up input tokens |
| --- | ---: | ---: | ---: | ---: |
| `96b701a2-f5d5-47ab-a0c9-1fc84fa08d91` | 2.460 s | 1.431 s | 8,241 | 8,552 |
| `9c8b5fe6-a6d7-4e45-8467-b3fbd4e78fbe` | 2.306 s | 1.412 s | 8,241 | 8,552 |
| `7c30fe27-db74-472b-861c-98de7852c584` | 2.856 s | 2.124 s | 8,241 | 8,552 |

First-request median: **2.460 seconds**; follow-up median: **1.431 seconds**. Timing has the same Core-to-first-text boundary described above. These are three fresh conversations in a warm running app/provider environment, not cold launches or a controlled before/after speed improvement. All first requests logged a new session with `resume:false`, and all had some cached input (4,361 / 8,239 / 5,367 tokens). Follow-up cache reads were 6,452 / 8,550 / 6,452; none was zero. A fresh conversation does not imply an empty provider cache.

The host-owned context-size diagnostics were identical across the three new sessions: **3,180 system-prompt bytes**, **19,189 ATOM tool-spec JSON bytes**, and **40 exposed tool names** in the diagnostic list. These byte counts do not include Claude Code's built-in schema sizes and are not per-section token attribution. The reported total logical input is uncached input + cache reads + cache writes; it includes more than those two byte-counted sections. Do not infer a reduction from an earlier different-model/context 16,700-token observation. No instructions, tool descriptions or chat history were trimmed. [All six raw samples](fresh-chat-latency-2026-10-24.csv).

**Local provider-process interruption passed before output.** Matched the third chat's newly started Claude CLI child (PID 66362) to ATOM's runtime parent (58194), then selected that exact PID in Activity Monitor before staging Force Quit. The host itself was left running. Sent a fictional `CEDAR_TRANSPORT_OK` request and entered a separate unsent draft, then interrupted only that CLI child before text or tools were observed.

Request `998987B6-1326-4258-B174-A0C74D108EB5` was admitted at 20:55:37.881Z. The session logged close/error at 20:55:38.084Z, then opened a fresh replacement with `resume:false` at 20:55:38.094Z. The existing bounded recovery path retried once using the saved transcript, since no text or tool action had been observed. The same host request completed and archived at 20:55:41.173Z; first text was 3.035 seconds, Core/model completion 3.251 seconds. The UI returned exactly `CEDAR_TRANSPORT_OK`, zero observed calls, and retained `UNSENT Cedar provider-transport draft 24 October.`. Runtime PID 58194 stayed alive; the interrupted child was gone. No credentials or network configuration changed.

Replaced only that fictional unsent draft with a conversation question. The replacement session correctly recalled that the prior addition was **11 + 7 = 18**, with zero observed calls. This confirms chat continuity through this provider-session replacement; it is not a claim of provider-side exactly-once processing. The request was intentionally side-effect-free. Remote timeouts/rate limits and failures after partial output or actions were not exercised by killing this local child process.

The original daily chat's exact-file grant remains stored, and its fictional file remains `Revision: four`. The three new fixture chats and their results were retained. Restored the original daily chat and Settings → AI model view, with Opus 5.5/thinking Off/Saved permissions and empty composers. No recovery record or fixture was deleted.

The bounded recovery/speed checks now cover normal reopen, quit during generation, host-runtime exits, a provider model rejection, explicit retry, a pre-output provider-process exit, chat-only permission suspension/reactivation and fresh/warm text timing. Next: one final daily/developer/computer workflow walkthrough, fixing only newly reproduced problems, before the explicitly deferred cursor usefulness/physical-motion check. Remaining fault-type and long-duration limits above still apply; this is not a blanket release certification.
