# Sentient parity and ATOM release plan

22 October 2026 · Planning checkpoint · Implementation has not started for this extension

Keshab requested a plan for the discovered note-search bug, release readiness and full Sentient parity. This extends the [initial seven-group adoption plan](sentient-adoption-plan.md); it does not reclassify implemented code as accepted product behavior. Execute one capability at a time, recording evidence and unresolved cases before moving on.

## Baseline and completion definitions

- ATOM: `010ffe1`, pushed to main. All seven initial coding groups exist. The [results](sentient-adoption-results.md) record automated and bounded native evidence; their older intermediate remaining lists are historical when superseded by newer sections.
- Sentient: the [33-feature inquiry](sentient-os-feature-inquiry.md), source `16e871ad43c19ca8b26ed36daf66baaa44e886e5`. On 22 October, `git ls-remote` still reports that main SHA and the [release list](https://github.com/Sentient-OS-Labs/sentient-os/releases) still lists 2.5 as latest. This is a pinned comparison, not an ongoing promise to match an evolving main branch. Sentient itself has not been installed or independently benchmarked here.
- **Release ready:** the explicitly declared ATOM release scope passes its automated, native, lifecycle, performance and distribution gates at the exact release revision. Unsupported paths are visible and documented. No known data-loss, permission, cancellation or shipped core-workflow blocker remains. Cosmetic exceptions require an explicit documented disposition; a failing required CI check does not count as an exception by default.
- **Functional parity:** every inquiry row has an implemented and verified ATOM equivalent or a specifically accepted difference. Existing project/chat/worker features count only when they deliver the same relevant user outcome. Source presence, a mock, a screenshot or passing a related test is not sufficient evidence by itself.
- **Strict parity:** an unresolved decision or accepted difference still remains a literal feature difference. Report it openly; do not call cloud-primary/backup-local ATOM an identical implementation of local-primary Sentient.

Cloud Gateway models stay primary. Local inference remains an explicit optional backup. Preserve multiple chats/projects, full archives, unsent drafts, per-chat model/thinking/access and deterministic grants/revoke behavior. Reuse Second brain, Gateway, routines, Board, checked tools and existing account integrations. No duplicate knowledge store or competing task system.

## Execution order

| Order | Work package | Result and exit gate |
| --- | --- | --- |
| 1 | R0: note-search bug | Delete/rename/update/source changes cannot leave obsolete searchable rows; focused regression and native reproduction pass. |
| 2 | R1: hosted Terminal rendering | Diagnose actual hosted artifacts, fix the nondeterminism, retain scenes and existing tolerance, then pass all required jobs for the published revision. |
| 3 | R2: remaining native acceptance | Finish the already implemented seven groups, including failures/cancel/restart and preservation of history/authority. Fix defects as separate bounded tasks. |
| 4 | R3: measured responsiveness and context | Run the controlled benchmark, break down first-turn context/cache behavior, then optimize the measured bottleneck and repeat the same conditions. |
| 5 | R4: release candidate | Audit lifecycle/distribution, complete final checks and produce a concrete release candidate with rollback and evidence. Publishing remains a separate explicit action. |
| 6 | P1–P6: parity expansion | Add the missing outcomes in dependency order below; each capability repeats the relevant release gates. Do not wait until the entire expansion to stabilize useful increments. |
| 7 | Final parity audit | Reconcile all 33 rows, accepted differences, release gates and reproducible everyday workflows at one pinned revision. |

The first release candidate covers the existing seven-group scope. It is a useful milestone before full parity, not a claim that parity has been reached. Each later parity increment receives its own accepted release scope.

## R0 — Fix stale note-search results first

Observed: Delete for good removes the owned note and updates graph counts, but its active search result survives until the query is cleared and re-entered. No stored-note resurrection or data loss was observed.

Inspect `BrainState` graph/hit reconciliation, `IslandModel` mutation acknowledgements and search event ordering before choosing the smallest fix. `setGraph` currently clears a vanished selection but does not reconcile cached hits; that is a lead, not a complete diagnosis. Likely files: `AtomIslandCore/Brain.swift`, `AtomIsland/IslandModel.swift`, the relevant runtime brain event wiring and their existing tests.

Acceptance:

- A successful confirmed delete removes the result without typing, toggling tabs or reopening the page. A rejected/failed delete retains the note and its result.
- Save/rename/body edit and imported-source refresh/disconnect update or invalidate affected results consistently, including a note that stops matching the query.
- A delayed search response cannot reintroduce a removed note or populate results for another query/runtime generation. Do not blindly remove results merely because graph data is partial; establish the event contract first.
- Empty search, selection, unsaved editor guards, links/counts and unrelated notes remain correct. No optimistic success before the host acknowledges a mutation.
- Add focused state/event regressions, then reproduce the original native sequence with disposable fictional data and approved cleanup. Compare the original state before/after. Record exact fix and limits.

## R1 — Resolve the hosted visual failure

Last recorded run `39727840071` at `a095a04` passed TypeScript/Swift but failed compact Terminal at 1.877%; the dark Terminal comparison was independently 1.378%. The path dependency was fixed; centered explanatory text still shifted vertically.

Inspect the newly pushed revision's run/artifacts first. Reproduce runner toolchain, fonts, environment, rendering size and layout constraints; isolate whether layout or capture timing causes the shift. Fix the cause, review affected images, retain scenes and 1% tolerance, and rerun hosted CI. Reference changes need an intentional visible design change, not accommodation of an unexplained failure. Exit only with the required jobs green on the actual candidate revision.

## R2 — Finish native acceptance of implemented capabilities

Already evidenced: signed restart/state retention; notes-folder preview/import/correction/conflict/missing/restore/disconnect; Claude reply generation/edit/Copy/Cancel; authored context revision handling; example Save/restart/default-off/Forget; loopback backup protocol/configuration/Stop. Do not repeat all these without a relevant code change or unresolved concern.

| Remaining batch | Required native outcome |
| --- | --- |
| Replies | Codex panel path; imported-source attribution in selected reply context; clipboard/truncation/secure-field refusal; provider failure and late result handling. Preserve Gemini's approved earlier selected-text action. |
| Continuity | Fictional long chat: inspect derived summary, open exact original references, pause/clear/re-enable, restart and verify originals/grants. Summary claims cannot create authority. |
| Prepared work | Fictional selected inputs → sourced card → edit/Copy/Restore/Close; pause, exhausted budget, older-card labeling and restart. No automatic action or delivery. |
| Source analysis | Start/pause/restart/explicit Resume; edit/refresh invalidation, cache reuse, budget exhaustion, source navigation and confirmed Clear/disconnect. No duplicate model dispatch. |
| Computer readiness | App-owned read/screenshot/input fixture with permission absent/denied/revoked, owned-helper failure/recovery and fresh observation. Never replay an uncertain write. |
| Local backup | Native Copy/Clear/Forget paths: **done 22 October** ([results](sentient-adoption-results.md)). Real inference is conditional on an explicitly configured compatible server; fixture success does not verify a real model. No automatic installation or provider switch. |
| Cross-cutting | Keyboard navigation, Japanese IME, VoiceOver labels/focus, narrow windows, scrolling, sleep/runtime interruption and cancellation. Execute outstanding scanner/race/timezone/budget cases based on actual coverage gaps. |

Use private snapshots and fictional fixtures; compare original records/configuration and restore only fixture changes. Keep test matrix statuses explicit: passed, failed, not run, blocked or deferred with reason. A skipped live path is never a pass. Use the [detailed validation backlog](sentient-adoption-validation.md), reconciled against latest results, rather than claiming every listed case already ran.

## R3 — Measure before optimizing

Continue the authorized ATOM-versus-Codex benchmark: same advertised model, reasoning effort, prompts, source/task content and foreground conditions. The previous size was three fresh chats per app with two responses each (12 responses). Pin the actual available model identity before running; disclose app-specific hidden contexts and any unequal settings.

Measure app/window readiness, request admission, dependency/provider setup, first visible text and total completion separately. Report input/cached/output/reasoning tokens where exposed, context/tool/instruction breakdown, usage-accounting coverage and background-model work separately. Do not turn unavailable metrics into zero. Verify current pricing only if reporting monetary estimates; subscription quota use is not equivalent to API cost.

First investigate the roughly 16,700-token first-turn context and the zero-cache follow-up: stable-prefix fingerprints, request envelope/tool ordering, model/effort/session changes, dynamic timestamps, cache expiry/routing and provider reporting. Cache hits cannot be guaranteed merely by keeping a prefix stable. Attribute context size before shortening instructions or tool descriptions.

The small comparison is exploratory. Follow with enough controlled cold/warm trials to report median/range; only report p95 if sample size supports it. Exclude user handoff delays from model latency and record errors. Set numerical latency/context targets from this baseline before optimization. Improve measured setup/prefix costs one at a time; rerun the same workload and history/grant-revoke cases. No speed or cost win without comparable evidence and unchanged required behavior.

## R4 — Release candidate gate

- Audit existing install, launch/reopen/login behavior, provider sign-in/out, credential storage, dependency preparation, permission guidance, export/backup/reset and update mechanisms before adding missing controls. Distinguish local signed personal use from distribution to another Mac.
- Verify additive migrations, interrupted writes, rollback compatibility and data recovery using snapshots, including existing chat/source/analysis data. Do not assume replacing a bundle downgrades a migrated database safely.
- Run relevant TypeScript/Swift/live-provider checks and complete required CI/gallery at the final revision. Preserve scene coverage/tolerance; record exact versions, skips and warnings. Assess outstanding warnings rather than silently treating them as errors or harmless.
- Verify the signed candidate and native smoke after replacement without losing TCC or current user state. For external distribution, scope Developer ID, notarization/stapling, packaging, supported macOS/hardware and clean-machine installation/update/rollback. Signing credentials or paid accounts may require user setup; mark that gate blocked rather than invent success.
- Produce release notes, known limitations, source/privacy/provider disclosures, support diagnostics without raw content, recovery instructions and a candidate artifact/checksum. Inspect any updater feed, reset or uninstall cleanup boundaries before enabling them.
- Run three end-to-end outcomes: remembered file work with persistent/revoked permission; selected context to an editable unsent reply; selected notes through interrupted analysis to sourced prepared work. Keep any external execution explicitly scoped.

Do not publish, tag a release or distribute through an updater as part of this planning task. Once the candidate is concrete, those actions can be separately authorized.

## Parity expansion after the first stable candidate

| Package | Scope, dependencies and completion evidence |
| --- | --- |
| P1: coherent everyday assistant | Audit notch/voice/main-chat entry routing, questions, Stop and activity against one selected chat. Make standing memory review/edit/conflict behavior clear without merging it with summaries or grants. Finish contextual drafting model/effort selection and an optional reviewed Insert action only after the focus/secure-field contract is agreed. Depends on R2 continuity/reply evidence. |
| P2: broader selected sources | Extend the current provenance contract to PDF, Word and images/OCR, then Apple Notes/SiYuan, then selected Calendar/Mail/Messages/WhatsApp sources as separately scoped adapters. Audit existing readers first. Each gets preview, scoped consent, stable IDs, freshness, exclusions, correction/conflict, deletion/disconnect and bounded scheduling. Keep CPU extraction separate from model interpretation; no continuous screen harvest. Protected sources need a decision before implementation/access. |
| P3: portable linked knowledge | Extend existing notes/links/graph with reviewed export and conflict-aware Markdown folder synchronization, browse/edit/link navigation and recoverable deletion/Trash. Design stable identity/rename/deletion handling, reconciliation and atomic publication before bidirectional writes. Add sourced consolidation that preserves provenance and distinguishes a proposed inference from a fact. Depends on P2's source contract; do not add a second authoritative content store. |
| P4: discovery and useful prepared work | Extend brief preparation with explicit selected knowledge and source-aware read-only discovery/research, freshness/duplicate/uncertainty controls and visible budgets. Add editable recipients/messages/plans and a separate explicit handoff into existing checked tasks. Cancellation, progress/questions/outcomes route to the originating chat; stale drafts never execute automatically. Add a reviewable personal briefing from the same grounded context. Depends on P2/P3; account/execution authority is separately scoped. |
| P5: runtime, provider and lifecycle depth | Compare native computer transports with equal authority and measured task success/latency; retain checked policy/ownership/recovery. Extend optional compatible provider capability checks and separate drafting selection through Gateway. Consider an optional local reader only as backup, never as primary. Complete dependency isolation/preparation, health/repair and update/reset gaps found by R4. Privileged wake scheduling and broadened all-local stages are decision-dependent extensions. |
| P6: external knowledge access | Audit existing local API/MCP account tools and add missing curated OAuth/read adapters where warranted. Start with local knowledge retrieval that honors source scopes, revoke/delete and content-free diagnostics. Optional hosted encrypted mirroring/phone retrieval needs a separate threat/storage/cost/revocation design and user decision before enabling. Depends on P2/P3 and account lifecycle. |

These packages are planning groups, not permission to implement several capabilities at once. Split each source/transport/action into a concrete bounded task with its files, migration, authority, failure modes and acceptance criteria before coding.

## All 33 inquiry rows: disposition ledger

The IDs refer to the pinned inquiry. **Partial** means an equivalent exists but scope or acceptance is incomplete. **Audit** means presence/depth must be checked before estimating a missing implementation. None of these labels claims full parity today.

| IDs | Outcome | Current disposition | Completion owner |
| --- | --- | --- | --- |
| 1, 2, 8 | Notch/voice, screen handoff, activity/questions | Existing entry points; integration and native outcomes need audit | R2, P1 |
| 3, 4 | App control and existing browser sessions | Checked computer control exists; transport/success comparison unmeasured | R2, R3, P5 |
| 5 | Durable continuing interaction | Multiple persistent chats retained; selected-chat continuity is the proposed equivalent, not a literal single global chat | R2, P1; confirm any conflicting design request |
| 6, 7 | Older-history summaries and editable standing memory | Summary implemented; native acceptance and standing-memory UX audit remain | R2, P1 |
| 9–11 | Contextual drafts, writing examples, independent provider | Claude native lifecycle covered; broader models, screenshot context/Insert and independent selector incomplete | R2, P1, P5 |
| 12 | Bundled local reader | Absent from current scope; user chose backup-only local direction | P5 decision; record intentional architecture difference |
| 13 | Folder/documents/images | Text/Markdown pilot covered; richer formats missing | P2 |
| 14–16 | Messages, Apple Notes/SiYuan, Mail/Calendar | Mixed existing tools and missing curated ingestion; audit per source | P2, source-specific decisions |
| 17, 18 | Hosted and direct OAuth MCP sources | Existing extension/account surfaces need source-by-source audit | P2, P6 |
| 19–21 | Linked generated knowledge, portable Markdown, reader/graph | Existing graph/notes; reviewed consolidation, portability/sync and Trash need extension | P3 |
| 22, 23 | Discovery and reviewable execution-ready work | Current prepared cards are limited to brief excerpts and Copy | R2, P4 |
| 24 | Sleep/wake overnight work | App-running schedules exist; privileged wake/power gates absent from adoption scope | P5 decision |
| 25 | Resumable ingestion | Imported-note analysis implemented; native restart/resume and broader adapters remain | R2, P2 |
| 26 | Provider/reasoning choices | Existing per-chat choices; custom capability coverage and independent drafting need audit/extension | P1, P5 |
| 27 | All-local operation | Current temporary text backup is narrower; all-local agent stages are not delivered | P5 decision; backup-only constraint persists |
| 28 | Hosted knowledge MCP mirror | Existing local API/MCP is not an encrypted cloud mirror | P6 decision |
| 29, 30 | Health/repair and dependency readiness | Protocol readiness implemented; native permission probes, lifecycle and transport isolation need acceptance/audit | R2, R4, P5 |
| 31, 32 | Updates/lifecycle, privacy and observability | Existing controls require release-scope audit; each new reader must inherit source/removal/diagnostic rules | R4 and every parity package |
| 33 | Personal briefing | Not delivered as a grounded cross-source welcome/pattern briefing | P4 |

## Decisions to ask only when concrete

| Conflict | Recommendation and when to ask |
| --- | --- |
| Local-primary versus backup-only | Keep the user's cloud-primary instruction. Do not silently add local triage as the default or call this strict architecture parity. Ask only if a scoped feature truly needs a different choice. |
| Single global chat versus ATOM projects | Route everyday entry points to the chosen chat; preserve separate histories and grants. Ask before any requested global history merge. |
| Selected text versus screen-aware drafting/Insert | Start with reviewed text/context. Offer explicit screen capture or Insert only with visible data/destination and secure-field/focus checks; sending remains separate. Ask about the interaction before changing the current Copy-only contract. |
| Protected apps/accounts | Prefer selected read-only sources with preview and deletion controls. Present the exact account/data/permission before broader access; no broad permission inferred from this plan. |
| Markdown writes and deletion | Offer export first, then reviewed synchronization with conflict/Trash recovery. Ask before a feature can overwrite external edits or change which copy is authoritative. |
| Privileged wake | Keep app-running schedules first. Present helper/power/thermal/awake limits before installing anything privileged. |
| Custom paid endpoints/cloud mirror | Prefer existing Gateway and local retrieval. Present billing, storage, retention and revoke/delete behavior before adopting another service. |
| Transport or source-code reuse | Keep checked ATOM authority. Compare transports rather than copying bypass behavior. Implement concepts independently; direct Sentient AGPL/commercial code/assets reuse needs a separate licensing decision. |

## Progress reporting and first task

Maintain one row per capability with: ATOM commit, referenced Sentient feature IDs, implementation state, native/automated evidence, measured performance where relevant, unresolved defects, user decisions and release disposition. Update this ledger and the results after each bounded task. Avoid a single parity percentage while scopes and accepted differences are unresolved.

**R0 result (22 October):** fixed on branch `fix/note-search-stale-hits`, not yet committed or CI-checked. `BrainState.refreshSearch()` plus one line in `IslandModel` re-ask the active search after every graph. Two regressions added; 789 island tests pass. Native delete sequence reproduced the bug on the pre-fix bundle and shows "No note matches" on the rebuilt app; all 48 non-FTS tables match the baseline after cleanup. Not exercised natively: rename/edit that stops matching, source refresh/disconnect, rejected delete, delayed response. See [STATUS.md](../STATUS.md).

**R1 result (22 October):** diagnosed, fix prepared, hosted check pending. Run 39759609477 fails only two Terminal scenes (1.877% and 1.378%); the hosted render is deterministic and every text line below the empty-state icon sits 1 device pixel higher than on this Mac (macOS 26 runner, macOS 27 here). The icon's layout box is now fixed in the Terminal and Browser views; local renders still equal the goldens and no scene or tolerance changed. R1 closes only when the `visual` job passes on the pushed revision. See [STATUS.md](../STATUS.md).

**Next step:** push the branch (or open a PR) so hosted CI runs R0 and R1 together. R0 and R1 stay open until the required jobs pass on that revision.
