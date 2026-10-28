# Board and Dashboard — 27 October 2026

## Scope and direction

Requested: visible agent creation, editing and availability controls on the Board, plus a clearer Board and Dashboard using the Impeccable workflow. The owner selected **Ready/Paused availability**, with task states continuing to follow actual Start/Stop/Retry outcomes.

Mode: **Operate**. This is a code-led replacement of two page layouts inside ATOM's existing macOS visual identity, not a new global brand or illustration system. Native SF typography, SF Symbols, theme palettes, app text scaling, navigation rail, character art and office floor remain the visual authority. No image comp, concept-seed exercise, new display font, design hooks or detector was used.

- **THESIS:** make managing an agent and finding work needing attention immediate, while keeping accounting secondary.
- **OWN-WORLD:** a quiet native Mac workspace, token-defined light/dark surfaces, hairline separators, ordinary menus/buttons, and ATOM's existing illustrated office. Preserve the current Theme/ChatAppearance/WorkspaceColors grounds rather than inventing a new palette.
- **STORY:** Board leads with team actions and agents; Dashboard leads with actionable work totals, then readable usage and deeper accounting.
- **FIRST VIEWPORT:** Board exposes All agents and Add agent before the floor and editable roster. Dashboard exposes review/running/team links before usage and daily activity.
- **FORM:** fluid content width; Board splits floor/roster at 840 points and stacks below; Dashboard uses three work links across the width and four usage columns when they fit, otherwise two. No decorative card grid, eyebrow or hero metric.

Impeccable reference: `pbakaus/impeccable`, pinned to `0dd67516c6387706e7b7e7f47f1c715efe6947c6`. Its guidance was read from a temporary checkout, not installed globally or bundled into ATOM. The existing `design/atom-design-system/DESIGN.md` predates recent navigation changes; this task preserves its confirmed theme/type principles without claiming the old sidebar/680-point description still matches the app.

## Implemented behavior

- Board header owns Add agent. All agents and the compact roster expose each agent's Edit and availability menu. Editing reuses existing configuration/versioning rather than a second save path.
- `agent.pause` accepts an agent id and strict boolean. The existing helper-settings table persists `paused:<id>` without a migration. Older events without `paused` decode as Ready/default false.
- Paused agents cannot accept new jobs or start already-queued jobs. The final store start gate applies even if work was queued earlier. Existing running tasks, reports, permissions, tools and Stop remain unchanged.
- Paused agents remain on the floor; actual running/waiting/failure states take precedence over an idle Paused bubble. Unimplemented/unavailable agents cannot be made available through this menu.
- Home/Dashboard uses functional review/running/team links, a plain usage summary, daily bars with a legend and a disclosure for detailed accounting. Recent turns, worker/model data, plan meters, briefs, suggestions and Git controls remain accessible.

## Verification

- No automated test suites or provider/model requests, per the owner's instruction. TypeScript typecheck, signed release build, isolated store/command checks, native rendered fixtures and live UI inspection are used instead.
- Isolated store checks: pause refuses add/start, preserves an existing running job, resumes queued work, and persists across a temporary database reopen. Strict command parsing rejects a string in place of the boolean.
- Live Board: Add agent opened the existing form and was cancelled without creating an agent. Edit opened Cedar Live A coder's existing name/personality/how-it-works/rules fields without saving. Its availability successfully round-tripped Ready → Paused → Ready; original state restored. No permissions or chat content changed.
- Native gallery fixtures are explicitly synthetic, isolated from runtime and defaults. Six fictional agents include Ready, Paused and running states, plus sample seven-day usage. Sixteen renders cover wide/compact Board and Dashboard, large Dashboard text, all-agents, Add and Edit in light and dark. These are layout evidence, not production-task acceptance.

The final signed native release build passed (existing Swift concurrency/deprecation warnings remain). TypeScript and strict bundle-signature/whitespace checks passed. Impeccable finish review: **disposition: ship**, all sixteen captures valid, no material fixes. Its documenter confirmed that the existing visual system is preserved; no global design-system rewrite or sidecar was warranted. Live final-build Dashboard → team roster opened all 13 existing agents with Edit/availability controls.

The final safety review caught and corrected a continuation edge: the native tool gate now permits a paused worker only for its own host-bound running attempt; new admission remains refused. An isolated decision-only probe confirmed that the existing running task retains an in-kit tool, while unbound, out-of-kit and stopped calls are refused. No actual tools or models were invoked. Removing a custom agent also clears its paused setting so a later reused id does not inherit it.

Deferred: automated regression suites, real provider-driven pause-during-work acceptance, exhaustive keyboard/VoiceOver audit and every optional theme. Add/Edit navigation was verified without creating or saving an agent; that does not claim a new end-to-end creation acceptance. Existing work, original chat/draft/access selection and unrelated `graphify-out/` are preserved. Changes remain local on `codex/stopped-task-summary`; no commit/push.

## Reference-led activity layout refinement

The owner corrected the first timeline-heavy direction with a supplied 398×230 dashboard image. Its structural authority is a slim metric strip above three aligned work areas: stacked trend charts on the left, a contribution-style activity grid and donut in the center, compact lists on the right. ATOM follows that composition with its existing native theme and real data; the tiny reference's domain-specific labels and values are not copied or invented.

Current direction supersedes the earlier Dashboard single-column FORM: six compact metrics; three columns above 1140 content points, two above 760, one below. Left: seven-day tokens, cached-input and recorded-call trends. Middle: dated local commit activity, a token-mix donut and four initial expandable task-branch summaries with explicit View all/Show fewer. Right: current brief, a compact archive with in-place expansion and View all, and reviewed prepared work. Recent turns and accounting remain in disclosures below. Charts show the seven samples actually recorded rather than fabricated high-frequency telemetry.

Git activity is derived from dated commits present in current local branch snapshots, deduplicated by repository and SHA, over 14 days ending at the latest recorded commit. It is explicitly not a push log, complete contribution history or inferred commit-parent graph. Existing branch push status, warnings, diff inspection and guarded push confirmation remain available. No Git push is performed by this presentation change.

The Board's office illustration no longer has a constant 320-point height. Its wide layout uses the available viewport height; the compact layout derives height from its width and office-map ratio. The office preserves its proportions, hit testing, agents, permissions and task controls.

Scoped visual rules from the implementation:

- `DashboardPanel` in `DashboardOverviewGrid.swift` uses a white light-theme surface or the existing dark-theme `fill2`, rounded corners (12 pt), internal padding (12 pt) and a content gap (10 pt). Aligned panels and columns are separated by 14 pt; the wide brief column is 280 pt. These are Dashboard composition rules, not replacements for global theme tokens.
- Native `appFont` keeps the owner's text scaling: Overview (20 pt semibold), panel titles (13 pt semibold), summary/trend readouts (18 pt semibold, monospaced figures), brief text (12 pt) and panel details (10.5 pt). Semantic theme colors continue to govern text, trends and state.
- `GitCommitActivity.swift` distinguishes empty cells with `fill3` and a secondary outline. `DashboardTokenMix` uses a visible neutral empty track and a word-and-count legend for input/output, cache written and cache read. Its ring represents composition, not progress toward a target.
- Each compact branch expands in place; the list initially shows four. The archive initially shows three with dated expandable entries. Both provide View all/Show fewer. Bounded summaries preserve the aligned overview without hiding the underlying review controls.

Refinement verification completed: final signed native build passed (51.64 seconds; existing weak-capture/deprecation warnings), strict signature and whitespace checks passed. Sixteen targeted fixture captures were reviewed against the supplied image, including a 1920×1080 Board viewport and an empty donut within the actual light/dark Dashboard panel. The finish review first returned **fix** for three issues, then **ship** for the scored corrections with no regressions. Live maximized Board growth, real-data branch details, earlier-brief expand/collapse, distinct time labels and all 14 branches through View all/Show fewer were verified. The rebuilt app is left on the maximized Dashboard at its top; no brief generation, Git push, model request or saved-content change was made. No automated test suite is planned for this pass. Panel surfaces follow the supplied reference: white in light themes, existing fill2 in dark themes; this is scoped to these Dashboard panels. The final review requested distinct neutral heatmap cells/empty-ring tracks within dark panels, bounded production branch density, and created times in archive accessibility names; these are included in the final fix batch.
