# Cloud task: ADR-110 Phase N5

This file is the brief for a cloud Claude session. Read `CLAUDE.md`, then ADR-110 in `DECISIONS.md` (with all its "Update" lists).

## Goal

Make the native engine the default. Then delete the legacy engine code.

## Rules for this session

- Do not run tests. The cloud session has no Claude Code, no macOS and no `data/`.
- Do not run `pnpm test` or `pnpm island:test`. Keshab runs them on the Mac after the pull.
- Run `pnpm install` and `pnpm typecheck` only. Fix every type error you cause.
- Do not touch `.env`, `data/`, `config/` or `graphify-out/`.
- Work on a new branch `n5-native-default`. Do not push to `main`. Open a pull request.
- Write Markdown in ASD-STE100 English: short sentences, active voice, present tense.
- One capability at a time. Commit in small steps with `refactor:`, `feat:` or `docs:` prefixes.

## Background

Phases N1 to N4 are done and on `main`.

- N1: engine core. One long-lived Claude Code session for each chat. Files: `claude-session.ts`, `native-core.ts`, `native-safety.ts`.
- N2: native sub-agents, the Board recorder, `create_agent` on the approval card.
- N3: voice, Telegram, API, routines and webhook on the native engine.
- N4: budgets, the plan limit and "Runs at once" are removed in both engines.

The switch is `ATOM_ENGINE=native|legacy`. The default is `legacy`. The `nativeEngine` value in `apps/mac/src/runtime.ts` is the one place that reads it.

## Steps

1. Make `native` the default. Remove the `ATOM_ENGINE` switch, `nativeEngine`, its entry in `ENV_NAMES` (`packages/shared/src/env.ts`) and its lines in `.env.example`.
2. Delete the legacy code, after you move what native still uses:
   - `services/llm-gateway/src/providers/claude-plan.ts`. Move first: `scrubbedEnv`, `planGuard`, `classify`, `tokensOf`, `sourcesFilter`, `sdkToolsFor`, `promptFrom`, `listPlanModels`, `redact`. Put them in a new small file.
   - `sub-agents.ts` and `codex-job.ts` in the same folder.
   - In `claude-plan-job.ts`: delete the research, files, plan and manager modes. Keep the no-tool modes for Tinker, skills, tests and the chat digest.
   - In `services/helpers`: `runner.ts`, `delegate.ts` (move `createScheduleTool` first), `goals.ts`, `managers.ts`, `team.ts`, `sub-agents.ts`.
   - In `apps/mac/src`: `run-job.ts`, `manager-run.ts`, `goal-post.ts`, `task-steering.ts`.
   - `createCore` in `services/core` (keep the `Core` types).
   - Swift: `ManagerViews.swift`, and the team-task and wake-up parts of `ScheduledView`.
3. Remove the legacy branches that N3 left:
   - `api-server.ts`: the `onChange` goal capture and `team().goal`.
   - `runRoutines()` without `start`, and `runWakeUps`.
   - The Telegram bot's `sendGoal` and `sendRoutineResult`.
   - The webhook's legacy `startRoutine`.
   - `teamContext` (the legacy `standing` uses it).
4. Delete the Codex fallback code. N4 left it unused: the `codexFallback` storage and command, the `codexJobs` set, `runCodexJob` and `codexReady`. Update `SECURITY.md`.
5. Search at the end. These names must not appear in code: `runResearch`, `createCore`, `watchGoals`, `startJobRunner`, `ATOM_ENGINE`, `nativeEngine`, `runCodexJob`.

## Keep

- Native safety: `native-safety.ts` hooks, `client_composed`, `permissionMode: "default"`.
- Plan meters, Dashboard tokens, the `usage` table, Tinker, test cases, the skills hub and routines.
- Old database rows. Never drop a table or delete a row.

## Do not change

- Legacy data in `data/`. Code only stops reading it.
- The island protocol for fields that the Swift app still reads. If you remove a field, make the Swift decoder accept its absence.

## Finish

1. Update `DECISIONS.md` (one "Update" line in ADR-110 for N5), `TASK.md` (Phase N5 entry), `STATUS.md` (one line) and `SECURITY.md`.
2. Run `pnpm typecheck`. It must be clean.
3. Open a pull request. In the body, list what you deleted and what you moved.
4. Say in the pull request that no test ran. Keshab runs `pnpm test` and `pnpm island:test` on the Mac, then tries these by hand: plain chat, project chat, voice, Telegram, Sid, a new agent, a routine.

## Open decision

Keshab has not yet chosen what to do with the Codex fallback. This brief assumes delete. If a cloud session finds a reason to keep it, stop and ask.
