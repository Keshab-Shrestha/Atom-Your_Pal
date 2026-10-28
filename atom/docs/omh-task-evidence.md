# Native workflow task evidence

26 October 2026 · Second bounded slice of [ATOM-native OMH orchestration](omh-native-orchestration.md).

## Outcome and boundary

Keep a host-owned identity for each actual task attempt and distinguish its lifecycle from the worker's claims. Collect bounded metadata for Codex's existing checked `ProjectCommand` inspections. Show a short execution summary alongside the worker's report in both the chat task result and task detail view, with IDs/revision details collapsed.

These receipts attest what the collector observed. They do not certify a task's natural-language deliverable, create a test pass, approve a command or declare the current working copy verified. A requested verification criterion, worker report, SDK tool summary and host-observed inspection remain distinct.

## Durable attempt identity

Two additive tables in the existing helper database store attempts and inspection receipts. Starting a job creates a fresh host UUID. Legacy reruns of the same job receive another identity; explicit native retries already have separate job IDs and also receive their own attempt UUID. Previous attempts remain stored, while the normal readback selects the latest attempt only.

Done means **reported**, not verified. Failure, Stop and interruption have separate states. On database reopening, running attempt records become interrupted; no command is replayed. Old jobs without records remain without records—there is no fabricated historical migration. Deleting a task removes its dependent evidence through a database trigger.

The collector rejects a receipt unless its job is running, its supplied attempt matches the current running attempt and its ID/metadata are valid. It refuses duplicates and retains at most 64 receipts per attempt. UI/model detail reads select the newest twelve; compact status uses the full count. Late responses cannot append to a stopped, ended or superseded attempt.

## What the inspection collector records

The `atom.task-inspection/v1` receipt carries:

- Host receipt ID, attempt ID and observation time.
- The fixed, allowlisted inspection utility name (for example `head` or `grep`), without its arguments.
- SHA-256 identities for the prepared executable/arguments and host-selected working directory.
- The runner's actual exit code, or null when no conclusive exit was supplied.
- Before/after Git metadata observations: clean, dirty or unavailable, with observed HEAD when available.
- A historical source revision only when both observations were clean and named the same commit.

Raw commands, arguments, paths, stdout/stderr, file contents and credentials are not copied into these tables. The existing timeline retains its existing redacted summaries separately. No model-facing evidence writer is registered.

This first collector covers **Codex ProjectCommand**, which permits bounded read-only inspection. It does not classify `grep` exit 1 as a failed task or turn exit 0 into a passed test. A null exit can also mean dispatch did not begin; the details say so. Disposable `ProjectShellPreview` calls, direct SDK Bash, manual Terminal checks, external MCP tools and arbitrary model claims do not receive these receipts. They remain unverified by this collector rather than being mislabeled as real-project checks.

## Revision observations and cost

Reuse the existing safe Git reader: no shell, inherited Git routing, optional index writes, prompts, executable hooks, fsmonitor, external diffs or configured worktree filters. Inspect metadata in the host-selected task directory. Each boundary probe has a 250 ms cancellation deadline, also tied to Stop. Failed/slow probes return unavailable and do not start another command, weaken policy or trigger a retry. The two probes can add up to roughly 500 ms plus process cleanup; this overhead is not a measured performance improvement.

Only the current project subtree is inspected. Ignored files, submodule contents and dependency/environment state are not attested. Reads at two boundaries are not a continuous or atomic filesystem snapshot. Dirty or changed state therefore receives no commit binding; an earlier record never becomes a current verification seal after later edits.

Command admission and target read approvals still occur before collection. Stop/project access is rechecked after the first metadata probe and by the existing execution runner. Evidence collection has no permission or model-selection authority.

## Product surfaces

- The existing thread response includes additive optional `executionEvidence` text from the host.
- Chat → task result and the task detail page show the concise summary and collapsed **Execution details**. Original worker report text is preserved.
- `plan_status` shows compact evidence for linked tasks. Explicit single-portion inspection expands the selected contract and its latest attempt's receipts; it cannot choose an arbitrary job from another chat.
- Legacy tasks/runtimes without evidence keep the existing view.

No new panel, settings switch, provider route, automatic commit or knowledge store is introduced.

## Validation and remaining acceptance

TypeScript type-check and diff checks passed. Native `swift build --build-system native -c release --product AtomIsland` passed initially in 68.22 seconds and again in 46.44 seconds after the final task-selection guard, with existing warnings in IslandSettings.swift/main.swift and the build-system deprecation notice. No unit/Swift test suites, model calls, app installation/restart, live acceptance, commit or push were performed for this slice.

At the agreed end-of-adaptation verification stage, use isolated fictional data to exercise:

1. Store reopening, interrupted attempts, separate rerun/retry identities and task deletion cleanup.
2. Receipt isolation across jobs/attempts, duplicate IDs, bounded history and late completion after Stop.
3. Actual Codex inspection with a clean commit, dirty files, changed HEAD, missing Git and metadata timeout.
4. Nonzero and unconfirmed exits, withheld output and no unsandboxed fallback.
5. Both UI locations, keyboard/disclosure behavior and thread refresh while work finishes.
6. Legacy plans, Claude workers, provider failures and preservation of history/drafts/grants.

Independent criterion evaluation, host-recorded build/test checks, disposable-copy evidence, automatic stale-check invalidation, older-attempt browsing and complete working-tree content fingerprints remain separate later capabilities. This implementation must not be described as a full verification engine.
