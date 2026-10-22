# Resumable imported-note analysis

22 October 2026 · ADR-192 · compiled implementation; acceptance deferred

Second brain → Sources offers optional analysis of copies already imported into Second brain. This first scope produces per-chunk summaries/open questions for human review. Folder refresh stays explicit. No filesystem scan, account reader, source/note write, action task, automatic knowledge consolidation or general model installation is added.

## Admission and model

Analyze imported copies explicitly starts a job with the displayed selected Claude/Codex model and low/supported-default effort. Daily scheduling is separately opt-in and off by default. Enabling it pins the reviewed model for future scheduled jobs; changing time/budget preserves that pin. Use selected model for future scheduled jobs explicitly changes it. Resume keeps the existing job's displayed model. Unsupported/unavailable models cannot silently select another provider or local backup.

Admit at most 500 current/locally corrected imported copies and 8 MiB of titles/text. Count skipped missing, conflicting, deleted, invalid/likely-credential or oversized copies. User editors remain uncapped; these are analysis-compute bounds. The manifest stores IDs, hashes and character counts, not another copy of the source text.

Each isolated Gateway request receives one Unicode-safe chunk of about 14,000 JSON-encoded UTF-8 bytes, original note ID, UTF-16 offsets, total characters and source-copy check time. Bound the full request to 18,000 bytes and the report to 3,500 bytes. No inherited chat/history, project, tools, plugins/MCP, settings or source discovery. Use a 60-second model deadline and at most four Claude SDK turns. Validate text, hidden controls and the existing credential heuristic; these checks do not guarantee semantic accuracy or complete secret detection. Host byte limits are not exact tokenizer/provider-output limits.

Daily admissions default to three, adjustable from one to ten per local day. An atomic SQLite counter survives pause, Clear, source reconnection and restart. Failed/cancelled/pre-dispatch admissions count conservatively. Retain recent metadata-only daily counts for approximately 30 days. Existing background accounting records actual provider usage. No efficiency gain or exact token/dollar quota is certified.

## Progress and recovery

Existing file checkpoints protect edits/Undo. Read-only analysis stores progress/derived reports in additive tables in the existing memory database. Persist admission before dispatch; commit the report and next cursor in one savepoint after checking source membership, note hash and optimistic version. Recheck each copy against the manifest before dispatch. Changed/unavailable entries are skipped; new notes wait for a new job.

Reuse cached reports only for the same source, note content/state, offset and provider/model/effort, using a versioned hash. Reuse consumes no model admission. Retain at most 2,500 chunks and page five at a time. Capture/preparation times stay visible. Note edit/delete/exclusion invalidates affected reports; disconnect removes the source's analysis data. A stale copy is labeled. Nothing becomes standing memory, authority, a permission or a verified action.

Pause and disable schedule cancels owned work. Foreground chat, brief work, source refresh/disconnect and native note mutations interrupt analysis. Yield between chunks; inactive analysis adds no database read to foreground interruption. Runtime close/restart leaves interrupted work paused. Explicit Resume preserves finished chunks and may resend the unfinished request, whose earlier delivery can already have consumed tokens. Repeating the same resume UUID cannot dispatch it again. Errors never self-retry.

Paused/failed jobs block a fresh scheduled job until reviewed/resumed/cleared. A job paused before dispatch solely for budget can continue on a later eligible tick when scheduling remains enabled and budget is available. Clear confirms removal of derived reports/progress/scheduling, retains usage counts and keeps a monotonic version so delayed old Start packets remain stale. Late results cannot recreate a removed source/job or overwrite a changed note.

## Schedule and review

Reuse the existing 30-second brief heartbeat and routine due-time calculation. Runs require ATOM to be running; normal sleep/closure catch-up is subject to the job's pause/recovery state. No privileged wake helper, power setting, system schedule or duplicate worker routine. Foreground/brief work defers admission. Analysis interrupts automatic summaries before a call, and summaries are not admitted during analysis/brief work.

Sources shows budget, current/pinned models, note/offset progress, completed/reused/skipped counts and fixed host-authored failure guidance. Review/copy reports manually or open the original note. The private native channel correlates request IDs and checks source/version/job. It does not automatically resend timed-out mutations. Poll only the visible pane, preserving the selected report page; ignore late mismatched replies and clear pending state on runtime stop. Logs contain counts, sizes, model/provider and fixed failure categories, never paths, source/report content or raw provider errors.

TypeScript checking and Swift release compilation are compiler evidence only. No tests, live model/source operation, user-data migration, installation/restart or live-user-state changes occurred. Keshab deferred tests to the end of the plan; see the [combined acceptance gate](sentient-adoption-validation.md). Resumable document ingestion, protected readers and cross-source synthesis remain later extensions. Next independent capability: optional configured local backup through Gateway, keeping cloud inference primary.
