# Read-only preparation with the daily brief

22 October 2026 · ADR-191 · compiled implementation; acceptance deferred

Extend the daily brief with optional prepared work, using its existing source categories, schedule and Dashboard. This first scope prepares an agenda, checklist, draft or review note from captured excerpts. It does not add an independent knowledge harvester, mail reader, research browser, privileged wake helper or execution queue.

## Opt in and bound the work

Settings → General → Daily brief → Prepare work for review is off by default. Selected Calendar events, open Reminders, weather, finished-task titles, pending-review counts and timers remain the existing brief inputs. Preparation adds no chat/history/notes search, account connection, screen collection or file permission. Existing brief source truncation and per-category limits remain; cards identify these as excerpts rather than complete/live records. Invalid text and likely credentials are excluded from the preparation input using existing validators/heuristics, which are not guarantees of complete secret detection.

When enabled, Brief me or the existing enabled daily-brief schedule can prepare up to three cards. One isolated selected-chat-model Claude/Codex Gateway job produces both brief lines and cards, replacing the ordinary brief model job for that run. It uses low or supported-default effort, no inherited session/tools/project/MCP/settings, no automatic model/provider fallback and no local-model download. Gemini and unavailable/unsupported selections get a plain brief with a preparation-unavailable status. Nothing is collected or dispatched by changing the setting alone.

The visible daily budget defaults to two preparation admissions, adjustable from one to five per local day. An atomic SQLite admission counter is durable across restart and pause/enable. Failed, cancelled and pre-dispatch-rejected admissions count conservatively; the budget is not an exact token/dollar meter. Short empty-source runs make no model request. An exhausted budget produces a plain brief and status without calling a model. Pausing the preparation switch does not turn off the ordinary daily brief.

One brief/preparation run is active at a time. Pause, preference changes, foreground chat and runtime close cancel preparation; source gathering checks cancellation between existing reads, while an already-started native read may finish. Late model results check cancellation and the captured configuration before publication. A preparation job has a 90-second model deadline and Claude allows at most four SDK turns. Input/output host budgets are 24,000/12,000 JSON UTF-8 bytes, not exact tokenizer/provider-output limits. Background summaries are interrupted before preparation, and summary admission is skipped while a brief is running. The existing schedule may try again if cancellation prevented any brief save; every new preparation admission still consumes the same daily budget. Closed runners do not run on later timer ticks.

## Sources, review and authority

The model returns inert title/body text plus one to four source IDs per card. The host resolves IDs exclusively to the captured inputs; the model cannot invent source snapshots, timestamps, actions, recipients or command structures. Validate output shape, sizes, hidden controls, known references and a credential heuristic. Citations prove which excerpts were supplied, not that the model's interpretation is correct. Instructions tell the model to avoid invented facts/urgency/commitments, preserve uncertainty and distinguish assistant claims from verified execution. Original sources and deterministic approval records stay authoritative.

Dashboard → Prepared for review shows the newest status and the most recent available successful cards within the loaded brief history, with capture time and generating provider/model. A failed or budget-limited run does not overwrite earlier successful cards. Older cards are explicitly labeled unrefreshed; paused preparation retains saved cards. Review and edit opens a separate snapshot editor with the supporting captured excerpts. Title/body inputs have no user-text length cap. Copy edited text is manual clipboard output only. Closing discards those edits, and Restore generated text explicitly replaces the local editor text. There is no automatic save-back, paste, send, task creation, approval, URL opening or tool invocation.

Cards are stored as an additive JSON column beside the existing brief, with its existing 14-day retention; the native list loads the newest 14 brief entries. A damaged derived payload is dropped/statused without hiding ordinary brief lines. Cards do not become chat history, standing memory, permissions, source-file changes or an automatic routine. Only ordinary brief lines follow existing Telegram/speech/notification settings; card payloads are never delivered through those paths.

The admission ledger retains recent local-day counts (approximately 30 days). Content-free diagnostics record source/card counts, bytes and generating model/provider. Existing background usage accounting records actual provider usage. Prepared text/source snapshots and raw provider errors are not logged.

## Evidence and remaining work

TypeScript checking and Swift release compilation are intermediate compiler evidence only. Keshab requested tests at the end of the adaptation plan, so no tests, live model/source reads, fixture runs, app installation/restart or changes to existing user state occurred here. [Deferred acceptance cases](sentient-adoption-validation.md) cover source admission, cancellation, budget races/restart, raw provider requests, retention, native review/copy and permission/history preservation. No speed/cost improvement or full Sentient research/execution parity is certified.

Broader reviewed knowledge discovery, reader formats/accounts and explicit authorized task handoff remain later extensions. The next independent adoption capability is resumable background source analysis using existing task/checkpoint/scheduling infrastructure.
