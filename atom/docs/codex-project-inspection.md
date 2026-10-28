# Codex project command inspection

Implemented 2026-10-18, ADR-161. This is a read-only inspection step toward command parity, not general shell access. Keshab continued after the model-pin batch, with tests and CI repairs still skipped.

## Available behavior

Codex folders workers in an active project can request `atom_ProjectCommand` with a command name and a plain string arguments array. Supported utilities are pwd, ls, cat, wc, head, tail and grep. The host selects the absolute system executable, allowed flags and canonical file operands; it never interprets model arguments as shell syntax. Glob patterns, substitutions, pipes and redirects are not expanded.

Inspection is absent from attachment-only/plain chats, research/think workers and the main model. Host-only project admission and a current runtime check must identify the same non-archived, existing source project/folder. Worker availability/kit/task state is checked again before launch and before returning output. A task in a Git project uses its existing task worktree. Changing the source project or stopping/deleting the chat withholds output/prevents later execution; it does not grant a new folder.

There are six attempts per task, reserved before awaited validation, with one running inspection at a time. Busy parallel calls refuse. Each call accepts at most 20 nonempty control-free arguments, 8,000 total argument characters and eight project operands. Operands must resolve inside the task folder and be regular files, or directories for ls; files are at most 1 MiB. Head/tail accept -n from 1 to 500. Grep takes one pattern of at most 300 characters and file operands. Recursive/follow/watch/script/file-list options, stdin and arbitrary executables are unavailable. Grep's ordinary no-match exit is reported without claiming a command failure.

The existing native Bash classifier and plan gate approve the proposed invocation before it runs. Plan-first workers need approval for inspection too. Each operand then passes Read or Glob policy, including the existing file floor and secret checks. Directory listing does not accept hidden-entry flags. Secret-shaped arguments are refused; matching output is withheld and other output receives existing redaction. This is pattern-based filtering, not proof that all sensitive data is detectable. File validation and kernel restrictions do not pin file contents against concurrent replacement.

## Executor boundary

Use the configured Codex program's standalone sandbox command, with no model/login request. On first use, inspect its help with a three-second bound and require explicit permission-profile, managed-config and working-directory controls; unsupported or rejected execution fails without a direct/unsandboxed fallback.

The host creates a private scratch folder outside the project, supplies fresh HOME/CODEX_HOME/TMPDIR values and a small fixed environment, and marks the scratch configuration untrusted. User shell startup files, user Codex config/login, proxy variables and environment credentials are not inherited. Managed requirements still apply through the CLI's explicit managed-config flag. No global configuration file is changed.

The command profile denies filesystem access by default, allows minimal platform reads and the canonical task folder as read-only, denies hidden project matches, and permits writes only to the disposable scratch folder. Command networking is disabled and no arbitrary Unix-socket grant is added. Unsupported exact-root paths refuse. A fixed Bash wrapper applies a 20-second CPU limit, changes to the host-owned directory and execs the validated argv; model content never enters that wrapper's source. No native model shell/web/browser capability is enabled.

The inspection process gets a separate process group. Stop, a 30-second execution timer or more than 32 KiB combined stdout/stderr kills that group; the host cleans remaining same-group descendants and the scratch folder on completion. Limits describe the command itself; scratch setup and the help preflight are separate. Cancellation/OS sandbox/process-group behavior has not been live-verified. No background-session or generic descendant-reconciliation API is introduced.

Board observations keep the ProjectCommand name, timing and fixed outcome text, not argv/output. There is no new schema or durable command journal. Existing file tools still perform approved edits; the inspection tool neither creates project checkpoints nor claims builds/tests ran.

## Verification and remaining work

TypeScript checking and static source/security/diff review pass. No tests added/run, adapter execution, provider calls, migration, gallery/app launch or live sandbox/cancellation/path/secret acceptance. CLI help/schema and official documentation were inspected only. No Swift source changed in ADR-161; the preceding ADR-160 Swift release compilation passed. Installed app unchanged; ADR-160/161 remain local/uncommitted on main after 2fe2250.

Existing CI for 2fe2250 remains failed and unrepaired at the user's direction. General shell/scripts/builds/tests, web search, browser, external MCP and nested workers remain open. Model pins, assigned instructions and known-URL public pages retain their documented scope. Next independent capability: external MCP adapter discovery/invocation under the existing per-worker grants; general shell requires a separate write/undo/lifetime design.

Implementation reference: [official named permission profiles](https://learn.chatgpt.com/docs/permissions). Documentation and advertised CLI controls do not establish that this implementation has passed live acceptance.


Subsequent update (ADR-162): checked external MCP discovery/calls are implemented for tested, enabled server assignments on non-think Codex workers. [Current MCP behavior and verification limits](codex-external-mcp.md). Earlier remaining-work statements describe their original batch; the next independent adapter is browser access.


Subsequent update (ADR-165): project folders workers also receive a separate disposable selected-input shell preview. Inspection remains read-only. Its shared executor now polls current admission during execution, bounds inherited-pipe drain after group termination and bounds scratch removal, withholding output on cleanup uncertainty. No complete descendant-death proof is claimed. [Preview behavior and verification limits](codex-shell-previews.md).
