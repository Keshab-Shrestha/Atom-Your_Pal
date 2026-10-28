# Codex worker model pins

Implemented 2026-10-18, ADR-160. Agents now have separate Claude and Codex model controls. In Agents, open a worker and use its Codex menu to select a model or choose **Use chat's Codex model** to clear the pin. The Claude control retains its existing behavior and is labeled Claude explicitly.

## Selection and execution

The Codex menu uses the available Codex provider's existing offered-model catalog from the runtime's info event, independently of the global/chat provider currently selected. It does not infer model tiers, prices or capabilities from model names. A saved pin stays visible if Codex or its model is unavailable, and can still be cleared; setting a new pin requires a currently offered Codex model. The host repeats this catalog check when saving and before admitting a pinned task.

For a task already routed to Codex, task admission captures the worker's Codex pin, or the chat's selected Codex model when no pin is set. The worker adapter receives that model directly. An unavailable pin refuses admission before creating a Board job or starting a provider session, with instructions to select another offered model or clear the pin. A provider-side model/account rejection also remains a failure; it does not clear the setting, silently select another model or switch to Claude. Offered catalog membership is not proof that the signed-in account can run every listed model.

Pin changes apply to subsequent tasks, including later explicit retries. They do not change a running task, the chat's foreground model/provider, a project's model, global settings or Claude's pin. Claude tasks do not read the Codex pin. Existing Claude/Laya tier and large-model settings remain scoped to their current Claude path; no new Codex tier/spend policy is claimed. The Codex default alias, when offered and selected, retains its existing provider-default semantics rather than naming an exact model version.

The Board initially records the requested model and whether it came from the worker pin or chat. Existing usage events can replace this with the actual model reported by Codex. File grants, plans, skills, web admission, Stop, checkpoints and the native execution lockdown are unchanged.

## Storage and protocol

An additive helper_codex_models table stores helper id and model id separately from the existing Claude helper_models table. No existing pin is copied or reinterpreted. Clearing deletes only the Codex row; custom-agent removal clears its Codex row in the existing cleanup transaction so a reused helper id cannot inherit it. SQL parameters are bound, with model length/syntax checks in code and a database length constraint.

The private command is `helper.codex.pin` with helper/model strings; an empty model clears the pin. Extra fields, invalid ids and non-string values are refused. The helper bridge validates offered models; errors use the existing settings path. Helpers events include optional codexPinnedModel only when set. Native decoding validates its shape and treats an absent field as no pin, preserving older payloads. Older installed UIs do not expose this control; newer UI plus an older host cannot set a pin until the runtime is updated. No public/model tool or secret field is added.

## Search decision and remaining work

Search was inspected before choosing this independently useful batch. Official documentation says hosted Codex search is separate from the command-network proxy; it requires its own configuration boundary. The installed CLI's structured search-results route is marked under development and off by default. No native search was enabled and no search subprocess was added. Search remains pending an isolated, capability-checked design rather than being counted as delivered. [Official web-search boundary](https://learn.chatgpt.com/docs/web-search#configure-local-web-search).

ADR-161 subsequently adds fixed read-only project command inspection ([scope](codex-project-inspection.md)); general shell/scripts/builds/tests, search, browser, external MCP and nested workers remain open. Known-URL pages and assigned instructions retain their bounded scope. Search design remains open while independent worker capabilities proceed.

## Verification

TypeScript checking, Swift release compilation and static diff review pass. The release build retains the existing IslandSettings/main capture warnings. No tests added/run, migration execution, provider requests, gallery, app launch or live pin/restart/account/UI acceptance, by the continuing user instruction. Installed app unchanged; local/uncommitted on main after the earlier 2fe2250 push.

CI for 2fe2250 remains failed: three TypeScript assertion mismatches and a Swift 6.3.3 compiler crash blocking Swift/visual jobs. The user explicitly chose further upgrades instead of CI repairs. This batch changes neither those assertions nor ChatFindBar nor the workflow, and local compilation is not evidence that CI is repaired.


Subsequent update (ADR-162): checked external MCP discovery/calls are implemented for tested, enabled server assignments on non-think Codex workers. [Current MCP behavior and verification limits](codex-external-mcp.md). Earlier remaining-work statements describe their original batch; the next independent adapter is browser access.
