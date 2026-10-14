# ATOM v2 plan: a notch harness with swarm, company and learning-loop abilities

Status: proposal (2026-10-14). Nothing here is built. Read `CLAUDE.md` first: one capability at a time.

## Goal

ATOM lives in the notch and works like three projects at once:

- **jcode** (Rust coding-agent harness): many agents on one daemon, agents that tell each other about file changes, cheap sessions, cache-miss warnings.
- **Paperclip** (control plane for a company of agents): org chart, goals, tasks with locks, heartbeats, budgets, approvals, audit log.
- **Hermes Agent** (Nous Research): a learning loop, agent-made skills, session search, one gateway for many chat apps, cron in plain words, sandboxed terminal backends.

This table comes from each project's README only. Check the details before you build.

## Where ATOM stands after N5

| Ability | ATOM now |
| --- | --- |
| One long-lived Claude Code session per chat, byte-stable prefix, 1 h cache | Built (ADR-110 N1) |
| Sub-agents with a Board, kits, grants, plan-first, worktrees | Built (N2) |
| Voice, Telegram, local API, routines, webhooks on the native engine | Built (N3) |
| Skills hub, Tinker reviews, skill drafts and edits, test cases | Built (ADR-094, 098, 102) |
| Memory, kept chats, conversation notes, projects, browser, MCP, Paperclip link | Built |
| Notch UI, Pal, Board, Dashboard | Built (Swift) |

N5 removed: budgets (N4), Managers, team tasks, wake-ups, the Codex fallback.

## Gaps, as single capabilities

Each row is one task with its own test. Order: top to bottom inside a column.

### From Hermes (learning loop and reach)

1. **Session search for the main agent.** A tool that searches past chats (FTS) and returns short hits. ATOM has `chats.search`; expose it as an `atom` tool. Smallest first step.
2. **Skill creation after a hard task, by the agent.** Tinker drafts skills after a good rating today. Add: the main agent proposes a skill at the end of a long task. Keshab still approves.
3. **User model.** A short, editable profile that memory builds from many chats. Memory facts exist; the profile is new. Needs a privacy decision first.
4. **More gateways.** One gateway interface; Telegram becomes the first adapter; then one more (Slack or Discord). Only after (1) to (3).
5. **Sandboxed terminal backends.** Today Bash runs in the macOS sandbox in project chats. Docker or SSH is a later, separate decision (SECURITY.md first).

### From Paperclip (company control plane)

6. **Goals above tasks.** A goal row that groups Board rows and carries context to each agent. The old goal tables exist in the store; the native engine does not use them.
7. **Task checkout and locks.** Two agents never claim one task. Needed once agents run in parallel on one repo.
8. **Approvals queue.** Needs-you already holds plans, proposals and asks. Add hire and spend approvals only if budgets come back.
9. **Audit log.** One append-only table of mutating actions (who, what, when, ids only). Fits `CLAUDE.md` section 16.
10. **Org chart and Managers.** Paperclip's core idea. Keshab removed Managers in N5 and budgets in N4. **Decision needed:** bring a lighter org chart back on native sub-agents, or stay flat.
11. **Budgets and hard stops.** Keshab removed them in N4. **Decision needed.**

### From jcode (swarm and harness speed)

12. **Shared state between running agents.** When agent A edits a file agent B read, B gets a note. Needs file-change events from the hooks in `native-safety.ts`.
13. **Peer messages.** Agents send a note to one peer or to all agents of a repo. The main agent routes them; no new daemon.
14. **Cache-miss warning.** `session.open` already logs the prefix hash. Show a warning in the notch when the cache goes cold or the hash changes.
15. **Grep with structure and context-aware truncation.** An `atom` tool for project chats. Measure token savings first.
16. **Cross-harness session resume.** Import a Claude Code or Codex session into a chat. Low priority.
17. **Self-development mode.** ATOM edits its own repo in a worktree, runs `pnpm typecheck`, and asks Keshab to restart. High risk. SECURITY.md first.

### The notch

18. **Swarm strip in the notch.** The collapsed notch shows N agents working, one dot each; expand for the Board. The `WorkStrip` view exists; connect it to Board rows.
19. **Interrupt and redirect from the notch.** N5 refuses "interrupt a step". A native `interrupt` of the main agent plus a redirect message closes that gap.
20. **Provider honesty.** Settings still lists Codex and Gemini CLI. N5 refuses chat on them. Remove them from the picker or give them a real role.

## Known regressions from N5 to decide first

- The task field on a worker's page (`job.add`) and the "Retry" button make legacy tasks. No runner starts them. Either route them through the main agent ("Sid, <task>") or remove them.
- The project chat note still says "use delegate"; the native engine has no `delegate` tool. Change the note to name the Agent tool.
- Telegram `/interrupt` and the island `job.interrupt` answer with an error.

## A total rewrite?

You allowed one. This plan does not need one: the native engine already has the harness architecture the three projects share (long-lived sessions, sub-agents, hooks as the policy layer, skills, memory, gateways). A rewrite would throw away the safety gate, the Board, the Swift UI and about 1,500 tests (969 node, 550 Swift at N4), and it cannot be checked in the cloud session (no macOS, no Swift compiler, no `data/`). The staged plan above keeps every step small and checkable.

If you still want a rewrite, the first step is to choose the language of the core (stay on Node, or move the daemon to Rust like jcode) and run the old and new cores side by side. That is a separate decision.

## Suggested order

1. Keshab runs `pnpm test` and `pnpm island:test` on the Mac and fixes what N5 broke.
2. Fix the three regressions above (tasks 0a to 0c).
3. Tasks 1, 14, 18, 19 (small, visible in the notch).
4. Decide items 10 and 11.
5. Tasks 6, 7, 9, 12, 13 (the swarm and company core).
6. Tasks 2, 3, 4 (the learning loop and reach).
