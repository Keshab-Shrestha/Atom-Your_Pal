# Codex disposable project shell previews

Implemented in source on 2026-10-18, ADR-165. Project folders workers can simulate commands on explicitly selected input copies. General shell writes to the real project and shell undo remain open. Tests and live execution remain skipped by request.

## Admission and inputs

`atom_ProjectShellPreview` uses the same active-project, folders-kit, worker/task and current source-chat binding checks as ProjectCommand. Plain/attachment-only chats, other kits, the main model and advisory children do not receive it. Two attempts per task are reserved before awaited preparation; inspection and preview share one busy slot.

The caller supplies only command and input_files. Commands are nonempty, at most 2,000 characters, with ASCII control/secret-shape checks. Zero to sixteen explicit relative files are accepted; ASCII path components exclude hidden paths and parent traversal. The complete JSON-quoted command and deduplicated file list, with the explanation, must fit the existing 600-character approval reason. Oversized reviews refuse instead of clipping away part of the request. Existing card presentation normalizes whitespace.

Each source passes native Read policy. Canonical containment, no-follow descriptor opening, regular-file/single-link checks and repeated entry/descriptor identity and metadata checks narrow replacement races. Reads stop at 256 KiB per file and 2 MiB total. Only strict UTF-8 without NUL or detected secret shapes is copied. These are per-file snapshots, not an atomic project snapshot or complete secret detector. Source files can change afterward.

Private temporary directories outside the task project hold independent baseline and working copies, preserving only executable/non-executable mode. No links, dependency-tree copying, hidden configuration, package installation or project credentials are supplied. Each copied input has a returned SHA-256 manifest entry. Existing native Bash classification and plan-first policy apply, followed by a fresh explicit disposable-preview card. Combined approval waiting is bounded at 120 seconds; existing cards may expire sooner. Current access is checked again before execution and during work.

## Execution and results

The shared command executor uses a separate named Codex sandbox profile: default-deny filesystem, minimal platform runtime reads, read-only baseline, writable working copy/runtime scratch, explicit real-task-root denial, hidden work-path denial and networking off. Fresh HOME/CODEX_HOME/TMPDIR and a fixed small environment omit user credentials/configuration. Managed requirements apply; unsupported/rejected sandbox setup refuses without an unsandboxed fallback. This follows the documented [named permission-profile model](https://learn.chatgpt.com/docs/permissions); documentation is not live acceptance of this adapter.

Host-generated Bash source passes the model's command as a positional argument to an inner shell inside the sandbox. A fixed wrapper collects its exit status and runs system diff against the baseline, also inside the sandbox. The unsandboxed host never reads generated file contents to construct the diff. The supplied command can execute copied scripts and system tools, but this selected-input environment usually lacks a real project's dependencies and configuration. It cannot establish that the real project built or its tests passed.

Combined stdout/stderr is limited to 32 KiB, execution to 30 wall seconds, and inherited per-process CPU to 20 seconds. Preview files also receive an inherited file-size ulimit of 16,384 blocks. Separate metadata-only monitors check the work and runtime scratch trees roughly every 200 ms: each is limited to 128 entries, depth six and 8 MiB, refusing links/special entries; work also refuses hidden entries. These checks can overshoot between scans and are not hard disk, aggregate CPU, memory, process-count or fork quotas. No generic descendant ledger or background-session API exists.

Stop, observed revocation, limits and process exit kill the owned process group. A one-second pipe-drain fallback withholds output when process/output cleanup cannot be confirmed. Descendants that escape the group are not proven dead. Both temporary-tree removals have three-second waits; failure/timeout returns an error and withholds output, while removal may continue and temporary files may remain. These lifecycle protections also tighten the shared read-only inspection executor. Sandbox/process behavior has not been exercised live.

Returned text labels command output and diff as untrusted simulation data. Secret-shaped output is withheld and other output redacted/clipped; the input manifest and explanation are additional envelope text. There is no trusted final-tree assertion: command output can forge headings, files may race, and the diff is not an approval, patch application or durable effect journal. Board observations retain generic names/timing/outcomes, omitting the command, selected files and output.

Nothing is copied back or automatically applied. Real changes still require user-authorized ordinary Read/Write/Edit policy and the existing file-checkpoint/worktree behavior. Existing checkpoints are best effort and do not cover arbitrary shell effects. A future review/apply capability needs fresh source-hash conflict checks and a separately defined rollback boundary; this batch does not implement it.

## Verification and remaining work

TypeScript checking and static source/security/diff review pass. No tests added/run, command-adapter execution, sandbox/CLI execution, provider/model calls, runtime migration, app launch or live acceptance. No Swift changes/build in ADR-165; ADR-164's release compilation passed separately. Installed app unchanged; ADR-160–165 remain local/uncommitted/unpushed on main after 2fe2250. Unrelated graphify-out remains untouched and known CI failures remain deferred.

Next independent scope: explicit preview review/apply design with current-source conflict detection and a fail-closed undo policy. General real-project shell writes, built-in hosted search, tool-enabled/recursive children and omitted browser operations remain separate gaps.


Subsequent update (ADR-166): a successful preview can issue a task-local source-hash receipt for a separately proposed short existing-input replacement. A complete fresh before/after card and verified required checkpoint govern that edit. The receipt never attests generated shell output; nothing is imported or automatically applied. Larger reviews, new/deleted files, multi-file apply and general shell writes remain open. [Reviewed-edit scope and verification limits](codex-preview-edits.md).
