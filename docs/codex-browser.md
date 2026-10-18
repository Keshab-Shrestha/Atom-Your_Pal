# Codex worker browser

Implemented 2026-10-18, ADR-163. This adds a bounded navigation/snapshot/form adapter under the existing browser grant. It does not expose every Playwright browser tool or complete Codex parity. Tests and live acceptance remain skipped by request.

## Admission and interface

An available non-think worker with its browser switch on and a host browser configuration gets `atom_Browser`. The host captures the existing per-worker Chromium configuration and rechecks it, the running task, worker availability/kit and browser grant before work, during requests and every 200 ms while idle. An observed change closes the task's browser permanently; granting access again requires a new task. A task that starts without the capability does not gain it midway. The separate WebFetch/web setting is not the browser permission.

The host connects to the installed Playwright MCP stdio server using ATOM's existing profile and output directories for that worker. It does not attach to the user's browser, an extension or a CDP endpoint. The shared native browser lane serializes tasks across Claude/Codex using that worker's profile. Lane acquisition and initial site/plan approval happen before server startup. A cancelled waiter that acquires late releases the lane immediately; normal release follows owned-connection cleanup and task end.

Browser takes an `action` and `arguments_json`, a JSON object string of at most 8,000 bytes. Unknown fields/actions refuse. Available actions:

| Action | Accepted fields |
| --- | --- |
| navigate | `url`: explicit HTTP(S) address, <=2,000 characters, no userinfo/control/whitespace |
| snapshot | empty object |
| click, hover | `target`: exact snapshot reference only |
| type | `target`, `text` <=2,000 characters, optional Boolean `submit` |
| fill_form | `fields`: 1–8 entries with `name` <=80 characters, `target`, supported field `type`, string `value` <=1,000 characters |
| select_option | `target`, `values`: 1–8 nonempty strings <=200 characters each |
| press_key | `key`: arrows, PageUp/PageDown, Home/End, Tab/Shift+Tab, Escape, Enter, Backspace, Delete, Space |
| wait_for | optional `time` >0 and <=5 seconds, `text`/`textGone` <=200 characters; at least one required |

Start every browser task with navigate. Targets must match the pinned server's `eN`/`fNeN` reference syntax, occur in the last returned bounded snapshot, and still occur in the fresh current snapshot. Selectors, model-generated page code, arbitrary key strings, clipboard/system shortcuts, paths, configuration, tabs, back/forward navigation, uploads, screenshots, downloads tools, dialogs and resize are not exposed. The server's advertised tools are intersected with the fixed host actions, never passed directly to Codex.

## Approvals and current-page checks

Every operation uses fresh native policy ids. Plan-first workers need ExitPlanMode approval before any browser use. Existing per-origin task approval is reused. In this host adapter only, each click, hover, type, fill, select and key operation asks for its own interaction approval, rather than relying on submit-word heuristics or remembered typing permission. Existing password/unknown-field checks can ask an additional per-entry card. Cards/Board observations omit typed values and form bodies. Default Claude interaction behavior stays unchanged when the host option is absent.

Non-navigation operations first read a new explicit inline snapshot. The host parses the installed server's Page header preceding its Snapshot section, updates the shared native page/ref policy, then checks that the current origin is approved before returning page text or authorizing an interaction. It never takes an origin from snapshot body text. After an interaction card resolves, another snapshot must retain the same URL and target lines; key actions additionally require an unchanged tree. Changed context refuses the interaction and asks for a fresh snapshot/action. This narrows stale approvals; it is not an atomic DOM/focus lock and cannot prevent concurrent user/page changes after the last check.

Successful actions are followed by another explicit inline snapshot. A redirect/new current tab must pass its origin approval before that snapshot is returned or later acted on. Browser data marks the worker as having read untrusted external content, including dispatches whose results are lost. The existing external-MCP fresh-approval rule and worker-to-foreground taint propagation apply. Page text cannot grant access, approve messages/purchases/deletions or authorize a new capability. An interaction card does not establish the user's broader task intent; the worker prompt requires explicit user authorization for external effects.

## Bounds and failure behavior

Twenty admitted attempts per task; one browser operation at a time. Handshake/tool listing has a combined 15-second wait; each browser RPC has a 30-second wait without progress extension; policy/lane waits are bounded at 600 seconds (the existing approval bridge may decline sooner). The worker's existing overall gateway deadline still applies. Host-owned CLI flags disable generated code and image responses, set 10-second action/15-second navigation timeouts and retain the existing no-WebMCP/password marker setup. No model-driven CLI flags, environment or server config are accepted.

Explicit snapshot text over 128 KiB, unsupported/missing inline snapshot format, non-HTTP(S)/userinfo page headers or secret-shaped data refuse. Supported returned page state is redacted and limited to 32 KiB plus a short host envelope, with visible truncation; only refs in that returned prefix can be selected. Limits apply after SDK receipt/parsing, not to total transport/server/browser memory. Secret/password marking and detection remain heuristic, not proof of complete credential protection. Page data already returned cannot be recalled from provider context.

Stop, changed access, timeout, policy/verification failure or task completion aborts waits and closes the owned stdio session. Cleanup wait is bounded at five seconds; the SDK escalates termination of its direct server child. This is not a generic browser-descendant supervisor or guarantee that all Chromium processes stopped. A failed/denied browser operation closes that task's adapter without automatic reconnect/retry. A missing/stale ref or context change detected before dispatch can instead request a new snapshot within the same task.

An error after requested dispatch explicitly retains an unknown external outcome. No rollback, exactly-once action, destination reconciliation or automatic retry is claimed. Code reports only completed transport/action plus a checked snapshot; that does not prove a site's intended business operation succeeded. Profiles/logins persist in ATOM's existing worker profile, and server-generated artifacts use its existing data output directory. Page scripts, subresources, popups and incidental downloads can still run. Site approval controls host operations and snapshot disclosure; it is not network-origin/private-IP containment or ProjectCommand's filesystem sandbox. No page code/evaluate tool is offered, but ordinary websites execute JavaScript.

## Verification and next step

`pnpm typecheck` and `git diff --check` pass; static source/policy/lifetime review completed against the installed Playwright MCP 0.0.83 sources and SDK types. No tests added/run, browser/MCP server startup, profile/site visits, adapter/network/provider calls, migration, gallery or app launch/install/live acceptance. No Swift source changed, so no new Swift build. Installed app unchanged. ADR-160–163 remain local/uncommitted on `main` after pushed commit 2fe2250; unrelated graphify-out is preserved and known CI failures deliberately deferred.

No dependency, schema, UI switch, native Codex browser/network privilege, external MCP assignment or provider fallback changed. Next independent capability: nested-worker design with explicit task ownership, grant inheritance, depth and Stop limits. General shell/scripts/builds/tests, built-in hosted search and omitted browser operations remain separate gaps. Live acceptance remains outstanding.

Reference: [Playwright MCP documentation](https://github.com/microsoft/playwright-mcp/blob/main/README.md). Implementation uses the installed package's fixed tool arguments, inline snapshot sections and flags; newer documentation does not establish runtime compatibility. The documented origin controls are not a security boundary.


Subsequent update (ADR-164): one generation of tool-free advisory children is implemented with bounded ownership, supplied context and parent/child Stop behavior. [Current advisory child scope and verification limits](codex-advisory-workers.md). Tool-enabled/recursive children remain separate; the earlier next-step statement describes the browser batch's checkpoint.
