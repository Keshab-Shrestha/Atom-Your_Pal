# ATOM Architecture

Project organization (2026-10-21, ADR-183): `ProjectSidebarScope` supplies pure catalog search/visibility/fallback rules. `IslandSettings` stores only the filter ID; `IslandModel` activates it only after a project catalog and reconciles removed IDs on chat-list updates. The current chat/composer/location are not changed. A root-owned `ProjectSettingsSheet` resolves its target by ID and uses existing individual host commands/response state. No new backend/protocol or permission. [Scope](docs/project-filter.md).

Chat workspace presentation (2026-10-21, ADR-182): `ChatWorkspaceLayout` reserves a bounded resizable pane beside the mounted conversation, covering it only below the practical split width. `WorkspacePaneLayout` supplies deterministic geometry; UserDefaults stores only width/surface name. `ProjectWorkspaceState` retains a bounded place per real surface in memory and clears it at existing scope/runtime boundaries. Exact pending-request matching remains authoritative; Undo blocks surface switches and invalidates other places. Native View commands remain key-window scoped. No new runtime, filesystem or Git authority. [Behavior](docs/workspace-pane.md).

Per-chat thinking (2026-10-19, ADR-179): live Claude SDK/Codex model catalogs supply supported levels to ModelSettings. The private chat.reasoning handler validates idle/current writable identity and effective provider/model before storing a compound-key chat_reasoning preference. NativeCore captures it once at turn admission. Claude includes it in session identity and resumes with adaptive thinking/effort; Codex passes it per turn without changing thread identity. ChatReasoningMenu renders confirmed chats-event state beside model selection. No grant, transcript or worker-default mutation. [Contract and evidence](docs/chat-thinking.md).

Model picker (2026-10-19, ADR-178): ChatModelMenu hosts a searchable ChatModelPicker over the runtime ModelInfo catalog. Pure ModelPickerCatalog provides provider-scoped identity, custom-current inclusion, deduplication and filtering; IslandSettings persists bounded favorites independently from model selection. All selections still route through IslandModel.chooseChatModel and the existing host-validated chat.model command. Opened-chat identity prevents stale picker actions from targeting another chat. No backend/protocol/database change; thinking/access/pane/project-source work is separately recorded in [interaction plan](docs/t3-interaction-upgrades.md).

Desktop shell (2026-10-19, ADR-176): HelpersView supplies the same neutral palette, sidebar width and compact WindowTopBar to every destination. SettingsSidebar uses existing SettingsPage selection plus local category-name filtering; search focus requests reach whichever sidebar is mounted. Projects/chats share a scroll region and app destinations retain persisted drag/reorder. Settings controls and ProjectWorkspaceView retain their existing model operations beneath the revised layout. Appearance uses existing Daylight/Void choices and companion theme light/dark identity. No new backend, protocol, state migration or dependency. [Scope](docs/desktop-t3-design.md).

Native file review (2026-10-18, ADR-167): An optional NativeTeamDeps approveFileEdit callback carries bounded canonical target/before/after data through ComputerBridge on the existing private approval event. Native state decodes exact bounded payloads, WorkStrip opens Board/Needs you and a dedicated card computes the existing inline diff off the UI thread with complete plain-text Before/After tabs. A fresh review token and captured request id gate native/host answers; generic approval cannot substitute. Telegram/API needs summaries omit review content/token and provide Decline only. Legacy hosts without the callback retain the small card; native refusal never falls back. Source-bound apply/checkpoint/hold behavior is unchanged, with no new database schema or dependency. Typecheck/static review and Swift release compilation recorded in STATUS; tests/app/live acceptance skipped. [Exact scope](docs/codex-native-file-review.md).

Reviewed preview-input edits (2026-10-18, ADR-166): Root folders routers retain canonical source hashes from successful cleaned-up previews in task-owned receipts. ReviewPreviewEdit checks exact input ownership/current admission, current Read/Write/plan policy and fresh complete before/after approval. A separate synchronous commit phase requires verified snapshots even in task worktrees, stages/fsyncs content and rechecks paths/hashes/identity before rename. The existing helper checkpoint store adds guarded rows whose expected output hash is armed before replacement and never inferred at finish/startup; existing Board Undo consumes these rows with bounded hash checks. Receipts and target holds are ephemeral; pending/failed reviews block same-worker host Write/Edit and repeat review, and task-end abort precedes clearing them. Snapshots retain existing retention. No generated-output attestation, automatic diff parsing, larger/multi-file apply, external-editor CAS or filesystem/SQLite transaction. No Swift/dependency changes; source/typecheck/static review only, no tests/migration/apply/live execution. [Exact scope](docs/codex-preview-edits.md).

Codex disposable shell previews (2026-10-18, ADR-165): Project folders routers expose ProjectShellPreview beside fixed inspection, sharing serial ownership and current project/task admission. Checked bounded text inputs become independent private baseline/work copies outside the real task root. The shared managed-aware command executor uses a distinct profile with baseline read/copy write, original-root denial, minimal runtime and networking off. Native Read/Bash/plan plus a full-request card precede launch. Diff runs inside the sandbox; the host monitors metadata only and returns untrusted output/hash provenance without applying changes. Best-effort resource monitoring and bounded process/pipe/temporary cleanup also tighten inspection. No schema/dependency/Swift change or native model shell enablement. Source/typecheck/static review only; tests/adapter/live execution skipped. [Exact scope](docs/codex-shell-previews.md).

Codex advisory children (2026-10-18, ADR-164): root routers expose ConsultWorker through a bounded per-parent owner. NativeGate admits only active same-chat root parents after plan approval; helper storage transactionally adds linked running children with durable native_scope=advisory. Separate ephemeral Codex adapters use an empty host catalog and unchanged native lockdown; native policy also denies every advisory tool. Two attempts, serial execution, per-child deadline and parent-owned cancellation prevent recursive/fan-out execution. Model pin/usage/Board reporting remain per job; reports are bounded unverified advice. Scope persists after parent unlinking and blocks independent Retry/Interrupt. Native helpers add optional advisory metadata for labels/control guards/parent navigation. No delegated grants, project worktrees, external adapters or skill loading. Additive schema reviewed only; typecheck/Swift release/static review, no tests/migration/live calls. [Details](docs/codex-advisory-workers.md).

Codex worker browser (2026-10-18, ADR-163): the router captures the existing worker browser stdio configuration and exposes one fixed Browser host tool only on granted non-think workers. The native browser lane/site policy runs before startup; host-only interaction cards and plan checks share the existing approval surface. A browserSeen helper shares SDK/host page/ref state and taint. Fixed-argument actions use returned/current refs, explicit inline snapshots and current-origin approval; URL/target checks repeat after approval. Task-owned connections recheck worker/task/grant/configuration, including idle revocation, and close before lane/task cleanup. No new native Codex browser configuration, dependency, schema or Swift source. Typecheck/static review only; tests/live browser startup skipped. [Details](docs/codex-browser.md).

Codex external MCP (2026-10-18, ADR-162): the worker router owns per-task SDK connections and exposes MCPList/MCPCall only for tested/enabled task-start server assignments on non-think kits. Live bounded discovery intersects the saved tested tools; exact returned definitions are refreshed before native grant/plan/trust approval and dispatch. Configuration fingerprints and current worker/task checks govern operations and idle connection cleanup. NativeGate's host-MCP option adds plan checks, bounded argument cards and fresh approval after external content; mcpRead propagates untrusted-result taint to the foreground. Existing Board observation stores generic outcomes only. No new provider/native MCP configuration, dependency, schema or Swift source. Typecheck/static review only; tests/live calls skipped. [Details](docs/codex-external-mcp.md).

Codex project inspection (2026-10-18, ADR-161): host-only ModelRequest.project distinguishes a project from attachment file copies. Runtime rechecks source project/folder binding; folders workers get a fixed-utility ProjectCommand adapter only on macOS. Application validation supplies canonical argv/read targets, then native Bash/plan and Read/Glob policy runs. The gateway's standalone Codex sandbox executor isolates configuration/environment, applies a read-only task profile and bounds process-group lifetime/output; no model request or unsandboxed fallback. Existing Board observation stores generic outcomes only. No new schema, native model shell or dependency. Compile/static review only; tests/live adapter acceptance skipped. [Details](docs/codex-project-inspection.md).

Codex worker models (2026-10-18, ADR-160): helpers own a separate helper_codex_models table and optional codexPinnedModel view field. A strict private helper.codex.pin command validates current offered Codex models before storage; the native picker uses the existing info provider catalog. The router captures/validates the pin before Agent admission and passes it to the same signed-in Codex adapter, otherwise inheriting the chat's model. Running tasks, Claude pins, active-provider routing and tool policy are unchanged. Board/usage preserve requested/actual model reporting. Agent removal clears its pin. No fallback/provider endpoint/dependency/search enablement. Typecheck/Swift release/static review only; tests/migration/live checks skipped. Existing CI remains unresolved at user direction. [Details](docs/codex-worker-models.md).

Codex public pages (2026-10-18, ADR-159): NativeCore supplies a host-only ModelRequest.web admission flag. Runtime adds a current global/project/source-chat configuration check to the Codex router; only research workers expose WebFetch. The direct HTTPS reader validates/pins public IPv4 DNS results, rechecks native URL/kit/task policy on redirect destinations and bounds requests, response bytes, time and returned text. A shared NativeGate.webRead helper serves SDK PostToolUse and host responses/redirects, preserving worker-to-main taint propagation. Existing Board observation omits URL/page bodies. No schema, dependency, search vendor, browser/plugin/native Codex privilege or provider fallback. Typecheck/static review only; tests/live checks skipped. [Details](docs/codex-public-pages.md).

Codex worker instructions/activity (2026-10-18, ADR-158): NativeTeamDeps supplies an optional bounded local skill reader. The Codex router exposes Skill for assigned names, rechecks current assignment/active-task policy, budgets returned text and records use at successful return. NativeGate skips SDK preload/authorization accounting for this host-managed path; Claude accounting is unchanged. Worker identity instructions use a Codex host contract, and main delegation describes actual limits. A worker-only observer writes fresh-id start/end events to the existing Board timeline, retaining bounded/redacted file targets and fixed outcomes. No schema, provider endpoint, plugin execution or native Codex privilege change. Typecheck/static review only; tests/live checks skipped. [Details](docs/codex-worker-capabilities.md).

Durable foreground recovery (2026-10-18, ADR-157): memory owns foreground_attempts/foreground_answers; the private island command handler claims typed delivery before attachment preparation, then passes its chat-bound identity through VoiceLoop/ZenoInput into Core. NativeCore's successful exchange callback supplies completion metadata; ChatStore saves history and its reply sequence/hash pointer in one transaction. Host question settlement persists an answer before model delivery. ChatInput v3 retains outbound input and question intents until matching receipts/fingerprints; no restored item auto-dispatches. Recovery list/read/dismiss/ack stays private-pipe only; normal archived acknowledgement scrubs redundant payloads, while unknown attempts remain retained. Retention excludes unreviewed source chats, and explicit deletion scrubs journal payloads. Composed cores/worker recovery are separate; no provider endpoint/dependency or generic effect ledger added. Compile/static review only; tests/migration/live checks skipped. [Details](docs/foreground-recovery.md).

Chat work visibility (2026-10-18, ADR-156): runtime ChatWorkBridge brackets the primary window Core with monotonic foreground timing and bounded snapshots. NativeCore observes main Claude SDK tool blocks only during send; Codex wraps its checked foreground runner with a captured run identity. Composed cores/worker internals are excluded. Main-only ask_user joins the existing host tool runner and uses a separate private-pipe question response command, cancellation and expiry. Successful Core records append labeled clarification JSON to the saved user text, retaining cross-provider/restart context without a second archive writer; failed-turn delivery remains unchanged. Swift attaches snapshots to matching visible turns, interpolates elapsed time and renders folded logs/question cards. Existing inspect responses gain read-only host access metadata. A host-only ModelRequest.interactionTools runner keeps clarification separate from read-only history; native chat.work.watch opts a card-capable UI into waiting. No new DB schema, provider endpoint or dependency. Compile/static review only; tests/live checks skipped. [Details](docs/chat-work-visibility.md).

Conversation controls (2026-10-18, ADR-155): native ChatControlsState correlates UUID requests/replies for inspect/page/flags/fork over the private JSON-lines protocol. The synchronous host handler validates revision/idle/writer constraints, uses the existing memory store, resumes a new private fork, then sends authoritative chat state before the control response. SQLite flag versions support conditional Undo; a child transcript and durable branch request record commit together. Source snapshots use SHA-256 of saved roles/text; page payloads are bounded separately from live rendering. Forks inherit project/own model metadata but create fresh provider sessions and carry no source chat grants or attachment bytes. Protected retention and complete project-delete cleanup account for archives/pins/living fork ancestors. Claude reset/limit metadata passes through the existing gateway; no manual Compact endpoint or model call is introduced. Compiled/static review only; tests/live/migration checks skipped. [Details](docs/conversation-controls.md).

Chat navigation batch (2026-10-18, ADR-152–154): Core `ChatFind` searches only loaded original turn strings with bounded literal results; IslandModel owns transient query/navigation ticks. MainWindow routes Command–F to chat find and Shift–Command–F to existing global search. A SwiftUI reader jumps to the selected turn while ChatScrollView suspends native following. Native `ProjectFileNavigation` resolves metadata under the current host-supplied ProjectInfo, serving finished-reply Finder chips and debounced @ file search; canonical/no-symlink checks repeat before reveal or draft insertion. `MentionItem.projectFile` carries an in-process relative path; no wire change. Background metadata tasks cancel/discard stale results; snapshots skip traversal. No runtime/gateway/schema/dependency change. Compiled/static review only; tests/live checks skipped. [Details](docs/chat-find-and-project-files.md).

Paste and quoting batch (2026-10-18, ADR-149–151): Core `HiddenCharacters` owns scalar cleanup, and `ComposerQuote` builds a bounded text quote. The existing scoped Command–V monitor delegates text pastes to Composer; native short insertion retains selection/Undo semantics, while long text is written through the private native `PastedTextFile` store and referenced by the existing ComposerDraft. IslandModel adds a review-before-send cleanup fallback and resolves quote turn ids against the current conversation; a focus tick requests composer focus. No wire/runtime/model gateway/schema/dependency change. User explicitly requested batching; tests/live checks skipped, compilation/static review only. [Details](docs/chat-paste-and-quoting.md).

Composer file previews (2026-10-18, ADR-148): native `AttachedFilesRow` moves into `ChatAttachments.swift`. Each file has a cancellable QuickLookThumbnailing request for a 32-point image, an icon fallback, a Preview button and a separate Remove button. A row-local URL binding drives SwiftUI Quick Look; chat identity resets the row and removal clears the selection. Regular/readable checks happen before preview; host attachment/policy checks still run at send time. Note ids, draft storage and queue payloads are unchanged. Snapshot rendering uses static symbols. Compilation/static review only; tests/live checks skipped. [Details](docs/chat-attachment-previews.md).

Conditional transcript scrolling (2026-10-18, ADR-147): `ChatScrollView` wraps the existing SwiftUI `Scrollable` only for chat. A view-local AppKit probe observes its enclosing NSScrollView, document/clip size and scroll notifications; a follow latch separates content growth from reader movement. Deferred guarded native scrolling follows the actual document end, including padding. A separate footer button resumes it. Chat identity/replay resets the latch; snapshot rendering remains flat. No model/runtime/wire/persistence change. Compilation/static review only; tests/live checks skipped. [Details](docs/chat-scrolling.md).

Long user-message display (2026-10-18, ADR-146): pure Core `UserMessagePreview` produces a bounded Unicode-safe excerpt beyond 600 characters/eight logical lines. `TurnView` owns a local expansion state and limits collapsed display to eight visual lines. Copy/retry/history/model paths continue to use the full transcript. No runtime/protocol/persistence change. Compilation/static review only; tests and live checks skipped. [Details](docs/chat-message-collapse.md).

Richer Markdown blocks (2026-10-18, ADR-145): Core `MarkdownBlock` adds recursive quotes, rules, structured list items with child blocks/task state and code language metadata. Parsing normalizes line endings, matches backtick/tilde fences and bounds quote/list nesting to 16 levels with visible text fallback. Native `MarkdownBlockView` recursively draws the tree with an erased recursive boundary, reusing existing copy controls. Plain/HTML reply serialization follows the same tree; original Markdown copy is unchanged. No model/runtime/protocol/storage/dependency change. Compiled/static review only; tests and interactive checks skipped. [Details](docs/chat-markdown.md).

Reply copying (2026-10-18, ADR-144): Core `MarkdownCopy.ReplyFormat` separates exact original Markdown, block-based plain text and rich HTML with plain fallback. `ChatCopyControl` accepts explicit content choices for either table or reply menus; user messages use exact plain-text payloads. `Conversation.lastFinishedReply` selects from current visible turns only. MainWindow's native Edit menu validates ⌘⇧C against the active main Chat window/no sheet/no recorder and reads the latest finished reply at invocation. No global shortcut, model/archive lookup or protocol/storage change. Compilation/static review only; tests and live checks skipped. Supersedes ADR-143's whole-reply default of publishing Markdown and HTML together. [Details](docs/chat-copying.md).

Block copying (2026-10-18, ADR-143): pure `MarkdownCopy` in AtomIslandCore serializes code, selected tables (Markdown/HTML, TSV or CSV), and the existing whole-reply payload. Parsed table blocks now retain alignment and escaped pipes. Native `ChatCopyControl` handles the persistent Button/Menu, brief feedback and checked single-item pasteboard writes via `ChatClipboard`. Reply/code/table groups expose accessibility copy actions; copy controls no longer depend on pointer hover. No model/runtime/wire/storage change. Compilation/static review only; tests and interactive acceptance skipped. [Details](docs/chat-copying.md).

Separate queue entries (2026-10-18, ADR-142): native `MessageQueue` is a bounded FIFO of stable-id messages; each has independent text and attachments. `ChatInput` version 2 stores ordered waiting arrays, migrates version-1 single messages in memory, and persists on subsequent saves. Live ids distinguish auto-draining entries from held input; storage never reconstructs the live queue. One active-turn completion advances one message, with a start barrier against duplicate idle events and repeated immediate sends. Stop/navigation/failure/restart hold the entire remaining tail. No turn-id acknowledgement protocol or exactly-once delivery is added. Compiled only; tests skipped. [Details](docs/chat-input-recovery.md).

Native input persistence (2026-10-18, ADR-141): `IslandModel` owns each chat's composer; both native views bind to that shared state. `ChatInputStore` writes a versioned atomic local JSON snapshot under Application Support/ATOM/ChatInput. It stores unsent text and attachment references plus one waiting message per chat. The transient `MessageQueue` is never reconstructed from storage; a restored message needs explicit review/edit/send. Existing chats reopen in their context; orphaned unfinished input moves only by explicit click into an empty writable chat. No backend schema/wire/provider change or turn-delivery journal. Tests skipped by request; compilation only. [Details](docs/chat-input-recovery.md).

Task lifetime and status (2026-10-18, ADR-140): host policy gates own per-job cancellation for native/Codex approvals; Stop no longer depends on SDK task-id delivery. The file policy checks cancellation again before lasting grants/checkpoints. The window task dispatcher publishes queue activity, and the island combines it with worker/foreground state and pending approval ids to restore existing asking/idle states safely. No new Swift/wire shape or persistence layer. [Scope and checks](docs/task-state-lifecycle.md).

First-turn provider persistence (ADR-139 live follow-up, 2026-10-18): explicit choices for chats with no transcript are stored in memory SQLite's `pending_chat_models`, read through the existing model lookup, and promoted atomically into the chat row on first save. Reset/removal clears the pending choice. This replaces the runtime-only map without inventing messages or implementing a turn journal. A real Codex interruption/retry exposed the gap and the corrected two-file workflow passed.

Task recovery (2026-10-18, ADR-139): the helpers store keeps interrupted outcomes and durable source/next retry identities. All native retry entry points persist one attempt before dispatch; the worker claims that attempt once. Runtime derives provider/project/read context from persisted ancestry, while permissions remain scoped to the new chat. SDK connection loss preserves unknown outcomes and prevents automatic fresh-session replay after host dispatch. Board exposes review before retry. This is task-attempt recovery, not an exactly-once operation or chat-turn journal. [Behavior, migration and evidence](docs/task-recovery.md).

Current continuity/provider changes (2026-10-17, ADR-135–137): the Core preserves each chat's full saved transcript across restarts and provider changes. Explicit file permissions live in the memory store by chat and canonical path; the model cannot create them. Codex app-server transport lives in the LLM Gateway, while the Mac host router reuses the policy gate, Board, approvals and checkpoints for checked tools and file agents. Native Codex execution and imported MCP tools are disabled and verified before a model turn. Text editing follows the active chat provider through the gateway, without chat context or provider fallback. Codex workers currently have a smaller tool set than Claude workers. See `docs/everyday-workflows.md` for supported scope and remaining live checks.

Long-chat recovery (2026-10-18, ADR-138): `apps/mac/src/chat-history.ts` separates a bounded provider replay window from the full archive and supplies host-bound own-chat search/read tools. Native Claude gets the tools through its MCP runner; Codex receives a host-only `ModelRequest.historyTools` runner through its checked main-thread router. The callback is never serialized into model input or handed to workers. Runtime binds older live sessions to their own saved chat after switching. SDK-native compaction remains provider-owned. [Details and evidence](docs/long-chat-history.md).

---

## 1. Architectural Vision

ATOM is a distributed-capable intelligence system.

The architecture must eventually support:

- one user identity
- multiple devices
- multiple models
- multiple capabilities
- memory
- knowledge
- tasks
- events
- permissions
- cloud synchronization
- team collaboration

However, implementation should begin as a modular monolith.

---

## 2. Long-Term Architecture

```text
USER
  ↓
Voice / Text / UI / API
  ↓
ATOM CORE
  ↓
Identity / Context / Events
  ↓
Deterministic Router
  ├── Memory
  ├── Knowledge
  ├── Decision Engine
  │      └── Laya / Jev
  └── LLM Gateway
         ├── Claude
         ├── OpenAI
         └── Future Providers
  ↓
Capability Manager
  ↓
Policy / Permissions
  ↓
Mac / iPhone / Windows Nodes
  ↓
Tasks / Events / Results
  ↓
ATOM
```

---

## 3. Phase 0 Architecture

Phase 0 intentionally simplifies the architecture.

```text
Audio Input
    ↓
Whisper Adapter
    ↓
ATOM Core
    ↓
LLM Gateway
    ↓
Provider Adapter
    ↓
TTS Adapter
    ↓
Audio Output
```

---

### Phase 0.5: Desktop Island

Phase 0.5 adds an interface process in front of the same pipeline (ADR-033 to ADR-038):

```text
ATOM Island (Swift app)                      ATOM runtime (Node)
  hover reveal, Ctrl+Option, panel UI          voice loop → Core → LLM Gateway
        │  commands: talk.start, talk.send…         ▲
        └──────── stdin (JSON lines) ───────────────┘
        ┌──────── stdout (JSON lines) ──────────────┐
        ▼  events: state, mic.level, reply…         │
```

- The island is display and input only. It holds no conversation state and makes no model calls.
- The runtime is the Phase 0 program in island mode. The Core does not know which interface drives it.
- The island starts the runtime as its child process, restarts it if it exits, and stops it on quit.
- The message format is defined in `docs/island-protocol.md` and is the boundary between the two.

This is an interface for the Mac node only. It is not the future device protocol (`packages/protocol/`, Phase 7+).

---

## 4. Input Layer

Input sources may eventually include:

- microphone
- keyboard
- application UI
- mobile UI
- API
- external events

All input should eventually enter a normalized ATOM request model.

---

## 5. ATOM Core

The Core is the central orchestration boundary.

Responsibilities may include:

- request lifecycle
- context assembly
- routing
- task creation
- event handling
- response generation
- coordination

The Core should not become a giant class containing every subsystem.

---

## 6. Identity

Identity establishes:

- user
- account
- session
- device
- authorization context

Identity must be deterministic.

The LLM should not determine who the user is.

---

## 7. Context

Context may contain:

- User
- Session
- Conversation
- Task
- Project
- Device
- Permissions
- Relevant Memory
- Relevant Knowledge

Only authorized context should be provided to a model.

---

## 8. Deterministic Router

The router should determine whether a request can be handled directly.

Example:

```text
Request
 ↓
Router
 ├── deterministic capability
 ├── memory
 ├── knowledge
 ├── decision engine
 └── LLM
```

The router should avoid unnecessary model calls.

---

## 9. Decision Engine

The Decision Engine exists between deterministic logic and expensive/general reasoning.

Example:

```text
Request
 ↓
Deterministic Router
 ↓
Ambiguous?
 ↓
Decision Engine
 ↓
Select Path
```

Potential implementations:

- Laya
- Jev

The Decision Engine must be replaceable.

---

## 10. LLM Gateway

The LLM Gateway isolates ATOM from model providers.

```text
LLM Gateway
├── Claude Adapter
├── OpenAI Adapter
└── Future Adapter
```

Provider-specific logic belongs inside adapters.

---

## 11. Memory

Memory is persistent user-specific information.

Possible memory records:

```text
Memory
├── ID
├── Type
├── Content
├── Provenance
├── Confidence
├── Importance
├── Scope
├── Created At
├── Updated At
└── Lifecycle
```

Memory is separate from raw conversation history.

---

## 12. Knowledge

Knowledge represents information available to ATOM.

Knowledge may be:

- personal
- project
- team
- organization
- platform

Knowledge retrieval must respect permissions.

---

## 13. Knowledge Scope

```text
Platform
↓
Organization
↓
Team
↓
Project
↓
User
↓
Assistant
↓
Device
↓
Session
```

More specific scopes should not automatically override authorization boundaries.

---

## 14. Capability System

Capabilities represent controlled operations.

Example:

```text
calendar.create_event
calendar.list_events
calendar.update_event
calendar.delete_event
```

Capabilities contain metadata about:

- permissions
- devices
- credentials
- dependencies
- version
- health

---

## 15. Capability Manager

The Capability Manager:

- registers capabilities
- validates capabilities
- exposes available actions
- checks dependencies
- manages versions
- tracks health

It should not bypass the Policy Engine.

---

## 16. Policy Engine

The Policy Engine determines whether an action is allowed.

```text
Proposed Action
 ↓
Policy
 ↓
Permission
 ↓
Capability
 ↓
Device
 ↓
Execution
```

Policy decisions must not depend solely on an LLM.

---

## 17. Device Manager

The Device Manager maintains information about ATOM nodes.

Example:

```text
Device
├── Identity
├── Platform
├── Capabilities
├── Permissions
├── Connection
├── Health
└── Version
```

---

## 18. Device Registry

Example:

```text
Devices

Mac Mini
├── filesystem
├── applications
├── browser
└── audio

iPhone
├── microphone
├── notifications
└── mobile capabilities

Windows PC
├── filesystem
├── applications
└── desktop
```

Actual permissions depend on the device.

---

## 19. Tasks

Tasks represent work that can span multiple operations or time.

Example:

```text
Task
├── ID
├── User
├── Objective
├── Status
├── Steps
├── Permissions
├── Devices
├── Results
└── Provenance
```

---

## 20. Events

Events represent occurrences.

Examples:

- task completed
- calendar event approaching
- device connected
- application state changed

Events can trigger tasks or notifications where authorized.

---

## 21. Conversation vs Task

These concepts must remain separate.

A conversation is communication.

A task is work.

Example:

```text
Conversation:
"Can you prepare my report?"

Task:
Prepare report
├── find files
├── analyze
├── draft
└── save result
```

---

## 22. Multi-Device Execution

The user should not need to select the execution device.

Example:

```text
iPhone
 ↓
ATOM
 ↓
Capability Registry
 ↓
Mac
 ↓
Action
 ↓
Result
 ↓
ATOM
 ↓
iPhone
```

---

## 23. Cloud Architecture

Future:

```text
          ATOM CLOUD
               │
  ┌────────────┼────────────┐
  │            │            │
Memory      Knowledge    Tasks
  │            │            │
  └────────────┼────────────┘
               │
         Device Registry
               │
  ┌────────────┼────────────┐
  │            │            │
 Mac         iPhone       Windows
```

Cloud coordinates.

Local devices retain controlled authority.

---

## 24. Multi-User Architecture

Future hierarchy:

```text
Organization
 ├── Teams
 │    ├── Projects
 │    └── Shared Knowledge
 │
 └── Users
      ├── Personal Memory
      ├── Personal Knowledge
      └── Devices
```

Data must remain isolated by authorization scope.

---

## 25. Modular Monolith

Initial architecture should be modular.

Possible logical modules:

- Core
- Memory
- Knowledge
- Decision
- LLM
- Tools
- Capabilities
- Devices
- Policy
- Tasks
- Events

These do not need to be separate processes.

---

## 26. Future Distributed Architecture

Only when scale requires it may modules become services.

Potential future:

- API
- Core
- Memory Service
- Knowledge Service
- LLM Gateway
- Decision Service
- Capability Service
- Device Service
- Task Service
- Event Service
- Policy Service

This is future architecture, not Phase 0.

---

## 27. Observability

Eventually track:

- request ID
- task ID
- device ID
- provider
- model
- latency
- errors
- actions
- provenance

Sensitive data should not be logged unnecessarily.

---

## 28. Architectural Rule

Do not implement an architectural component until the current capability requires it.

The architecture describes where ATOM is going.

The task system determines what is built now.


ADR-169: each saved chat has an optional bounded user-maintained brief and independent version on its existing SQLite row. The existing private chat.control channel inspects/version-checks it; NativeCore reads the exact chat’s latest brief on every provider request, separately from transcript replay. Forks start empty. This data neither authorizes tools nor creates global memory. [Scope](docs/chat-brief.md).


ADR-170: the local memory database keeps one window chat-selection identifier in chat_navigation. Only the island host records/reopens it, before input listeners, through existing Core.resume and project replay. Startup publishes the current history after Ready using existing events; early manual navigation wins. Selection is separate from background chat recency and never submits input or resumes work. [Scope](docs/chat-reopening.md).

ADR-171: the current local project chat owns a native Files / Changes workspace. One private request/response shape joins deterministic bounded folder/text reads with existing helper checkpoint provenance/review/Undo. Source chat/project/request identities reject stale results; the host resolves the canonical project root on every operation. A review token binds an exact checkpoint and original/current hashes before single-file Undo. No provider, filesystem watcher, migration, parallel history store or new grant is added. [Scope](docs/project-workspace.md).

ADR-172: `workspace.git`/`workspace.gitReview` add bounded asynchronous Git inspection to the same native project pane. Fixed Git reads return grouped status and raw HEAD/index/disk (or conflict-stage) text, with source-chat/project/root revalidation and stale-result rejection. Whitespace normalization is native comparison presentation only. No provider, Git mutation, migration or new permission is introduced. [Scope](docs/git-workspace.md).


ADR-173: `prepareWorkdir` resolves the creation commit before adding a new task branch and records it through `task-branch-base.ts` in host-owned metadata beside worktrees. Branch review resolves saved or explicitly estimated bases into immutable object IDs. `Projects.gitFolders` supplies active rechecked roots to Git discovery; repository-wide review requires a repository-root project or existing agent grant. Native cards expose saved/estimated provenance and local behind counts with explicit refresh. Push keeps its separate grant/confirmation boundary. [Details](docs/task-branches.md).


ADR-174: `ChatActionsMenu` supplies compact native ellipsis controls for message/reply actions and the single header Chat options menu. `ConversationControls` now owns its sheets/popovers from the stable top bar; `ConversationTab` retains only conditional mutation feedback. Message menus reuse existing clipboard, quote and fork callbacks; fixed reply gutters avoid streaming completion reflow. No host/protocol/persistence change. [Locations](docs/conversation-controls.md).


ADR-175: `ChatAppearance` adapts pinned T3 Code light/dark chat tokens and column geometry without changing stored AppTheme choices. `HelpersView` scopes the neutral chat palette/chrome to the chat page. `ChatUserBubbleLayout` bounds natural-width messages at 80% without a row GeometryReader; shared conversation/composer views retain existing state and callbacks. Hover/focus menus retain native actions and VoiceOver visibility. The empty-chat composer has one stable view identity. No runtime/protocol/persistence boundary changes. [Source/evidence](docs/chat-t3-design.md).

## Chat access admission (ADR-180, 2026-10-21)

The composer access menu writes an additive chat-scoped preference through a strict current/idle/writable/expected-mode command. NativeCore captures it for all sources and source-chat task/retry cores. Chat only omits automatic external context and tools while retaining saved conversation/brief; Claude and Codex gates additionally deny forged calls. Ask before changes applies a host-owned fresh per-call approval before native/file/worker admission. Session/runner identity includes access, current mode is rechecked per call, and background work blocks changes. Gemini refuses restricted turns before launching its CLI. No Full access mode. See [access behavior and verification](docs/chat-access.md).

## Full access admission (ADR-181, 2026-10-21)

Full access is a host-confirmed per-chat mode, not a global setting or new provider tool. The current/idle/writable/expected-mode check runs before and after consent; cancellation, navigation/new input and provider/task changes refuse stale activation. The complete scope appears on an expanded native approval card. Ordinary-file overwrite/classified-command/site-opening/already-granted-plugin confirmations can be skipped; path/secret/kit/sandbox/macOS/external-content/undo/cancellation/resource checks and protected action approvals remain. A granted plugin may operate outside ATOM's file sandbox. Full access persists only for its chat; new and forked chats remain checked. Exact-file grants and history are unchanged. [Detailed boundary and verification](docs/chat-full-access.md).


ADR-184: sidebar navigation has one Projects filter/settings entry, one source chooser and one scoped New chat. A unified active chat list replaces the permanent project tree. Project source operations cross the private pipe as correlated create/cancel/created messages; the host validates canonical exclusive destinations, runs bounded fixed-argv Git with isolated configuration, then calls existing checked project registration. Cancellation/quit abort the process group; native state rejects unmatched completions. No provider/model tool route or transcript/access migration. [Contract](docs/project-sources.md).


ADR-185: Workspace Browser is a native user-operated WebKit session owned by the current IslandModel chat scope, separate from ProjectWorkspaceState's host file operations and agent Chromium profiles. Its view/session survives same-chat surface close/reopen; identity/runtime reset destroys temporary website storage and rejects old-view callbacks. No protocol/provider tool or model-context integration. [Details](docs/workspace-browser.md).

ADR-186: Workspace Terminal embeds a pinned SwiftTerm native emulator with an explicit delegate over the testable WorkspaceTerminalProcess PTY transport and a small POSIX C launch/cleanup target. Launch is user-only and explicit, starts in a rechecked project root with a minimal environment, and has no host/model command route. The pane owns presentation; Stop/surface exit/window closure/scope/runtime/quit own termination. A process exit monitor reaps the exact child after session cleanup. The stopped buffer is memory-only; only surface preference persists. Compact panes use a surface menu. The distributed app includes the upstream license/resource bundle. [Scope and limits](docs/workspace-terminal.md).


ADR-194 (23 October 2026): reviewed personal-source expansion reuses Second brain with per-source format metadata, preserving the original folder table and existing text-only scopes. A private bounded AtomDocuments executable reads PDF text layers or validated main Word XML via stdin. Explicit saved-note selections extend the existing brief preparation flow with bounded source snapshots and revision/profile checks. Private note-bearing cards and ordinary deliverable brief lines use separate isolated selected-profile requests. No new content store, account connector, automatic scan, agent permission or primary local-model route. See [scope and validation](docs/everyday-assistant-polish.md).


ADR-195/196 (23 October 2026): the main AppKit window owns user sizing; the title-bar drag view has one owner for dragging/zoom. Orbit is an additive avatar drawing family shared across companion, portraits, icon and floor, with legacy/custom fallback. Studio preserves workstation anchors, seat capacity and pathfinding while spreading lounge anchors into three rows, and retains existing task/approval navigation; canvas accessibility actions open the same routes. Reduced motion uses a stationary scene. No runtime execution, permission or database changes. [Scope and evidence](docs/studio-redesign.md).
