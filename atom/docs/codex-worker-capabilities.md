# Codex worker instructions and activity

Implemented 2026-10-18, ADR-158. This is a scoped Codex parity batch, not complete provider parity.

ADR-159 subsequently adds checked known-URL public-page reading for research workers when web access is enabled. [Current page-reading scope and verification limits](codex-public-pages.md).

ADR-160 adds a separate Codex model pin per worker. Without a pin, tasks continue to inherit their chat's Codex model; Claude pins remain independent. [Current model-pin scope and verification limits](codex-worker-models.md).

ADR-161 adds read-only fixed-utility command inspection to project folders workers, with explicit sandboxing, native policy and bounds. General shell/scripts/builds/tests remain unavailable. [Inspection scope and verification limits](codex-project-inspection.md).

ADR-162 adds checked external MCP discovery/calls for tested, enabled servers assigned to non-think workers, with plan/trust/one-call approval and bounded task-owned connections. [MCP scope and verification limits](codex-external-mcp.md).

ADR-163 adds bounded browser navigation/text snapshots/form interactions under existing browser/site grants, with fresh cards and current-page checks. [Browser scope and verification limits](codex-browser.md).

ADR-164 adds one generation of bounded advisory children: supplied context only, no tools or inherited grants, separate linked tasks and parent-owned Stop. [Advisory child scope and verification limits](codex-advisory-workers.md).

Codex delegation inherits the chat's signed-in Codex model unless the worker has a validated separate Codex pin. A folders worker gets checked text-file tools and, in a project, its task worktree. Every kit can now load skill instructions explicitly assigned to that worker. The runtime supplies the existing local skill reader, with the user's skill taking precedence over an ATOM skill of the same name.

ADR-165 adds discard-only shell previews on explicitly selected input copies. Native checks and a fresh complete-request card apply; the real task root is denied and nothing applies automatically. [Preview scope and verification limits](codex-shell-previews.md).

ADR-166 adds separately approved short preview-input edits with host source receipts, full-text review, fresh source conflict checks and required checkpoint copies. No automatic shell-diff import or larger/multi-file review. [Reviewed-edit scope and verification limits](codex-preview-edits.md).

ADR-167 expands capable hosts to a bounded native diff with complete Before/After text and request-token approval. Generic/old-client/Telegram Allow cannot approve richer reviews; source/undo/hold checks remain. [Native-review scope](codex-native-file-review.md).

## Assigned instructions

`atom_Skill` accepts an exact assigned name, without a plugin prefix or path. The router checks the worker's task-start assignment and current assignment before reading; the native gate checks the active worker/task and current assignment again before returning instructions. An assignment added during a task is available on its next task. Removing one refuses later loads; already-returned text cannot be recalled from a provider context.

Each successful return contains at most 8,000 instruction characters, with 24,000 across the task, including repeated loads. Parallel loads recheck the remaining budget after awaiting policy. Long bodies are visibly cut. Missing, unreadable, empty, unassigned, over-budget, denied and cancelled loads do not count as skill use. The host records use immediately before a successful tool return, not on task creation or policy authorization. This proves returned instructions, not that the model followed them.

This loads SKILL.md text only. It does not install or execute Claude plugins, scripts or supporting files. Skill text cannot grant tools, access, approval or a provider change. Existing file/plan/kit rules and native Codex lockdown remain authoritative. There is no fallback to Claude.

## Board activity

Worker host calls use the existing task timeline store and UI, with fresh host UUIDs, start/end timestamps, durations and generic success/error outcomes. Reused provider RPC ids cannot collapse distinct calls. Starts contain tool names and existing bounded/redacted file-target summaries; they omit Grep patterns, plans, edit payloads and skill text. Ends contain fixed outcome text, never tool-result bodies. A caught exception returns an error without its stack or a claimed success. Telemetry-write failures remain non-fatal through the shared recorder.

The existing store keeps 200 calls per task and displays the latest 100. Task deletion removes them. On restart, unfinished entries follow the existing Interrupted/error behavior; interruption does not establish whether a filesystem effect occurred. There is no new schema or generic effect journal. Foreground work observations remain separate.

## Capability descriptions and gaps

The main delegation tool describes each worker's actual Codex capabilities. Worker prompts combine existing identity/instructions with a Codex host-tool contract, replacing the Claude-specific kit contract that described unavailable shell/web tools. Prompts require honest limitation reports and actual results for claims of changes or research. The Board initially explains when a saved Claude pin does not apply; normal usage events still report the actual Codex model.

Still unsupported as native Codex worker capabilities: general shell/scripts/builds/tests, built-in web search, tool-enabled children and recursive delegation. Advisory children use ADR-164's bounded no-tools consultation path. Browser access uses ADR-163's bounded adapter; uploads/screenshots/tabs/dialogs and page code remain outside it. External MCP uses ADR-162's checked assigned-server adapter; third-party tools may expose other actions under their own configured privileges. Project folders workers have ADR-161's fixed read-only inspection utilities and ADR-165's disposable selected-input shell simulation, plus ADR-166's separately approved short input replacements, without real-project shell writes or automatic apply; research workers have ADR-159's known-URL reader when web access is enabled. Separate model pins use ADR-160's no-fallback admission checks. Assigned instructions do not close the other gaps. Background conversation summaries retain their existing Claude route.

## Verification and next step

`pnpm typecheck` passes; static source/diff review completed. No tests added/run, model calls, migrations, app launch or live cancellation/permission/skill/Board acceptance, by the user's continuing no-tests request. No Swift source changed in this batch, so no additional Swift build was needed. The installed app is unchanged. Work remains local/uncommitted on `main`; historical test/live results do not validate ADR-158.

Next Codex work after ADR-167: design generated-file proposal capture using sandboxed content transport, complete review and required undo. Tool-enabled child grant intersections/recursion remain unsupported. General shell/write/undo/lifetime and isolated search designs remain open. Live acceptance remains outstanding for these batches and recent chat/reliability changes.
