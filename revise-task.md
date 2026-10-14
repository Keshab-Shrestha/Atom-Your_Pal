# Revise task: after the quality pass

This file is the brief for you (Keshab) or a later Claude session. It lists what the quality pass did, what it could not check, and what to do next on the Mac. Read `CLAUDE.md` first. Write Markdown in ASD-STE100 English.

## What the quality pass tried to do

Raise every area of the code rating toward 10 out of 10 without a Mac:

- Maintainability: delete dead legacy code, split the biggest files.
- Tests: more tests for the new code, tests that run on Linux too, Swift tests for the new Core types.
- Risk: a live probe that checks Claude Code's behaviour on your Mac, so an SDK change shows up at once.
- UI: fix buttons that are missing or in the wrong place.

The progress log is at the end of this file.

## What no cloud session can check

1. The Swift code. Nothing written since ADR-110 N5 was compiled: work plans (`WorkPlans.swift`, `PlanViews.swift`), the second brain (`Brain.swift`, `BrainView.swift`), and the UI fixes (Stop, Copy, Try again, New chat, Delete chat, the plus on the project row).
2. The Swift tests that were added (`Tests/AtomIslandCoreTests`).
3. The real behaviour of Claude Code: does the safety gate's rewrite of an Agent call's prompt reach the sub-agent?
4. How the app looks and feels.

## What to do on the Mac, in this order

1. `git pull` the branch `claude/blissful-babbage-87itdf`.
2. `pnpm install`, `pnpm typecheck`, `pnpm test`. One test (`grants.test`) is macOS only and must pass there.
3. `pnpm island:build` and fix every compiler error. Most will be small.
4. `pnpm island:test`. Fix failures. Do not delete a failing test before you know why it fails.
5. `ATOM_LIVE_TESTS=1 pnpm test:live`. The new `native-plan.live.test.ts` checks the one thing the cloud could not: that a planned portion's prompt is the one the sub-agent receives.
6. Try by hand: plain chat, project chat, voice, Telegram, a three-portion plan ("compare three mesh Wi-Fi kits and give advice"), a routine, the second brain (write a note with `[[a link]]`, open the graph), delete a chat, New chat in a project.
7. Write what you found at the end of this file, then give it back to Claude.

## Added after the quality pass (ADR-113)

Check these by hand on the Mac too:

- A chat moves from Claude to Codex (or the Gemini CLI) and back, and keeps its context.
- The paperclip and a drop on the composer attach a PDF, an image and a text file. Claude reads them. A secret file (`.env`) is refused.
- The Skills menu and `/skill-name` use a skill for one message.
- The model menu is in the composer, not in the top bar.
- Swift to compile first: `ConversationView.swift` (the new composer), `ComposerDraft.swift`, `ComposerDraftTests.swift`.

## Open decisions

- A second chat app (Slack or Discord) for the gateway. Needs a token, an allowlist and a security review first.
- Whether Codex and the Gemini CLI stay in the model list. They cannot run chats now.

## Progress log

(The quality pass adds a line here for each step.)

- Q1 done: dead goal, hand-off, plan-first and steer store methods removed with their tests; unused imports and prepared statements removed; one real N5 bug found and fixed (a native agent's checkpoints were never finished). Left on purpose: `handOffs`, `context`, `setPlanFirst`, `rejectPlan` and the manager parser in `agents.ts` (old soul files still load). Look at them again on the Mac.
- Q2 done: `grants.test` skips the `/System` check off macOS. The whole suite passes on Linux (796 tests).
- Q3 done: new tests for the gate with plans (`native-safety-plan.test.ts`), the Tinker runner, `taskStarter`, `nativeSteering`, the audit log and the reach tools. Swift tests added but never compiled: `BrainTests.swift`, `WorkPlansTests.swift`.
- Q4 done: `native-plan.live.test.ts` (run on the Mac: it checks the real SDK) and `sdk` in the `session.open` log line. Never run, because the cloud has no signed-in `claude`.
- Q5 partly done: the island session's interface types moved to `island-types.ts` (island.ts 1105 to 816 lines), and the plan view moved from `store.ts` to a pure, tested function (`viewOfPlan` in `plans.ts`). Not done on purpose: `createRuntime` and the big Swift views share many private members, and a split cannot be compiled here. Do it on the Mac, with `pnpm island:build` open.
- Q6 done: the top bar no longer shows a second Back on the soul, task and new-agent pages. Idea left out (a new protocol command): a Stop plan button on the plan card; today you stop each running portion on the Board.
- Q7 done: TASK.md and STATUS.md updated.
