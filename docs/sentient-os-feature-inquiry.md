# Sentient OS feature inquiry and comparison with ATOM

Reviewed 21 October 2026 (Asia/Tokyo). This document records the research snapshot. Keshab subsequently authorized adaptation; see the [current adoption plan](sentient-adoption-plan.md) for scope and delivery. Local general inference is optional backup, with remote models primary.

## Scope and evidence

- ATOM snapshot: `f63b00ac10d3eca2005efe0184c3be4794581c10` on main. Committed and pushed the completed Terminal capability before starting this inquiry, as requested. Remote SHA verified. Its existing 781 Swift checks and 40 visual comparisons were completed in the preceding implementation; they are not a Sentient comparison.
- Sentient source snapshot: `16e871ad43c19ca8b26ed36daf66baaa44e886e5`, main, dated 19 October 2026. Latest published release found: [2.5, published 19 October](https://github.com/Sentient-OS-Labs/sentient-os/releases/tag/2.5). The release notes mention a refreshed download with the same build number. Source inspection does not identify the exact contents of every installed build-14 binary.
- Read the current website/release notes, per-feature engineering documentation, relevant production Swift, and selected public issue reports. Reviewed a shallow source clone under `/tmp/atom-sentient-os-inquiry-20261021`; did not install, launch or execute Sentient, its scripts, a model, its root wake helper or its computer-use helper. No personal source database or account was accessed.
- **Code present** means there is a documented implementation and corresponding source. It does not mean independently verified in the running Sentient app. **Reported** means the project or an issue author says it happened. **Assessment** is my conclusion from those facts. No measured Sentient-versus-ATOM speed/cost result exists from this inquiry.

## Assessment

Sentient has a more coherent implementation of a **personal-context assistant**: selected sources → local triage → linked knowledge → contextual drafts and proposed work. ATOM has more explicit **project/task/agent controls**: multiple project chats, workers, approvals, checkpoints/Undo, Git review and the new Browser/Terminal surfaces. More controls do not establish better task outcomes, and a polished demo does not establish lower latency or token cost.

The most relevant gap for ATOM is how useful personal context is gathered and reused with little repeated briefing. It is not a missing constellation animation or another workspace tab.

## Feature inventory: what Sentient has

All rows are source-backed feature presence, not independent live acceptance. Conditions and limitations are intentional parts of the inventory.

| # | Feature | What is implemented / material condition | Evidence |
| --- | --- | --- | --- |
| 1 | Notch assistant | Click the notch, tap a configurable right-side key to type, hold it to speak; live progress and Stop. | [Sidekick][sidekick] |
| 2 | Screen-aware task handoff | User request, current display context and knowledge can ground a short task such as finishing a form. This is generic computer use, not a separate verified integration for every advertised app. | [Sidekick][sidekick] |
| 3 | Background app control | Native app-state reads, clicks, text input, files and navigation through OpenAI’s native helper. Current backends all use it; legacy CUA is not the active route. Background interaction remains app/focus dependent. | [Native runtime][native], [selection code][native-selection] |
| 4 | Existing browser sessions | Can operate the user’s logged-in browser through native computer tools. This is not an embedded browser pane or a promise of reliable arbitrary website automation. | [Native runtime][native] |
| 5 | One continuing conversation | Home, notch, voice and started proactive cards share durable SQLite history, replies, questions, outcomes and recovery state. One foreground computer task at a time. | [Conversation][conversation] |
| 6 | Automatic older-history summaries | Background, tool-disabled compaction plus exact-history search/read; source messages remain stored. Current context builder has byte budgets, not an unlimited prompt. | [Context code][context-code], [compactor][compactor-code] |
| 7 | Editable standing memory | Plain `SidekickMemory.md`, independent of the conversation and knowledge folder; atomic saves/conflict handling. Clearing chat preserves it and knowledge. | [Conversation][conversation] |
| 8 | Activity and in-notch replies | Expandable Worked for activity, app/step descriptions, questions and user answers directly in the notch; proactive action outcomes join chat. | [2.5 release](https://github.com/Sentient-OS-Labs/sentient-os/releases/tag/2.5), [Sidekick][sidekick] |
| 9 | Double Tap contextual reply | Screenshot + personal knowledge + writing samples → a draft pasted into the focused reply field. It remains unsent. Requires initial analysis completion and relevant permissions. | [Double Tap][double-tap] |
| 10 | Personal writing examples | One-time selected sent-message samples in editable `writingstyle.md`; not continuous style harvesting. Collection scope differs from regular analysis selections. | [Double Tap][double-tap] |
| 11 | Separate drafting provider | Double Tap independently supports covered cloud drafting, OpenAI/OpenRouter, Ollama/LM Studio and compatible Responses or Chat Completions endpoints. Needs image/context support. | [Double Tap][double-tap] |
| 12 | Bundled local understanding model | Gemma 4 E4B via vendored LiteRT-LM, Metal text/vision, speculative decoding, bounded context/output and batch engine reuse. The model downloads separately. | [Engine][engine], [production code][engine-code] |
| 13 | Folder/document understanding | Selected standard/custom folders; supported PDFs, Word, text/Markdown and images/saved screenshots, with depth/page/content/candidate limits. Not a continuous screen recording. | [Local sources][local-sources] |
| 14 | iMessage and WhatsApp | Opted-in conversations, DM/group attribution and bounded message windows read from local databases; protected readers need Full Disk Access. | [Local sources][local-sources] |
| 15 | Apple Notes and SiYuan | Local Notes extraction; SiYuan workspace/block/database rendering when installed and enabled. These sources have different edit-refresh behavior. | [Local sources][local-sources] |
| 16 | Local Mail and Calendar | Selected Apple Mail accounts and synced EventKit calendars. Local analysis works without ChatGPT/Claude subscriptions; Calendar reader is read-only despite macOS’s Full Access grant. | [Local sources][local-sources] |
| 17 | Hosted work connectors | Gmail, Google Calendar, Slack, Outlook Mail/Calendar through supported subscription backends, with source-specific reads and tool policies. Hosted data follows that provider path. | [Hosted sources][hosted-sources] |
| 18 | Direct OAuth MCP accounts | Granola and Notion catalog, PKCE/browser sign-in, Keychain grants, account generations, live tool inventory and per-run policy. Transport/account support is not proof of all knowledge-reader curation: Granola content curation remains unverified in the guide. | [Direct MCP][direct-mcp] |
| 19 | Generated linked knowledge | People/projects/preferences/commitments organized into Markdown notes and wikilinks. A chosen frontier model consolidates the local summaries. | [Knowledge][knowledge] |
| 20 | Portable knowledge files | Ordinary folder the user can inspect/edit outside the app; staged updates, atomic publication and a freshness check avoid overwriting concurrent user edits. | [Knowledge][knowledge] |
| 21 | Knowledge reader and graph | Constellation visualization plus folder tree, Markdown reading/editing, link navigation, creation, Trash and unsaved-edit guards. The graph is a view of notes, not evidence of perfect retrieval. | [Knowledge UI][knowledge-ui] |
| 22 | Proactive discovery | A summaries-based judge proposes up to eight candidates; a read-only research stage checks/prepares at most five cards. No automatic external execution during preparation. | [Proactive][proactive] |
| 23 | Reviewable prepared work | Editable message/recipient/plan/briefing, then explicit user-triggered connector/computer execution; progress/questions/result join the continuous chat. Once started, task execution does not ask again for every click. | [Proactive][proactive] |
| 24 | Overnight wake and analysis | Default 3 AM, configurable local time, manual/deferred analysis, a consented root wake helper, power/thermal gates, heartbeat/deadman and an awake ceiling. Root is for fixed wake operations, not model commands. | [Scheduler][scheduler] |
| 25 | Resumable ingestion | Per-source checkpoints, interrupted-work recovery, model reload/retry handling and analysis progress independent of visible windows. Existence of recovery code does not establish every long run succeeds. | [Engine][engine], [scheduler][scheduler] |
| 26 | Provider and reasoning choices | ChatGPT/Claude subscriptions or compatible custom/LM Studio/OpenRouter endpoints. Main custom path requires Responses support and a vision test. Speed slider chooses model/effort on subscription paths. | [Model choice][providers], [speed code][speed-code] |
| 27 | All-local inference option | Requires compatible additional model/server configuration for the frontier work and independent local Double Tap setup. Downloaded bundled reader alone does not make every AI stage local. Online tasks still need a network. | [Model choice][providers] |
| 28 | Optional cloud knowledge MCP | Encrypted upload plus tools for other AIs, including on a phone, to retrieve knowledge. Relay decrypts in memory for authorized requests; the private link is a bearer secret. It is not remote phone control of the Mac. | [MCP mirror][mirror] |
| 29 | Setup/health and Test & repair | Guided model/runtime/permission readiness, app-owned native read/screenshot/click/text probe, manual repair and optional report upload. Reports are distinct from conversation content. | [Native health][native] |
| 30 | Dependency preparation | Private Codex installation/home, signed helper validation, background dependency preparation at launch and bounded recovery. Avoids rewriting the user’s normal Codex settings. | [Native runtime][native] |
| 31 | App updates and lifecycle controls | Sparkle updates, launch-at-login, reset/uninstall and model/provider settings. Reset, remote deletion and service records have different retention boundaries. | [Updates][updates], [settings][settings] |
| 32 | Privacy filtering and observability | Source selection, local triage and narrow identifier checks, Keychain credentials, crash/usage diagnostics. Filters are not complete de-identification; some basic release telemetry remains after extended analytics is off. | [Security][security] |
| 33 | One-time personal briefing | A welcome letter synthesizes patterns from the built knowledge and can be saved as a keepsake. A product-generated provider task, not free local magic on every backend. | [Proactive][proactive] |

## Overlap with ATOM

ATOM evidence below is checked against the current repository, not the older README alone. Some capabilities have live workflow evidence; others have compiled/scripted evidence only. This is a depth/scope comparison, not a reliability score.

| Area | Sentient | ATOM now | Assessment |
| --- | --- | --- | --- |
| Personal context intake | Selected local apps/files plus hosted/direct sources feed an organized knowledge loop. | Facts, conversation notes, kept chats, project metadata and authored/agent-written Second brain notes. No equivalent broad automatic source-ingestion loop found. | Sentient is further developed here. |
| Notes and graph | Portable Markdown folder, wikilinks, reader/constellation. | SQLite-backed Second brain, Markdown bodies, links/backlinks/tags, auto-links and graph. | Both exist; portability and intake differ. No need to build a second graph to catch up. |
| Long-conversation continuity | One durable conversation, automatic compaction, original-history retrieval, standing memory. | Many persistent chats, bounded replay, own-chat search/read, explicit Chat brief, grants and durable drafts/recovery. | Both have continuity foundations. Automatic provider-neutral decision/history summaries are a worthwhile ATOM candidate. |
| Quick contextual reply | Screen + knowledge + one-time writing style; separate direct drafting path. | Selected-text/clipboard Quick actions and Ask ATOM editing; no equivalent integrated personal reply/style loop found. | Double Tap is a meaningful capability gap, not just a different shortcut. |
| Computer-use transport | Signed OpenAI native helper, current app-state recovery/diagnostics. | CUA-driver transport, deterministic app/action policy and approval cards. | Sentient has a different, developed integration worth evaluating. Speed/success advantage remains unmeasured. |
| Task authority | User-fired task has broad computer execution; native Codex path bypasses CLI approvals/sandbox, with additional tool/prompt policies. | Saved permissions, Chat only, Ask before changes and explicitly confirmed per-chat Full access; protected action checks remain. | Policy differs. Fewer pauses cannot be called an equal-authority benchmark win. |
| Proactive assistance | Discovers cross-source loose ends, researches and prepares specific editable work. | Morning brief gathers weather/events/reminders/task state; memory suggestions and explicit routines. | Sentient is closer to a proactive personal assistant; these are not equivalent features. |
| Scheduling | Source-analysis/nightly knowledge loop plus a root wake helper. | General daily/weekly/hourly worker routines, catch-up and Telegram/API hooks. | Sentient is deeper on sleep/wake analysis; ATOM has broader explicit job scheduling. |
| Models | Hosted subscriptions and custom/local compatible endpoints; drafting separate. | Claude/Codex and limited tool-free Gemini routes; per-chat model/reasoning, worker pins. Local speech exists, general local-model chat is not delivered. | Sentient is broader on local/BYOM inference; ATOM has more per-chat/worker organization. |
| Agents and concurrency | Shared one-task computer-use lock; several bounded preparation stages. | Named workers/souls/kits, plans/dependencies, Board/Floor, task timelines and worker worktrees. | ATOM has more explicit team/task controls. Does not prove better autonomous completion. |
| Project and developer work | Generic app/file actions can be powerful; no comparable dedicated project/Git workspace found. | Projects/filter/imports, Files/Changes/Git review, checkpoints/Undo, branch work, native Browser and user Terminal. | ATOM is more developed as a project workspace. Sentient’s browser control is a different capability from an embedded pane. |
| Phone/external AI | Other AIs can retrieve optional mirrored knowledge, including from a phone. | Telegram interaction/approvals/reports plus local API and MCP server for task integration. | Different strengths: knowledge portability versus remote assistant/task access. |
| Extensibility | Curated hosted/direct MCP services and provider adapters. | Assigned external MCP grants, editable agents/skills, skills hub and API/MCP integration. | ATOM has a broader explicit extension surface; live support varies by provider. |
| Cost visibility | Local triage avoids per-call provider charges for that stage. Hosted summaries, tasks, compaction and drafting can still use paid/quota-limited inference. | Token/cache/timing and estimated cost dashboard, provider quota visibility and measured startup report. | ATOM has more explicit cost instrumentation. No total-cost winner established. |
| UI focus | Three main interactions built around existing daily apps: hand off, draft, review proposals. | Wider mix of chat, workers, projects, coding/file tools and utilities. | My judgment: Sentient is closer to the original everyday-assistant goal; ATOM risks making its useful controls feel like product clutter. |

ATOM source anchors: [Second brain](../services/memory/src/brain.ts), [brain wiring](../apps/mac/src/brain-wiring.ts), [memory suggestions](../services/memory/src/suggestions.ts), [daily brief](../apps/mac/src/brief.ts), [routines](../services/helpers/src/routines.ts), [continuity](long-chat-history.md), [Chat brief](chat-brief.md), [checked access](chat-access.md), [Full access](chat-full-access.md), [computer transport](../services/tool-engine/src/computer/cua-client.ts), [computer policy](../services/tool-engine/src/computer/policy.ts), [worker limits](codex-worker-capabilities.md), [workspace](workspace-pane.md), [Telegram](telegram.md).

## What the “3 GB local model” actually establishes

The production download is **3,659,530,240 bytes** (about 3.66 GB decimal / 3.41 GiB) for **Gemma 4 E4B**. File size, model parameter count and whole-system RAM requirements are different quantities. The documented entry hardware is an Apple silicon Mac on macOS 15.4+, with 8 GB RAM for the built-in reader, not a guarantee that an additional larger local agent fits. [Download source][model-download], [current README](https://github.com/Sentient-OS-Labs/sentient-os/tree/16e871ad43c19ca8b26ed36daf66baaa44e886e5).

There are three distinct paths:

1. **Local understanding:** bundled Gemma reads/classifies/summarizes selected source items. Metal text/vision and multi-token prediction are enabled. One engine is reused over a batch, with a fresh item conversation and bounded output. Code comments describe roughly ten-second cold engine loads; these are author-reported observations, not a timing measured here. The engine guide’s 2–3× decode and ~21% GPU-vision improvement are also project-reported tuning results. [Engine code][engine-code]
2. **Knowledge/proactive/Sidekick:** the selected frontier provider does the organizing/reasoning/computer work. Defaults use subscription models; local computer use needs an additional compatible vision/tool-calling endpoint, tested before selection. The bundled reader is not the default Sidekick agent. [Model choice][providers]
3. **Double Tap:** a separate API client/relay or local endpoint makes an unsent draft. The default documented route is cloud-based. The website’s “2 seconds” claim refers to this drafting interaction, not arbitrary local-model computer workflows. [Drafting design][double-tap], [production client][drafting-code], [website](https://sentient-os.ai/).

Without the exact demo/model/quantization/hardware/settings, the observation that it looks fast is reasonable but cannot establish that the bundled 3.66 GB model is doing all the displayed work.

## Speed and token design worth learning from

| Mechanism found in source | What it could improve | Boundary |
| --- | --- | --- |
| Dependency preparation begins at app launch; compatible native helper/CLI reused. | Reduces first-use setup on the critical path. | Installation/background prep is not model prefill speed. [Runtime][native] |
| Default subscription computer-use tier uses low reasoning; explicit speed/model mapping. | Less reasoning before actions on suitable tasks. | Different model/effort means a different benchmark condition. [Speed code][speed-code] |
| `execArguments` requests `service_tier="fast"` on the applicable Codex paths. | May affect provider scheduling when supported. | Requested tier is not proof it is honored; a current issue reports an unsupported tier being omitted. Claude’s bridge path differs. [CLI][codex-code], [report #352](https://github.com/Sentient-OS-Labs/sentient-os/issues/352) |
| Double Tap uses a direct streaming API path instead of spawning the full CLI. | Avoids seconds of process/session setup for one-shot drafting. | It is not a replacement for a long-running tool/permission-aware agent. [Client][drafting-code] |
| Reusable knowledge text precedes the changing screenshot; supported OpenAI requests use explicit cache controls. | Stable prefix reuse for repeated drafts. | No cache-hit or lower-total-token guarantee across providers. The client can pack up to 600,000 bytes of knowledge, so prompts need measurement. [Client][drafting-code] |
| The custom Responses adapter removes older screenshots, retains the newest image and text placeholders. | Avoids repeated image prefill in local GUI loops. | Applies to that adapter path; must retain enough textual history for verification. Do not blindly delete ATOM conversation history. [Adapter][local-adapter] |
| Metal GPU text/vision, speculative decoding, batch reuse and bounded visual attention. | Better local throughput for repeated item summaries. | Does not prove interactive agent success/latency. [Engine][engine-code] |
| Read-only preparation is separate from user-fired execution, which has fewer approval pauses. | Less interruption after a scoped task starts. | Task authorization and deterministic protections must be compared separately. [CLI][codex-code], [proactive][proactive] |

Current Sentient `SidekickContext.build` defaults to **72,000 bytes** for its history block, reserves a bounded portion for older summaries, and includes eligible recent exchanges under that budget. The compactor keeps recent tasks exact, uses isolated provider calls and caps each stored summary at 10,000 bytes. These are component budgets, not total input-token counts: model instructions, knowledge, tools and in-task UI history also contribute. More than one conversation-sized budget can exist at once. [Context][context-code], [compactor][compactor-code]

ATOM’s measured 19 October baseline is 5.34 s median first model text in the optimized fresh-chat sample, 1.32 s setup median and roughly 11,594 first-turn input tokens, with four final cached follow-ups. That is three fresh chats, not a p95 guarantee. The old zero-cache miss still has no proven root cause. Sentient has no matching measured sample here; its reader throughput or website’s draft timing cannot be placed in that column. [ATOM measurement](chat-startup-performance.md)

## Limits that affect the comparison

- Local source extraction is selective and bounded. PDFs initially contribute only a few pages; files/notes have size/window caps. File iterative ingestion keys on date added and Apple Notes on creation, so edits are not universally reanalyzed. SiYuan has explicit edit-aware behavior. Do not equate “understands your life” with every item being current or complete. [Sources][local-sources]
- Custom main providers require Responses compatibility and vision; an Ollama Double Tap preset does not establish that every Ollama model/server can run Sidekick. [Providers][providers]
- Current native task startup can force-quit another OpenAI helper instance outside Sentient’s private path. A future side-by-side test with Codex computer use must account for this ownership conflict rather than interrupt an active user task. [Runtime][native]
- Computer execution uses the CLI bypass flag. Additional fresh-state/connector/prompt policies exist, but prompts are not a sandbox. ATOM should evaluate the runtime while preserving its own authorization rules. [CLI][codex-code], [security][security]
- Privacy is feature-specific: hosted inference can receive summaries, knowledge and screenshots; writing samples are original examples; optional mirror requests decrypt in relay memory. Some basic release analytics remain enabled independently of extended analytics. “Local first” is not the same as “nothing can leave the machine.” [Security][security], [mirror][mirror]
- Open reports on 21 October include long-item local-analysis deferrals/stalled overnight runs ([#353](https://github.com/Sentient-OS-Labs/sentient-os/issues/353)) and native screen-capture/agent termination failures ([#352](https://github.com/Sentient-OS-Labs/sentient-os/issues/352)). These are user reports, not independently reproduced prevalence or proven root causes. A current compaction/usage question ([#354](https://github.com/Sentient-OS-Labs/sentient-os/issues/354)) is not itself evidence that compaction is missing; current main has an actual compactor/context implementation.
- An older heavy-user quota report ([#314, August](https://github.com/Sentient-OS-Labs/sentient-os/issues/314)) describes repeated large cached contexts. It is a reason to measure full-task cost, not a current-version benchmark or proof of a token leak.
- Open-source licensing is **AGPL-3.0 with a commercial-licensing option**, unlike the MIT T3 reference. Treat this inquiry as design/architecture research; do not assume source can be copied into ATOM under the same terms as T3. No Sentient code or assets were imported. [Project licensing][license]
- Website/README launch-offer text and the latest release’s capacity/courtesy-gift text differ. Do not base a price/free-for-life promise on the older marketing page. This inquiry does not establish today’s exact commercial entitlement.

## Recommendation for the upgrade plan

Do not jump from a demo to a general local-model replacement, and do not keep adding workspace panels just to increase the feature count. Before the next product capability, use this comparison to choose a narrower everyday-assistant outcome.

1. **Measure and improve the current computer workflow.** Build a repeatable app-owned readiness probe and stage timings, then compare existing CUA against a separately evaluated native-helper adapter if worthwhile. Keep grants/approvals/history outside the model. No forced takeover of the user’s other running tools.
2. **Improve useful context without bulk-reading the Mac.** An initial opt-in source could be one ordinary notes folder with provenance, last-read/last-edited times, deletion/correction handling, preview and explicit review. Reuse Second brain rather than replacing it with another graph. Broader protected app databases and a privileged wake helper would be separate decisions.
3. **Add a contextual unsent-reply workflow.** Combine a fresh visible thread, selected relevant facts and user-edited style examples. Keep model/provider choice and the data flow clear. A direct draft-only provider route is worth measuring; no automatic send and no need to bundle a general local model first.
4. **Improve long-chat continuity carefully.** Evaluate asynchronous summaries of old decisions and unresolved work, preserving original history and retrieval, with separate summaries/memory/permissions. This directly addresses the original “someone new every time” concern. Summaries must not become authorization.
5. **Evaluate a small local model only for a measured role.** Classification/summarization is a plausible candidate. Measure extraction quality, missed facts, RAM/energy, cold load and steady-state throughput before accepting the download/support burden. Keep remote providers optional rather than replacing them on an untested speed assumption.

These are candidates and a proposed priority order, not implementation approval. Existing PR/Device workspace items remain unimplemented and are not started by this inquiry.

## Proposed fair benchmark (not run)

Use three fictional everyday workflows on the same Mac: (a) retrieve/update a decision across restart and follow-up, (b) draft an unsent reply using two relevant fictional facts, (c) read a fictional TextEdit/web form and make one verified, reversible edit. Compare the exact same cloud model/effort first; match service tier and record effective authority/approval pauses rather than silently weakening one side.

Record cold and warm setup, first model text, first verified UI action, verified task completion, failures/retries, user interventions, actual input/cached/output/reasoning tokens and any background ingestion/compaction work. Separate app execution time from time waiting for human approval. Report task success before speed. A local-model head-to-head is a later experiment because ATOM does not currently expose an equivalent general local inference backend.

No source execution, model calls, account connection or app installation was performed for this report. App source/permissions/history remained unchanged after the requested push.

## Source index

Links below are pinned to the inspected Sentient source; issue and release links above are current public records.

[overview]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Documentation%20-%20General%20-%20README.md

[engine]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Engine/Documentation%20-%20On-Device%20Engine%20%26%20Triage.md

[engine-code]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Engine/Engine.swift

[model-download]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Engine/ModelDownload.swift

[local-sources]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Sources/Documentation%20-%20Sources%20-%20Local%20%28Files%2C%20WhatsApp%2C%20iMessage%2C%20Notes%29.md

[hosted-sources]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Sources/Documentation%20-%20Sources%20-%20Cloud%20%28Gmail%2C%20Calendar%29.md

[direct-mcp]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Connectors/Documentation%20-%20Connectors%20%28Direct%20MCP%29.md

[knowledge]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Vault/Documentation%20-%20Knowledge%20Base%20%28Vault%29.md

[knowledge-ui]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Views/Knowledge/Documentation%20-%20Knowledge%20Window%20%28Constellation%20%26%20Reader%29.md

[proactive]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Proactive/Documentation%20-%20Proactive%20Intelligence.md

[scheduler]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Scheduling/Documentation%20-%20Overnight%20Scheduler%20%26%20Wake%20Helper.md

[sidekick]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Notch%20Magic/Documentation%20-%20Sidekick%20-%20General.md

[conversation]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Notch%20Magic/Documentation%20-%20Sidekick%20-%20Conversation%20Backend.md

[context-code]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Notch%20Magic/SidekickContext.swift

[compactor-code]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Notch%20Magic/SidekickCompactor.swift

[double-tap]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Double%20Tap/Documentation%20-%20Double%20Tap.md

[drafting-code]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Double%20Tap/DoubleTapInference.swift

[providers]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Cloud/Documentation%20-%20Cloud%20-%20Frontier%20Model%20Choice%20%28BYOM%29.md

[speed-code]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Cloud/ComputerUseSpeed.swift

[codex-code]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Cloud/CodexCLI.swift

[native]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Driver/Documentation%20-%20Native%20Computer%20Use.md

[native-selection]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Driver/ComputerUseBackend.swift

[native-rules]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Driver/OpenAIComputerUse.swift

[local-adapter]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Cloud/ResponsesTranslator.swift

[mirror]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Cloud/Documentation%20-%20Cloud%20-%20MCP%20Mirror.md

[settings]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Views/Settings/Documentation%20-%20Settings.md

[updates]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/Updates/Documentation%20-%20Auto-Update%20%28Sparkle%29%20%26%20Release%20Pipeline.md

[health]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/Sentient%20OS%20macOS/System/Documentation%20-%20System%20%28Permissions%2C%20Health%2C%20Uninstall%29.md

[security]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/SECURITY.md

[license]: https://github.com/Sentient-OS-Labs/sentient-os/blob/16e871ad43c19ca8b26ed36daf66baaa44e886e5/LICENSING.md
