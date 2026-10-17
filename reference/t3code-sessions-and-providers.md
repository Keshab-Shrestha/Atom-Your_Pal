# T3 Code: sessions and the provider layer

Source: github.com/pingdotgg/t3code (MIT licence). Read on 2026-10-17 from a shallow clone at commit `2fbd4318`.
Scope: sessions (threads), models, the provider layer, approvals, resume, fork, history, attachments, composer.
Paths in this file are relative to the T3 Code repository unless a path starts with `/home` or names an ATOM folder.

How to read the marks:

- "Verified" means the author read the code.
- "Unverified" means the claim comes from a doc page or a type name only. The author did not trace the code.
- "Not found" means a search found nothing.

---

## 1. What T3 Code does here

### 1.1 The object model

T3 Code separates the thing the user sees from the thing the provider holds.
The design text is in `docs/orchestration-v2/core-graph-and-data-model.md`. The schemas are in `packages/contracts/src/orchestrationV2.ts`.

| Object | Schema name | What it is |
| --- | --- | --- |
| Project | `ProjectId` | A folder. Threads belong to it. A thread can also have no project |
| Thread | `OrchestrationV2AppThread` | The conversation the user sees. Stable across provider changes |
| Run | `OrchestrationV2Run` | One counted user turn. Has an `ordinal` and a status |
| Run attempt | `OrchestrationV2RunAttempt` | One try at a run. A steer or a retry makes a second attempt |
| Execution node | `OrchestrationV2ExecutionNode` | A step inside a run: message, tool call, approval, plan, subagent |
| Provider session | `OrchestrationV2ProviderSession` | A live or resumable provider process |
| Provider thread | `OrchestrationV2ProviderThread` | The provider's own conversation handle (for Claude, a session id) |
| Context transfer | `OrchestrationV2ContextTransfer` | A durable link used by a fork or a provider switch |
| Context handoff | `OrchestrationV2ContextHandoff` | The text bridge used when a native fork or resume cannot work |
| Runtime request | `OrchestrationV2RuntimeRequest` | An approval or a question that waits for the user |
| Checkpoint | `OrchestrationV2Checkpoint` | A file snapshot at the end of a run. Used for rollback |

Key rules (verified in `docs/orchestration-v2/README.md`):

- App ids are primary. Provider ids are only references.
- The root run is the only thing that can complete a user turn. A subagent ending does not end the run.
- Provider switches do not make a new thread. They attach a handoff to the next run.
- A fork makes a new thread. The provider is not chosen at fork time.

Thread fields worth knowing (verified, `OrchestrationV2AppThread`):

- `title`, `providerInstanceId`, `modelSelection`, `runtimeMode`, `interactionMode`.
- `branch`, `worktreePath`, `activeProviderThreadId`, `lineage`, `forkedFrom`.
- `archivedAt`, `deletedAt`, `pinnedAt`, `pinOrderKey`, `lastVisitedAt`.
- `settledAt`, `settledOverride`, `snoozedUntil` (the "done" and "later" states of the sidebar).
- `limitRecovery` (a usage limit stopped a run, with a reset time), `titleRegeneration`.

Run status values (verified): `preparing`, `queued`, `starting`, `running`, `waiting`, `completed`, `interrupted`, `failed`, `cancelled`, `rolled_back`.
Provider session status values (verified): `starting`, `ready`, `running`, `waiting`, `stopped`, `error`.

### 1.2 Events, snapshots, history and paging

- Every change is an event in a SQLite log. Each stored event has a growing `sequence` (`OrchestrationV2StoredEvent`).
- A client reads a snapshot at sequence N. Then it reads the events after N.
- The client sends `afterSequence` to resume a stream. The stream items are `synchronized`, `snapshot`, `event`, and `unknown-event` (`OrchestrationV2ThreadStreamItem`).
- An old client skips an event type it does not know. It still moves its cursor. This lets servers and clients upgrade apart.
- Command ids make commands safe to repeat. A repeated command returns the first receipt. Provider side effects do not run twice.
- A snapshot is a bounded window. `OrchestrationV2ThreadBoundedSnapshot` has `historyCursor`, `hasMoreHistory` and `payloadBudgetExceeded`.
- `THREAD_HISTORY_PAGE_POLICY` in `apps/server/src/orchestration-v2/threadHistoryPaging.ts` sets 10 user turns, 75 items, and 1 MiB per page.
- `OLDER_THREAD_USER_TURN_LIMIT` is 20 user turns for each "load earlier" call.
- The cursor is opaque. The server encodes it as base64url JSON (`encodeThreadHistoryCursor`).
- Tool noise (`command_execution`, `reasoning`, `file_change`, `dynamic_tool`) does not count as conversation history (`isConversationHistoryItem`).
- The client keeps a cached snapshot. It drops an idle thread after 5 minutes (`THREAD_SNAPSHOT_IDLE_TTL_MS`).
- The client merges older pages with `mergeOlderHistoryIntoProjection` (`packages/client-runtime/src/state/threadHistoryMerge.ts`).
- Raw provider frames are not app state. They go to a rotating log, 64 KiB per payload (`docs/internals/providers.md`).
- T3 Code can list and import a provider's own sessions. `ServerProvider.nativeSessions` has `canList`, `canLoad`, `canResume`. `thread.create` accepts `importedNativeThread`.

### 1.3 Thread commands

All commands are variants of `OrchestrationV2Command`. The ones for sessions:

| Group | Commands |
| --- | --- |
| Life | `thread.create`, `thread.archive`, `thread.unarchive`, `thread.delete` |
| List order | `thread.pin`, `thread.unpin`, `thread.pin.reorder`, `thread.active.reorder`, `thread.visit`, `thread.mark-unread` |
| State | `thread.settle`, `thread.unsettle`, `thread.snooze`, `thread.unsnooze`, `thread.auto-settle` |
| Name | `thread.metadata.update` (has `title` and `regenerateTitle`) |
| Settings | `thread.runtime-mode.set`, `thread.interaction-mode.set`, `thread.model-selection.set` |
| Turns | `message.dispatch`, `run.interrupt`, `queued-message.promote-to-steer`, `queue.resume`, `queued-run.reorder`, `queued-run.cancel`, `queued-run.edit` |
| Requests | `runtime-request.respond`, `thread.user-input.dismiss` |
| History | `checkpoint.rollback`, `thread.fork`, `thread.merge_back`, `provider.switch` |

Pin, archive, settle and snooze each show a toast with Undo for 5 seconds (`docs/user/thread-sidebar.md`).

### 1.4 How a turn runs

The call chain below comes from file names, the docs and the contract types. The author did not trace `RunExecutionService.ts` line by line. Treat the order as unverified in detail.

1. The client uploads files first. They are "pending" attachments.
2. The client sends `message.dispatch` with a `dispatchMode` (see 1.9).
3. `ThreadMessageIntake.ts` claims the attachments for the thread. It validates the limits first (`AttachmentClaims.ts`).
4. `ThreadManagementService.ts` sends the command to `Orchestrator.ts`. The orchestrator writes events in one transaction and returns the sequence.
5. `RuntimePolicy.ts` resolves the runtime policy (cwd, runtime mode, interaction mode).
6. `ProviderSessionManager.ts` opens or reuses a provider session. `ProviderSessionTransitionPolicy.ts` decides which.
7. The adapter starts the turn. It streams `ProviderAdapterV2Event` values back.
8. `ProviderEventIngestor.ts` turns those events into app events. The projection updates. The client gets the events.
9. A `turn.terminal` event ends the run with `completed`, `interrupted`, `cancelled` or `failed`. It also marks the provider thread `reusable` or `broken`.
10. Checkpoint capture runs after the turn. It is a second milestone, apart from the turn end.

### 1.5 Resume

- The session record is durable. The live process handle is not. After a restart, the manager makes a new runtime from the stored record (`docs/orchestration-v2/core-graph-and-data-model.md`).
- `ProviderAdapterV2OpenSessionInput` has `resumeFromSession` and `initialNativeThreadId`.
- The Claude adapter uses `resume: <native id>` when a prior turn exists. Otherwise it uses `sessionId: <native id>` (`ClaudeAdapterV2.ts`, near `threadIdentity`).
- The Claude adapter also sets `resumeSessionAt` from the stored conversation head. This resumes at one message.
- The manager releases an idle session after 30 minutes (`DEFAULT_IDLE_TIMEOUT_MS` in `ProviderSessionManager.ts`). A pin can hold it up to 4 hours (`DEFAULT_MAX_IDLE_PIN_MS`).
- `ProviderRuntimeRecoveryService.ts` and `RestartContinuation.ts` recover runs after a server restart.
- After a restart, queued messages stay saved but held. The user presses Resume (`queue.resume`).
- The adapter must report `hasPendingBackgroundWork`. A session with background work is not released as idle (`docs/internals/adding-a-provider.md`).

### 1.6 Fork, rollback and "edit from here"

- `thread.fork` has `sourceThreadId`, `targetThreadId` and a `sourcePoint` (a run, a node, or a provider thread).
- `ThreadForkService.ts` plans the fork. It allows only these source statuses: `completed`, `waiting`, `failed`, `interrupted`, `cancelled` (`isForkableSourceRunStatus`).
- The fork copies the thread fields. It sets `lineage` and `forkedFrom`. It records a `ContextTransfer` with status `pending`.
- The real fork happens at the first run of the new thread. The result is `native_fork` or `portable_context` (`OrchestrationV2ContextTransferResolution`).
- Claude uses the SDK function `forkSession(sessionId, { dir, upToMessageId })` for a native fork (`ClaudeAdapterV2.ts`, `forkThread`). It refuses while a turn is active.
- `apps/server/src/claudeHistoryWorker.ts` runs `getSessionMessages` and `forkSession` from the SDK in a separate worker process.
- Rollback is `checkpoint.rollback` with `restoreFiles`. The UI calls it "Edit from here" (`docs/user/composer.md`).
  - It removes the chosen message and all later ones.
  - File restore works only for worktree threads. The server refuses it when another agent uses the folder.
  - The action shows only when the provider reports `supportsConversationRollback`.
- `thread.merge_back` sends a summary of a fork back to its parent.

### 1.7 Switching model or provider inside a thread

- `planSelectionTransition` is a method of each adapter. It returns `apply_on_next_turn`, `restart_session`, `create_with_handoff` or `reject` (`packages/provider-core/src/server/selectionTransition.ts`).
- `decideProviderSessionTransition` is a pure function in `ProviderSessionTransitionPolicy.ts`. It returns `reuse`, `switch_model_in_session`, `restart_and_resume`, `create_with_handoff` or `reject`.
- Rules (verified): an unavailable target is rejected. No current session means create with handoff. A different driver or continuation group means create with handoff.
- The Claude adapter returns `apply_on_next_turn` for any model change (`turnScopedSelectionTransition`).
- A handoff is a budgeted text selection, not a summary written by an agent. The default cap is 16,000 tokens (`DEFAULT_HANDOFF_TOKEN_CAP` in `handoffBudget.ts`). See `docs/user/portable-handoffs.md`.
- The handoff leaves out reasoning, tool state and attachments. The agent can read the omitted history with a thread-reading tool.
- After the first run, the model picker locks the provider to its "continuation group" (`lockedProvider`, `lockedContinuationGroupKey` in `ProviderModelPicker.tsx`). Two Claude instances with the same config directory share a group.

### 1.8 Approvals and questions

- An approval or question is an `OrchestrationV2RuntimeRequest`. Kinds: `command`, `file-read`, `file-change`, `mcp-elicitation`, `permission`, `dynamic_tool_call`, `user_input`, `auth_refresh`.
- Status: `pending`, `resolved`, `expired`, `cancelled`.
- `responseCapability` says how to answer: `live` (the provider waits), `message` (the answer goes as a new user message), or `not_resumable` (the request cannot survive a restart).
- Decisions (`ProviderApprovalDecision`): `accept`, `acceptForSession`, `acceptAlways`, `decline`, `cancel`.
- The client answers with `runtime-request.respond`. `RuntimeRequestService.ts` validates the answer and commits it in one transaction.
- The Claude adapter uses the SDK callback `canUseTool`. A tool call becomes a request and waits on a `Deferred` (`ClaudeAdapterV2.ts`, `canUseToolEffect`).
- `AskUserQuestion` becomes a `user_input` request. `ExitPlanMode` is answered at once and makes a plan card.
- The rule for adapters: pass the provider's own option ids through. Every request needs a decline path the provider honors.
- Approvals can come from subagents. The UI shows every respondable request.

### 1.9 Runtime modes, interaction mode, plan mode

Runtime modes (`RuntimeMode` in `packages/contracts/src/providerPolicy.ts`):

| Mode | UI name | Claude `permissionMode` (verified, `permissionModeForClaudeRuntimePolicy`) |
| --- | --- | --- |
| `approval-required` | Supervised | `default` |
| `auto-accept-edits` | Auto-accept edits | `acceptEdits` |
| `auto` | Auto | `auto` |
| `full-access` | Full access | `bypassPermissions` |

- The T3 default is `full-access` (`DEFAULT_RUNTIME_MODE`). ATOM must not copy this default.
- `RuntimePolicy.ts` has `providerRuntimeMode`. If a provider does not list the mode in `supportedRuntimeModes`, the server runs the thread as `approval-required`. Code decides. The model does not.
- `adding-a-provider.md` forbids faking a missing mode. A provider offers only modes it enforces itself.
- Interaction mode has two values: `default` and `plan` (`ProviderInteractionMode`). Plan mode maps to Claude `permissionMode: "plan"` and read-only tools.
- A plan comes back as `OrchestrationV2PlanArtifact`. Kind `proposed_plan` has markdown. Kind `todo_list` has steps.
- The web shows a `ProposedPlanCard`. An "implement" message carries `sourcePlanRef` (`message.dispatch`).
- `showInteractionModeToggle` hides the plan switch for providers that cannot produce a plan card.

### 1.10 Queue, steer, stop

`message.dispatch.dispatchMode` has five values (verified):

| Value | Meaning |
| --- | --- |
| `start_immediately` | Start a run now |
| `queue_after_active` | Wait for the active run to end |
| `steer_active` | Send the message into the running turn (needs `targetRunId`) |
| `restart_active` | Interrupt the turn and start a replacement attempt |
| `defer_start` | Make the run but do not start it (used by thread launch) |

- Queued messages are saved on the server. The user can edit, reorder, remove or promote a queued message to a steer.
- `queuedRunsInDeliveryOrder` (`QueuedRunOrder.ts`) sorts by `queuePosition`, then `ordinal`. Automatic completion messages go first.
- A client setting "Follow-up behavior" picks Queue or Steer as the default. Cmd+Enter flips it (`docs/user/composer.md`).
- If a provider cannot steer, the app can steer by interrupt and restart (`supportsSteeringByInterruptRestart`).
- `run.interrupt` stops a run. It has `holdQueue` to keep queued messages from starting.
- Stop is a request first. The terminal state arrives later in `turn.terminal` (`docs/orchestration-v2/README.md`).
- A known trap: a Stop sent before the provider registers the turn can be ignored. Adapters need a test for it (`adding-a-provider.md`).
- Usage limits: a quota error becomes failure class `usage_limit` with a reset time. The thread shows Limited and can resume (`UsageLimitRecoveryWorker.ts`).

### 1.11 Attachments

- Upload happens when the user adds the file. The file is "pending" until the message is sent. All uploads must end before send.
- `claimPendingAttachments` copies the pending file into the thread. The pending file stays as a retry source. A sweep removes it later.
- Attachments live outside the project folder. A path in the prompt gives no file access (`docs/internals/providers.md`).
- Limits (`packages/contracts/src/chatAttachment.ts`): 100 files, 10 MiB per image, 80 MiB of images, 50 MiB per file, 120,000 characters of text.
- Types: `image`, `file`, and `ChatUnknownAttachment` (so old readers do not fail on a new type).
- Image MIME types: gif, jpeg, png, webp. HEIC is converted to JPEG on the client.
- A text paste of 32 KiB or more becomes a text file attachment (`PastedTextAttachmentSource`). Providers get a path only, to save context.
- Question answers can carry attachments too (`attachmentsByQuestionId`).
- A snap-shot source (`SnapShotSource`) can carry app name, window title and accessibility text with an image.

### 1.12 Composer features

From `docs/user/composer.md` (verified as docs, not traced in the web code):

- Markdown editor that shows styled text while the user types. Lists, quotes, code blocks with a language picker.
- `/` commands and `$` skills. T3 commands such as `/model` and `/plan` work on any line. Provider commands must start the message.
- `#` finds pull requests. `@` finds another thread and attaches it as a reference (the agent reads it on demand).
- Chips for context: terminal excerpt, review comment, file, quoted assistant text with a comment.
- Recall: ArrowUp in an empty composer brings back the last sent prompts.
- Prompt stash: Cmd+S saves the prompt and files for later. Files in a stash live 24 hours.
- Drafts per thread, kept in `apps/web/src/composerDraftStore.ts`. The same store keeps the sticky model per provider.
- Model picker with search, favorites, hidden models and a custom order (`ModelPickerContent.tsx`).
- Traits picker for effort, fast mode, thinking and context size (`TraitsPicker.tsx`).
- Context meter and a "Compact" chip when the prompt cache has expired (`ContextWindowMeter.tsx`, `providers-claude.md`).
- `/compact`, `/goal`, and "Restart agent session" in the command palette.
- Send one prompt to several models: Shift-click models in the picker of a new thread. Each model gets its own thread.
- Edit from here, and a queue panel (`QueuedRunsControl.tsx`).
- Pending approval and question panels sit above the composer (`ComposerPendingApprovalPanel.tsx`, `ComposerPendingUserInputPanel.tsx`).

---

## 2. The provider layer

### 2.1 Driver and instance

- A driver kind names an integration: `codex`, `claudeAgent`, `cursor`, `grok`, `opencode`, `antigravity`, `pi`, `muse`, `acpRegistry` (`packages/contracts/src/model.ts`, `builtInDrivers.ts`).
- An instance is one configuration of a driver. It has its own account, session state and model list.
- Two Claude instances with two config directories are two accounts (`docs/user/providers-claude.md`).
- `ProviderInstanceId` is a slug. The default instance id equals the driver kind (`defaultInstanceIdForDriver`).
- Work is routed by instance id. A driver needs no global state (`driver.ts`: "no per-driver Context tags").

### 2.2 The contract a provider implements

Server side, in `packages/provider-core/src/server/`:

| Type | File | Role |
| --- | --- | --- |
| `ProviderDriver<Config>` | `driver.ts` | `driverKind`, `metadata`, `configSchema`, `defaultConfig()`, `create()`, optional `usage` |
| `ProviderInstance` | `driver.ts` | `snapshot`, `refreshModels`, `orchestrationAdapter`, `textGeneration`, optional `auth`, `consumeResetCredit` |
| `ProviderAdapterV2` | `ProviderAdapter.ts` | `getCapabilities()`, `planSelectionTransition()`, `openSession()` |
| `ProviderAdapterV2SessionRuntime` | `ProviderAdapter.ts` | The per-session API (below) |
| `ProviderTextGeneration` | `textGeneration.ts` | Small helper tasks: titles, branch names, commit messages |
| `ProviderAuthController` | `auth.ts` | Sign-in flow for providers that support it |

The session runtime has these methods (verified, `ProviderAdapter.ts`):

- Threads: `ensureThread`, `resumeThread`, `readThreadSnapshot`, `rollbackThread`, `forkThread`, `unloadThread`.
- Turns: `startTurn`, `steerTurn`, `interruptTurn`, `compactThread` (optional), `injectHistory` (optional).
- Requests: `respondToRuntimeRequest`.
- Events: `events` stream, `subscribeEvents`.
- Extras: `hasPendingBackgroundWork`, `getModelContextWindow`, `stopTask`, `stopSubagent`, `mcpApps`.

The adapter emits typed events: `provider_session.updated`, `provider_thread.updated`, `provider_turn.updated`, `node.updated`, `message.updated`, `turn_item.updated`, `runtime_request.updated`, `plan.updated`, `turn.terminal`, `command_output.delta`.

The adapter reports capabilities in `OrchestrationV2ProviderCapabilities`. It has 11 groups: `sessions`, `threads`, `turns`, `streaming`, `tools`, `approvals`, `planning`, `subagents`, `context`, `checkpointing`, `identity`. It also has `runtimePolicy.enforcement` (`native` or `client-boundary`).

- The rule: report only what the provider really does. A missing capability makes orchestration use a fallback (for example a portable handoff instead of a fork).
- The rule: clients read capabilities. They never read the driver kind (`docs/internals/adding-a-provider.md`).

Package layout for a new provider (`adding-a-provider.md`):

- `./settings` holds the settings schema (`makeProviderSettingsSchema`).
- `./client` holds label, icon and badge. It must be safe for browser and mobile.
- `./server` holds the driver and the adapter driver.
- The server registers the driver in `builtInDrivers.ts` and the adapter in `builtInProviderAdapterDrivers.ts`.
- Cheap path: an ACP agent needs only a registry entry, not code.
- Tests use replay fixtures. A real provider transcript replays through the real orchestrator (`docs/orchestration-v2/testing-strategy.md`).

### 2.3 How an instance is configured

- Server settings hold a map `providerInstances` (`ServerSettings` in `packages/contracts/src/settings.ts`).
- Each entry is `ProviderInstanceConfig`: `driver`, `displayName`, `accentColor`, `environment`, `enabled`, `config`.
- `config` is per driver. Claude has `binaryPath`, `homePath` (sets `CLAUDE_CONFIG_DIR`), `launchArgs`, `autoCompactWindow`, `customModels`.
- `environment` is a list of `{ name, value, sensitive }` variables. They merge into the process environment (`mergeProviderInstanceEnvironment`).
- Mutations are `create`, `upsert`, `remove` (`ProviderInstanceMutation`).
- At start, `deriveProviderInstanceConfigMap` adds a default instance for every built-in driver, except drivers with `hasDefaultInstance: false` (ACP registry).
- A project can turn an instance on or off (`projectSettingsOverrides`).
- The web form for `config` is built from the schema. Annotations set the control: `text`, `password`, `textarea`, `switch`, `select` (`ProviderSettingsFormAnnotation`).
- Settings pages: `ProviderSettingsPanel.tsx`, `ProviderInstanceCard.tsx`, `AddProviderInstanceDialog.tsx`, `ProviderSettingsForm.tsx`.

### 2.4 Auto selection and defaults

Server side:

- `DEFAULT_MODEL_BY_PROVIDER` gives one default model per driver (`model.ts`). Example: Claude `claude-fable-5-1`, Cursor `auto`.
- `DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER` gives a cheap model for small tasks. Claude uses `claude-haiku-5-5`.
- Status order for the list: `BUILT_IN_DRIVER_ORDER` in `providerStatusCache.ts` (codex, claudeAgent, cursor, grok, opencode, antigravity).

Client side (verified, `apps/web/src/providerInstances.ts` and `modelSelection.ts`):

- `resolveSelectableProviderInstanceEntry(entries, instanceId)`:
  1. Use the requested instance if it is enabled and available.
  2. Else use the first instance that is enabled, available and `ready`.
  3. Else use the first enabled and available instance that is not in `error`.
- `getDefaultProviderInstanceModel`: first non-custom model with `isDefault`, else first non-custom model, else the first model, else the table default.
- `resolveDefaultProviderModelSelection` keeps a saved selection if its instance is still usable. Otherwise it falls back as above.
- `NO_PROVIDER_MODEL_SELECTION` is a placeholder. It is never saved or sent. The composer disables Send until a real provider exists.
- `resolveProviderCatalogAvailability` returns `loading`, `ready`, `unavailable` or `unconfigured`. This avoids a false "no providers" state while the stream loads.
- New threads use the remembered provider, model and options (sticky selection in `composerDraftStore.ts`). A project model default wins over it.
- Text generation has its own selection, `textGenerationModelSelection`. A fallback instance gets the cheap model, not the flagship one (`resolveAppModelSelectionState`).

### 2.5 How model lists are found

| Provider | Source (verified unless noted) |
| --- | --- |
| Claude | A bundled JSON manifest `apps/server/src/provider/model-manifest.json`. The server also fetches a newer copy from GitHub `main`. The newer `updatedAt` wins. A bad fetch keeps the last good file |
| Codex | The Codex app server `model/list` (`docs/internals/model-manifest.md`). A manifest adds models that need a newer CLI |
| OpenCode, Antigravity | Dynamic lists from the provider. Antigravity does not allow custom models |
| Any | `customModels` in the instance config: `{ slug, name, capabilities }` |

- A model that needs a newer CLI is listed in `updateRequiredModels`. The picker tells the user which update unlocks it. The check is `adapter.claudeCode.minVersion`.
- T3 Code does not call the SDK `supportedModels()` for Claude. A search of `apps/server/src` found no use. (ATOM does call it. See section 4.)
- The user can hide models, reorder them, and mark favorites (`providerModelPreferences`, `favorites` in `settings.ts`).
- Aliases map old names to new ones (`MODEL_SLUG_ALIASES_BY_PROVIDER`).
- A "default" model is a sentinel. The adapter must never send it to the provider (`adding-a-provider.md`).
- The snapshot cache is written to disk, so the list shows at once at start (`providerStatusCache.ts`).

### 2.6 API key and custom endpoint: how the user types it, where it goes

T3 Code has three ways. None is the main path for Claude or Codex, which use the CLI sign-in.

1. A secret field in the driver settings schema.
   - Example: Antigravity `apiKey` (`AntigravitySettings` in `settings.ts`). The annotation is `secretSetting` plus `control: "password"`.
   - The form shows a masked input (`SecretInput.tsx`).
2. Environment variables on an instance.
   - The user adds `{ name, value, sensitive: true }` rows in the instance card (`ProviderInstanceCard.tsx`).
   - `docs/user/providers-claude.md` shows the OpenRouter setup: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` (sensitive), and an empty `ANTHROPIC_API_KEY`.
   - This is how a custom endpoint or a router enters. The instance then uses its own config directory.
3. A sign-in flow run by the CLI (`claude auth login`, Codex ChatGPT sign-in). T3 Code never reads the token. The web can show a terminal for it (`ProviderAuthTerminal.tsx`).

Where the secret is stored (verified):

- `settingsSecrets.ts` finds secret fields with `secretSettingsFields`. It finds env rows with `sensitive: true`.
- `serverSettings.ts` (`moveInlineSettingsSecrets`) writes each secret to the secret store and puts the redacted mark in `settings.json`.
- The store is `ServerSecretStore` (`apps/server/src/auth/ServerSecretStore.ts`). It writes one file per secret, `<stateDir>/secrets/<name>.bin`. The folder has mode 0700. The file mode is unverified.
- The secret name is built from the instance id, driver and field, base64url-encoded (`provider-config-…`, `provider-env-…`).
- Clients get settings through `redactServerSettingsForClient`. A secret comes back as an empty value with a "redacted" flag. The constant `SECRET_REDACTED` is six bullet characters.
- The server does not use the macOS Keychain for these secrets. (The Cursor usage reader can read the Cursor CLI login from the Keychain, with user consent. That is a separate feature.)
- Not found: any spend cap or "this key is billed" label on a typed key. T3 Code does not need one: its main providers bill the user's subscription.

### 2.7 Health checks and sign-in status

- Each instance has a `snapshot` (`ManagedServerProvider`). The client sees `ServerProvider`: `enabled`, `installed`, `version`, `status` (`ready`, `warning`, `error`, `disabled`), `auth`, `checkedAt`, `message`, `models`, `usageLimits`, `versionAdvisory`, `updateState`.
- `ServerProvider.auth` has `status` (`authenticated`, `unauthenticated`, `unknown`), `type`, `label`, `email`, `canLogout`.
- The Claude check (`apps/server/src/provider/ClaudeProvider.ts`, `probeClaudeCapabilities`) is the best idea to copy.
  - It starts the Agent SDK `query()` with a prompt iterator that never yields.
  - It calls `initializationResult()`. The process starts and reports its account. No request goes to the model.
  - It reads `account.email`, `subscriptionType`, `tokenSource`, `apiKeySource`, `apiProvider`.
  - `claudeAuthStatus` says `unauthenticated` only when `tokenSource` is `"none"` and no key, email or subscription exists.
  - The label is "Claude API Key" when the method is `apiKey`. Otherwise it shows the subscription name.
  - A timeout of 25 s covers slow cloud backends (`CAPABILITIES_PROBE_TIMEOUT_MS`).
  - A 5 minute cache protects the probe (`CAPABILITIES_PROBE_TTL` in `ClaudeDriver.ts`). The setting `DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL` is also 5 minutes.
- The rule "setup must not happen as a health-check side effect" (`docs/internals/providers.md`): a check must not open a session, start MCP servers, run hooks or open a login page.
- Failure text is actionable: "Claude Code is not authenticated. Run `claude auth login` and try again."
- Update flow: a provider updates only through the installer that owns its binary (`providerMaintenance.ts`).
- The web shows a banner when a provider is down (`ProviderStatusBanner.tsx`) and a setup card with docs links.

### 2.8 Model options: effort, thinking, context size

- A model has `capabilities.optionDescriptors` (`ModelCapabilities` in `model.ts`). A descriptor is `select` or `boolean`.
- A selection is `ModelSelection = { instanceId, model, options: [{ id, value }] }` (`modelSelection.ts`).
- The manifest for Claude lists these option ids (verified by grep in `model-manifest.json`): `effort` (low, medium, high, xhigh, max, ultrathink, ultracode), `fastMode`, `thinking`, `contextWindow` (`1m`).
- `compileClaudeModelSelection` (`apps/server/src/claudeModelOptions.ts`) turns a selection into SDK input: `apiModelId`, `effort`, `settings` (`alwaysThinkingEnabled`, `fastMode`).
  - A context size of `1m` adds the suffix `[1m]` to the model id.
  - `ultrathink` is injected into the prompt (`promptInjectedValues`), not sent as an option.
- The web `TraitsPicker.tsx` draws the controls from the descriptors. A saved option the model no longer has is shown but not sent.
- Options are remembered per model per provider (`stickyOptionsByModelByProvider`).
- The Claude instance also has `autoCompactWindow` (100,000 to 1,000,000 tokens) and the composer shows a context meter.
- A rule from `adding-a-provider.md`: wait until the provider lists an option before you write it. Treat a stored option that the live session lacks as skipped, not as an error.

---

## 3. Where to look

| Feature | Path in T3 Code |
| --- | --- |
| Design of threads, runs, nodes | `docs/orchestration-v2/core-graph-and-data-model.md` |
| Capability system | `docs/orchestration-v2/provider-capability-system.md` |
| Provider switch and handoff | `docs/orchestration-v2/provider-switching-and-context.md`, `docs/user/portable-handoffs.md` |
| Fork and lineage | `docs/orchestration-v2/thread-lineage-and-context-transfer.md` |
| Thread, run, command schemas | `packages/contracts/src/orchestrationV2.ts` |
| Model options and selection | `packages/contracts/src/model.ts`, `modelSelection.ts` |
| Provider instance config | `packages/contracts/src/providerInstance.ts` |
| Runtime and interaction modes | `packages/contracts/src/providerPolicy.ts` |
| Provider snapshot, auth status | `packages/contracts/src/server.ts` (`ServerProvider`) |
| Settings, secret fields, form hints | `packages/contracts/src/settings.ts` |
| Attachments and limits | `packages/contracts/src/chatAttachment.ts` |
| Provider adapter contract | `packages/provider-core/src/server/ProviderAdapter.ts` |
| Driver and instance contract | `packages/provider-core/src/server/driver.ts` |
| Model change plan | `packages/provider-core/src/server/selectionTransition.ts` |
| Handoff budget | `packages/provider-core/src/server/handoffBudget.ts` |
| How to add a provider | `docs/internals/adding-a-provider.md`, `docs/internals/providers.md` |
| Claude adapter (SDK use) | `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` |
| Claude health probe | `apps/server/src/provider/ClaudeProvider.ts` |
| Claude driver and cache | `apps/server/src/provider/Drivers/ClaudeDriver.ts` |
| Claude model catalog | `apps/server/src/provider/ClaudeModelCatalog.ts`, `model-manifest.json`, `ModelManifest.ts` |
| Claude option compile | `apps/server/src/claudeModelOptions.ts` |
| Claude history worker, fork | `apps/server/src/claudeHistoryWorker.ts` |
| Instance registry, defaults | `apps/server/src/provider/ProviderInstanceRegistryHydration.ts`, `ProviderInstanceRegistry.ts` |
| Status cache and order | `apps/server/src/provider/providerStatusCache.ts` |
| Secrets in settings | `apps/server/src/settingsSecrets.ts`, `serverSettings.ts`, `auth/ServerSecretStore.ts` |
| Runtime policy | `apps/server/src/orchestration-v2/RuntimePolicy.ts` |
| Session reuse or restart | `apps/server/src/orchestration-v2/ProviderSessionTransitionPolicy.ts`, `ProviderSessionManager.ts` |
| Message intake, attachments | `apps/server/src/orchestration-v2/ThreadMessageIntake.ts`, `AttachmentClaims.ts`, `apps/server/src/attachmentStore.ts` |
| Fork plan | `apps/server/src/orchestration-v2/ThreadForkService.ts` |
| History paging | `apps/server/src/orchestration-v2/threadHistoryPaging.ts` |
| Queue order | `apps/server/src/orchestration-v2/QueuedRunOrder.ts` |
| Interrupt and steer | `apps/server/src/orchestration-v2/ProviderTurnControlService.ts` |
| Approvals | `apps/server/src/orchestration-v2/RuntimeRequestService.ts` |
| Usage-limit recovery | `apps/server/src/orchestration-v2/UsageLimitRecoveryWorker.ts` |
| Rollback | `apps/server/src/orchestration-v2/CheckpointRollbackService.ts` |
| Title from a cheap model | `apps/server/src/orchestration-v2/ThreadTitleRegenerationService.ts` |
| Client thread state, paging | `packages/client-runtime/src/state/threads.ts`, `threadHistoryMerge.ts`, `threadRetention.ts` |
| Default provider and model | `apps/web/src/providerInstances.ts`, `modelSelection.ts`, `providerModels.ts` |
| Composer shell | `apps/web/src/components/chat/ChatComposer.tsx`, `ComposerPrimaryActions.tsx` |
| Draft and sticky model store | `apps/web/src/composerDraftStore.ts`, `promptStashStore.ts` |
| Model picker | `apps/web/src/components/chat/ProviderModelPicker.tsx`, `ModelPickerContent.tsx` |
| Effort and options picker | `apps/web/src/components/chat/TraitsPicker.tsx` |
| Queue panel | `apps/web/src/components/chat/QueuedRunsControl.tsx` |
| Approval panel | `apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx` |
| Plan card | `apps/web/src/components/chat/ProposedPlanCard.tsx` |
| Context meter | `apps/web/src/components/chat/ContextWindowMeter.tsx` |
| Provider banner | `apps/web/src/components/chat/ProviderStatusBanner.tsx` |
| Provider settings UI | `apps/web/src/components/settings/ProviderInstanceCard.tsx`, `AddProviderInstanceDialog.tsx`, `SecretInput.tsx` |
| User docs | `docs/user/composer.md`, `permission-modes.md`, `thread-sidebar.md`, `providers-claude.md`, `usage.md` |

---

## 4. What ATOM has today, and the gap

ATOM facts below come from the files named in the table. The author read them on 2026-10-17.

| Topic | ATOM today | Gap |
| --- | --- | --- |
| Chat model | A chat is a list of turns plus a `ChatSessionRef` (`id`, `model`, `tail`) in `services/memory/src/chats.ts` | No run, attempt or node objects. Not needed now |
| Session per chat | One long-lived Claude Code session per chat. Idle close after 60 minutes. `resume` with the stored id (`services/llm-gateway/src/providers/claude-session.ts`, ADR-110) | Same idea as T3. ATOM has no recovery report after a crash |
| Providers | `PROVIDERS` in `packages/shared/src/config.ts`: `claude-plan`, `codex`, `gemini-cli`. Codex and Gemini answer as plain text (ADR-113) | No capability table. The UI learns limits from refusals in words |
| Provider instances | One per provider. No second Claude account | Not needed now |
| Auto selection | `createModelSettings` in `apps/mac/src/model-settings.ts`. A saved choice is read from `config/island.json`. A choice with a missing program is ignored with a warning | No ordered fallback. No "first ready provider" rule |
| Model list | Claude: live `supportedModels()` through the SDK (`plan-support.ts`, ADR-097). Others: a fixed table plus a typed custom id (`CUSTOM_MODEL_PATTERN`) | Better than T3 for Claude. No capability data per model |
| Model per chat | `chat.model` command and `ChatStore.setModel`. A project also has a model (`project.model`) | None |
| API key | None by design. ADR-092 removed API keys. `scrubbedEnv` removes `ANTHROPIC_*` and other keys (`plan-support.ts`). `planGuard` stops a run when `apiKeySource` is not `none` or `oauth` | T3 allows a typed key. ATOM must not, unless Keshab decides it (idea 10) |
| Health and sign-in | `scanAiTools` (`apps/mac/src/ai-tools.ts`) runs `claude auth status` and `codex login status`. It reads only `loggedIn`. Result goes in the `info` event | No account name, plan name or credential kind before the first turn. `planGuard` sees `apiKeySource` only after a turn starts |
| Runtime modes | `permissionMode: "default"` is fixed. `canUseTool` and a PreToolUse hook run ATOM's own gate (`native-safety.ts`). Code decides | No user-visible mode per chat. This is a safe default |
| Approvals | `approval.request` and `approval.answer` (`ApprovalState.swift`). One request at a time. Auto-decline after 60 s | Only Allow or Decline. No "for this chat" |
| Plan mode | A plan-first agent starts in `plan` mode (`native-agents.ts`). The user approves with `plan.approve` | No plan mode for a plain chat |
| Queue | One "Next" row. Messages join into one turn (ADR-127, `MessageQueue.swift`). Cmd+Return stops and sends | No list, no reorder, no steer into a running turn |
| Stop | Esc and `talk.cancel` call `interrupt()` on the SDK query | Same as T3 |
| History | `chat.opened` returns all saved messages. The store keeps the newest 200 plain chats and 500 per project | No paging, no cursor |
| Rename, delete | `chat.rename`, `chat.delete` | None |
| Pin, archive a chat | Not found. Projects can be archived (`project.archive`) | Gap |
| Fork a chat | Not found | Gap |
| Edit an earlier message | Not found. ADR-125 lists it as "left out" | Gap |
| Compact, context meter | Not found in `apps/mac/src` or `services`. ADR-125 lists "a context strip" as left out | Gap |
| Effort, thinking | Fixed: `thinking: { type: "disabled" }` in `claude-session.ts`. No `effort` option | No user choice |
| Attachments | Paperclip, drop and paste. 5 files, 10 MB each, copied into `data/attachments/<chat>`. Secret files refused (ADR-113, ADR-125, `attachments.ts`) | `text.send` allows 4000 characters. A long paste has no file path |
| Composer | Several lines, recall with up arrow, drafts per chat, `/` picker, `@` mentions, skills menu (ADR-117, 125, 126) | No prompt stash. No chips with quotes |
| Usage limit | The plan guard reads rate-limit events. The Dashboard shows plan use | No "continue after the reset" |
| Title | First words of the chat. Manual rename | No title from a small model |

---

## 5. Ideas for ATOM, ranked

Ranking uses value, fit and risk. Size: S is under one day, M is a few days, L is a week or more.
Each idea is one capability. CLAUDE.md section 3 says to build one at a time, each with its own ADR.

### 1. Account line and billing check before the first turn (S to M)

- What: Copy T3's Claude probe. Start the SDK `query()` with a prompt that never yields. Call `initializationResult()`. Read `account` (email, subscription type, `tokenSource`, `apiKeySource`).
- Why: Settings can say "Signed in as you, Max plan" or "Not signed in". It can warn at once if a credential would bill per token. Today `planGuard` finds this only after a turn begins.
- Fit: It strengthens the money rule. No model request is sent. No login is read or stored. This is the same claim ADR-055 already makes. The Claude program reports the account fields.
- Caution: Unverified whether ATOM's installed SDK version has `initializationResult()` and `account`. T3 Code uses both. Check `ClaudeSdk` in `claude-session.ts` first.
- First step: Add a function `probePlanAccount(claudePath)` in `plan-support.ts`. Return the account fields. Add a unit test with a fake SDK. Show the result in the `info` event only.

### 2. Context meter and "Compact" (M)

- What: Show how full the chat's session is. Offer a Compact button that sends `/compact` into the session.
- Why: ATOM keeps a session open for 60 minutes with a 1 hour cache. A long chat grows its prompt and costs plan tokens each turn. T3 shows a meter and a Compact chip.
- Fit: Token discipline (ADR-118). No money change. The meter needs only numbers ATOM already reads (`tokensOf` in `plan-support.ts`).
- Caution: Unverified that `/compact` works through the streaming-input `prompt` ATOM uses. T3's docs say Claude accepts `/compact`.
- First step: A pure Swift function that turns the last result's input and cache tokens into a percent of the model window. Show it as one small line in the conversation. Do compact in a second step.

### 3. Edit an earlier message and ask again (S to M)

- What: "Edit from here" on a sent message. It removes that message and all later ones. The text returns to the box.
- Why: The most common repair of a bad turn. ADR-125 lists it as left out. T3 does it with `checkpoint.rollback`.
- Fit: Conversation only. No file restore. No money change. Code decides what to remove.
- Safe variant: Cut the saved turns. Clear the `ChatSessionRef`. The next turn reopens the session with the transcript, as ADR-113 already does after a provider change. Refuse while a turn runs or a background agent works.
- First step: `ChatStore.truncate(id, fromIndex)` in `services/memory/src/chats.ts`, with tests. Then a protocol command `chat.rewind`.

### 4. Fork a chat from a message (M)

- What: Make a new chat that holds the turns up to a chosen message.
- Why: Try another path without losing the first. T3 records `forkedFrom` and `lineage`.
- Fit: Uses the same transcript reopen as idea 3. The new chat starts with no session. The first turn builds one from the copied turns. This costs the plan tokens of one cold start.
- Alternative: Use the SDK `forkSession(sessionId, { upToMessageId })`, as T3 does. It needs the SDK message id, which ATOM does not store. Skip it at first.
- First step: `ChatStore.fork(id, upToIndex)` that copies turns and the project. Store `forkedFrom` in the chat row.

### 5. Long paste becomes a file (S)

- What: A paste of 4000 characters or more becomes a text file attachment, as T3 does at 32 KiB.
- Why: `text.send` refuses more than 4000 characters (`island-commands.ts`). Today the user must split the text.
- Fit: ADR-113 attachment path and secret-file checks stay as they are. The agent reads the copy with Read.
- Caution: A project chat refuses attachments (ADR-113). Decide what happens there.
- First step: In `ComposerPaste.swift`, a pure rule `PasteChoice` for long text. Write the temp file as for a pasted image (ADR-125).

### 6. A provider capability table in `info` (S)

- What: A fixed table per provider: `tools`, `attachments`, `projectChats`, `resume`, `fork`. Send it in the `info` event.
- Why: T3's rule is "clients read capabilities, never the driver name". Today ATOM refuses a Codex project chat with words. The UI could hide the option first.
- Fit: Deterministic data. No model decides. It is a small step toward the Provider boundary in CLAUDE.md section 2.
- First step: Add `caps` to each `PROVIDERS` entry in `packages/shared/src/config.ts`. Add it to `InfoEvent`. Test in `model-settings.test.ts`.

### 7. Pin and archive chats, with Undo (S to M)

- What: Pin a chat above the list. Archive a chat out of the list. Delete and archive show a 5 second Undo.
- Why: The chat list holds up to 200 plain chats. T3 uses `pinnedAt`, `archivedAt` and an Undo toast.
- Fit: Pure list state. No runtime change beyond a column and two commands.
- First step: Add `pinnedAt` and `archivedAt` to the chats table and `ChatSummary`. Add `chat.pin` and `chat.archive` commands to `docs/island-protocol.md`.

### 8. Continue after a usage limit (M)

- What: When the plan limit stops a turn, show the reset time. Offer "Send again after the reset". Hold the message until then.
- Why: Plan limits are the real cost limit in ATOM. T3 has failure class `usage_limit`, `limitRecovery` on the thread and a worker (`UsageLimitRecoveryWorker.ts`).
- Fit: Money rule safe. It never switches to a key. The worker only waits.
- First step: Parse the reset time from the existing rate-limit event in `planGuard`. Show it in the error line. Add the timer in a second step.

### 9. A depth choice per chat: quick, normal, deep (S to M)

- What: An optional `effort` for a chat. Maps to the SDK `effort` option and `thinking`.
- Why: T3's `TraitsPicker` shows effort, thinking and context size from model data.
- Fit: Default stays as today (thinking off), so ADR-118 token discipline holds. A deeper choice uses more plan tokens, never money. T3 passes `effort` in its query options (verified). ATOM's SDK version is unverified.
- Caution: Changing effort may change the cached prompt prefix. Measure `cacheWrite` before and after.
- First step: Add an optional `options` list to the `chat.model` command and to `ChatSessionRef`. Pass `effort` only when it is set.

### 10. Typed API key or custom endpoint (L) - breaks the money rule

- What: A "Bring your own key" provider, as T3 allows through a secret field or sensitive env rows.
- Why: The user asked about it. It would allow a pay-per-token model when the plan is out.
- Fit: It breaks ADR-092 and ADR-055. Those say no API keys, and `scrubbedEnv` strips them on purpose. It needs a new ADR from Keshab. Do not build it without one.
- Safe variant, if Keshab agrees:
  - Off by default. A separate provider named "Billed: API key". It never runs on its own and never as a fallback.
  - The key goes in the macOS Keychain, not in `.env` or in a settings file. T3 stores keys in a file under `secrets/` with a redacted placeholder in `settings.json`. ATOM can copy the redaction idea (`SECRET_REDACTED`) and use the Keychain instead.
  - The key never enters the Claude Code environment. `scrubbedEnv` stays as it is. The key serves only a plain-text chat through the LLM Gateway.
  - A visible "Billed" label on every turn. A monthly cap set by the user, checked by code.
  - The key never goes to logs, the island, or the model.
- Safe part to build now, without a key: copy T3's secret-field pattern (redacted value, separate store, `sensitive` flag) for other tokens, such as the Telegram bot token that lives in `.env` today.
- First step: Write the ADR draft. No code.

### 11. Plan mode for a plain chat (M)

- What: A `/plan` switch. The next turn runs with `permissionMode: "plan"`. A plan card appears with an "Implement" button.
- Why: T3 uses `interactionMode` plus `sourcePlanRef`. ATOM has it only for plan-first agents.
- Fit: Code sets the mode. The model cannot. Plan mode is stricter, so the risk is low.
- Caution: Unverified that ATOM can change `permissionMode` inside a live session. T3 calls `setPermissionMode` on the query (verified in `ClaudeAdapterV2.ts`). The ATOM `ClaudeSdk` type lacks it.
- First step: A pure rule `modeFor(chat)` and a test. Then wire `/plan` in `slash-commands.ts`.

### 12. History paging for long chats (M)

- What: Send the newest N turns on `chat.open`, with a cursor. Load older turns on scroll.
- Why: T3 caps a page at 10 user turns or 75 items or 1 MiB. ATOM sends the whole chat.
- Fit: Needs a protocol change and a Swift list change. Low value until chats get long. Do it after the items above.
- First step: Measure the largest chat in `data` and the size of its `chat.opened` event.

### 13. "Allow for this chat" on approvals (S to M)

- What: A third button next to Allow and Decline. It remembers one narrow rule for this chat only. T3 calls it `acceptForSession`.
- Why: Computer control asks again and again for the same app or action.
- Fit: It widens permissions, so it needs an ADR and tests in the safety gate. Code stores the rule. The model cannot. T3 notes that "always" grants can leak across a project, so scope by chat and by exact target.
- First step: Write the ADR. Define the rule key (tool plus target). Never apply it to blocked apps or secret fields.

### 14. Steer a running turn (M)

- What: Send a new message into the running turn instead of stop and resend. T3 has `steer_active`.
- Why: ADR-127 chose "Cmd+Return stops the answer". Steer would keep the work done so far.
- Fit: Money rule safe. Unverified that ATOM's streaming-input session handles a user message in the middle of a turn. ATOM has a `skip` counter for turns Claude Code starts by itself, so the stream is not simple.
- First step: A live probe with a fake SDK test. Only then a design.

### Not recommended now

- Orchestration V2 objects (runs, attempts, nodes, checkpoints, context transfers). They solve many providers and a remote server. ATOM has one main provider and one device. CLAUDE.md section 22 says do not build it before it is needed.
- Multiple instances of one provider. ATOM has one user and one plan.
- Send one prompt to several models. It multiplies plan use.
- The bundled model manifest with remote fetch. ATOM reads the live list from the SDK, which is more exact.
