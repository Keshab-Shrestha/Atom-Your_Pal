# Oh My Hermes inquiry and ATOM roadmap comparison

Research checkpoint: 26 October 2026. This is a source audit and proposed roadmap extension, not an adaptation implementation or a live product benchmark.

Subsequent decision: Keshab selected [ATOM-native integration](omh-native-orchestration.md). That document records the implemented first slice and remaining architecture; the findings below remain the original research checkpoint.

## Finding

Oh My Hermes (OMH) is a useful reference for developer orchestration, task evidence and memory diagnosis. It adds workflows and a control plane around Hermes Agent. It does not provide a demonstrated replacement for ATOM's native workspace or faster macOS computer-use driver. Borrow selected mechanisms within ATOM's existing boundaries; do not introduce a second agent runtime to obtain them. [Upstream architecture](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/docs/ARCHITECTURE.md).

Keep our existing direction: cloud models primary, local inference optional as backup or an explicitly selected decision provider; preserved transcripts, drafts and deterministic permission records; release readiness before broad parity expansion. Several OMH mechanisms would extend capabilities ATOM already has rather than add entirely new systems.

## Scope and evidence

- OMH: `rlaope/oh-my-hermes`, main at `171ccfa698fd94b6ec23a8940f9658556b430351`, committed 25 October 2026. Latest published release observed: [v4.0.2](https://github.com/rlaope/oh-my-hermes/releases/tag/v4.0.2), published 25 October. Main and release are different references.
- ATOM: `1b6cc685224dffa46332e6894f73357a7d4e47b8`, already merged and pushed to main. Comparison includes the current native redesign and the later acceptance records in TASK.md, not just older roadmap statuses.
- Method: read-only pinned checkout; targeted inspection of DAG state, dispatch, memory admission/recall, capability projection, code indexing, TUI and documented contracts; GitHub release/check metadata. No installer, upstream Python module, skill procedure, model call, test suite or benchmark was executed.
- Counted **151 top-level packaged SKILL.md files**, matching 151 install-visible entries in the generated workflow reference. Its 239 workflow headings also include other reference surfaces; they are not 239 independently executing features. Default profile is a smaller ten-skill set. [Catalog](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/src/skills/catalog.py).
- GitHub reported all 14 returned check runs successful at the inspected main SHA. This supports repository CI health, not local app performance or end-to-end feature acceptance.

The inventory distinguishes executable implementation from guidance and prepared records. A contract can be well implemented without proving the external action happened. OMH itself makes this distinction. [Capability impact](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/docs/CAPABILITY_IMPACT.md).

## Architecture and execution boundaries

Hermes handles the conversation. OMH supplies routing, skill guidance, local state, plugin tools/hooks, terminal UI and handoff machinery. Selected agent CLIs execute external coding work. The base Python package requires Python 3.11+ and declares no runtime dependencies, but Hermes, executors and optional extraction/media providers add their own requirements. [Package configuration](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/pyproject.toml).

Two execution paths matter:

1. **Hermes DAG:** the parent defines nodes, dependencies and prompts; OMH returns ready work; Hermes delegates it. A returning child waits for the parent's acceptance. State survives conversation compaction through durable run records. This is orchestration support, not independent proof of correctness. [DAG state implementation](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/src/plugin_bundle/omh/dag_run.py).
2. **External coding dispatch:** explicit dispatch actually starts local executor processes in isolated worktrees, observes results and can run declared verification. Integration remains separately gated; dispatch does not merge. Prepared handoff metadata alone does not launch a worker. Some broad documentation describes Maestro as preparation only, whereas the newer coding-run path implements spawning; use the specific code path when judging availability. [Fanout lifecycle](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/docs/FANOUT.md).

## Feature inventory and comparison

These are capability-level comparisons, not quality scores. “Extend” means useful overlap with existing ATOM code; “add” means a distinct mechanism was not found in the inspected ATOM paths.

| OMH area | What it provides and where the claim stops | ATOM comparison / recommendation |
| --- | --- | --- |
| Natural-language workflow routing | Routes requests into specialist guidance; multilingual triggers and negative controls help avoid keyword collisions. | ATOM has roles, kits and skills. Extend selection quality and explain the chosen workflow; do not put all skills into chat context. |
| Interviews and planning | Guided clarification, alternatives, acceptance criteria and decision records. | Existing plans/briefs overlap. Add an optional reviewed acceptance checklist for complex tasks. |
| Ten intensive workflows | Context, interview, research, plan, work, DAG, Maestro, loop, QA and performance workflows. These mix guidance with host-backed operations. | Offer a few clear outcomes through ordinary chat; avoid ten new permanent controls. |
| Dependency DAG | Ready-node selection, blocked dependents, categories, topology and bottleneck views. | ATOM already has dependency-based portions and bounded parallelism. Extend its plan model and Board view. |
| Repair and extension | Bounded failed-node repair and missing-work extension; verification nodes must be rerun after repair. | Useful addition to explicit retry. Preserve accepted work and bind replacement results to their original task. |
| Work boundaries | Named write scopes reject declared overlap in the Hermes DAG. | Improve scheduling, but retain ATOM's actual sandbox/grants. See literal-path limitation below. |
| External coding workers | Real Codex/Claude and configured executor dispatch, worktree isolation and process supervision. | ATOM already has native workers and task worktrees. Improve evidence/recovery rather than add another dispatcher. |
| Model/effort chains | Editable category-specific model and reasoning-effort chains with provider availability metadata. | Extend existing worker pins/tier floors and chat selectors only if the user wants automatic lane routing. |
| Worker visibility | TUI graph/tree, agent detail, model/effort labels, progress, steering and interruption. | Improve the existing chat task panel and Board; do not add a fifth workspace lane. |
| Session lineage | Binds observed executor session IDs to attempts, executable identity, worktree and revision. Resume advice is copy-only and does not prove native history still exists. | Useful recovery hardening for ATOM's retained jobs/sessions. |
| Failure diagnostics | Bounded sanitized failure output with phase/reason and attempt lineage. | Extend current runtime diagnostics into concise actionable task errors. |
| Capacity handling | Specialized queue-admission logic for supported Codex builds, separate from cancellation and generic failures. | Useful pattern; do not copy build-specific assumptions into general retries. |
| Completion evidence | Separates preparation, reported work and observed verification; artifacts are tied to execution records. | Extend ATOM's report/diff panel with checks actually observed at the current revision. |
| Task-specific capability context | Shortlists relevant capabilities; expands details explicitly; shared byte budget and reasons for exclusions. | High-value extension of deferred tools and existing context instrumentation. Measure actual provider tokens/cache effects. |
| Frozen capability authority | Projection refresh can only intersect the originally granted capability set. | Useful defense alongside ATOM's deterministic grants, never a replacement for them. |
| Memory capture and review | Scoped candidate records, duplicate handling, retention and admission states. Default mode is auto-safe, not mandatory human review. | Extend diagnosis/lifecycle, retain ATOM's explicit memory controls. |
| Memory retrieval | Task-ranked, scoped and budgeted recall; freshness and conflicting subject values affect eligibility. | Extend saved facts/notes/continuity with clearer freshness and exclusion reasons. |
| Memory failure diagnosis | Distinguishes storage, eligibility, selection, rendering, delivery and use; remedies can remain prepared rather than applied. | Strong addition for the original “it forgot within the same chat” complaint. |
| Memory identity | User/project/thread/channel identities, principal separation and migration review. | Valuable if ATOM gains shared/account surfaces; avoid premature multi-user complexity now. |
| Knowledge curation | Wiki and memory maintenance procedures, confirmation/correction/retirement and lifecycle records. | Align with portable knowledge and consolidation backlog; keep originals/recovery paths. |
| Source-backed research | Research, source finding, briefs, paper-learning and synthesis guidance. | Extend worker skills and sourced suggestions; workflow names do not establish connector access. |
| Historical web evidence | Separates publication, retrieval and archived capture time for date-specific claims. | Add provenance to research/source records when historical comparison is requested. |
| Long-document coverage | Page-range plan and ledger, partial-coverage warnings, page anchors and optional host extraction tools. OMH is not the PDF parser. | Extend existing PDF/Word intake and chunk analysis; this does not supply OCR by itself. |
| Code graph | Python AST files/symbols/import relationships, entrypoint tags and diagram views. | Potential future project map; ATOM needs Swift/TypeScript support, so this scanner is not a drop-in solution. |
| Design and deliverables | Frontend, accessibility, visual QA, reports, decks, documents and media workflow guidance. | Add selected skills only after provider/tool readiness and artifact verification. |
| Operational workflows | Release, deployment, reliability, audits, connector readiness and domain-specific procedures. | Curate useful workflows in the existing skill system. Do not equate broad catalog coverage with delivered integrations. |
| Tool-call rules | Optional user-written matching rules and planned-batch rehearsal. Malformed rules fail open as an advisory layer. | A preview could help explain actions; ATOM safety policy must remain authoritative. |
| Plugin inspection | Static hook-contract and self-update risk reporting distinguishes observer hooks from policy gates. | Useful future skill/MCP review feature; declaration inspection is not a security certification. |
| Terminal UI and rewind | Themes, session/prompt selection, shell interaction and transcript rewind. Rewind is not general filesystem rollback. | Native UI already serves ATOM's needs. Prefer non-destructive forks plus existing file checkpoints. |
| Setup/maintenance | Setup, update, doctor, profiles, capability switches and optional bridge/projection surfaces. | Borrow a capability readiness screen in Settings; avoid a second installation/configuration system. |

Inventory sources: [workflow reference](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/docs/WORKFLOWS.md), [model-chain editor](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/src/plugin_bundle/omh/model_chain_picker.py), [executor receipts](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/docs/FANOUT-EXECUTOR-EVIDENCE.md), [memory governance](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/docs/MEMORY.md), [plugin hooks](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/docs/PLUGIN-HOOK-CONTRACT.md), [rewind](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/src/tui/rewind_picker.py).

## Most valuable additions for ATOM

### 1. Explain missed memory in everyday language

Add an optional “Why wasn't this remembered?” view. Explain whether the information was saved, applicable to this chat/project, included in the request or omitted for a stated reason. Separately display deterministic file permission state. Supplying a fact to a model does not prove the model used it; the explanation must preserve that uncertainty. [Recall incident design](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/docs/MEMORY-RECALL-INCIDENT.md).

ATOM already retains full history, derived summaries with source references, notes and exact-file grants. Start by recording compact selection receipts in those existing paths, not by migrating memory to OMH. Acceptance should include an omitted fact, stale summary, wrong scope and a retained grant after restart, with originals unchanged. Keep technical fields inside Details.

### 2. Give each developer result a trustworthy completion record

Show changed files, actual workspace, checks observed, checked revision, outstanding uncertainty and actual Git effects together. Keep model-reported success separate from host observations. A later edit invalidates earlier verification for the new state. Extend the existing task report/Changes surface; do not require movement between pages.

### 3. Share one context budget across optional material

Budget skill metadata, tool details, note excerpts, summaries and task progress together. Load compact relevant descriptions first and expand only when needed. Preserve a stable prefix where possible. OMH's projection records why an item was excluded and cannot expand its approved capability set. [Projection implementation](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/src/capabilities/projection.py).

ATOM already removed inherited skill discovery and measures setup/first text/cache counters. Reuse that instrumentation: compare identical prompts and settings, report bytes separately from provider tokens, and prove history/grant continuity. No assumed percentage speedup or guaranteed cache hit.

### 4. Strengthen the existing work plan

Add file-conflict scheduling, a compact dependency view and bounded repair of failed portions. An independent check should verify the requested outcome after repairs. ATOM's current portion scheduler already selects ready work and propagates blocked dependencies; replacing it with OMH would duplicate the system.

Normalize real paths and directory containment, account for symlinks, and stop descendants when the user presses Stop. Start with the current concurrency bound. More parallel workers can increase total tokens and interference, even when wall time decreases.

### 5. Improve source coverage and freshness

Extend document analysis with explicit covered/missing page ranges and durable page citations. Add visible stale/conflicting note warnings and distinguish current web retrieval from a historical capture. This strengthens the accepted PDF/Word and sourced-suggestion direction. [Document ledger](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/docs/LONG-DOCUMENT-READING.md), [temporal receipts](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/docs/TEMPORAL-SOURCE-RECEIPTS.md).

### 6. Add a project map only after core reliability

Use incremental Swift/TypeScript symbol/import indexing to target file reads and show affected areas. OMH's inspected scanner is Python-specific and builds definitions/import edges, not a universal semantic call graph. Measure indexing cost and actual reduction in exploration before making it persistent. [Scanner](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/src/codegraph/scanner.py).

## Conflicts and safeguards before adaptation

| Observed behavior | Recommendation for ATOM |
| --- | --- |
| OMH defaults project memory to auto-safe approval. | Keep explicit retention/review behavior. Automatic admission would be a separate product decision. [Admission code](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/src/plugin_bundle/omh/memory_admission.py). |
| Category chains can change the model used for work. | Preserve user pins. Any cross-provider automatic fallback needs an opt-in list, cost limits and clear disclosure; retain local as optional backup. |
| External coding templates allow staging/commits as part of worker work. | Do not import those templates. Preserve ATOM's explicit commit/push handoff and host enforcement. This directly conflicts with the earlier no-commit incident. [Dispatch template](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/src/coding/fanout_dispatch.py). |
| DAG cancel marks the run cancelled but instructs the caller to stop existing children separately. | ATOM Stop must cancel admitted work and descendants, prevent late actions and retain uncertain in-flight effects. [DAG tool](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/src/plugin_bundle/omh/tools/dag_tool.py). |
| DAG scope collision compares entries as written, not directory containment. | Treat it as scheduling metadata. Use canonical path/containment checks plus existing execution permissions. [Scope comparison](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/src/plugin_bundle/omh/dag_core.py). |
| Optional tool-call rule files degrade to no intervention if invalid. | Advisory rules may improve guidance; invalid mandatory ATOM policy must refuse execution. [Rule implementation](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/src/plugin_bundle/omh/toolcall_rules.py). |
| Transcript rewind truncates the later conversation on resend. | Keep source history; prefer fork/retry with separate file checkpoints. |
| Many domain/media/connector workflows depend on another host or provider. | Expose readiness accurately; do not advertise unavailable execution because a skill exists. |

No decision is needed to finish this investigation. If an implementation later proposes automatic memory admission, provider switching, autonomous Git effects or destructive rewind, present that concrete conflict and recommendation to the user first.

## How this fits the current plan

This is an additive proposal to [Sentient parity and release readiness](sentient-parity-release-plan.md), with later TASK.md evidence taking precedence over old checkpoint statuses. It does not reopen completed fixes or promise full OMH parity.

| Order | Bounded work | Existing plan alignment |
| --- | --- | --- |
| 0 | Finish remaining actual-app release checks at one pinned revision: accessibility/keyboard/IME, interruption, provider paths, signing/distribution and outstanding computer uncertainty. | R2/R4; keep cursor acceptance last as requested. |
| 1 | Add compact memory selection/delivery explanations, preserving independent grants. | P1/R2; original continuity complaint. |
| 2 | Extend in-chat developer reports with revision-bound host evidence and clear Git effects. | R2/developer workflow; builds on existing report/diff. |
| 3 | Instrument and reduce optional context with shared budgets and stable discovery. Repeat controlled latency/token comparison. | R3; no unrelated policy trimming. |
| 4 | Extend dependency scheduling with robust conflicts, bounded repair and descendant cancellation. | Developer workflow; one bounded capability per implementation step. |
| 5 | Add document coverage/page anchors and freshness, then curated sourced work suggestions. | P2/P3/P4; OCR/multiple folders remain separate work. |
| 6 | Consider a native project map, curated workflow packs and capability readiness UI. | Later developer/skill expansion. |
| Separate | Continue measured computer-driver/round-trip improvements and real Jev validation. | P5; OMH is not evidence of a faster CUA engine. |

Suggested first OMH-derived implementation: **memory explanation receipts**. It directly addresses the user's initial problem, adds little UI and fits the current memory architecture. Release-critical defects still take priority.

## Performance and adoption limits

No ATOM-versus-OMH latency, cost, token-efficiency or task-quality result was measured. A workflow catalog and successful CI do not establish daily-user superiority. OMH's cross-harness contract evaluates submitted metadata and explicitly does not independently prove executor activity; its separate product A/B harness has its own corpus/provenance limitations. Any comparison needs matched model/effort, fresh/resumed sessions, task outcomes, tool calls, cache counters, total billed usage and wall time. [Cross-harness boundary](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/docs/CROSS_HARNESS_BENCHMARK.md), [product A/B methodology](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/benchmarks/product-ab/v1/README.md).

The top-level project is MIT licensed; preserve attribution/license for any copied source and inspect notices for each vendored component. Prefer implementing the selected patterns inside ATOM over installing the whole framework. [License](https://github.com/rlaope/oh-my-hermes/blob/171ccfa698fd94b6ec23a8940f9658556b430351/LICENSE).

## ATOM evidence used

- Existing planning: `services/helpers/src/work-plan.ts`, `plans.ts` and `jobs.ts` — ready/blocked portions, compact prerequisite handoffs and bounded parallelism.
- Existing worker choice: `services/helpers/src/models.ts` — user pin, tier selection and role floors; `services/decision-engine/src/` and [computer decisions](computer-decision-providers.md) — optional prepared-choice providers.
- Existing worker authority: `apps/mac/src/native-agents.ts` and `native-safety.ts` — tool kits, scoped MCP, no-commit contract and bounded tool-free advisory children.
- Existing continuity: `services/memory/src/chat-continuity.ts`, [design](chat-continuity-summaries.md) and [native recovery evidence](provider-recovery-and-latency-2026-10-24.md).
- Existing context instrumentation: [startup/context investigation](chat-startup-performance.md).
- Current outcome evidence: [three-workflow walkthrough](final-workflow-walkthrough-2026-10-24.md), [computer timing](computer-speed-2026-10-24.md), [native redesign](workspace-reference-redesign.md), and latest TASK.md entries.

No application code, personal data, provider settings or permissions changed during this inquiry. The document and planning links are local research changes; no commit, push, rebuild or runtime restart was performed.
