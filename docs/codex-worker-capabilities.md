# Codex worker instructions and activity

Implemented 2026-10-18, ADR-158. This is a scoped Codex parity batch, not complete provider parity.

ADR-159 subsequently adds checked known-URL public-page reading for research workers when web access is enabled. [Current page-reading scope and verification limits](codex-public-pages.md).

Codex delegation still uses the chat's signed-in Codex model. A folders worker gets checked text-file tools and, in a project, its task worktree. Every kit can now load skill instructions explicitly assigned to that worker. The runtime supplies the existing local skill reader, with the user's skill taking precedence over an ATOM skill of the same name.

## Assigned instructions

`atom_Skill` accepts an exact assigned name, without a plugin prefix or path. The router checks the worker's task-start assignment and current assignment before reading; the native gate checks the active worker/task and current assignment again before returning instructions. An assignment added during a task is available on its next task. Removing one refuses later loads; already-returned text cannot be recalled from a provider context.

Each successful return contains at most 8,000 instruction characters, with 24,000 across the task, including repeated loads. Parallel loads recheck the remaining budget after awaiting policy. Long bodies are visibly cut. Missing, unreadable, empty, unassigned, over-budget, denied and cancelled loads do not count as skill use. The host records use immediately before a successful tool return, not on task creation or policy authorization. This proves returned instructions, not that the model followed them.

This loads SKILL.md text only. It does not install or execute Claude plugins, scripts or supporting files. Skill text cannot grant tools, access, approval or a provider change. Existing file/plan/kit rules and native Codex lockdown remain authoritative. There is no fallback to Claude.

## Board activity

Worker host calls use the existing task timeline store and UI, with fresh host UUIDs, start/end timestamps, durations and generic success/error outcomes. Reused provider RPC ids cannot collapse distinct calls. Starts contain tool names and existing bounded/redacted file-target summaries; they omit Grep patterns, plans, edit payloads and skill text. Ends contain fixed outcome text, never tool-result bodies. A caught exception returns an error without its stack or a claimed success. Telemetry-write failures remain non-fatal through the shared recorder.

The existing store keeps 200 calls per task and displays the latest 100. Task deletion removes them. On restart, unfinished entries follow the existing Interrupted/error behavior; interruption does not establish whether a filesystem effect occurred. There is no new schema or generic effect journal. Foreground work observations remain separate.

## Capability descriptions and gaps

The main delegation tool describes each worker's actual Codex capabilities. Worker prompts combine existing identity/instructions with a Codex host-tool contract, replacing the Claude-specific kit contract that described unavailable shell/web tools. Prompts require honest limitation reports and actual results for claims of changes or research. The Board initially explains when a saved Claude pin does not apply; normal usage events still report the actual Codex model.

Still unsupported for Codex workers: shell, web search, browser, external MCP, provider-specific worker model pins and nested delegation. Research workers now have the bounded known-URL page reader from ADR-159 when web access is enabled. Assigned instruction loading does not close the other gaps. Background conversation summaries retain their existing Claude route.

## Verification and next step

`pnpm typecheck` passes; static source/diff review completed. No tests added/run, model calls, migrations, app launch or live cancellation/permission/skill/Board acceptance, by the user's continuing no-tests request. No Swift source changed in this batch, so no additional Swift build was needed. The installed app is unchanged. Work remains local/uncommitted on `main`; historical test/live results do not validate ADR-158.

Next Codex work after ADR-159: a supported search adapter, other missing worker adapters and provider-specific model-pin design. Live acceptance remains outstanding for these batches and recent chat/reliability changes.
