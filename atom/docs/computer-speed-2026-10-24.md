# Checked computer sequences — 24 October 2026

Implemented one bounded optimization: remove provider round trips between predictable button clicks while keeping a complete same-window observation after **every** click. The existing individual-action path remains available. No driver wait was shortened, no input was replayed, and no permission/history migration or local-model route was added.

## Controlled live measurements

Same retained chat `d2d95a1c-dfdb-4e79-a7da-6a0b78f72c92`, Claude Opus 5.5, thinking Off, Saved permissions, background mode. Calculator was already open on the secondary display, window `26107`. Every timed run listed windows, selected that exact window, and pressed **All Clear, 1, 3, Add, 2, 9, Equals**. Both new completed sequences were independently inspected through native accessibility: Last Expression `13 + 29`, Edit field `42`. Each run still made seven driver clicks and eight window observations, including the initial look.

Search budget: one implementation, one repeat baseline, two completed sequence trials and one separate cancellation trial. No broader optimization search or Swift suite.

| Variant | Core completion | Timed transport | Outside timed transport | Computer calls | Correct? |
| --- | ---: | ---: | ---: | ---: | --- |
| Historical individual actions | 53.232 s | 20.734 s | 32.498 s | 9 | Yes |
| Repeated individual actions | 56.008 s | 20.282 s | 35.726 s | 9 | Yes |
| Sequence A, with rejected malformed plan | 44.894 s | 18.805 s | 26.089 s | 4, including one rejection | Yes, after correction before input |
| Sequence B, clarified format / cancellation boundary | 37.462 s | 19.988 s | 17.474 s | 3 | Yes |

[Raw timings and request IDs](computer-speed-2026-10-24.csv). The best measured repeat was 18.546 seconds / **33.1% shorter** than the repeated baseline, and 29.6% shorter than the historical baseline. Trial A was 19.8% shorter than the repeated baseline, including the malformed-plan overhead. These are controlled samples, not a broad-app benchmark or a p95 claim. Prompts deliberately requested the respective individual/sequence path; the sequence prompts also supplied expected values. Ordinary task planning and other providers remain unmeasured.

The seven actual driver clicks still cost 16.405 seconds in B, versus 17.222 in the repeat baseline; observations cost 1.839 versus 1.662 seconds. Most of the improvement was outside timed driver calls, consistent with removing six provider round trips. That remainder includes provider planning, dispatch and serialization; it is not isolated model inference. Enumeration/cache/initialization state varied slightly between runs. A's window bounds changed during the task; the same window identity was retained, and no automation move command was sent. B's reported bounds remained x 2623, y 240. Bounds are never interpreted as primary-display coordinates.

First text was 31.748 seconds for the repeat baseline, 44.858 for A and 37.405 for B. The baseline streamed intermediate commentary; sequences first spoke near completion while the native activity display showed progress. **This change improves completion time, not measured first-text latency.** All clicks remained driver-unconfirmed. Exact fresh text transitions passed; they were not relabelled as driver-confirmed input or proof of arbitrary application semantics.

## Execution boundary

`computer.click_sequence` accepts 1–8 steps, each shaped as:

```json
{"button":"1","expect":{"label":"Edit field","value":"1"}}
```

The host validates the entire shape, delivery mode and label policy before input. Strings are bounded to 120 characters; extra fields, secret-labelled expectations, destructive labels and approval-requiring buttons are rejected. Consequential actions must use ordinary individual actions and their existing approvals. Chat access policy still gates the entire tool.

For each step, the host finds one enabled, exact-label `AXButton` in the latest observation, uses its current driver token through the ordinary click implementation, then captures the complete pinned window again. The expected read-only `AXStaticText` label must be unique with the exact untruncated value. For driver-unconfirmed input, that expected match must be new; an already-matching value cannot verify it. Suspected no-ops and unknown effects stop even if the value matches. Missing/ambiguous controls, mismatches, owner/generation changes, read/driver failures and cancellation stop the remainder. An input in progress at cancellation may already have taken effect. Nothing is automatically replayed.

Only the final window image/tree is returned to the model. Intermediate observations stay inside this action; no idle capture occurs. App/action/step counts may reach native progress; expected values, screen text and image bytes do not enter diagnostic events. Progress does not begin extra action lifetimes. The native activity surface displays e.g. “Clicking button 6 of 7 in Calculator”; Stop stays available.

In A, the model initially used `{button,label,value}`. The host rejected it with **nothing clicked**. The model then corrected the shape and executed seven clicks exactly once. The observation hint now includes the explicit nested format for resumed chats; the tool definition and schema descriptions include it too. This is validated dynamically by ATOM, not a new generic provider-schema system.

## Actual Stop and draft check

During B, a full native inspection at 30 seconds showed “Clicking button 6 of 7 in Calculator”, **Stop**, **Queue message** and the exact unsent draft. The completed reply retained that draft.

A separate cancellation request `22E0E450-91C7-4CAD-A910-128508B3DF5E` was stopped through ATOM's real Stop button. It returned Ready / “Stopped after 21s” and retained `UNSENT checked sequence Stop draft.`. Logs show four completed click/read pairs; the fifth click was interrupted after 550 ms and explicitly recorded as possibly applied. Independent inspection showed `13 + 2`, consistent with the in-flight fifth input already taking effect. No sixth or seventh click was sent. A second native inspection about 90 seconds later still showed `13 + 2`; the log contained exactly those five click attempts and no later click. The stored request state was `stopped`. Only the fictional unsent test draft was cleared; chats, grants and source fixtures were preserved. The original daily chat, its Opus/Off/Saved permissions settings, empty composer, sidebar filter and AI model Settings view were restored. A read-only database check confirmed the original exact-file grant remains present.

Cursor usefulness/physical acceptance remains deferred at the user's request. This trial does not certify its visual movement or primary-pointer position.

## Reproduce and roll back

In the running app, select the retained computer chat with the model/access settings above. First run:

> Use only computer in background mode on the current Calculator window. List its windows and look at the exact window_id. Click All Clear, 1, 3, Add, 2, 9, Equals as seven individual click calls with look_after each time; do not use click_sequence. Do not open, move or activate windows, use keys, or use other tools. Verify the display and report one short sentence distinguishing observations from driver confirmation.

Then repeat with the same buttons using `click_sequence`, expected label `Edit field` and values `0`, `1`, `13`, `13 +`, `13 + 2`, `13 + 29`, `42`. Stop on mismatch without replay. Observe the exact final expression/result independently, and compare `turn.complete.modelMs` for the corresponding request IDs. Sum `computer.transport.durationMs` only within each serial turn's interval (completion timestamp minus modelMs through completion). Do not use firstTextMs as time to verified result or sum usage across concurrent requests.

Validation commands:

```sh
pnpm typecheck
node --test --test-reporter=dot services/tool-engine/src/computer/tool.test.ts services/tool-engine/src/computer/sequence.test.ts apps/mac/src/computer-bridge.test.ts
git diff --check
```

Typecheck and all 123 focused TypeScript tests pass. Coverage includes malformed whole-plan rejection, exact/fresh tokens, final-only image delivery, mismatch/no-op/ambiguous-value halts, restricted buttons, mode/ownership/generation protection, cancellation and balanced progress lifetimes. The running native app was relaunched to load the updated TypeScript runtime; no native rebuild was needed and no Swift suite ran.

Rollback: remove the `click_sequence` action/description/step field and sequence branch, `readings` helper/state, `onProgress` wiring and numeric progress extension. Existing individual `click` with `look_after` remains the fallback without any data migration. Keep other earlier workflow fixes intact. No commit or push was performed.
