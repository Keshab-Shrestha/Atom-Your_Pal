# Task Stop, approvals and completion status

2026-10-18, ADR-140. Follow-up to the real recovery checks in [task recovery](task-recovery.md).

## Behavior and authority

Stopping a host-linked task cancels its approval requests immediately, including before the Claude SDK supplies a task id. Only that task is cancelled; another task's approval stays valid. The approval bridge closes the cancelled id, and later answers for it do nothing. A late answer from an adapter that ignores cancellation cannot create a continuing grant or authorize the stopped call.

The native policy gate owns per-task abort signals and checks the stored task state before tool decisions and again when returning a cached decision. Signals reach file, command, plan, MCP and browser approval adapters. Codex combines its request cancellation with the host task signal. The file policy rechecks cancellation after awaiting approval and before saving a grant or checkpoint, covering Stop between the answer and policy continuation. Worker end/session cleanup also aborts pending host approvals. The runtime no longer waits for an SDK task id before routing Stop.

This stops further checked authorizations. It cannot roll back an operation already accepted or executed before Stop. Existing file copies/Undo and the unknown-outcome recovery path remain the way to inspect earlier changes. Existing continuing grants remain grants; Stop does not revoke previously valid chat permissions.

## Window status

Window-created task and retry turns use a separate Core. Their queued/running turn activity is now tracked until the queue drains, including failures and removed retries. The island combines that activity with its worker rows and foreground voice/text loop instead of leaving the header in Thinking after an approval.

A background completion emits the existing idle state only when the foreground loop is idle, no task turn or worker is active, and no approval remains. Listening, transcription, a foreground answer and speech retain their own state. If a live approval remains when foreground work or another card ends, the window re-presents its existing id and text; this creates no new approval or permission. The same request id also retains its notification identity. No new wire event or Swift state is introduced. Notices and errors retain the client's existing idle-handling rules.

## Checks

- Actual memory/helpers stores, real files and the approval bridge: Stop closes one card while another remains, the stopped file stays unchanged, the other approval works, and late Allow for chat creates no grant.
- A cancellation-ignoring adapter, an answer/Stop continuation race and a previously allowed cached decision cannot permit work after Stop.
- Native Core with a scripted SDK: a pending plan card cancels before any `task_started` id arrives, and a late answer is refused.
- Task queue tests cover failure and a removed retry. Island protocol tests cover queue completion, remaining workers/cards, foreground listening/model/speech, restoration of the same pending request and listener cleanup at quit.
- Typecheck passes; the full TypeScript suite passes with two workers: 1,063 passed and eight opt-in model tests skipped. No new schema, dependency, Swift view or wire shape is introduced. The earlier signed native build, 733 Swift tests and 75-image/12-golden baseline remain applicable; those unchanged native checks were not repeated for this backend-only follow-up. No lint/coverage gate is configured; coverage was not measured.

## Real app acceptance

The app was idle before restarting its backend normally to load the changes. A fictional file in `~/Documents/ATOM-Task-Stop-b2rwt9kh/cedar.txt` was the only file used.

1. Native Claude worker #28 (`claude-sonnet-5-5`) reached a file approval. Pressing its task's Stop immediately removed the approval, marked the task Stopped and showed Ready with zero pending/failed/running work. Direct file verification found its original content unchanged, and no continuing file grant existed. The later “From the team” notice was the stopped worker's report, not continuing work.
2. The source chat was explicitly changed to Codex without changing the global default. Retry created one linked attempt #29 on signed-in Codex (`gpt-6-astra`). The header showed Thinking, then Needs your OK for the fresh file request. Allow for task saved the expected fictional content. The task/report completed and the header returned to Ready with zero pending/failed/running work **without another restart**. Neither attempt created a continuing grant.

This verifies the native Stop and Codex retry-completion fixtures. The cancellation race and concurrent foreground/card scenarios are automated checks, not claims of every possible live SDK/OS timing. Fictional records/files remain for inspection. Codex's missing per-tool timeline remains a separate limitation; this change does not add it or implement durable chat drafts/turn delivery.

Final reload: after the last pending-card coordination change, the idle app was quit/relaunched normally and opened Ready with zero pending, failed-attention or running work. No model task was replayed. The concurrent card/foreground restoration path is covered by the final automated suite.
