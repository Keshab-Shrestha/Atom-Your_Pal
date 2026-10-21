# Chat access modes (ADR-180)

Delivered 2026-10-21 as step 3 of the requested T3 interactions. The lock menu beside model/thinking changes the current writable chat's agent access. It does not send a message or alter its draft.

| Mode | Effective behavior |
| --- | --- |
| Saved permissions | Existing checked tools, worker kits, project policy and remembered exact-file grants. Default for old and new chats. |
| Chat only | Conversation replay and saved brief only. No host tools, delegation, new project/attachment/skill reads, automatic screen/memory/opening context or direct app/media shortcuts. Saved grants are suspended. |
| Ask before changes | Read-only tools retain their checks. Every change-capable or unknown call requires a fresh Allow, including delegated workers and files covered by continuing grants. Native/file/MCP/browser/plan policies still apply afterward. |

Claude and Codex enforce these modes at the host tool gates. Gemini CLI's plan mode is insufficient to guarantee these restrictions; it refuses restricted requests before launching, with an actionable provider/mode choice. Its menu explains compatibility. No Full access mode is included; that is the separately requested next capability.

## Continuity and admission

`chat_access` is an additive table in the existing memory database. No row means `checked`; invalid modes refuse. Choices persist before the first reply and across restart/provider changes, copy independently on explicit fork, and are cleaned up on deletion. A switch never rewrites transcripts, briefs, drafts or file grants. Access follows the source chat for task/retry cores and all input sources, so changing providers or speaking cannot bypass it.

Only the current idle writable local chat can change access. The command binds the exact chat and expected previous mode, rejects extra fields, and refuses shared/archived chats, active turns and active/queued source-chat jobs. The host rechecks current mode on every tool call. Claude reopens/resumes with the new access setting in its session identity; Codex changes its host runner/tool catalog. Old runners cannot retain authority after a mode change.

Chat only still permits the user's exact deterministic Show/Forget file permissions commands. Normal product controls (manually opening a workspace, attaching a file, changing settings) and internal transcript/recovery bookkeeping are separate from agent tool authority. An attachment is not expanded into Chat only's prompt. Old conversation excerpts already in replay remain conversation context; mode changes cannot retract previously supplied data from a provider.

## Additional approval boundary

A closed host-owned read-only allowlist covers native file/web lookup, instruction loading, own-chat archive queries, time/weather/calendar/reminder/timer inspection, recall, foreground inspection and clarification. Unknown tool names and external MCP/browser calls require approval. Starting a worker also asks; its later change-capable calls ask independently. A plan approval retains its existing card.

The extra approval happens before any existing permission/checkpoint/task admission side effect. Decline does not mint a remembered file grant. A continuing grant can satisfy the original file policy, but cannot satisfy this extra approval. Some operations therefore show an existing policy-specific card as well.

Approvals bind the tool, argument hash, call and worker identity. Claude's hook/canUseTool pair shares one decision for the same captured call; altered arguments refuse. Codex uses host-unique ids across processes while preserving matching Board lifecycle ids. Main-call decisions reset each turn; worker decisions remain scoped to their session. The bounded approval ledger fails closed when full. Cancellation, stale access and unavailable/failed approval all refuse, including late Allow responses. Nothing is logged with argument bodies.

Cards show complete bounded arguments for ordinary calls. Write/Edit and worker admission show the exact target/worker plus an explicitly labelled content/task preview, authorizing one captured operation rather than claiming full diff review. Paths/commands or unknown argument sets too large for the review card refuse rather than silently clipping. Protected-file rules, required undo and full preview-edit review remain independent checks.

## Verification

- Persistence tests cover old default, pre-first-reply restart, chat isolation, explicit fork independence, deletion and unchanged history/brief/exact-file grants.
- Gate tests cover no-tool refusals, closed read allowlist, fresh approvals, hook/canUseTool identity, altered payloads, oversized review refusal, cancellation and stale-mode refusal; allowing never overrides the native tool allowlist.
- Controlled Claude/Codex core tests retain conversation/brief while proving external context/attachment/skill/shortcut loaders are never called in Chat only.
- Controlled Codex worker integration edits a temporary fictional file: a remembered grant cannot bypass a declined fresh approval; the next task asks again and can complete; stale runners refuse; returning to Saved permissions preserves the original grant. Board completion and Stop tests remain green.
- Wire tests refuse stale/shared/archived/busy chats, tasks, extra fields and Full access. Swift decodes exact modes and captures expected previous mode; older runtime events hide the selector.

Full TypeScript suite: 1,131 pass / eight normal opt-in skips (`/tmp/atom-access-full-tests-final.log`); 40 final core/CLI checks pass, including a further reused-session cancellation regression (`/tmp/atom-access-final-cancel.log`). Typecheck and 757 Swift tests / 140 suites pass. Signed build, strict signature verification and all 89 gallery scenes / 21 visual comparisons pass. No new visual references were needed; the existing snapshot fixtures do not exercise the live access menu.

Live 21 October: selected Chat only, then Ask before changes on the fictional notebook chat; typed exactly `Cedar access check — unsent.`; switched to the original movie chat (still Saved permissions), then back. The exact draft, selected mode, original table and follow-up transcript remained. Cleared only that test draft, inspected Chat only's host/computer/web-off summary, restored Saved permissions and the original movie chat (Haiku 5.5 / Off / empty composer / Ready). No prompt was sent and no new provider completion, grant or task was created. Native menu selection used the accessible item followed by Return while the composer was empty. Persistence across restart/fork and actual refusals/edits are controlled automated checks, not a live paid-provider claim.

The live check exposed one sentence that attributed disabled host tools to the provider instead of the mode; corrected it to “ATOM host tools are unavailable in this mode.” Final packaging status is recorded in TASK.md and STATUS.md.


Final wording-only signed build passes (`/tmp/atom-access-build-final.log`) and strict signature verification succeeds. Final ATOM and its runtime were restarted; the main window starts hidden, as in the earlier build. Live functional checks above preceded only the one-sentence summary correction. No further prompt, action or permissions change was made.
