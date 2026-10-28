# Shared optional-context budget

26 October 2026 · Third bounded slice of [ATOM-native OMH orchestration](omh-native-orchestration.md).

## Outcome

Use one deterministic UTF-8 composition kernel for chat background, worker handoffs and plan-status inspection. Allocate the payload as a whole rather than independently admitting every optional block. Retain user instructions and policy guidance; reduce only host-classified optional material or expand a prerequisite from its retained minimum summary when room permits.

This is a context-payload budget, not a model token meter, a provider context-window limit or a new user input limit. It does not shorten tool definitions, edit transcripts or change permission records.

## Parts and selection

`services/helpers/src/context-budget.ts` is a pure composition boundary with three part types:

| Part | Preservation rule |
| --- | --- |
| Required | Keep the complete text. No fallback or omission. |
| Support | Keep at least the supplied minimum summary; retain the larger body when it fits. If the full text is already shorter, keep it as the minimum. |
| Optional | Keep the full block or its host-supplied fallback when it fits; otherwise omit the block whole. |

If every full block fits, preserve all text in its original order and add no omission notice. Otherwise reserve the required/minimum payload and a fixed disclosure, then consider larger/optional blocks by descending host priority and original-order ties. Selection priority does not reorder the rendered text. The kernel does not call a model, network, clock, filesystem or storage API.

The fixed disclosure says background was shortened/omitted, asks for original details before relying on an incomplete summary and states that permissions/history are unchanged. Protected content and disclosure can exceed the nominal limit; `overLimitBytes` reports this rather than hiding it by clipping instructions. All byte accounting includes composition separators and the disclosure when present. No budget-driven substring slicing occurs.

Duplicate/invalid host IDs, unknown part types, invalid budgets and incomplete support summaries refuse composition instead of silently dropping an unknown source. The host supplies classifications; source text cannot promote itself to a required instruction or create authority.

## Chat integration

Claude's native session path and the shared text/Codex provider path use a **16,384-byte** target for the composed contextual payload. Opening and turn background share that same allocation with these protected parts:

- User-selected skill/command instructions and the user-maintained Chat brief.
- Permission/access-mode guidance, including revocation, Chat only and Full access notices.
- Current-chat continuity, replay/truncation notices and the current-chat project digest.
- Selected memory facts, memory guidance, time and explicitly pointed window text.
- Existing addressed-worker and response-format guidance where applicable.

Automatically retrieved kept-chat hits are optional, with priority 100; unrelated recent conversation episodes are optional, with priority 60. The project digest is **required** because inspection showed it describes the current chat, not broad project discovery. Original selected/imported notes, stored facts, source documents and conversations are not modified or deleted by omission of a contextual block.

The runtime supplies typed `contextParts`/`openingParts`. Other callers can retain the old opaque string callbacks; their content stays required because the compiler cannot safely infer which embedded instructions are optional. Structured callbacks take precedence, so pointed-window text is not consumed twice.

Standing system instructions, project/attachment authority notes, user messages, replayed conversation messages, attachments, tool schemas, actual tool results and images stay outside this payload allocation. Existing replay/attachment/tool policies continue to govern them. This does not certify a cap on total provider input or claim that every optional source is integrated already.

## Workflow integration

Worker handoff context uses an **8,192-byte** target shared by the existing goal/format guidance, the complete task contract and prerequisite results. Each available prerequisite keeps at least its bounded summary; larger bodies compete for the remaining room. Existing per-report/goal excerpt bounds remain in place. Missing reports are not invented, and original reports remain in the helper store.

The actual task text remains outside this allocation and is passed intact under the existing plan validation. A budget overrun cannot drop a contract's scope, verification criterion or stopping condition. It cannot change readiness, concurrency, worker identity, the selected model or file/MCP policy.

`plan_status` uses the same workflow target. Compact states, the explicitly inspected contract and evidence summaries are retained. Large inspection-receipt details can fall back to the existing summary, which still says no independent task verification is recorded. Full evidence remains available in the task view/store. Ordinary status does not expand all contracts or all receipt histories.

## Receipts and prefix stability

`atom.context-budget/v1` receipts record the target, minimum bytes, actual rendered bytes, overrun and each source's full/fallback/omitted selection, offered/retained byte counts and a closed reason. `chat.context_budget` logs these with request/chat identity; `plan.context_budget` logs them with plan/portion or status phase. Neither log contains source text, file paths, credentials, prompts or model output. This is grouped composition telemetry, not a complete per-memory recall/delivery diagnosis.

Keep source order stable. Do not put changing counters, timestamps or random budget IDs in the model-facing disclosure or standing prompt. Existing session keys, tool schema reuse, provider/model choices and archive handling are unchanged. This preserves the existing prefix design, but cannot guarantee cache hits.

## Validation status and limits

`pnpm typecheck` and `git diff --check` pass. This slice changes TypeScript composition only; no native rebuild is required to compile new Swift code. No test suites, model benchmark, runtime restart, app installation, live acceptance, commit or push were performed. Token/cost/latency savings are unmeasured.

At the agreed end-of-adaptation verification stage, cover:

1. Exact preservation when all parts fit; stable ties/order; full UTF-8 accounting with Japanese and emoji.
2. Required content exceeding the target, zero-room cases, disclosure overhead and truthful overrun counts.
3. All available prerequisite minima retained; correct body-to-summary fallback; contracts unchanged.
4. Duplicate IDs, invalid classifications/budgets and unsupported host payloads refusing safely.
5. Both provider paths, warm/resumed/restarted chats, explicit skills/briefs and pointed-window consumption once.
6. Chat only/access modes, exact-file grant/revoke and original history/draft continuity.
7. Plan status keeping evidence uncertainty while omitting bulky details.
8. Controlled same-model first-text/token/cache comparison, including cases where all blocks already fit and no reduction should be claimed.

Slice 5 adds persistent saved-fact selection and group-level composition/outcome receipts alongside this compiler; [coverage and limits](omh-memory-receipts.md). Semantic workflow/skill routing, provider tool-catalog pruning, a full context-window allocator and broader per-memory eligibility/use diagnosis remain later work. No additional model inference or dependency was added.
