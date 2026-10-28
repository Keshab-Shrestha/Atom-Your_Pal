# Native OMH dependency and declared-write scheduling

Fourth bounded slice, 26 October 2026. Extend the existing scheduler; no Hermes runtime, automatic repair, extra model call or execution authority.

## Behavior

`plan_work` accepts optional `writeScope` paths on each portion, for example `["src/chat", "docs/chat.md"]`. These are literal paths relative to the selected project. `.` covers the project. Missing/empty declarations remain conservative: the whole selected project, or unknown scope outside a project. They never mean read-only.

The host derives an `atom.write-scope/v1` binding and stores it beside the existing portion metadata in `work_plans.portions`. Model-supplied bindings are ignored. No migration, transcript rewrite or permission-record change is needed. Legacy undeclared plans remain compatible and conservative.

Declarations reject absolute paths, traversal, patterns, shell syntax, Git internals and more than 32 generated entries. Metadata resolution follows existing ancestors/symlinks, including the nearest existing ancestor of a new file. Outside-project/dangling links, inaccessible ancestors, explicit hard-linked files and unsupported file types refuse; linked Git internals also refuse. Canonical comparison uses component boundaries with conservative Unicode normalization/case folding: `src` overlaps `src/chat`, while `src` and `src-old` remain distinct. Case-sensitive volumes may serialize more than necessary.

Two explicitly declared overlapping scopes need an `after` dependency, direct or through an earlier chain. Ambiguous plans refuse rather than acquiring an invented order. Admission checks active/reserved portions again. Compatible declarations can use the existing two slots; unknown/whole-project file scopes wait for conflicting work. `plan_status` suggests a compatible batch and explains holds. Explicit portion inspection expands its declarations.

Folder-kit workers and portions declaring paths participate in file holds. An unnumbered folder task cannot bypass active/reserved file work in the same chat. Production queries all running native jobs, beyond the sidebar's latest 20; tool-free advisory children are excluded. Lightweight adapters without this query retain their recent-job fallback and need the new query before claiming complete active-job coverage.

Reservations are shared by books using the same helper store, including recreated Claude/Codex books during model choice. Replacing a plan is refused while its portions or unnumbered file work are running/starting. Idle unfinished plans can still be replaced; old records remain stored.

Immediately before job creation, the gate rechecks paths after asynchronous model/repository preparation. Changed projects or retargeted declarations require a new plan. Stop releases pending holds immediately; captured cancellation is checked before job creation/dispatch. Cleanup runs once, so delayed completion cannot clear a newer attempt's reservation. Admission failures after job creation stop the undispatched row and retain it for audit. No automatic retry follows.

## Boundaries

These are **declared-write scheduling checks**, not a filesystem sandbox or proof of actual writes. Existing grants, protected-file checks, approvals, access modes, Stop and Git policy remain authoritative. Workers receive their declarations and are told to request replanning if more paths are needed.

There is no recursive alias scan or continuous filesystem watch. Aliases inside declared directories, external processes, changes after the final metadata observation, writes outside declarations, MCP side effects and cross-chat/project concurrency are outside this scheduler's guarantee. Other kits without explicit paths are not certified side-effect free. Actual write-set enforcement/attestation needs a separate slice.

Dependencies pass reports. Existing isolated worktrees do **not** automatically receive predecessor uncommitted edits. This neither copies/merges those files nor commits/pushes them; the tool description warns against assuming file transfer. Dependent work needing those edits requires an explicit reviewed handoff. Independent verification, bounded repair, cross-process leases and broader descendant cancellation remain separate.

History, saved grants, drafts, provider pins and memory continuity are untouched. No speed improvement is measured.

## Validation and deferred acceptance

`pnpm typecheck` and `git diff --check` pass. Reviewed parser/storage/views, provider bindings, shared reservations, unnumbered admission and cancellation cleanup. No suites, model calls, native build, installation/restart, commit or push. Runtime behavior is pending end-stage acceptance:

- Store/reopen new and legacy plans; reject forged bindings/malformed declarations.
- Exercise nested/new paths, same-target/outside/dangling/retargeted links, explicit hard links, Git aliases, Unicode/case variants and component boundaries.
- Reject unordered overlap; accept direct/transitive dependencies; retain failure propagation/two slots.
- Admit disjoint paths together; serialize unknown scopes and explain invalid/held portions.
- Block replacement, unnumbered bypass and duplicate claims during preparation, across books and beyond 20 recent jobs.
- Stop during chooser/repository detection; start a fresh attempt, then resolve the old call and confirm no late job or lost new reservation.
- Retarget paths during preparation; fail linkage and confirm no orphan running row or replay.
- Preserve actual grants/revoke, history, isolation, explicit Git handoff and selected providers.

Implementation: `services/helpers/src/write-scopes.ts`, work-plan/store views, `apps/mac/src/native-plan.ts`, `native-safety.ts` and existing Claude/Codex adapters.
