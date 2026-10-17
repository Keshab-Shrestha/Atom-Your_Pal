# T3 Code: sessions and the provider layer

Source: github.com/pingdotgg/t3code (MIT licence). Read on 2026-10-17 from a shallow clone at commit `2fbd4318`.
Scope: sessions (threads), models, the provider layer, approvals, resume, fork, history, attachments, composer.
Paths are relative to the T3 Code repository unless they name an ATOM folder.

Marks used in this file:

- "Verified" means the author read the code.
- "Unverified" means the claim comes from a doc page or a type name only.
- "Not found" means a search found nothing.

---

## 1. What T3 Code does here

### 1.1 The object model

T3 Code separates what the user sees from what the provider holds.
The design text is `docs/orchestration-v2/core-graph-and-data-model.md`. The schemas are in `packages/contracts/src/orchestrationV2.ts`.

| Object | Schema name | What it is |
| --- | --- | --- |
| Thread | `OrchestrationV2AppThread` | The conversation the user sees. Stable across provider changes |
| Run | `OrchestrationV2Run` | One counted user turn, with an `ordinal` and a status |
| Run attempt | `OrchestrationV2RunAttempt` | One try at a run. A steer or retry makes a second attempt |
| Execution node | `OrchestrationV2ExecutionNode` | A step in a run: message, tool call, approval, plan, subagent |
| Provider session | `OrchestrationV2ProviderSession` | A live or resumable provider process |
| Provider thread | `OrchestrationV2ProviderThread` | The provider's own conversation handle (for Claude, a session id) |
| Context transfer | `OrchestrationV2ContextTransfer` | A durable link for a fork or a provider switch |
| Context handoff | `OrchestrationV2ContextHandoff` | Text bridge used when a native fork or resume cannot work |
| Runtime request | `OrchestrationV2RuntimeRequest` | An approval or question that waits for the user |
| Checkpoint | `OrchestrationV2Checkpoint` | A file snapshot at the end of a run, used for rollback |

Rules (verified in `docs/orchestration-v2/README.md`):

- App ids are primary. Provider ids are only references.
- Only the root run completes a user turn. A subagent ending does not end it.
- A provider switch makes no new thread. A fork makes a new thread.

Thread fields (verified): `title`, `providerInstanceId`, `modelSelection`, `runtimeMode`, `interactionMode`, `branch`, `worktreePath`, `lineage`, `forkedFrom`, `archivedAt`, `pinnedAt`, `settledAt`, `snoozedUntil`, `lastVisitedAt`, `limitRecovery`.

Run status (verified): `preparing`, `queued`, `starting`, `running`, `waiting`, `completed`, `interrupted`, `failed`, `cancelled`, `rolled_back`.

### 1.2 Events, snapshots, history and paging

- Every change is an event in a SQLite log. Each stored event has a growing `sequence`.
- A client reads a snapshot at sequence N. Then it reads the events after N.
- A client resumes with `afterSequence`. The stream items are `synchronized`, `snapshot`, `event` and `unknown-event` (`OrchestrationV2ThreadStreamItem`).
- An old client skips an unknown event type but still moves its cursor. Servers and clients upgrade apart.
- A snapshot is a bounded window (`OrchestrationV2ThreadBoundedSnapshot`: `historyCursor`, `hasMoreHistory`).
- `THREAD_HISTORY_PAGE_POLICY` (`apps/server/src/orchestration-v2/threadHistoryPaging.ts`) sets 10 user turns, 75 items, 1 MiB per page.
- "Load earlier" fetches 20 more user turns (`OLDER_THREAD_USER_TURN_LIMIT`). The cursor is opaque base64url JSON.
- The client merges older pages in `packages/client-runtime/src/state/threadHistoryMerge.ts`. It drops an idle cached thread after 5 minutes (`THREAD_SNAPSHOT_IDLE_TTL_MS`).

### 1.3 Thread commands

The commands are variants of `OrchestrationV2Command`.

| Group | Commands |
| --- | --- |
| Life | `thread.create`, `thread.archive`, `thread.unarchive`, `thread.delete` |
| List order | `thread.pin`, `thread.unpin`, `thread.pin.reorder`, `thread.visit`, `thread.mark-unread` |
| State | `thread.settle`, `thread.unsettle`, `thread.snooze`, `thread.unsnooze` |
| Name | `thread.metadata.update` (`title`, `regenerateTitle`) |
| Settings | `thread.runtime-mode.set`, `thread.interaction-mode.set`, `thread.model-selection.set` |
| Turns | `message.dispatch`, `run.interrupt`, `queued-message.promote-to-steer`, `queue.resume`, `queued-run.reorder`, `queued-run.cancel`, `queued-run.edit` |
| Requests | `runtime-request.respond`, `thread.user-input.dismiss` |
| History | `checkpoint.rollback`, `thread.fork`, `thread.merge_back`, `provider.switch` |

Pin, archive, settle and snooze show a toast with Undo for 5 seconds (`docs/user/thread-sidebar.md`).

### 1.4 How a turn runs

The order comes from file names, docs and types. The author did not trace `RunExecutionService.ts` line by line (unverified in detail).

1. The client uploads files. They are "pending" attachments.
2. The client sends `message.dispatch` with a `dispatchMode` (see 1.10).
3. `ThreadMessageIntake.ts` claims the attachments for the thread and checks the limits.
4. `Orchestrator.ts` writes events in one transaction and returns the sequence.
5. `RuntimePolicy.ts` resolves cwd, runtime mode and interaction mode.
6. `ProviderSessionManager.ts` opens or reuses a session. `ProviderSessionTransitionPolicy.ts` decides which.
7. The adapter starts the turn and streams `ProviderAdapterV2Event` values.
8. `ProviderEventIngestor.ts` turns them into app events. The projection updates and clients get the events.
9. A `turn.terminal` event ends the run (`completed`, `interrupted`, `cancelled`, `failed`). It marks the provider thread `reusable` or `broken`.
10. Checkpoint capture runs after the turn end. It is a separate milestone.

### 1.5 Resume

- The session record is durable. The live process handle is not. After a restart the manager rebuilds the runtime from the record.
- The Claude adapter passes `resume: <native id>` when a prior turn exists. Else it passes `sessionId` (`ClaudeAdapterV2.ts`, near `threadIdentity`).
- It also passes `resumeSessionAt` from the stored conversation head, to resume at one message.
- The manager releases an idle session after 30 minutes (`DEFAULT_IDLE_TIMEOUT_MS`). A pin can hold it up to 4 hours.
- After a server restart, queued messages stay saved but held. The user presses Resume (`queue.resume`).

### 1.6 Fork, rollback and "edit from here"

- `thread.fork` has `sourceThreadId`, `targetThreadId` and a `sourcePoint` (run, node or provider thread).
- `ThreadForkService.ts` allows only these source statuses: `completed`, `waiting`, `failed`, `interrupted`, `cancelled`.
- The fork copies the thread, sets `lineage` and `forkedFrom`, and records a `ContextTransfer` with status `pending`.
- The real fork runs at the first run of the new thread. The result is `native_fork` or `portable_context`.
- Claude uses the SDK `forkSession(sessionId, { dir, upToMessageId })` (`ClaudeAdapterV2.ts`, `forkThread`). It refuses while a turn is active.
- "Edit from here" is `checkpoint.rollback` with `restoreFiles`. It removes the chosen message and all later ones.
  - File restore works only for worktree threads. The server refuses it if another agent uses the folder.
  - The UI offers it only when the provider reports `supportsConversationRollback`.

### 1.7 Switching model or provider inside a thread

- Each adapter has `planSelectionTransition`. It returns `apply_on_next_turn`, `restart_session`, `create_with_handoff` or `reject` (`selectionTransition.ts`).
- The Claude adapter returns `apply_on_next_turn` for every model change (verified).
- `decideProviderSessionTransition` is a pure function (`ProviderSessionTransitionPolicy.ts`). It returns `reuse`, `switch_model_in_session`, `restart_and_resume`, `create_with_handoff` or `reject`.
- An unavailable target is rejected. No current session, or a different driver or continuation group, means create with handoff.
- A handoff is a budgeted text selection, not an agent summary. The default cap is 16,000 tokens (`DEFAULT_HANDOFF_TOKEN_CAP`). It leaves out reasoning, tool state and attachments (`docs/user/portable-handoffs.md`).
- After the first run, the model picker locks the thread to its "continuation group" (`ProviderModelPicker.tsx`: `lockedContinuationGroupKey`).

### 1.8 Approvals and questions

- An approval or question is an `OrchestrationV2RuntimeRequest`. Kinds: `command`, `file-read`, `file-change`, `mcp-elicitation`, `permission`, `dynamic_tool_call`, `user_input`, `auth_refresh`.
- Status: `pending`, `resolved`, `expired`, `cancelled`.
- `responseCapability` is `live` (the provider waits), `message` (the answer goes as a new user message) or `not_resumable`.
- Decisions: `accept`, `acceptForSession`, `acceptAlways`, `decline`, `cancel` (`ProviderApprovalDecision`).
- `runtime-request.respond` is validated and committed in one transaction (`RuntimeRequestService.ts`).
- The Claude adapter uses the SDK callback `canUseTool`. A tool call becomes a request and waits on a `Deferred` (`canUseToolEffect`).
- `AskUserQuestion` becomes a `user_input` request. `ExitPlanMode` is answered at once and makes a plan card.

### 1.9 Runtime modes, interaction mode, plan mode

| Runtime mode | UI name | Claude `permissionMode` (verified) |
| --- | --- | --- |
| `approval-required` | Supervised | `default` |
| `auto-accept-edits` | Auto-accept edits | `acceptEdits` |
| `auto` | Auto | `auto` |
| `full-access` | Full access | `bypassPermissions` |

- The T3 default is `full-access` (`DEFAULT_RUNTIME_MODE`). ATOM must not copy this default.
- `providerRuntimeMode` in `RuntimePolicy.ts`: if a provider does not list the mode in `supportedRuntimeModes`, the server runs the thread as `approval-required`. Code decides. The model does not.
- `adding-a-provider.md` forbids faking a missing mode in the app. A provider offers only modes it enforces itself.
- Interaction mode is `default` or `plan`. Plan maps to Claude `permissionMode: "plan"` and read-only tools.
- A plan is an `OrchestrationV2PlanArtifact`: `proposed_plan` (markdown) or `todo_list` (steps).
- The web draws a `ProposedPlanCard`. An "implement" message carries `sourcePlanRef`.

### 1.10 Queue, steer, stop

`message.dispatch.dispatchMode` has five values (verified):

| Value | Meaning |
| --- | --- |
| `start_immediately` | Start a run now |
| `queue_after_active` | Wait for the active run to end |
| `steer_active` | Send the message into the running turn (needs `targetRunId`) |
| `restart_active` | Interrupt the turn and start a replacement attempt |
| `defer_start` | Make the run but do not start it |

- Queued messages are saved on the server. The user can edit, reorder, remove or promote one to a steer.
- `queuedRunsInDeliveryOrder` (`QueuedRunOrder.ts`) sorts by `queuePosition`, then `ordinal`.
- A client setting picks Queue or Steer as the default. Cmd+Enter flips it (`docs/user/composer.md`).
- `run.interrupt` has `holdQueue` to stop queued messages from starting.
- Stop is a request first. The final state arrives later in `turn.terminal`.
- A quota error becomes failure class `usage_limit` with a reset time. The thread shows Limited and can resume (`UsageLimitRecoveryWorker.ts`).

### 1.11 Attachments

- Upload starts when the user adds the file. All uploads must finish before send.
- `claimPendingAttachments` copies the pending file into the thread. The pending copy stays as a retry source. A sweep removes it later.
- Attachments live outside the project folder. A path in the prompt gives no file access.
- Limits (`chatAttachment.ts`): 100 files, 10 MiB per image, 80 MiB of images, 50 MiB per file, 120,000 characters of text.
- A text paste of 32 KiB or more becomes a text file attachment. The provider gets a path only, to save context.

### 1.12 Composer features

From `docs/user/composer.md` (docs only, not traced in web code):

- `/` commands, `$` skills, `#` pull requests, `@` another thread as a reference.
- Context chips: terminal excerpt, review comment, file, and a quoted assistant text with a comment.
- ArrowUp in an empty composer recalls sent prompts. Cmd+S stashes a prompt and its files for 24 hours.
- Drafts per thread and a sticky model per provider (`apps/web/src/composerDraftStore.ts`).
- Model picker with search, favorites, hidden models and custom order (`ModelPickerContent.tsx`).
- Traits picker for effort, fast mode, thinking and context size (`TraitsPicker.tsx`).
- Context meter and a "Compact" chip when the prompt cache has expired (`ContextWindowMeter.tsx`, `providers-claude.md`).
- `/compact`, `/goal`, and "Restart agent session".
- Queue panel (`QueuedRunsControl.tsx`). Approval and question panels above the composer.

---

## 2. The provider layer

### 2.1 Driver and instance

- A driver kind names an integration: `codex`, `claudeAgent`, `cursor`, `grok`, `opencode`, `antigravity`, `pi`, `muse`, `acpRegistry`.
- An instance is one configuration of a driver, with its own account, session state and model list.
- Two Claude instances with two config directories are two accounts (`docs/user/providers-claude.md`).
- The default instance id equals the driver kind (`defaultInstanceIdForDriver`). Work is routed by instance id.

### 2.2 The contract a provider implements

Server side, in `packages/provider-core/src/server/`:

| Type | File | Role |
| --- | --- | --- |
| `ProviderDriver<Config>` | `driver.ts` | `driverKind`, `metadata`, `configSchema`, `defaultConfig()`, `create()`, optional `usage` |
| `ProviderInstance` | `driver.ts` | `snapshot`, `refreshModels`, `orchestrationAdapter`, `textGeneration`, optional `auth` |
| `ProviderAdapterV2` | `ProviderAdapter.ts` | `getCapabilities()`, `planSelectionTransition()`, `openSession()` |
| `ProviderAdapterV2SessionRuntime` | `ProviderAdapter.ts` | The per-session API |
| `ProviderTextGeneration` | `textGeneration.ts` | Small tasks: titles, branch names, commit messages |

The session runtime (verified) has: `ensureThread`, `resumeThread`, `readThreadSnapshot`, `rollbackThread`, `forkThread`, `unloadThread`, `startTurn`, `steerTurn`, `interruptTurn`, `respondToRuntimeRequest`, an `events` stream, and optional `compactThread`, `injectHistory`, `hasPendingBackgroundWork`, `getModelContextWindow`.

The adapter reports `OrchestrationV2ProviderCapabilities` with 11 groups: `sessions`, `threads`, `turns`, `streaming`, `tools`, `approvals`, `planning`, `subagents`, `context`, `checkpointing`, `identity`. It adds `runtimePolicy.enforcement` (`native` or `client-boundary`).

- Rule: report only what the provider really does. A missing capability makes orchestration use a fallback.
- Rule: clients read capabilities. They never read the driver kind (`docs/internals/adding-a-provider.md`).
- A new provider lives in `packages/provider-<name>` with `./settings`, `./client` and `./server` exports. The server registers it in `builtInDrivers.ts`.

### 2.3 How an instance is configured

- Server settings hold a map `providerInstances`. Each entry is `ProviderInstanceConfig`: `driver`, `displayName`, `accentColor`, `environment`, `enabled`, `config`.
- Claude `config` has `binaryPath`, `homePath` (sets `CLAUDE_CONFIG_DIR`), `launchArgs`, `autoCompactWindow`, `customModels`.
- `environment` is a list of `{ name, value, sensitive }`. It merges into the process environment (`mergeProviderInstanceEnvironment`).
- At start, `deriveProviderInstanceConfigMap` adds a default instance for each built-in driver, except drivers with `hasDefaultInstance: false`.
- The web form is built from the schema. Annotations set the control: `text`, `password`, `textarea`, `switch`, `select` (`ProviderSettingsFormAnnotation`).

### 2.4 Auto selection and defaults

Server side:

- `DEFAULT_MODEL_BY_PROVIDER` gives one default model per driver (`model.ts`).
- `DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER` gives a cheap model for small tasks. Claude uses `claude-haiku-5-5`.

Client side (verified, `apps/web/src/providerInstances.ts`):

- `resolveSelectableProviderInstanceEntry(entries, instanceId)`:
  1. Use the requested instance if it is enabled and available.
  2. Else use the first instance that is enabled, available and `ready`.
  3. Else use the first enabled, available instance that is not in `error`.
- `getDefaultProviderInstanceModel`: the first non-custom model with `isDefault`, else the first non-custom model, else the table default.
- `resolveDefaultProviderModelSelection` keeps a saved selection while its instance is usable.
- `NO_PROVIDER_MODEL_SELECTION` is a placeholder. It is never saved. The composer disables Send until a real provider exists.
- `resolveProviderCatalogAvailability` returns `loading`, `ready`, `unavailable` or `unconfigured`. It avoids a false "no providers" state while the stream loads.
- New threads use the remembered provider, model and options. A project model default wins.
- Text generation has its own selection. A fallback instance gets the cheap model, not the flagship (`resolveAppModelSelectionState`).

### 2.5 How model lists are found

| Provider | Source |
| --- | --- |
| Claude | A bundled JSON manifest (`apps/server/src/provider/model-manifest.json`). The server also fetches a newer copy from GitHub `main`. The newer `updatedAt` wins. A bad fetch keeps the last good file |
| Codex | The Codex app server `model/list` (`docs/internals/model-manifest.md`) |
| OpenCode, Antigravity | Dynamic lists from the provider |
| Any | `customModels` in the instance config: `{ slug, name, capabilities }` |

- A model that needs a newer CLI is listed in `updateRequiredModels` (`minVersion`). The picker says which update unlocks it.
- T3 Code does not call the SDK `supportedModels()`. A search of `apps/server/src` found no use. ATOM does call it.
- The user can hide, reorder and favorite models (`providerModelPreferences`, `favorites` in `settings.ts`).
- "default" is a sentinel. The adapter must never send it to the provider.

### 2.6 API key and custom endpoint: how the user types it, where it goes

T3 Code has three ways. None is the main path for Claude or Codex, which use the CLI sign-in.

1. A secret field in the driver schema. Example: Antigravity `apiKey`, with `secretSetting` and `control: "password"` (`settings.ts`). The form shows a masked input (`SecretInput.tsx`).
2. Environment variables on an instance, with `sensitive: true` (`ProviderInstanceCard.tsx`). `providers-claude.md` shows OpenRouter: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` (sensitive) and an empty `ANTHROPIC_API_KEY`. This is how a custom endpoint enters.
3. A CLI sign-in (`claude auth login`). T3 Code never reads the token. The web can show a terminal for it (`ProviderAuthTerminal.tsx`).

Where the secret goes (verified):

- `settingsSecrets.ts` finds secret fields (`secretSettingsFields`) and sensitive env rows.
- `moveInlineSettingsSecrets` in `serverSettings.ts` writes each secret to the secret store and leaves a redacted mark in `settings.json`.
- The store is `ServerSecretStore` (`auth/ServerSecretStore.ts`): one file per secret at `<stateDir>/secrets/<name>.bin`. The folder has mode 0700. The file mode is unverified.
- `redactServerSettingsForClient` sends an empty value and a "redacted" flag to clients. `SECRET_REDACTED` is six bullet characters.
- The server does not use the macOS Keychain for these secrets.
- Not found: a spend cap or a "this key is billed" label. T3 Code does not need one: its main providers bill a subscription.

### 2.7 Health checks and sign-in status

- The client sees `ServerProvider`: `enabled`, `installed`, `version`, `status` (`ready`, `warning`, `error`, `disabled`), `auth`, `checkedAt`, `message`, `models`, `usageLimits`, `updateState`.
- `ServerProvider.auth` has `status` (`authenticated`, `unauthenticated`, `unknown`), `type`, `label`, `email`, `canLogout`.
- The Claude check is the best idea to copy (`ClaudeProvider.ts`, `probeClaudeCapabilities`):
  - It starts the Agent SDK `query()` with a prompt iterator that never yields.
  - It calls `initializationResult()`. The process starts and reports its account. No request goes to the model.
  - It reads `account.email`, `subscriptionType`, `tokenSource`, `apiKeySource`, `apiProvider`.
  - `claudeAuthStatus` returns `unauthenticated` only when `tokenSource` is `"none"` and no key, email or subscription exists.
  - The label is "Claude API Key" when the method is `apiKey`. Else it shows the subscription name.
  - A 25 s timeout covers slow cloud backends. A 5 minute cache protects the probe (`ClaudeDriver.ts`).
- Rule (`docs/internals/providers.md`): a check must not open a session, start MCP servers, run hooks or open a login page.
- Failure text is actionable: "Claude Code is not authenticated. Run `claude auth login` and try again."

### 2.8 Model options: effort, thinking, context size

- A model has `capabilities.optionDescriptors`. A descriptor is `select` or `boolean` (`model.ts`).
- A selection is `ModelSelection = { instanceId, model, options: [{ id, value }] }`.
- The Claude manifest lists these option ids (verified by grep): `effort` (low, medium, high, xhigh, max, ultrathink, ultracode), `fastMode`, `thinking`, `contextWindow` (`1m`).
- `compileClaudeModelSelection` (`apps/server/src/claudeModelOptions.ts`) turns a selection into SDK input: `apiModelId`, `effort`, `settings` (`alwaysThinkingEnabled`, `fastMode`).
  - Context size `1m` adds the suffix `[1m]` to the model id.
  - `ultrathink` is injected into the prompt, not sent as an option.
- `TraitsPicker.tsx` draws the controls from the descriptors. Options are remembered per model per provider.
- Rule (`adding-a-provider.md`): wait until the provider lists an option before you write it. Treat a stored option the live session lacks as skipped, not as an error.

---

## 3. Where to look

| Feature | Path in T3 Code |
| --- | --- |
| Thread, run, node design | `docs/orchestration-v2/core-graph-and-data-model.md` |
| Capabilities | `docs/orchestration-v2/provider-capability-system.md` |
| Provider switch, fork | `docs/orchestration-v2/provider-switching-and-context.md`, `thread-lineage-and-context-transfer.md` |
| Thread, run, command schemas | `packages/contracts/src/orchestrationV2.ts` |
| Model options, selection | `packages/contracts/src/model.ts`, `modelSelection.ts` |
| Instance config, modes | `packages/contracts/src/providerInstance.ts`, `providerPolicy.ts` |
| Provider status, auth | `packages/contracts/src/server.ts` (`ServerProvider`) |
| Settings, secret fields | `packages/contracts/src/settings.ts` |
| Attachments | `packages/contracts/src/chatAttachment.ts` |
| Adapter and driver contract | `packages/provider-core/src/server/ProviderAdapter.ts`, `driver.ts` |
| Model change, handoff budget | `packages/provider-core/src/server/selectionTransition.ts`, `handoffBudget.ts` |
| How to add a provider | `docs/internals/adding-a-provider.md`, `providers.md` |
| Claude adapter (SDK use) | `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` |
| Claude health probe | `apps/server/src/provider/ClaudeProvider.ts`, `Drivers/ClaudeDriver.ts` |
| Claude model list and options | `apps/server/src/provider/ClaudeModelCatalog.ts`, `model-manifest.json`, `apps/server/src/claudeModelOptions.ts` |
| Instance defaults, status cache | `apps/server/src/provider/ProviderInstanceRegistryHydration.ts`, `providerStatusCache.ts` |
| Secrets in settings | `apps/server/src/settingsSecrets.ts`, `serverSettings.ts`, `auth/ServerSecretStore.ts` |
| Runtime policy, session reuse | `apps/server/src/orchestration-v2/RuntimePolicy.ts`, `ProviderSessionTransitionPolicy.ts` |
| Message intake, attachments | `apps/server/src/orchestration-v2/ThreadMessageIntake.ts`, `AttachmentClaims.ts` |
| Fork, rollback, paging | `apps/server/src/orchestration-v2/ThreadForkService.ts`, `CheckpointRollbackService.ts`, `threadHistoryPaging.ts` |
| Queue, interrupt, approvals | `QueuedRunOrder.ts`, `ProviderTurnControlService.ts`, `RuntimeRequestService.ts` (same folder) |
| Usage-limit recovery | `apps/server/src/orchestration-v2/UsageLimitRecoveryWorker.ts` |
| Client thread state | `packages/client-runtime/src/state/threads.ts`, `threadHistoryMerge.ts` |
| Default provider and model | `apps/web/src/providerInstances.ts`, `modelSelection.ts` |
| Composer, drafts, stash | `apps/web/src/components/chat/ChatComposer.tsx`, `apps/web/src/composerDraftStore.ts`, `promptStashStore.ts` |
| Pickers, queue, plan, meter | `components/chat/ProviderModelPicker.tsx`, `TraitsPicker.tsx`, `QueuedRunsControl.tsx`, `ProposedPlanCard.tsx`, `ContextWindowMeter.tsx` |
| Provider settings UI | `apps/web/src/components/settings/ProviderInstanceCard.tsx`, `AddProviderInstanceDialog.tsx`, `SecretInput.tsx` |

---

## 4. What ATOM has today, and the gap

The author read the files named below on 2026-10-17.

| Topic | ATOM today | Gap |
| --- | --- | --- |
| Chat model | A chat is a list of turns plus a `ChatSessionRef` (`id`, `model`, `tail`) in `services/memory/src/chats.ts`. A chat and a project each have a model | No run or node objects. Not needed now |
| Session per chat | One long-lived Claude Code session per chat. Closes after 60 minutes idle. Reopens with `resume` (`services/llm-gateway/src/providers/claude-session.ts`, ADR-110) | Same idea as T3 |
| Providers | `PROVIDERS` in `packages/shared/src/config.ts`: `claude-plan`, `codex`, `gemini-cli`. Codex and Gemini answer as plain text (ADR-113) | No capability table. The UI learns limits from refusals |
| Auto selection | `createModelSettings` (`apps/mac/src/model-settings.ts`). A saved choice is read from `config/island.json`. A choice whose program is missing is ignored with a warning | No "first ready provider" rule |
| Model list | Claude: live `supportedModels()` (`plan-support.ts`, ADR-097). Others: a fixed table plus a typed custom id | Better than T3 for Claude. No per-model option data |
| API key | None by design (ADR-092). `scrubbedEnv` removes `ANTHROPIC_*` and other keys. `planGuard` stops a run when `apiKeySource` is not `none` or `oauth` | T3 allows a typed key. ATOM must not, unless Keshab decides (idea 10) |
| Health and sign-in | `scanAiTools` (`apps/mac/src/ai-tools.ts`) runs `claude auth status` and `codex login status`. It reads only `loggedIn` | No account name or credential kind before the first turn |
| Runtime modes | `permissionMode: "default"` is fixed. `canUseTool` and a PreToolUse hook run ATOM's own gate (`native-safety.ts`). Code decides | No mode per chat. A safe default |
| Approvals | `approval.request` and `approval.answer`. One at a time. Auto-decline after 60 s | Only Allow or Decline |
| Plan mode | A plan-first agent starts in `plan` mode (`native-agents.ts`). `plan.approve` | None for a plain chat |
| Queue | One "Next" row. Messages join into one turn (ADR-127) | No list, no reorder, no steer |
| History | `chat.opened` returns all saved messages. The store keeps the newest 200 plain chats | No paging |
| Pin or archive a chat | Not found. Only projects can be archived | Gap |
| Fork a chat | Not found | Gap |
| Edit an earlier message | Not found. ADR-125 lists it as left out | Gap |
| Compact, context meter | Not found in `apps/mac/src` or `services`. ADR-125 lists a context strip as left out | Gap |
| Effort, thinking | Fixed `thinking: { type: "disabled" }` in `claude-session.ts`. No `effort` | No user choice |
| Attachments | Paperclip, drop, paste. 5 files, 10 MB each, copied to `data/attachments/<chat>`. Secret files refused (ADR-113, ADR-125) | `text.send` allows 4000 characters. A long paste has no file path |
| Composer | Several lines, up-arrow recall, drafts per chat, `/` picker, `@` mentions (ADR-117, 125, 126) | No prompt stash |
| Usage limit | The guard reads rate-limit events. The Dashboard shows plan use | No "continue after the reset" |

---

## 5. Ideas for ATOM, ranked

Size: S is under one day, M is a few days, L is a week or more.
CLAUDE.md section 3 says one capability at a time. Each idea needs its own ADR and task.

### 1. Account line and billing check before the first turn (S to M)

- What: Copy T3's Claude probe. Start the SDK `query()` with a prompt that never yields. Call `initializationResult()`. Read `account` (email, subscription type, `tokenSource`, `apiKeySource`).
- Why: Settings can say "Signed in as you, Max plan" or "Not signed in". It can warn at once if a credential would bill per token. Today `planGuard` finds this only after a turn starts.
- Fit: It strengthens the money rule. No model request is sent. ATOM does not read or store a login.
- Caution: Unverified whether ATOM's SDK version has `initializationResult()`. T3 Code uses it. Check `ClaudeSdk` in `claude-session.ts` first.
- First step: Add `probePlanAccount(claudePath)` in `plan-support.ts` with a fake-SDK test. Show the result in the `info` event only.

### 2. Context meter and Compact (M)

- What: Show how full the chat's session is. Offer a Compact button that sends `/compact` into the session.
- Why: A long chat grows its prompt and costs plan tokens each turn. T3 shows a meter and a Compact chip.
- Fit: Token discipline (ADR-118). No money change. The meter needs only numbers ATOM already reads (`tokensOf`).
- Caution: Unverified that `/compact` works through ATOM's streaming-input `prompt`. T3's docs say Claude accepts it.
- First step: A pure Swift function from last-result tokens to a percent of the model window. Show one small line. Add Compact later.

### 3. Edit an earlier message and ask again (S to M)

- What: "Edit from here" on a sent message. It removes that message and all later ones. The text returns to the box.
- Why: The usual repair for a bad turn. ADR-125 lists it as left out. T3 uses `checkpoint.rollback`.
- Fit: Conversation only, no file restore, no money change.
- Safe variant: Cut the saved turns and clear the `ChatSessionRef`. The next turn reopens the session with the transcript, as ADR-113 does after a provider change. Refuse while a turn or background agent runs.
- First step: `ChatStore.truncate(id, fromIndex)` in `services/memory/src/chats.ts`, with tests. Then a `chat.rewind` command.

### 4. Fork a chat from a message (M)

- What: Make a new chat that holds the turns up to a chosen message.
- Why: Try another path and keep the first. T3 records `forkedFrom` and `lineage`.
- Fit: Reuses the transcript reopen of idea 3. The new chat has no session. Its first turn costs one cold start of plan tokens.
- Alternative: The SDK `forkSession(sessionId, { upToMessageId })`, as T3 does. ATOM does not store SDK message ids. Skip at first.
- First step: `ChatStore.fork(id, upToIndex)` that copies turns and project. Store `forkedFrom` in the chat row.

### 5. Long paste becomes a file (S)

- What: A paste of 4000 characters or more becomes a text file attachment. T3 does this at 32 KiB.
- Why: `text.send` refuses more than 4000 characters (`island-commands.ts`). The user must split the text today.
- Fit: The ADR-113 attachment path and secret-file checks stay as they are.
- Caution: A project chat refuses attachments (ADR-113). Decide what happens there.
- First step: A pure rule in `ComposerPaste.swift` (`PasteChoice`) for long text. Write a temp file as for a pasted image (ADR-125).

### 6. A provider capability table in `info` (S)

- What: A fixed table per provider: `tools`, `attachments`, `projectChats`, `resume`. Send it in the `info` event.
- Why: T3's rule: clients read capabilities, never the driver name. ATOM refuses a Codex project chat with words today. The UI could hide the option first.
- Fit: Deterministic data. A small step toward the Provider boundary in CLAUDE.md section 2.
- First step: Add `caps` to each `PROVIDERS` entry. Add it to `InfoEvent`. Test in `model-settings.test.ts`.

### 7. Pin and archive chats, with Undo (S to M)

- What: Pin a chat above the list. Archive a chat out of the list. Delete and archive show a 5 second Undo.
- Why: The list holds up to 200 plain chats. T3 uses `pinnedAt`, `archivedAt` and an Undo toast.
- Fit: Pure list state. A column and two commands.
- First step: Add `pinnedAt` and `archivedAt` to the chats table and `ChatSummary`. Add `chat.pin` and `chat.archive` to `docs/island-protocol.md`.

### 8. Continue after a usage limit (M)

- What: When the plan limit stops a turn, show the reset time. Offer "Send again after the reset". Hold the message until then.
- Why: Plan limits are ATOM's real cost limit. T3 has failure class `usage_limit`, `limitRecovery` and a worker.
- Fit: Safe for the money rule. It never switches to a key. It only waits.
- First step: Parse the reset time from the rate-limit event that `planGuard` already reads. Show it in the error line. Add the timer later.

### 9. A depth choice per chat: quick, normal, deep (S to M)

- What: An optional `effort` for a chat. It maps to the SDK `effort` option and `thinking`.
- Why: T3's `TraitsPicker` shows effort and thinking from model data.
- Fit: The default stays as today (thinking off), so ADR-118 holds. A deeper choice uses more plan tokens, never money. T3 passes `effort` in its query options (verified). ATOM's SDK version is unverified.
- Caution: A changed option may change the cached prompt prefix. Measure `cacheWrite` before and after.
- First step: Add an optional `options` list to `chat.model` and `ChatSessionRef`. Pass `effort` only when set.

### 10. Typed API key or custom endpoint (L) - breaks the money rule

- What: A "bring your own key" provider, as T3 allows through a secret field or sensitive env rows.
- Why: It would allow a pay-per-token model when the plan is out.
- Fit: It breaks ADR-092 and ADR-055. They say no API keys, and `scrubbedEnv` strips them on purpose. It needs a new ADR from Keshab. Do not build it without one.
- Safe variant, if Keshab agrees:
  - Off by default. A separate provider named "Billed: API key". Never a fallback.
  - The key goes in the macOS Keychain, not in `.env` or a settings file.
  - The key never enters the Claude Code environment. `scrubbedEnv` stays. The key serves only a plain-text chat through the LLM Gateway.
  - A visible "Billed" label on every turn. A monthly cap that code checks.
  - The key never goes to logs, the island or the model.
- Safe part to build now: T3's secret pattern (redacted value, separate store, `sensitive` flag) for other tokens. The Telegram bot token lives in `.env` today.
- First step: Write the ADR draft. No code.

### 11. Plan mode for a plain chat (M)

- What: A `/plan` switch. The next turn runs with `permissionMode: "plan"`. A plan card shows an "Implement" button.
- Why: T3 uses `interactionMode` and `sourcePlanRef`. ATOM has it only for plan-first agents.
- Fit: Code sets the mode, not the model. Plan mode is stricter, so the risk is low.
- Caution: Unverified that ATOM can change `permissionMode` in a live session. T3 calls `setPermissionMode` on the query (verified). The `ClaudeSdk` interface in `claude-session.ts` showed only `interrupt`.
- First step: A pure rule `modeFor(chat)` with a test. Then wire `/plan` in `slash-commands.ts`.

### 12. Later, lower value

- History paging (M). T3 caps a page at 10 user turns, 75 items or 1 MiB. ATOM sends the whole chat. First measure the largest `chat.opened` event.
- "Allow for this chat" on approvals (S to M). T3 has `acceptForSession`. It widens permissions, so it needs an ADR. Scope by chat and exact target. Never apply it to blocked apps or secret fields.
- Steer a running turn (M). T3 has `steer_active`. ADR-127 chose stop and send. Unverified that ATOM's session takes a message mid-turn. Probe with a fake SDK first.

### Not recommended now

- The V2 objects (runs, attempts, nodes, context transfers). They serve many providers and a remote server. CLAUDE.md section 22 says do not build them before they are needed.
- Many instances of one provider. ATOM has one user and one plan.
- One prompt to several models. It multiplies plan use.
- A model manifest with remote fetch. ATOM reads the live list from the SDK.
