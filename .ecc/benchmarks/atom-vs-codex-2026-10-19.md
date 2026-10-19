# ATOM vs Codex desktop: token and latency snapshot

Measured on 19 October 2026, Asia/Tokyo. ATOM revision `26ee5b8`.

**Finding:** ATOM used 52.2% fewer total input tokens, with an estimated 16.2% lower Standard API-equivalent cost. Codex completed fresh-chat responses faster; follow-ups were close. These are six short responses per app in the current installed configurations.

## Totals

| Metric | ATOM | Codex desktop |
|---|---:|---:|
| Successful responses | 6 | 6 |
| Workloads passing the supplied checks | 6/6 | 6/6 |
| Total input tokens | 101,156 | 211,842 |
| Uncached input tokens | 52,900 | 53,122 |
| Cached input tokens | 48,256 | 158,720 |
| Cached share of input | 47.7% | 74.9% |
| Output tokens | 119 | 113 |
| Estimated API-equivalent cost, all six responses | $0.005832 | $0.006956 |
| Median completion time, fresh-chat first response | 6.83 s | 4.12 s |
| Median completion time, same-chat follow-up | 1.65 s | 1.47 s |

The uncached input totals were almost identical: 52,900 vs 53,122. Codex reused more cached context, narrowing the cost difference substantially. Fewer total tokens did not translate into faster first replies in this run.

## Per-response evidence

| Workload | Turn | ATOM input / cached | Codex input / cached | ATOM completion | Codex completion |
|---|---:|---:|---:|---:|---:|
| Exact reply and recall | 1 | 16,741 / 0 | 35,282 / 22,144 | 7.147 s | 2.833 s |
| Exact reply and recall | 2 | 16,904 / 16,512 | 35,388 / 35,072 | 1.653 s | 1.297 s |
| Summary and recall | 1 | 16,787 / 0 | 35,216 / 22,144 | 6.551 s | 4.204 s |
| Summary and recall | 2 | 16,986 / 16,640 | 35,353 / 22,144 | 1.490 s | 2.067 s |
| Table and arithmetic | 1 | 16,781 / 15,104 | 35,242 / 22,144 | 6.827 s | 4.125 s |
| Table and arithmetic | 2 | 16,957 / 0 | 35,361 / 35,072 | 1.681 s | 1.469 s |

## Method and interpretation

- The same six prompt strings were checked for exact equality across apps. GPT-6 Luna (`gpt-6-luna`), Low effort, default service tier. Three projectless Codex chats and three new ATOM chats, each with an initial prompt and a follow-up. Existing app instructions and tool catalogs were retained.
- ATOM used its signed native desktop composer. Codex used actual local desktop chats submitted through the desktop chat tools, including their normal delegation wrappers. This was not `codex exec`, a bare API comparison, or a comparison against the long development chat.
- Benchmark model calls were sequential, with app order varied. Natural provider caching was retained. A new chat is not guaranteed to have a cold provider cache. The parent orchestration chat remained active.
- All responses passed the requested exact-text, recall, bullet, table and arithmetic checks. ATOM showed zero observed tool calls; the selected Codex rollouts contained no model tool calls. These very small prompts do not establish quality on real coding or long conversations.
- ATOM input in the usage database excludes cached input; this report adds it back. Codex input already includes cached input. Output includes reasoning when reported; Codex reported zero reasoning tokens, and ATOM does not retain that breakdown.
- Timing uses ATOM foreground attempt creation through completion persistence and Codex host task duration. The boundaries differ slightly and exclude independently measured UI rendering. ATOM model times are also retained in the JSON. Codex first-token telemetry is retained, but ATOM has no equivalent, so no first-token winner is claimed.
- ATOM fresh responses took 6.55–7.15 s; Codex fresh responses took 2.83–4.20 s. Follow-ups took 1.49–1.68 s in ATOM and 1.30–2.07 s in Codex. These ranges and medians describe three observations each; they are not stable performance guarantees.
- The first Codex attempt hit the usage limit before the account window reset. It produced no reply and is excluded from totals. It was retried in the same first benchmark chat, so that chat contains the failed request as well as the retry. No extra successful responses were generated.
- No additional per-chat usage records were found. An ATOM background conversation-note attempt failed with “Conversation notes need the Claude plan” during a chat switch. This run does not establish the cost of successfully generated background notes.

## Cost estimate

Standard API-equivalent rates: $0.10 per million uncached input tokens, $0.01 cached input, $0.125 cache writes, and $0.50 output. All cache-write counts here were zero. Rates checked against [official OpenAI documentation](https://developers.openai.com/api/docs/models/gpt-6-luna) on 19 October 2026.

`estimate = (uncached_input × 0.10 + cached_input × 0.01 + cache_write_input × 0.125 + output × 0.50) / 1,000,000`

Both apps used signed-in Codex access. These numbers estimate equivalent API consumption; they are not subscription invoices, actual incremental charges, or measured subscription-credit conversion. A zero-dollar ATOM dashboard entry for this model does not mean zero provider consumption.

## Recommended next work

Measure ATOM fresh-chat setup stages and first-text latency, then reduce the measured startup delay. Investigate cache stability: the last ATOM follow-up had zero cached input despite two earlier follow-ups reusing almost the entire prompt. Its roughly 16,700-token first-turn context also warrants a breakdown before trimming instructions or tool descriptions. Preserve chat history and permission continuity while optimizing.

No app source was changed or rebuilt for this measurement. The original ATOM chat and its Haiku model selection were restored. The three benchmark chats in each app remain available for review.

Raw prompts, replies, timestamps, counters, excluded failure and calculation metadata are in [the JSON baseline](atom-vs-codex-2026-10-19.json).
