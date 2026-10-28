# ATOM chat startup measurement and optimization

Measured on 19 October 2026 with the signed ATOM desktop, GPT-6 Luna (`gpt-6-luna`), Low effort and the existing default service tier. Two variants and twelve successful model responses were the maximum scope. Raw counts, prompts, replies, request ids, per-stage times and failures are retained in [the measurement ledger](../.ecc/benchmarks/atom-startup-2026-10-19.json).

## Result

| Measurement | Instrumented baseline | Final implementation |
|---|---:|---:|
| Setup through verified session readiness | 4.18 s | 1.32 s median |
| First model text delivered to Core | 8.19 s | 5.34 s median |
| Core completion | 8.39 s | 5.48 s median |
| First-turn input tokens | 16,737 | 11,594 median |

The baseline is one instrumented fresh chat after restarting ATOM. The final implementation has three fresh chats: one after restart and two while the app was running. Final setup ranged from 0.23 to 1.94 seconds and first text from 4.43 to 6.73 seconds. These are small, descriptive samples, not p95 measurements or guarantees. Process warming and provider/network time vary. First text is the first nonempty model chunk at Core, not independently measured native window paint time.

## Stage evidence and variants

| Stage | Baseline | Config-read variant | Final, first chat after restart |
|---|---:|---:|---:|
| Transport creation | 2 ms | 2 ms | 2 ms |
| Codex initialization | 663 ms | 510 ms | 498 ms |
| Inherited configuration inventory | 2,461 ms | 19 ms | 42 ms |
| Standalone skill discovery | included in provider setup | included in provider setup | 65 ms |
| Thread creation | 1,037 ms | 1,259 ms | 1,309 ms |
| Active-thread policy verification | 6 ms | 11 ms | 16 ms |
| Total readiness, including local work | 4,182 ms | 1,813 ms | 1,944 ms |

The baseline called `mcpServerStatus/list` without a thread to discover inherited server names. That discovers connections and tools before ATOM can disable them. The first variant uses `config/read` for the same working directory, disables configured MCP and plugin entries before `thread/start`, then retains the mandatory active-thread inventory check. Malformed or unverifiable configuration refuses before a model turn. The measured slow inventory operation is eliminated; external tool access is not enabled to obtain the speedup.

The second variant discovers Codex's standalone skills and disables those paths through thread-only configuration. The discovery observed 64 enabled user/system skills, outside ATOM's isolated native filesystem. They are distinct from ATOM's checked `atom_use_skill` and worker skill tools. No global Codex setting or skill file is written. Existing ATOM tools, assigned skills and instructions are preserved.

The final three samples still spent 3.37–5.41 seconds between session readiness and first model text. This measurement does not separate provider computation, transport, routing or queue time within that interval.

## First-turn context breakdown

| Local component | Observed size |
|---|---:|
| Standing ATOM instructions | 1,678 bytes |
| First-turn extra context | 2,139 bytes |
| First user message, as history JSON | 127 bytes |
| Serialized turn text, including context and labels | 2,344 bytes |
| ATOM tool specifications, before provider framing | 22,101 bytes / 37 tools |
| Largest specification, `atom_delegate` | 4,408 bytes |
| Discovered standalone Codex skill metadata JSON | 41,448 bytes / 64 skills |

These rows overlap: serialized turn text already includes the first message and extra context; the largest tool is included in the tool total. Skill discovery metadata is not the exact text rendered to the model. Byte counts must not be interpreted as token counts.

Removing only the inherited skill catalog after the startup variant reduced provider-reported input from 16,738 to 11,594 tokens for the same first prompt, about 5.1K tokens or 31%. The time line changes between requests and may account for a few tokens. The remaining roughly 11.6K tokens include provider framing/context and cannot be assigned exactly to local components with the available counters. ATOM's 37 tool definitions, standing instructions and first-turn context sizes remained identical across the measurement. No description or policy instruction was shortened.

## Cache investigation

New `codex.turn` diagnostics retain both raw cumulative `total` and per-request `last` token counters, alongside the session reuse/restart reason. All twelve records reconciled against ATOM's usage database. A protocol check also exercises a genuine zero-cache second turn on a reused thread, including duplicate usage notifications, without mistaking it for a restart or dropping its uncached input.

All four final follow-ups reused their live session without a prefix restart. They reported 11,392, 11,520, 11,392 and 11,392 cached input tokens. First text arrived in 1.04–2.13 seconds. The saved pre-upgrade chat opened separately and recalled its old facts correctly.

The cause of the earlier benchmark's zero-cache follow-up is **not established**: it did not retain raw per-request counters or session restart metadata. There is no evidence here of an accounting subtraction error or an unexpected restart. Stable session reuse does not guarantee a cache hit; OpenAI describes caching as matching the rendered prefix against an available cache entry. See [official prompt-caching documentation](https://developers.openai.com/api/docs/guides/prompt-caching). This change does not control provider cache placement or promise that misses disappear.

The reuse signature now checks complete tool definitions, including descriptions and schemas. A real definition change deliberately reopens with the saved transcript; it does not silently retain stale tools. Per-request time, context and continuing-file-grant notices remain appended to the user turn rather than rewriting standing instructions.

## Continuity and verification

Validation:

```sh
pnpm typecheck
node --test services/llm-gateway/src/providers/codex-session.test.ts apps/mac/src/codex-tools.test.ts apps/mac/src/native-core.test.ts apps/mac/src/voice-loop.test.ts
```

Type checking and 55 targeted checks passed. They cover no global configuration writes, pre-model refusal of malformed discovery or unverified policies, native permission refusal, cancellation, tool-schema/transcript replay, first-text timing, raw usage accounting and actual temporary-file host edits using fake model RPC. Explicit same-chat/file grants persist between worker sessions; another file or chat asks again, and cancelled approvals cannot create a grant or write later. This is not a new live model file-edit/grant test.

Twelve live responses completed. Ten matched their expected exact text; two word-position quizzes returned `benchmark ready` instead of `Cedar benchmark`. These failures are retained, not excluded. Direct quotation of the first reply passed in all three final chats. Reopening the pre-upgrade notebook chat returned `Cedar: 22` and `Birch: 17`, and its four original archived messages compare byte-for-byte with the earlier benchmark evidence. These checks demonstrate saved context availability, not universal model recall accuracy.

Logs contain counts, durations, tool names and request ids, without prompt text, arguments, configuration, skill paths or credential values. The baseline evidence deliberately includes only fictional prompts/replies. No production source file or permission-store schema was changed outside the chat provider/timing path. The existing signed app loads its runtime from this checkout; it was restarted to activate the changes. Its original chat, Haiku selection and empty composer were restored.

To repeat the measurement, restart ATOM, open a new projectless GPT-6 Luna chat, send the first prompt from the ledger, then quote the first reply on a follow-up. Correlate `codex.turn` and `turn.complete` by `requestId`, and compare usage against the matching chat in the local stores. Repeat while ATOM is running to distinguish startup warming from provider variation. Never copy private chat or configuration text into shared evidence.

Rollback is limited to the provider bootstrap changes; instrumentation can remain. Do not remove the final policy check or disable file-grant gates as a performance shortcut.
