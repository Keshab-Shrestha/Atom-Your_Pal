# ZENO Project Status

## Cross-platform window — step 2h-2, 24 October 2026

Find in chat works in the new window. Still to do in chat parity: chat brief and saved history (2h-3); in-chat questions and work results (2i); file-edit review (2j). Swift remains the shipping client.

## Cross-platform window — step 2h-1, 24 October 2026

The `/` picker works in the new window. Still to do in chat parity: find in chat and chat brief (2h-2, 2h-3); in-chat questions and work results (2i); file-edit review (2j). Swift remains the shipping client.

## Cross-platform window — step 2g-2, 24 October 2026

Interrupted, stopped and failed requests can be reviewed, restored to an empty composer or dismissed in the new window; nothing is resent automatically. Still to do in chat parity: slash picker, find, chat brief (2h); in-chat questions and work results (2i); file-edit review (2j). Swift remains the shipping client.

## Cross-platform window — step 2g-1, 24 October 2026

Per-chat drafts, the message queue and held messages work in the new window, with drafts saved across restarts. Still to do in chat parity: recovery of interrupted requests (2g-2); slash picker, find, chat brief; in-chat questions; file-edit review. Swift remains the shipping client.

## Cross-platform window — step 2f, 24 October 2026

Attachments and paste work in the new window. Still to do in chat parity: queue, per-chat drafts and recovery; slash picker, find, chat brief; in-chat questions; file-edit review. Swift remains the shipping client.

## Cross-platform window — step 2e, 24 October 2026

Model, thinking and access can be chosen per chat in the new window. Still to do in chat parity: attachments and paste, queue/drafts/recovery, slash picker, find, chat brief, in-chat questions and file-edit review. Swift remains the shipping client.

## Cross-platform window — step 2d-2, 24 October 2026

Fork, edit and retry work in the new window. Still to do in chat parity: model/thinking/access menus, attachments and paste, queue/drafts/recovery, slash picker, find, chat brief, in-chat questions and file-edit review. Swift remains the shipping client.

## Cross-platform window — step 2d-1, 24 October 2026

Copy (reply formats, message, code, table, last reply) and "Reply to this" work in the new window. Fork/edit/retry, model/access menus, attachments, queue/recovery, slash picker, find and in-chat questions are still to do. Swift remains the shipping client.

## Cross-platform window — step 2c, 24 October 2026

Chats can be renamed, pinned, archived (Undo) and deleted (confirmed) in the new window. Copy/quote/fork, model/access menus, attachments, queue/recovery, slash picker, find and in-chat questions are still to do. Swift remains the shipping client.

## Cross-platform window — step 2b, 24 October 2026

The new window shows ATOM's questions (Allow/Decline) and a working strip with Stop (button and Esc), and survives a reload mid-question. File-edit reviews can be declined but not approved yet. The Swift app remains the shipping client.

## Cross-platform window — step 2a, 24 October 2026

The new window renders Markdown replies and keeps the chat at its end. Everything else in chat parity (Stop, approvals, chat actions, copy, model/access menus, attachments, recovery, slash picker, find, questions) is still to do; the Swift app remains the shipping client. 48 desktop tests, root typecheck and the build pass.

## Cross-platform window — step 1, 24 October 2026

`apps/desktop/` holds a Node bridge and a Preact window (Four-lane design) over the unchanged runtime and protocol. Works: start/supervise/restart/stop the real runtime, stream its events, send commands, list/open/create chats, send typed messages, show state and errors. 30 new tests, root typecheck and a production build pass; the window was checked in Chromium against a fake runtime and against the real runtime's startup. Not working yet: every other screen, voice, shortcuts, tray, overlays, Pal, the native shell, Windows and Linux (untested), macOS-only tools elsewhere. The Swift app is untouched and remains the shipping client. See [docs/cross-platform-migration.md](docs/cross-platform-migration.md).

## Optional Jev/Laya computer decisions — implemented, 24 October 2026

Settings → General now offers Chat model (default), Jev cloud and Laya local, plus optional local backup for Jev and native Keychain-backed key entry. Keshab chose both providers with selection under his control. Added bounded choice among prepared checked button plans; deterministic execution policy, observations, Stop, history and grants remain authoritative. Repaired the existing Laya virtualenv's broken Python link/config using installed Python 3.14.8, with recovery copies and no installation/download. Local warm calls can be fast (54 ms isolated; 509 ms full app context), but both real app examples abstained and sent no input; no overall task-speed gain is certified. Jev credential/network acceptance awaits a locally entered key. Typecheck/172 focused TypeScript checks, native release build, signing and real settings/abstention checks pass; no Swift suite/commit/push. Leave the default selected so Keshab can choose. [Scope, security, repair and evidence](docs/computer-decision-providers.md). Next: real-key Jev validation and representative choice accuracy/speed evaluation before relying on automatic selection. Cursor acceptance stays deferred.

## Checked computer sequences — measured improvement, 24 October 2026

Added a bounded 1–8-button sequence with a fresh whole-window read and exact labelled-value gate after every click, retaining ownership/generation, ordinary policy and cancellation. Real seven-click Calculator completion fell from 56.008 s (repeat baseline; historical 53.232) to 44.894/37.462 s; best repeat 33.1% shorter, with all seven inputs/eight observations retained. Trial A includes a rejected malformed plan before any input. B showed Stop/Queue and a retained draft during step 6/7. A separate real Stop interrupted click 5, prevented clicks 6/7 and retained its draft; the in-flight input may have applied. Typecheck/123 focused TypeScript checks pass; no Swift suite/native rebuild/commit/push. This is a controlled completion-time improvement, not broad-app or first-text certification. Cursor acceptance stays deferred. [Measurements, policy and reproduction](docs/computer-speed-2026-10-24.md). Next: broaden everyday computer-task acceptance and address the remaining driver click wait; do not weaken verification.

## Final daily/developer/computer walkthrough — 24 October 2026

All three functional paths passed in the running app. Daily recall/memory disclosure were clear; task 36 remained uncommitted in its isolated copy with an accurate in-chat diff/report and two independently passing Terminal fixture checks; background Calculator reached independently verified 42 while Stop/Queue and its unsent draft remained available. Computer speed remains the main practical gap: 53.232 seconds for seven clicks, 20.734 seconds in timed driver calls and 32.498 seconds elsewhere; individual clicks still unconfirmed. No app change, builds, general suites or push; original chat/settings restored and fixtures retained. [Evidence](docs/final-workflow-walkthrough-2026-10-24.md). Next: measured computer-loop/reporting improvements; cursor usefulness/visual acceptance stays deferred. This is a functional acceptance result, not release or 8/10 certification.

## Fresh chats and provider-process interruption — 24 October 2026

All six native arithmetic replies across three fresh chats were exact and tool-free. First-text medians were 2.460 seconds first request and 1.431 seconds follow-up; these are warm-app observations with cached input, not cold-launch or causal optimization results. Interrupting only the verified provider CLI child before output left ATOM running, recovered through one bounded retry, preserved the draft, and retained conversational recall. Original chat/settings/exact-file grant restored. No app change, builds, suites or push. [Detailed evidence](docs/provider-recovery-and-latency-2026-10-24.md). Next is a final daily/developer/computer walkthrough, then cursor acceptance last. Remote, partial-output and long-duration limits remain open; no overall 8/10 or release certification is claimed.

## Chat only boundary and retained permissions — 24 October 2026

Actual Claude/Opus Chat only checks passed refusal of requested clock/worker actions, unchanged file, retained grant, draft/mode persistence after reopening, correct chat-fact recall and exact arithmetic output with zero observed calls. After restoring Saved permissions, task 35 edited the same fictional file without another approval or commit; independent file/permission checks matched. Original Settings view restored; no app change, builds, suites or push. [Evidence and scope](docs/provider-recovery-and-latency-2026-10-24.md). Transient failures, longer recovery and fresh-chat latency remain open; cursor stays last. This does not fix or reclassify the earlier model's natural-language no-tools violation in Saved permissions.

## Provider rejection and repeated latency — 24 October 2026

Actual invalid-model rejection preserved failed input, the occupied draft and held queue; explicit retry succeeded on the restored model. Ten fixed warm follow-ups: median first text 2.516 seconds, cache reads nonzero in all ten, 98.43% aggregate reported cache-read share. Nine returned exactly the requested number without observed calls; one loaded a tool description and added an apology despite the instruction, so strict compliance remains open. No app change, suites, build or commit/push. [Evidence, limits and raw samples](docs/provider-recovery-and-latency-2026-10-24.md). Next is explicit Chat only/grant continuity; broader transient failures, longer recovery and fresh-chat speed remain open. Cursor stays last.

## Unexpected runtime recovery and file-permission continuity — 24 October 2026

The running signed rebuild passed actual idle/in-flight runtime interruption checks: automatic recovery in 3.033/2.848 seconds, retained draft/held input, and an Interrupted request available for review without replay or settings blame. A saved exact-file grant survived those exits and authorized the next fictional edit without reapproval (tasks 33/34; independently checked). Fixed a stale Recovery success notice/detail while changing reviewed records; release build, strict signing and live UI check passed. No suites or commit/push. Provider failure, longer recovery cycles and repeated latency acceptance remain open; cursor stays last. [Evidence and boundaries](docs/live-recovery-acceptance-2026-10-24.md).

## Daily chat and interruption recovery — 24 October 2026

Actual app relaunch preserved drafts/chat/model/access. Quitting during generation retained a stopped Recovery request and held its queued follow-up; restoring input did not send it. New replies recalled corrected chat facts while the queued fixture remained undispatched. Runtime readiness was 2.104/1.835 s; first text was 5.783/5.360 s after relaunch and 2.651 s warm (individual observations only). No new code defect found, no suites or build ran. Unexpected crashes, provider failures, saved file-grant continuity and repeated latency acceptance remain open; cursor verification stays last. [Detailed evidence](docs/live-recovery-acceptance-2026-10-24.md).

## Workflow fixes and connected-display acceptance — 23 October 2026

The rebuilt signed app is running. Real native checks passed Stop while acting with an unsent draft; an explicitly uncommitted new coder task and its in-chat report/diff; full-window reopen and draft/model/access retention; plain memory disclosure; image-only Preview reading; and background Calculator actions with independently verified results on both attached displays. Duplicate-runtime startup now reports stage runtime/exit 75 and leaves settings alone (real isolated CLI check). A separate ATOM-owned visual cursor is implemented; physical movement/return confirmation remains open and, at Keshab's request, is deferred to the final acceptance step. He remains skeptical of the feature, so revisit usefulness as well as correctness before accepting it. Driver click uncertainty and primary-only full-desktop capture remain documented limits. Typecheck/relevant TypeScript regressions and native release compilation pass; no Swift suite ran. [Detailed acceptance](docs/workflow-fixes.md). This is not an 8/10 or release-readiness certification.

## Actual daily/developer/computer walkthrough — 23 October 2026

Exercised the running signed app at `fafe567`; no Swift or general TypeScript suites ran. Daily chat corrected and recalled fictional facts across restart, preserving the exact unsent draft and model/access state (displayed replies 3s/1s/3s). An isolated developer task fixed one line; the fixture check went from one failure to two passes, independently rerun in ATOM's Terminal. Native diff review and confirmed push to an owned local bare remote passed. Found a host-created task commit despite an explicit no-commit request, while the report/chat claimed no commit. Calculator produced an independently verified 351 in 48s/11 calls and explained unconfirmed clicks; the composer Stop vanished during acting. Send next now cancelled a later trial; synthetic Escape did not, without establishing physical-shortcut behavior. Window/runtime interruptions and a duplicate-runtime refusal mislabeled as a settings error need investigation. App left Ready with fictional fixtures retained. [Evidence, limits and path to 8/10](docs/live-workflow-acceptance-2026-10-23.md).

## Orbit identity, Studio Board and title-bar sizing — implemented and checked (23 October 2026)

Keshab selected a new logo, new character style and new floor-style Board, with double-click maximizing/restoring within the desktop. Implemented shared Orbit vector characters, new icon artwork, Studio furniture and Board navigation, native-size ownership and single-owner drag/zoom. Existing worker/task/approval/history behavior and custom legacy avatars are preserved. All 798 Swift tests pass; release compilation and strict bundle-signature verification pass. Reviewed 120 gallery scenes and 50 visual references at the unchanged 1% threshold; one intentional Board reference was updated and four Studio/icon references added. The rebuilt app is running Ready on Studio. Native title-bar zoom maximized to 1920 × 1050, retained that size through Tasks navigation, and restored to 961 × 1050. The reported original physical snap-back was not conclusively reproduced; automated behavior is verified. [Scope and evidence](docs/studio-redesign.md).

## Everyday assistant polish — implemented, live acceptance open (23 October 2026)

Keshab chose PDF/Word folders and sourced suggestions alongside denser chat, simpler reply drafting and reduced computer round trips. Implemented on `codex/everyday-assistant-polish`, integrating the corrected open PR branches. Existing source scopes, chat archives/drafts, explicit permissions and cloud-primary/local-backup behavior are preserved. Typecheck, 1,251 TypeScript tests (10 optional live skips), 796 Swift tests and release compilation pass. Actual native fictional PDF/Word extraction ran locally; private-note regressions verify revision checks and note-free ordinary delivery. An isolated signed preview renders 116 scenes; 46 visual comparisons pass at the unchanged 1% threshold after reviewing nine intentional density references and adding three draft-panel references. Existing Swift isolation/capture warnings and the deprecated native build-system warning remain. No running-app replacement, real personal-source/model read or new live computer-latency benchmark occurred. Broader source/account intake and live acceptance remain open; this does not certify full parity or release readiness. Scope: [everyday assistant polish](docs/everyday-assistant-polish.md).

## PR autofix — Cursor lifecycle and input validation (23 October 2026)

PR #6 review found a failed return glide could leave the agent cursor visible, and delayed start/finish calls could enable an ended task or hide a newer task. Cursor lifecycle revisions now discard superseded continuations; cleanup attempts to disable after lookup/move failure, and driver error results are surfaced. Four new cursor regressions failed before the fix and pass afterward. Invalid delivery modes are now rejected before approval/cursor side effects; its new regression failed before correction. Read-only status steps no longer initialize the cursor ahead of the measured cold probe; its new regression failed before correction. Bring in PR #4's app-ownership fix without rewriting branch history. Typecheck and the full TypeScript suite pass (1,229 passed, 10 opt-in skips, zero failures). No live foreground action or user setting changed; the previously deferred native foreground check remains open.

## PR autofix — Computer app identity (23 October 2026)

Review of PR #4 found that a cached process ID could be reused by another app while retaining the previous app's policy identity. Require matching window ownership before the cached fast path, reset cache reuse across helper generations, reject mismatched window-state owners and propagate window-list errors. Valid same-owner repeated looks retain the faster path. Three new regressions failed before the fix; all 80 focused computer-tool cases pass afterward. No live app, permission, setting or user record changed. Broader check results are recorded in the PR description.

## Next capability — Computer control: agent cursor and background/foreground mode (decided 2026-10-23)

Keshab asked for two things. Build them one at a time.

A. Agent cursor. During a computer task, show the Cua Driver's agent cursor (`set_agent_cursor_enabled`, session-owned). It moves with ATOM's actions, separate from the user's real cursor, which ATOM never moves. When the task ends, the agent cursor glides back to the ATOM pal or island and then hides (`end_session` runs the cursor cleanup once). Decision: "Fly back to ATOM".

B. Background or foreground. Today every action uses `delivery_mode: "background"`, so the user can keep working. Add a Settings default (background) and a per-request override: the user can ask for foreground in a request. Foreground briefly fronts the target window, so shortcuts and sheets work. Decision: "Both".

A is done (2026-10-23). The bridge enables the agent cursor at the first step of a task. The motion is a near-straight 400 ms glide (`arc_size` 0, `turn_radius` 0, `spring` 1), because the default motion looked like a spiral. When the task ends, the cursor glides to the top center of the main display, near the island, and then hides. `move_cursor` uses the default window scope, so the real mouse does not move. Live check: the Calculator task (12 times 7 is 84) on the main display showed the cursor and the glide back. Cursor errors log `computer.cursor_failed` and do not stop the task. 26 cursor and bridge tests pass.

B is built (2026-10-23), not yet checked live. Settings → General → Computer control has a new switch, "Work in the foreground" (default off). The island sends `computer.mode` after every runtime start and on each change, so no restart is needed. The computer tool reads the default at each click, type, key and scroll. A request can override it with `mode` ("background" or "foreground"). The model sets `mode` only when the user asks; it never switches mode by itself to retry. An unknown mode is refused before anything reaches Cua. `set_value` has no delivery mode in the driver and is unchanged. Foreground uses Cua's `delivery_mode: "foreground"`: it briefly fronts the window, acts, and then gives focus back to the app that was in front. Tests: 79 tool tests, bridge and protocol tests, 1220 TypeScript tests, and 792 Swift tests pass; typecheck passes; goldens are within tolerance.

Committed without a live check, at Keshab's request. Next: a live check of the foreground mode on Calculator.

## Current capability — Computer control 4/4: visible current step (2026-10-23)

While ATOM uses the Mac, the chat's work row now names the current step, for example "Working for 13s · 9 observed calls · Clicking in Calculator". Live captures confirm it. Action and app only, no typed text. One new core test; 791 Swift tests pass; release build passes; goldens unchanged. Computer control steps 1–4 are done. Next: contextual drafting.

## Current capability — Computer control 3b: look shows read-only on-screen text (2026-10-23)

`look` now lists unnumbered on-screen text (such as Calculator's display), capped at 20 entries and filtered for secret labels. In a live recheck, the Calculator task answered "12 times 7 equals 84" in 34.5 s, where both earlier runs failed. One new test; 105 pass. Next: step 4, visibility.

## Current capability — Computer control 3/4: speed baseline and first reduction (2026-10-23)

A model-in-the-loop Calculator task took 51.0 s and then 36.5 s. Most of the change is model behavior (n = 1). Driver clicks cost about 2.5 s each and end "unconfirmed", a driver limit with no option to skip. `look` now reuses the last app's pid and skips `list_apps`, saving about 0.6–0.8 s per repeat look; two new tests, 104 pass. Both runs could not read Calculator's display, because `look` drops unnumbered static text. That fix is next. See [computer readiness](docs/computer-readiness.md).

## Current capability — Computer control 2/4: reliability baseline and two fixes (2026-10-23)

A live, model-free baseline on a fictional TextEdit task found two defects, and both are fixed. `look` no longer reads an off-screen helper window (which made input blame "another Space"). A click on a text field that has no press action now points to `type`. After the fixes, `type` is confirmed 5 of 5. Still open: background menu shortcuts (`cmd+w`) and save-sheet buttons do not work. 102 computer tests pass. See [computer readiness](docs/computer-readiness.md). Next: step 3, speed.

## Current capability — Computer control 1/4: read-only permission status (2026-10-23)

Keshab asked to improve Computer control in four steps: permissions and setup, reliability, speed, visibility. Step 1 is done. The `computer` tool's `status` action now also reports Accessibility and Screen Recording through the driver's read-only `check_permissions` (`prompt: false`). It names the grant holder and gives grant guidance when a permission is missing; ATOM changes no permission. Two new tests; 94 computer and transport tests pass; typecheck passes. A live read-only check reports both permissions granted for `com.trycua.driver`. Not covered: the native app flow with a revoked permission. See [computer readiness](docs/computer-readiness.md). Next: step 2, reliability baseline.

## PR autofix — Reviewed reply insertion (23 October 2026)

PR #5 review found an unreadable selection was treated as empty, and selection was checked before activation waits. A dedicated reviewed insertion path now checks the captured app/focus/owner, editable nonsecure field and an explicitly empty AX selection range after waiting. It refuses unknown destinations, verifies direct writes without a duplicate paste on uncertainty and reports fallback paste as unconfirmed. Insert is single-flight and panel Close cancels pending insertion. Dictation/Replace remain unchanged. The nil-selection regression failed before correction; all 793 Swift tests, final release build, isolated bundle signature and 114 gallery scenes/43 unchanged visual references pass. The initial release attempt ran out of disk; removing only task-owned build artifacts and retrying with the repository’s native build system succeeded. The earlier live TextEdit check predates these corrections; no new live insert or app replacement occurred during autofix.

## Current capability — Contextual drafting: reviewed Insert (2026-10-23)

The reply-draft panel now has an explicit "Insert into ‹App›" button. It is enabled only for a finished draft while the source app runs. It inserts at that app's cursor through ATOM's existing inserter: a password field gets the clipboard instead, and nothing is ever sent or Return pressed. A selection guard refuses to overwrite selected text. Two new core tests; Swift tests pass; release build passes; goldens unchanged. Live check with Keshab: the guard refused while the source line was selected, and Insert placed the draft at the cursor with the original line intact and nothing sent. See [contextual reply drafts](docs/contextual-reply-drafts.md).

## Current step — R3 first pass: context and cache from existing usage (2026-10-22)

Existing usage rows show a fixed prefix of about 10.3k tokens. It is identical across chats and restarts. Follow-ups cache correctly, and cache misses come from the 1-hour TTL. The "16,700-token first turn" was a turn that reused a stopped attempt. Found and fixed one bookkeeping defect: after a resume, `dollars_sdk` counted the whole restored session. `session.open` now logs system-prompt and ATOM tool-schema byte sizes to attribute the prefix. Typecheck passes; no local tests ran, as requested. A live turn after restart confirms the fix and logs 3,164 system-prompt bytes and 17,721 ATOM tool-schema bytes: about 5.2k of the ~10.3k-token prefix is ATOM's own. Only about half the prefix is cached across chats. PR #1 and PR #2 are merged; PR #3 carries this work. Details are in the [plan](docs/sentient-parity-release-plan.md) under R3.

## Current capability — R2 long-chat continuity acceptance (2026-10-22, completed with two observations)

The native continuity workflow passes with a fictional 54 KB chat. It covers the background summary, accurate cited items, Saved context details, Read original navigation, Pause and clear, Enable, restart without a startup job, and a rebuilt summary. Original messages and access records are unchanged. Observations: coverage advances one 28 KB batch per exchange, and one item phrases a past state as current. The first send was stopped when the window closed and stays as a recovery item. No test suites ran, as requested. Details are in the [results](docs/sentient-adoption-results.md). Documentation only; no code changed.

## Current step — PR #1 merged; R2 prepared-work acceptance (2026-10-22, completed with one finding)

PR #1 merged into main as `808f814`. R0 and R1 are closed.

The native prepared-work workflow passes with two fictional timers as the only input. It covers the no-input run with no model call, a zero-card run, a sourced card, Review and edit, Copy, Restore, Close discard, budget exhaustion, older-card labeling, restart and pause. Finding, fixed the same day: the plain brief blamed an unavailable model when the real reason was empty input or a used budget. It now names the real reason, with a Swift regression test (790 tests pass). The fictional chat, its summary note and 4 brief rows remain by design. Details are in the [results](docs/sentient-adoption-results.md).

## Current capability — R2 imported-note analysis acceptance (2026-10-22, completed with two findings)

The native analysis workflow passes with a fictional three-note folder. It covers start, reports, Copy, original-note navigation, cache reuse, restart, Resume, edit invalidation, budget pause, Clear and Remove source. After cleanup only the usage counter differs from the baseline, by design. Findings: one chunk failed its output check once and then passed on Resume, and the failure log had no stage or category, so the cause is unknown. The log line now carries the failed stage, with a regression test (1,206 TypeScript tests pass). This run used 7 analysis attempts today. Details are in the [results](docs/sentient-adoption-results.md).

## Current capability — R2 local backup Copy/Clear/Forget acceptance (2026-10-22, completed)

Native Copy, Clear and Forget pass against an owned loopback fixture, with Cancel checked before each confirmation. Clear and Forget send no request. Forget deletes `config/local-backup.json`. After cleanup the clipboard, `config/island.json` and all 48 non-FTS tables match the baseline. Details, one UX observation and limits are in the [results](docs/sentient-adoption-results.md). Documentation only; no code changed.

## Current capability — R1 hosted Terminal rendering (2026-10-22, confirmed on hosted CI)

Confirmed: PR #1 run 39763844330 passes all three jobs. Hosted diffs fall to 0.006% (Terminal compact, was 1.877%), 0.004% (Terminal dark, was 1.378%) and 0.011% (Browser compact, was 0.928%). This confirms the icon-box diagnosis below. R0 and R1 close when PR #1 merges.

Hosted run 39759609477 (main `010ffe1`, image macos-26-arm64) fails only the `visual` job. TypeScript and Swift pass. Compared with all 44 goldens, exactly two scenes exceed 1%: `39-workspace-terminal-compact` (1.877%) and `39-workspace-terminal-dark` (1.378%). Every other scene is under 1%. `ui-check.sh` stops at the first failure, so this was not visible in the log.

Diagnosis: the render is deterministic. Two local renders are identical (0.000%) and equal the goldens. The hosted numbers are the same on two runs. The cause is the OS, not timing. This Mac runs macOS 27.0.1; the runner runs macOS 26. In the hosted image the icon sits at the same row, and every text line below it is exactly 1 device pixel higher. The line spacing among the text lines is unchanged. So the drift is in the icon's layout box, which is the SF Symbol size. The Browser empty state uses the same icon pattern and sits at 0.93%.

Fix: the Terminal and Browser empty-state icons now have a fixed height (26 and 28 points, the local natural sizes). Local renders of the affected scenes stay equal to the goldens. No golden, scene or tolerance changed. `pnpm island:test` passes 789 tests.

Not verified: the hosted result. No macOS 26 render exists on this Mac. The hypothesis is confirmed only when the `visual` job passes on a pushed revision. If it still fails, measure the hosted render again before changing anything else.

## Current capability — R0 stale note-search results (2026-10-22, committed `e4bd552` on branch, not pushed)

Keshab reported that Delete for good left the removed note in the search results. This is task R0 of the [release plan](docs/sentient-parity-release-plan.md).

Cause: the runtime sends a new graph after each save, delete or source change. It sends search hits only when the window asks. The window never asked again, so old hits stayed until the user retyped the query.

Fix: `BrainState.refreshSearch()` returns the search command for the active words. `IslandModel` sends it each time a graph arrives. The old hits stay until the runtime answers, so a rejected change keeps its note. An answer for other words is still dropped.

Evidence:
- Two new regression tests in `BrainTests.swift`. `pnpm island:test` passes 789 tests.
- Native run with two fictional notes (IDs 38 and 39) on a private `memory.db` backup. The pre-fix bundle deletes the note (32 notes, 25 links) but still shows "1 match" with the deleted title. The rebuilt signed app shows "No note matches" with no retyping.
- Cleanup: both fixtures deleted. All 48 non-FTS tables match the pre-test hashes. The original chat, Opus 5.5, Off thinking, Saved permissions and empty composer are restored.

Limits: the native run covers delete only. Rename, body edit, source refresh or disconnect, a rejected delete and a delayed answer rely on the unit tests and on the runtime sending a graph after each change. The `IslandModel` line has no unit test. Hosted CI has not run. The running app is now the rebuilt bundle; the pre-fix bundle is in the private snapshot. Controls were pressed through Accessibility, not typed by hand.

Next task: R1, the hosted Terminal visual failure. Commit of R0 needs Keshab's go-ahead.

## Current plan — Release readiness and Sentient parity (2026-10-22)

Keshab requested a plan covering the discovered note-search defect, release readiness and full Sentient parity. The [execution plan](docs/sentient-parity-release-plan.md) is the current forward sequence: R0 stale search results → R1 hosted Terminal visual failure → R2 remaining native acceptance → R3 controlled latency/context/cache benchmark → R4 release candidate → P1–P6 broader parity. It maps all 33 inquiry features, distinguishes verified equivalents from incomplete scope, and records decisions for protected sources, external writes, wake helpers, hosted memory and architecture differences.

This is a documentation-only planning checkpoint. Main was pushed at `010ffe1`; the search defect is still open and required hosted visual CI is not yet established green. Cloud remains primary and local remains explicit backup; chats/history/drafts/grants remain authoritative. Full parity and release readiness are separate completion gates. Next implementation task: R0 only, with focused regressions and native evidence, then document and stop. No app build, user state or unrelated graphify output changed.

## Current capability — Saved reply context and writing examples (2026-10-22, completed batch)

Created only the fictional authored note Cedar reply context R8 20261022 (ID 37), with a private original database/preferences snapshot and recoverable copies of the fixture text/example/result. Native Find returns that one dated note unchecked; explicit selection exposes its exact excerpt, and Remove deselects without deleting it. Save a fictional writing example; Save persists its exact Unicode text while inclusion remains Off. No existing saved examples were present or overwritten.

Use the normal memory-store API to change only the owned fixture after selection, from Blue Room 74/22 notebooks to Blue Room 75/23 notebooks. Native Generate rejects the stale reference before the writer path. Find shows the revised preview unchecked with a review notice. Explicit re-selection plus style opt-in yields one actual isolated Opus 5.5/Low reply using Blue Room 75 and 23 notebooks; diagnostics record one included source/style true. No external send, automatic paste, new chat exchange, account read or grant. The original 32 note rows and original history/access/project hashes remain unchanged.

Close the ephemeral panel, cleanly quit/relaunch the existing signed app without rebuilding, and compare all eleven observed tables against the immediate pre-restart baseline: exact matches. After Keshab physically reopens Draft a reply, the exact saved example is visible with inclusion Off; intent/background/search/selection/draft are reset and Copy is disabled. With explicit cleanup approval, Forget clears the sample and removes its preference key, then Delete for good removes only note 37. All 31 original application tables match the original baseline hashes exactly: 32 notes and 25 links, with history/access/project records unchanged. Current chat, Opus 5.5/Off/Saved permissions, project filter/theme and empty composer are restored. The saved fictional TextEdit document and temporary Finder window are closed; private source/example/result recovery files remain preserved. [Detailed evidence](docs/sentient-adoption-results.md).

This is acceptance work only; no app source/build/automated-test change in this batch. One UI issue observed during cleanup remains open: deleting the selected note updates graph counts but leaves its active search result visible until the query is cleared and re-entered; the refreshed search correctly reports no match. Codex native flow, imported-source provenance UI, secure fields, broader keyboard/IME/accessibility and the Terminal hosted visual failure remain separate. Graphify-out stays untouched. This bounded batch is complete.


## Current capability — Native contextual reply workflow and activation fix (2026-10-22, completed batch)

Exercised the signed running app with a fictional Cedar conversation in TextEdit. Keshab physically invokes Quick actions because automated Control–Option–K inserts a control character. Fixed the reopen handler to explicitly reveal the main window only when hasVisibleWindows is false, preserving an existing page/panel instead of forcing chat. Release build passes (41.18 seconds), existing ATOM Local Signing and strict codesign verification pass. Native checks cover hidden-window reopening, Board retention on repeated Open and actual access to the floating Quick actions/reply panels after rebuild.

The reply panel shows the active Opus 5.5 at Low effort while main-chat thinking stays Off. Empty-query opening selects no saved content. Explicit lookup for the removed unique fixture note returns no candidates. Edit intent/background and a fictional writing example, verify inclusion starts Off, opt in manually, and generate an actual isolated reply. Editing the output works; changed inputs show the stale-input notice. Copy stays in the panel and matches exactly when manually pasted into a separate blank TextEdit document; the original conversation is unchanged. Save both fictional TextEdit artifacts in the private acceptance folder and close their windows without deleting them.

Four manual generation admissions yield three completions and one actual native Cancel. Two short attempts complete before cancellation can be dispatched; do not count them as cancelled. The longer numbered-text fixture exposes Cancel; pressing it shows Drafting stopped, preserves the earlier manually edited reply and stale-input attribution, re-enables Copy and shows no late replacement on a later read. Close returns to the preserved chat. No external message, automatic paste, example preference save, selected-source upload or chat/memory append occurs. Logged successful requests show zero sources and explicit style inclusion.

All eleven observed notes/links/source/history/access/reasoning/grant/navigation/project tables match pre-draft hashes; saved examples and workspace width/surface preferences match too. Preserve the user's latest selected Cedar project filter/theme instead of an older baseline, empty composer, Opus 5.5/Off/Saved permissions and hidden workspace. Restore Finder desktop. [Evidence and limits](docs/sentient-adoption-results.md).

Explicit saved-source checkbox/revision review, Save/Forget/restart example persistence, Codex's native panel path, Close/reopen form reset, secure fields and broader keyboard/IME/accessibility remain acceptance cases; prior automated/provider coverage is separate. No new automated tests were added/run for the narrow AppKit activation correction; use release/signature and native behavior evidence. Existing Terminal hosted visual failure remains unresolved, with no threshold/scene changes. No latency/token/cost or model-quality benchmark is claimed. Graphify-out remains untouched. Next native case: explicit saved-context and saved-example lifecycle checks. Stop after this batch.


## Current capability — Native notes workflow acceptance (2026-10-22, completed)

Exercised the signed running app with a new fictional two-note folder: native chooser/Preview/Cancel makes no persistent change; Import adds exactly two notes with provenance; search/open works; whitespace/newlines/Japanese text survive. Native Save marks a local correction without changing the source file; Refresh preserves it. Changing the fictional source then refreshing marks a conflict and keeps the local correction. Unsaved editor changes disable Use file version; cancelling its explicit confirmation preserves the saved copy.

Keshab explicitly approved source-version replacement and removal of only the test source/two imported copies. Applied the native confirmation: replacement exactly matches the source and returns to Current. A missing-file Refresh retains its saved copy; restoring the original file returns to zero missing. Clean restart preserves exact source/notes/links/history/access table hashes; native Sources retains two current notes, daily analysis Off and zero attempts. Approved source removal returns Second brain to 32 notes/25 links, no connected folder and no search match for the fixture.

Every observed original non-FTS application table matches its pre-test row hash after cleanup, including all original notes/links/history/access/reasoning/grant/navigation/project/source metadata. Restore the original chat, empty composer, Opus 5.5/Off/Saved permissions, hidden workspace, empty brain search and Finder desktop. Original fixture files and an exact correction backup remain preserved. No model/analysis job, schedule change, real source selection or new file permission. [Evidence](docs/sentient-adoption-results.md).

Hosted run 39727840071 for a095a04 passes TypeScript/Swift but still fails compact Terminal visual comparison at 1.877%. Artifact inspection confirms the fictional path matches; centered body text still shifts vertically. Dark Terminal is 1.378% different independently. The path fix did not resolve all hosted rendering differences. Keep threshold/scenes unchanged and track this separately; do not claim CI is green. Changes in this batch are documentation only; no app rebuild or new automated tests were needed for this native acceptance/cleanup. Graphify-out remains untouched. Next independent capability: native contextual reply editing with fictional context. Long-chat original navigation, prepared cards, analysis restart/resume, broader accessibility/device/local-server checks and the controlled startup/cache/token benchmark remain later acceptance work. Stop after this batch.


## Current capability — Signed restart and native backup acceptance (2026-10-22)

Pushed the adaptation to origin/main as `4251304`, then replaced the repository app bundle with a release build signed by the existing ATOM Local Signing identity; strict signature verification passes. Fixed Launch Services reopen handling so opening the already-running menu-bar app reliably shows the full window and repeated Open does not toggle it closed. Background startup remains unchanged.

Native verification preserves the selected chat/messages, fictional unsent restart draft, Opus 5.5/Off/Saved permissions, Terminal selection/stopped shell, 379-pixel divider and empty Browser address. Restored the originally empty composer and hidden workspace. Exact hashes of all seven observed original history/access/reasoning/grant/navigation/project tables remain unchanged. This real baseline contains no exact-file grant; do not confuse it with automated Full access/grant/revoke fixtures.

The real Local text backup sheet passes Save-without-connect, explicit model-list probe, first answer/follow-up isolation, model/usage presentation, delayed Stop retaining draft/prior answers, and Close/reopen discard with an owned fictional HTTP fixture. Restored unconfigured backup state, stopped the fixture and closed the test Finder window. No local model download, real source read, new foreground cloud response or access expansion. Saved context correctly needs no summary for the current short chat. [Evidence and remaining acceptance](docs/sentient-adoption-results.md).

Hosted CI for `4251304` passes TypeScript/Swift but fails compact Terminal visual comparison. Inspected the artifact/diff; make the gallery's home-dependent project path a fixed fictional absolute path, inspect/update only two Terminal references. Final release compilation passes (49.14 seconds); isolated gallery has 114 scenes and all 43 local comparisons pass at unchanged tolerance. Hosted confirmation of this follow-up remains pending. Native folder import/corrections, reply/prepared-card editors/Copy, long-chat reference navigation, analysis restart/resume, accessibility/IME and real local inference remain to check. The controlled startup/first-text/cache/token benchmark follows native acceptance. Unrelated graphify-out remains untouched. Stop after this batch.


## Current step — Combined validation passes; native release acceptance remains (2026-10-22)

All seven initial Sentient adaptation coding groups now have automated/isolated-provider evidence. TypeScript checking, 1,205 ordinary TypeScript tests, 787 Swift tests, eight actual fictional model responses, release build and 43 visual comparisons pass. The ordinary suite has ten gated skips; two new adaptation live tests were separately enabled and passed. The other eight live/device tests remain unrun. All 114 gallery scenes render, including six added adaptation scenes. [Results, fixes and precise limits](docs/sentient-adoption-results.md).

Added store migration/rollback/history/grant, source conflict/scanner, draft isolation, continuity reference/cancellation, preparation budget, analysis checkpoint/recovery/cache and loopback backup security/lifecycle fixtures. Fixed imported-marker/environment audit collision, reinforced contextual-provider restriction and corrected snapshot scrolling/short backup-sheet usability. Inspected the old hosted CI artifact before refreshing the intentional compact Browser menu reference; retained the 1% threshold. Model settings' Local backup card gets its own inspected reference update; three new derived-work/backup references now guard these screens.

The installed/running app and real user state were not replaced/restarted or mutated. Provider smoke uses no tools, files, real notes/examples or stored chats; local backup used an owned compatible HTTP fixture. No new local model/runtime or package dependency. Native interactions, signed installation/restart continuity, remaining device workflows, real configured local inference and controlled startup/first-text/cache/token measurement remain separate release acceptance. A fresh hosted CI run also remains after a requested push. Work is local/uncommitted on main alongside prior adaptation steps; graphify-out is untouched. Earlier compiler-only entries below describe their original delivery stages and are superseded by the evidence linked here, not by a full release certification.

## Current capability — Optional local text backup (2026-10-22, ADR-193)

Sequence 7 is implemented: a separate Settings → Model backup panel accepts an explicit compatible server address/model, checks its model list without conversation data, and sends manually entered text through Gateway. Cloud choices stay primary. Follow-ups retain only this temporary conversation; outputs support manual Copy and report total completion time plus optional server-reported token counts. No automatic fallback, inherited cloud history/memory/grants, model/runtime installation, startup probe, tool execution or uncertain-action replay. [Behavior and limits](docs/local-backup.md).

Literal-loopback direct HTTP, fixed paths, no proxies/credentials/redirects, bounded JSON/input/output, exact returned model identity and plain-text-only completion keep the adapter narrow. Save/Forget is separate from connecting. Host revisions/session/send receipts, one active request, deadlines/cancellation and native reload-after-timeout prevent late/duplicate publication. Successful pairs commit together; failed sends keep prior results and unsent input. Close/restart discards scratch context; deterministic permissions and saved cloud archives stay untouched. A loopback service may itself forward/store requests; no all-local privacy or speed guarantee is implied.

TypeScript checking and Swift release build pass (65.85 seconds, existing warnings), with static scope/diff review. Per Keshab, no tests were added/run and no server/model/fixture request, settings mutation, dependency install or app replacement/restart occurred. Initial coding scope for the seven adaptation groups is present, not acceptance-certified or full Sentient parity. Work stays local/uncommitted on main alongside sequences 2–6; graphify-out remains untouched. Next: the [combined end-of-plan gate](docs/sentient-adoption-validation.md), including deferred migrations/provider/recovery/security/native/gallery acceptance and the known Browser visual comparison issue. No further capability is started in this turn.

## Current capability — Resumable imported-note analysis (2026-10-22, ADR-192)

Extended Second brain → Sources with a read-only analysis job over existing imported copies. Snapshot bounded note IDs/hashes, process Unicode-safe chunks through an isolated pinned Claude/Codex Gateway model and checkpoint each report/cursor atomically. Reuse unchanged chunks by source/note/hash/offset/model/effort. Source originals, imported text/corrections, chat archives/briefs/drafts and permissions remain separate. No automatic filesystem scan, action worker, account reader, local-model install or provider fallback. [Scope and limits](docs/source-analysis-jobs.md).

Added explicit Start/Pause/Resume, restart-to-paused recovery, source/version/job checks, repeated-resume protection and monotonic Clear recovery. Foreground/brief/native source/note mutations cancel owned work; yield between chunks and avoid inactive-analysis reads in foreground interruption. Validate source membership/hash before dispatch/publication, reject malformed/oversized/likely-credential output, invalidate changed/deleted/excluded copies and prevent late resurrection. Fixed host guidance distinguishes model, output and checkpoint failures; raw content/provider errors stay out of diagnostics. Existing accounting records background provider usage.

Daily analysis is off by default and reuses existing due-time calculation/30-second brief heartbeat. Visible durable admissions default to three, adjustable one to ten per local day; failed/cancelled admissions count and Clear/restart cannot reset them. Schedule model is explicitly pinned and preserved on time/budget edits. Interrupted/failed jobs wait for explicit Resume; budget-only pauses can continue when scheduling/budget permit. No system wake/helper or power change. Sources shows progress/skips/reuse/budget/model, paged report/source timestamps, stale labels, manual Copy and original-note navigation. Confirmed Clear removes derived analysis/scheduling while keeping notes and budget.

TypeScript checking and final Swift release compilation pass (60.74 seconds, existing native-build deprecation/Swift capture warnings). Static diff/whitespace review completed. No tests were added/run, no model call, real source operation, fixture/user-data migration or app installation/restart occurred. Running chats/drafts/grants/access, Browser page and pane preference were untouched. All migration/recovery/budget/provider/security/performance/native/gallery acceptance remains in the [combined end-of-plan gate](docs/sentient-adoption-validation.md), as Keshab requested. This is compiled implementation, not acceptance-certified delivery, full Sentient ingestion/synthesis parity or measured efficiency. Changes stay local/uncommitted on main with earlier adaptation work; graphify-out remains untouched. Next independent capability: optional configured local backup through Gateway, keeping remote inference primary. Stop after this capability.


## Current capability — Read-only prepared daily-brief cards (2026-10-22, ADR-191)

Extended existing daily-brief categories, schedule and Dashboard with opt-in prepared work. One isolated selected-chat-model Claude/Codex Gateway job produces brief lines plus up to three draft/checklist/review cards using only captured brief excerpts, with host-resolved source IDs and timestamps. No knowledge/chat search, protected app/account reader, model-directed research, new schedule, provider fallback or local-model download. Unsupported/busy/Gemini paths preserve a plain brief with an unavailable status. [Scope and limits](docs/proactive-preparation.md).

Added a persistent atomic local-day admission budget (default two, configurable one to five), input/output/card/reference validation, source-failure notice, deadline and settings/foreground/runtime-close cancellation. Preference changes and late output cannot publish an old configuration. Preparation replaces the ordinary brief model job rather than adding a second job; failed/cancelled admissions count conservatively, and exhausted budgets make no model request. Foreground chat takes priority; preparation interrupts summary work and summary admission is skipped while a brief runs. Ordinary brief behavior remains when the opt-in is off.

Dashboard shows newest preparation status and recent saved successful cards with source/model/time and stale/paused disclosure. A separate editor supports unlimited user title/body text, source excerpt review, explicit Restore and manual Copy only; closing discards edits without changing the saved generated card. Failed/budget-limited later runs retain earlier successful cards. No task, send/paste, approval, source write, chat/global-memory save or new authority. Card payloads never use existing Telegram/speech/notification delivery; only brief lines keep their configured route. Additive brief JSON storage shares existing retention; the admission ledger persists across pause/restart.

TypeScript checking and Swift release compilation pass, with existing native-build deprecation/Swift capture warnings. Static scope/diff/whitespace review completed. Per Keshab's instruction, no tests were added/run and no model call, real source read, fixture execution, user-data migration, app installation/restart or live-user-state change occurred. All migration/budget/cancellation/provider/security/native/gallery acceptance remains in the [combined end-of-plan gate](docs/sentient-adoption-validation.md). This is compiled implementation, not acceptance-certified delivery, full Sentient research/execution parity or measured speed/cost improvement. Source stays local/uncommitted on main alongside the previous adaptation work; graphify-out is untouched. Next independent capability: resumable background source analysis using existing scheduling/tasks/checkpoints. Stop after this capability.


## Current capability — Automatic long-chat continuity (2026-10-22, ADR-190)

Implemented the next authorized Sentient adaptation step: asynchronous derived summaries extend existing bounded replay and own-chat history retrieval. After a saved ordinary long-chat exchange, one isolated selected-model Claude/Codex Gateway job summarizes a bounded older batch with original mN references. Short chats make no summary call; foreground requests cancel pending/active work. No automatic retry/catch-up sweep, provider fallback, local model or composed worker/routine/API summary inheritance. Gemini keeps existing replay because its adapter cannot guarantee tool-free isolation. [Scope and limits](docs/chat-continuity-summaries.md).

An additive local table holds only derived items, prefix hash/count, model provenance and enabled/version metadata. Recheck the exact archive prefix and optimistic version before publication/use; reject stale/malformed/oversized output and unknown references. Changed originals invalidate the copy; deletion/pruning removes it and prevents late resurrection. Preserve full messages, explicit Chat brief, saved facts, drafts, access choices and exact-file grants. The selected model receives summaries as lossy reference data, never authorization or verified execution. Claude receives changed copies without a forced session reset. Usage is recorded as background; no content/raw provider errors enter diagnostics.

Chat options → Saved context details now shows status, coverage/model and expandable derived items with navigation to a cited original. Pause and clear aborts owned work and discards the derived copy; enable waits for a later eligible exchange. Commands require the current idle writable local chat and matching version. Earlier provider-session copies are disclosed; future requests carry pause/invalidation guidance. Additional model-token costs and the large-single-message fallback are documented.

TypeScript checking and final Swift release compilation pass (39.82 seconds, existing native-build deprecation/Swift capture warnings). Static diff/whitespace review completed. No tests were added/run, no model request or real-data migration was performed, and no app installation/restart or user-state change occurred. Acceptance/security/migration/lifecycle/provider/cache/UI checks remain in the [combined end-of-plan gate](docs/sentient-adoption-validation.md), as Keshab requested. This is compiled implementation, not acceptance-certified delivery or a measured speed/cost improvement. Changes remain local/uncommitted on main alongside the notes-folder and reply-draft work; graphify-out is untouched. Next independent capability: sourced read-only proactive preparation. Stop after this capability.


## Current capability — Contextual unsent reply drafts (2026-10-22, ADR-189)

Continued the authorized Sentient adaptation from the local notes-folder pilot. Extended Quick actions' existing Draft a reply into a review panel for checked Claude/Codex: editable captured conversation/intent/background, explicit local saved-fact/note search, checked exact excerpts/provenance, opt-in editable writing examples with separate local Save/Forget, and editable Copy-only output. No screenshot, background app/thread read, auto paste/send or guessed destination. [Scope/limits](docs/contextual-reply-drafts.md).

Bind chat/provider/model and separate advertised drafting effort before admission; re-resolve selected source revisions before dispatch. Claude uses the selected model through Gateway's tool-free job; Codex uses the checked empty-runner session with native-tool lockdown. No inherited chat, task tools or automatic memory, fallback or retries. One draft at a time; request matching, dropped-command errors, cancellation, panel Close/X/shortcut toggle, native timeout/runtime stop and ignored late results are implemented. Failed/cancelled regeneration preserves the prior output and its correct input attribution. Examples stay excluded by default on each new panel and persist only on explicit Save; draft data is not added to chats/memory/source files. Usage uses existing Claude/Codex recorders; local diagnostics contain sizes/counts/style boolean only.

Found a concrete compatibility boundary: Gemini CLI's existing plan/read-only adapter can use native reads and cannot guarantee the new tool-free isolation. Keshab explicitly approved Claude/Codex first on 22 October 2026, preserving Gemini's existing selected-text reply action until its adapter can be restricted. This resolves the compatibility choice. Compiled code already matches the approved scope: Gemini's old action stays unchanged, and the new contextual backend refuses Gemini; no new Gemini examples or saved context can be dispatched. No weaker adapter, automatic provider switch or account configuration change was introduced.

TypeScript typecheck and final Swift release compilation pass, with the existing SwiftPM/Swift capture warnings. No tests were run or added per Keshab's instruction; security/protocol/model/lifecycle/native/gallery acceptance remains in the [combined end-of-plan gate](docs/sentient-adoption-validation.md). No real model request, source lookup, example save, clipboard/input interaction, app installation/restart or live-user-state change occurred. Source is local/uncommitted on main after c8e5fda alongside the notes-folder pilot; graphify-out remains untouched. This is compiled implementation, not acceptance-certified delivery. Next independent coding capability: asynchronous long-chat continuity summaries while preserving originals and permission authority. Stop after this capability.


## Current capability — Selected notes-folder source (2026-10-22, ADR-188)

Pushed completed computer readiness, research and adoption plan to origin/main as `c8e5fda` at Keshab's request. Keshab then explicitly deferred tests until the end of this adaptation plan; no tests were run or added in this capability. [Deferred combined validation and acceptance cases](docs/sentient-adoption-validation.md).

Implemented the next scoped pilot: Second brain → Sources previews one checked ordinary UTF-8 Markdown/text folder before explicit import. Manual edit-aware refresh uses the existing notes, FTS/search, tags, wikilinks and autolinks. Persist only source provenance/identity/hashes/exclusions alongside existing content; preserve whitespace and avoid title collisions. Local corrections survive refresh; changed-source conflicts/missing copies are labeled. Use file version requires confirmation and a fresh scan. Delete excludes the imported path; confirmed source removal deletes its copies including corrections, never the originals. Preview cancellation/expiry/replacement, folder changes, bounded no-follow reads and atomic publication are implemented. Existing chat archives, exact-file grants, access choices and source files are not rewritten. Imported brain reads and explicit note attachments have source/data markers and feed checked Claude/Codex external-content safeguards. No model source configuration endpoint or automatic folder grant. [Scope/limits](docs/personal-notes-source.md).

TypeScript typecheck and final Swift release compilation pass, with existing SwiftPM native-engine/implicit-capture warnings. Static diff/whitespace review completed. Unit/integration/security/migration/live-model/UI/gallery checks are deliberately deferred; this is compiled implementation, not acceptance-certified or installed. No real notes folder, model request, private app source or account was used. The running app/window/Browser page, chats/drafts/grants and pane preference were not touched; the compiled binary was not copied into ATOM.app or launched. Current source changes remain local/uncommitted on main; graphify-out remains unrelated and untouched.

This pilot does not deliver PDF/Word/image readers, protected application databases, hosted/OAuth source adapters, model knowledge consolidation or portable two-way Markdown publication. Remote models remain primary; local general inference stays a later optional backup. The prior Terminal compact-Browser visual CI mismatch remains in the end-of-plan gate. Next scoped adoption capability: contextual unsent reply drafts extending Quick actions, with selected context and editable opt-in writing examples through Gateway. Stop after this capability.


## Current capability — Sentient adoption: computer readiness and recovery (2026-10-21, ADR-187)

Keshab authorized adapting Sentient's useful advantages, upgrading existing equivalents and asking only about actual conflicts with a recommendation. Saved the [seven-capability sequence and complete 33-feature mapping](docs/sentient-adoption-plan.md). Remote Gateway models stay primary; general local inference is a future optional fallback/backup. No general model/runtime installation, Sentient source/assets reuse, cloud mirror, automatic sends or permission widening.

Implemented the first capability in the existing computer tool: explicit content-free `status`, startup/probe/call timing, paginated method validation, per-process pending state, active-call-safe idle lifetime, bounded retirement of only ATOM's owned helper, and generation-checked input after approval waits. Failed fresh observations, stale tokens and transport failures discard the old target. No uncertain action is replayed by the transport. A status probe does not certify macOS permissions. [Behavior and evidence](docs/computer-readiness.md).

Typecheck passes; full TypeScript regression passes 1,167 tests with eight normal live opt-in skips. Final focused 173 computer/transport/screenshot/host-policy checks pass after retaining a healthy replacement when rejecting old tokens. Installed Cua protocol-only sample: 141 ms initialization + 4 ms cold probe; 2 ms warm probe. No desktop content read, input injected or model request made. Swift/UI sources and protocol are unchanged, so no native rebuild/gallery run is required for this host-only capability. The running host was not restarted or hot-patched; it loads the checkout sources on next runtime launch. Live chats, drafts, grants, Browser page and pane preference were not touched. Changes are local and uncommitted; unrelated graphify-out remains untouched.

The prior Terminal push f63b00a has green TypeScript/Swift CI, but its visual job failed on 38-workspace-browser-compact.png at 1.308% changed pixels (run 39616156486). This is an outstanding pre-existing visual-baseline investigation, not certified fixed by the host tests; no reference or tolerance was changed here. Next adoption capability: explicitly selected ordinary notes-folder ingestion into Second brain with provenance, edit-aware freshness and removal/correction. Native helper migration, app-owned permission/input health checks and protected personal sources are not delivered by this first probe. Stop after this capability.


## Current inquiry — Sentient OS features and ATOM comparison (2026-10-21)

Pushed the completed Terminal capability to main as `f63b00a` at Keshab’s request; verified the remote SHA. Then completed a source/documentation inquiry of Sentient OS at `16e871ad43c19ca8b26ed36daf66baaa44e886e5` (main, 19 October), plus current release 2.5, website and selected issue reports. [Saved 33-feature inventory, overlap matrix, local-model/speed analysis, limitations and candidate priorities](docs/sentient-os-feature-inquiry.md).

Finding: Sentient is further developed in opt-in personal-source ingestion, automatic linked Markdown knowledge, contextual writing-style drafts, read-only proactive preparation and overnight analysis. ATOM has more explicit multi-chat/project/worker controls, checked access, task checkpoints/Undo, Git/workspace surfaces and Telegram task interaction. The bundled 3.66 GB Gemma reader is not the default computer-use model; frontier computer use and Double Tap have distinct providers. Native OpenAI helper integration, low-effort defaults, prewarming, direct draft API and screenshot/context handling are useful architectural candidates, not a measured speed win. No current same-model/hardware/task token/latency comparison was run. Current open failure reports are attributed reports, not reproduced defect rates.

Research only: no Sentient app/model/helper/script was installed or executed, no account/source data was connected, no code/assets were copied and no new ATOM product feature was started. Candidate priorities are not approved implementation work; pause PR/Device expansion pending Keshab’s next choice. Preserve the live Cedar Browser page, pane preference, current chats/drafts/grants and the notebook’s Full access choice. Unrelated graphify-out is untouched. Research notes remain local after the requested Terminal push.


## Current capability — Terminal workspace surface (2026-10-21, ADR-186)

Published the completed Browser capability and acceptance notes to main as `3c25835` before starting this work, at Keshab’s request. All GitHub Swift, TypeScript and visual jobs passed (run 39610971376).

Implemented an explicit user-operated Terminal beside active project chats, using pinned MIT SwiftTerm 1.19.0 for native VT rendering and an owned testable PTY transport. Start rechecks the project root, shows normal-Mac-user scope and skips inherited app credentials/user shell startup files; it is not a project sandbox or an agent action/Undo path. Stop/surface exit/window closure/scope/runtime/quit end the shell’s ordinary session jobs and reap the exact child. No agent endpoint, automatic model context, permission/schema change or terminal disk transcript. Existing computer policy continues to refuse ATOM’s own app identity. Compact panes use a surface menu; Option–Command–5 selects Terminal. [Scope, dependency review and limitations](docs/workspace-terminal.md).

781 Swift tests / 146 suites pass, including six new real PTY checks. Final focused 20 workspace checks pass after native focus/Accessibility corrections. The 26 existing computer-policy tests pass, including the own-app refusal. Final locally signed release build, strict signature verification, shell syntax checks and 108 gallery scenes / all 40 visual comparisons pass. Reviewed the added chooser entry, wide/compact layouts and three new Terminal references. Initial live native Start, real printf/pwd/stty, resize, Ctrl–C and draft isolation passed. Fixed two live findings: focus after Start and readable Accessibility output. Final native acceptance passed after the user opened the corrected window: Start immediately focuses the readable AX terminal, harmless printf/stty output and Return remain outside the chat draft, explicit Stop works, Start again creates a clean buffer, pane close/reopen and surface switching leave the shell stopped, and changing to the movie chat/back removes the old terminal buffer entirely. Restart also retained the exact fictional draft and per-chat model/thinking/access state. Cleared only “Cedar terminal check — unsent.” and restored the user’s newly opened https://chat.sudoproject.tech/ Browser page in Cedar Workspace Check / Opus 5.5 / Off / Saved permissions / empty composer and search / Ready. Preserved the user’s new 391-pixel pane preference and larger window. Original movie history and the notebook’s confirmed Full access remain unchanged. No model request or file edit was issued. Terminal changes remain local/uncommitted; graphify-out remains untouched. Stop after this capability; PR and Device panes remain independent integrations.


## Current interaction — Browser workspace surface (2026-10-21, ADR-185)

Add a real user-operated native Browser beside chat, with URL/navigation/loading/error/reset controls, per-current-chat temporary website storage and scoped lifetime. Preserve Files/Changes/Git checks, pane resizing/places and chat/draft/access continuity. The agent browser remains separate; no automatic model page context or host-script bridge. HTTPS and local HTTP previews only. [Scope and evidence](docs/workspace-browser.md).

Implemented and compiled. All 775 Swift checks / 145 suites pass; final signed build/strict verification and 105 gallery scenes / 37 comparisons pass. Live HTTPS/loopback, Back/Forward/Reload/Stop, Return without draft send, close/reopen, Reset and cross-chat storage isolation, file/download/upload/dialog refusals pass. Fixed two live findings: a chooser-return link for unavailable file surfaces and failed-address/Reload retention. Final live recheck passed after the user opened the window: project Files → plain chat exposes Choose a surface → Browser, and after a successful HTTPS page a failed local address remains in the address bar through Reload. Reset the temporary browser, restored the chooser preference, closed Workspace and left the original movie chat / Haiku 5.5 / Off / Saved permissions / empty search and composer / Ready. No model request or file mutation was sent; the notebook’s confirmed Full access remains untouched. Browser work is prepared for publication on main at Keshab’s request. Prior ADR-184 live acceptance notes remain local; e2f44a7 is published with all GitHub jobs passing. Preserve graphify-out, original movie chat and the notebook’s confirmed Full access. Stop after this Browser capability; Terminal is the next independent pane integration.


## Project source live acceptance — 2026-10-21

Published ADR-183/184 as e2f44a7 on main. Completed real native New project creation and GitHub owner/repository import using two dedicated fixtures under ~/Documents/ATOM-source-check-wx35r21p: Cedar Source Check (created, project p-dc580aa8, helper cedar-source-coder) and Cedar Import Check (imported, project p-a9ff5b62, helper cedar-import-coder). Creation initialized an actual empty Git repository; import cloned octocat/Hello-World, retained its public HTTPS origin and produced the expected Hello World README with clean Git status. Both UI operations confirmed success and left the existing movie chat unchanged. No model prompt was sent.

Up/Down/Return source navigation passed. After a normal quit/relaunch, both projects and the selected import filter persisted; the movie transcript, Haiku 5.5 / Off / Saved permissions and exact fictional unsent draft survived. Cleared only the test draft. The single New chat then opened Cedar Import Check / New chat, and the Files pane listed and previewed the real imported README. Closed the pane and restored the movie chat with empty composer. Native project-popover synthetic Return dismissed without changing scope; Keshab physically clicked its search, pressed Down/Return and confirmed Cedar Source Check selected with the movie chat retained. The resulting project selection was verified in Accessibility. After explicit cleanup consent, removed only the two empty fixture projects using Remove project, keep chats and their generated agents through the native team controls. Verified both project IDs and agent folder grants are absent; agent configuration follows the existing recoverable agents-removed flow. Moved the dedicated fixture directory to ~/.Trash/ATOM-source-check-wx35r21p and verified the imported README remains recoverable there. Selected-project removal returned the filter to All projects. Restored the original movie chat / Haiku 5.5 / Off / Saved permissions / empty search and composer / closed workspace / Ready. Existing project/chat data and the notebook’s confirmed Full access choice were not changed. All GitHub TypeScript, Swift and visual jobs for e2f44a7 passed (run 39588428298). No production source or permission policy changed and no build/regression suite needed rerunning for this acceptance-only pass. The remaining project source create/import/restart/keyboard acceptance step is complete within the public-HTTPS scope. Next separate capability: Browser in the right pane.


## Current interaction — Project sources and simpler sidebar (2026-10-21, ADR-184)

Removed the permanent Projects block and repeated chat plus buttons at Keshab’s request. Search now shares its row with Projects, New project and one New chat; project selection scopes a single chat list, and New chat uses that scope. Existing project management moves into picker settings. Implemented the next requested source chooser with checked local-folder registration, new Git repository initialization and bounded public HTTPS/GitHub cloning. History/drafts/access/grants remain unchanged. [Scope and evidence](docs/project-sources.md).

Typecheck, full TypeScript suite (1,154 passed / eight normal opt-in skips), 772 Swift tests / 144 suites and real public HTTPS clone in a disposable fixture pass. Final locally signed release build and strict signature verification pass. A separate render passes all 101 gallery scenes / 33 comparisons; reviewed only the three affected existing main-window references, two prior local project references and four new source/navigation scenes. After launching the rebuilt app and the user opening its full window, live checks pass: one Chats list/no permanent Projects block or chat plus, single top New chat, all four source forms, search/no-match/back/cancel and Return selection; Cedar scope retains current New chat and changes top New chat scope, settings exposes existing management. Restored All projects and left the original fresh New chat / Opus 5.5 / Off / Saved permissions / empty search/draft / Ready. No prompt, project creation, folder grant, archive or delete was dispatched. Actual init/clone/registration are controlled host fixtures; physical arrow navigation and live import completion are not certified. No live project or grant was added by these fixture checks. Preserve user’s current fresh New chat / Opus 5.5 / Off / Saved permissions / empty draft, and the separate notebook’s confirmed Full access. Prepared ADR-183/184 together for publication on main at Keshab’s request, after 43ad83d. Unrelated graphify-out remains untouched. Private-repository authentication and Browser/Terminal/PR/Device surfaces remain separate capabilities. Stop after this capability.


## Current interaction — Project filter and settings (2026-10-21, ADR-183)

Pushed the completed Full access/workspace batch to main as `43ad83d` at Keshab’s request. Its GitHub TypeScript, Swift and visual jobs all passed. Then implemented the next requested interaction: a searchable local project filter with persisted ID, scoped active/archived lists and explicit outside-filter feedback, plus real project settings through existing rename/model/web commands. The folder remains display/reveal only. [Scope and evidence](docs/project-filter.md).

767 Swift tests / 143 suites, 134 targeted host/project checks, signed build/strict signature verification and 97 gallery scenes / all 29 comparisons pass. Reviewed four new references; existing ones are unchanged. Live final-build filter/search/no-match/All projects/outside-filter/global search, gear/accessibility settings entry, invalid-name refusal, name/model round-trips and draft/chat retention pass. Restored exact Cedar name, inherited default model, web off, All projects, collapsed projects and original movie chat (Haiku 5.5 / Off / Saved permissions / empty search/draft / closed workspace / Ready). No prompt sent. Native popover click injection required AX value-setting; physical keyboard-only/restart checks remain unverified, with persistence and archived/deleted cases covered by core tests. Native-only work remains local after `43ad83d`; preserve graphify-out and the earlier confirmed notebook Full access choice. Next independent requested step: project source palette/imports. Stop after this capability.


## Current interaction — Resizable workspace surfaces (2026-10-21, ADR-182)

Delivered the next requested T3 interaction: real Files/Changes/Git chooser, a resizable pane beside chat, compact fallback, native View commands and keyboard/accessibility resizing. Retain per-surface previews/filter/source choices in memory across close/reopen/tab switches; scope/runtime changes clear every place. Save only preferred width/surface; existing file/Git/Undo policy remains authoritative. Composer controls wrap for the narrower chat. [Scope, evidence and limits](docs/workspace-pane.md).

763 Swift tests / 142 suites, final signed build, strict signature check and 93 gallery scenes / all 25 comparisons pass. Live listing/literal preview/Git source/Changes/menu/drag/focused-key/width clamping/filter/close-reopen/draft/isolation checks pass on the fictional Cedar project. Compact behavior is rendered/unit coverage; live window resizing did not take effect. Restored default pane preference/chooser, collapsed projects, original movie chat with latest user messages, Haiku 5.5 / Off / Saved permissions / empty composer / closed workspace / Ready. No model or mutation was dispatched by these checks. Prior notebook Full access choice is untouched. Local on main alongside uncommitted ADR-181; no push requested. Preserve graphify-out. Next independent requested step: searchable project filter and project settings. Browser/Terminal/PR/Device surfaces need separate integrations. Stop after this capability.


## Current interaction — Full access for one chat (2026-10-21, ADR-181)

Published prior desktop polish/thinking/checked-access work to main as bce4193 at Keshab's request, then implemented the separate Full access upgrade. Explicit host confirmation enables routine approval skipping for one chat; new/forked chats remain checked, old grants/history/drafts survive, and protected tools/actions retain their checks. The full scope has an expanded native confirmation card. [Behavior and limits](docs/chat-full-access.md).

Typecheck, 1,140 TypeScript tests / eight normal opt-in skips and 758 Swift tests / 141 suites pass. Final signed build and strict signature verification pass. All 90 gallery scenes / 22 visual comparisons pass, including the reviewed complete-scope confirmation reference. Live Full access menu, complete-scope Board card and chat/draft isolation pass. The confirmation was accepted in-app during a user interaction, and the fictional notebook chat now has Full access; preserve that confirmed choice. Cleared only the fictional unsent draft and restored the original movie chat (Haiku 5.5 / Off / Saved permissions / empty composer / Ready). No model request or agent action ran. Decline/cancellation and actual file effects are controlled automated checks. Full access itself remains local/uncommitted; unrelated graphify-out is untouched. Next separate requested capability: the multi-surface right pane.

## Current interaction — Per-chat access modes (2026-10-21, ADR-180)

Implemented Saved permissions, Chat only and Ask before changes beside model/thinking, with persisted chat scope and deterministic Claude/Codex enforcement. Existing history, brief, draft and exact-file grants survive mode changes; strict mode asks even for remembered edits. Stale/busy/shared/archived changes refuse. Gemini refuses restricted turns before launch because its native tools cannot be host-gated. Full access remains the next separate upgrade. [Behavior and evidence](docs/chat-access.md).

Verification: full TypeScript suite 1,131 passed / eight normal opt-in skips; 40 final core/CLI checks pass including a new reused-session cancellation regression; typecheck and 757 Swift tests / 140 suites pass. Signed release build and strict code-signature verification pass; all 89 gallery scenes / 21 comparisons pass. Live menu selection for all three modes, cross-chat isolation, exact unsent draft retention and unchanged transcript pass. Chat only's access summary reports host/computer/web off. Restored Saved permissions on the fixture and the original movie chat (Haiku 5.5 / Off / empty composer / Ready); no prompt sent. Corrected the summary's provider/mode wording after inspection; final signed build and strict signature verification pass. Restarted the final app/runtime; its main window starts hidden and can be opened from the menu-bar icon. Live behavior checks preceded only that one-sentence wording correction. Local on main, uncommitted/unpushed; preserve prior polish/thinking and unrelated graphify-out. Stop after this capability.

## Current interaction — Per-chat thinking (2026-10-19, ADR-179)

Thinking selection is implemented against actual installed provider metadata, with per-chat/model persistence and unchanged history/grants/drafts. Default retains Claude Off/Codex Low. Typecheck, 227 targeted TypeScript and 755 Swift checks pass; signed build, 89 gallery scenes and 21 comparisons pass. On 21 October the full TypeScript suite passes (1,121 passed / eight normal opt-in skips) plus final typecheck/model-settings checks. Live Claude selection/chat isolation/draft retention/restart and Codex levels/High/default/model inheritance pass after the user opens the main window. Original movie chat restored (Haiku 5.5 / Off / empty composer / Ready); fixture choices reset; no prompt sent. [Behavior and verification](docs/chat-thinking.md). Steps 3–7 of the T3 interaction plan remain separate.

## Current desktop polish — 2026-10-19

All seven selected themes now apply to the entire window. Design system is hidden from user Settings/search; Chats has a New chat + button; sidebar and message gaps are smaller. Growing multiline fields accept complete ordinary text through saving/recovery, with existing permission and resource protections retained. Typecheck, 256 targeted TypeScript tests, 752 Swift tests, signed build and 21 visual comparisons across 89 gallery scenes pass; live themes/new chat/long schedule/Undo verified. Restored Warm and the original saved chat with empty composer. [Details and limits](docs/desktop-input-polish.md). Local on main, not pushed.

## Current measured optimization — 2026-10-19

Codex chat startup now inventories effective configuration without connecting inherited MCP servers, then verifies the resulting disabled tool policy. Inherited standalone Codex skill catalogs are excluded per thread; ATOM's 37 tool specs, instructions, history and file-grant policy remain. Setup 4.18 s baseline → 1.32 s final median; first model text 8.19 s → 5.34 s; first-turn input 16,737 → 11,594 tokens. Small sample: one baseline and three final fresh chats, with first text 4.43–6.73 s. Typecheck/55 targeted checks pass; actual signed app restarted and measured. Two live word-position answers were incorrect; direct quotations and a reopened saved chat passed. Cache counters reconcile, but the earlier zero-cache miss has no proven root cause. [Measurement ledger, context breakdown and scope](docs/chat-startup-performance.md).

## Measured chat baseline — 2026-10-19

Six short responses per app, GPT-6 Luna / Low: ATOM 101,156 total input tokens vs Codex desktop 211,842; estimated API-equivalent cost $0.005832 vs $0.006956. Median fresh-chat completion: 6.83 s vs 4.13 s; follow-up: 1.65 s vs 1.47 s. Both passed 6/6 supplied checks. This small installed-configuration snapshot uses natural caching and slightly different host timing boundaries; it does not establish general coding quality, first-visible-text speed or subscription billing. [Report and raw evidence](.ecc/benchmarks/atom-vs-codex-2026-10-19.md). No app source changed.

## Current interaction upgrade — 2026-10-19 (ADR-178)

Saved all requested T3 interactions and the explicit decision to make Full access a separate upgrade. First delivery is a searchable per-chat provider/model picker with provider filtering, favorites, unavailable states, custom IDs and default inheritance. Favorites persist locally with provider identity and bounded size. Existing host validation and chat/draft/grant state remain authoritative; selection errors are visible at the composer. [Complete requested sequence](docs/t3-interaction-upgrades.md).

751 Swift tests / 138 suites, signed release build, 89 gallery scenes and all 21 visual comparisons pass. Live search/filter/favorites across restart/custom-ID validation/default inheritance/model switching and draft retention passed; final app reopened Ready with original chat/model, empty composer and test favorite removed. Physical arrow/Return acceptance remains unverified because automated key injection dismisses the popover. ADR-177/178 are included together in this verified publication on main at Keshab’s request. Thinking levels, access modes including separate Full access, pane surfaces, project filter/settings and repository source creation/import are requested follow-ups, not delivered controls.

## Current design preview fix — 2026-10-19 (ADR-177)

The reported perpetual Loading models screen is the Design system showcase. Real app status and AI model settings were Ready/available. Examples now carry explicit preview labels and notices, and sample New chat/retry actions are disabled. The loading sample opts out of the real timeout so it stays distinct from the Slow example; real loading screens retain their default behavior.

745 Swift tests / 137 suites, signed build, 87 gallery scenes and all 19 visual comparisons pass. Live preview stayed distinct after 44 seconds, with disabled sample actions and app Ready. Only the reviewed showcase reference changed; app left on State previews with its original theme. Local after published desktop redesign 9d99578; no runtime/provider/policy change.

## Current desktop redesign — 2026-10-19 (ADR-176)

T3's sidebar/settings/panel patterns now guide the main ATOM window, with one neutral light/dark appearance and compact shell across destinations. New chat sits beside search; projects/chats scroll together; settings has category filtering and direct navigation; workspace uses a matching tab strip. Existing actions, grants and confirmation policies remain intact. [Scope/evidence](docs/desktop-t3-design.md).

745 Swift tests / 137 suites, signed release build, 87 gallery scenes and all 19 visual comparisons pass. Live navigation/accessibility, settings filter/select/light appearance/restoration, hidden sidebar/focus and workspace tabs passed. Original chat/sidebar/theme restored; app left Ready with an empty composer. ADR-174–176 form one verified desktop design publication on main at Keshab’s request. Older local/push notes below record the individual implementation batches; `graphify-out/` is untouched.

## Current T3 Code chat design — 2026-10-19 (ADR-175)

Reworked the actual chat presentation using T3 Code source at `1451e7cb` and its installed app as references: neutral surfaces, compact project/title header, wider bounded message column, soft 80% user bubbles, 14pt replies at consistent contrast, hover/focus menus and a larger composer with controls along the bottom. Empty chat centers the heading/input. Existing theme light/dark choice is respected without rewriting preferences; other pages retain their palette. ATOM branding and functional controls remain native; no T3 runtime, access mode or provider integration is imported.

All 745 Swift tests, signed release builds, 83 gallery scenes / 17 visual comparisons and live draft/Japanese/model/menu checks pass. Test drafts were cleared without sending. Final empty-chat and polished composer checks passed; original chat/sidebar restored, app left Ready. [Pinned reference, licensing, scope and final evidence](docs/chat-t3-design.md). Local on main alongside ADR-174; not committed/pushed. Prior workspace/Git commit 818b644 is published with all GitHub checks green. `graphify-out/` remains untouched.

## Current chat layout upgrade — 2026-10-19 (ADR-174)

The completed workspace/Git upgrades were pushed as `818b644` on main; TypeScript, Swift and visual GitHub checks all passed. Keshab then requested fewer permanent controls in chat. Whole-message copy/edit/retry and reply copy/quote/timings now live in compact ellipsis menus, with header utilities grouped into Chat options. The utility strip and per-message action footers are removed. Project reveal and cache/replay diagnostics move into the menu; workspace stays directly accessible as an icon. Recovery has a small attention indicator. Work, approval, error and mutation feedback stay visible.

All 745 Swift tests passed. Final signed build, all 80 gallery scenes / 14 visual comparisons and live menu/sheet/copy/unsent-quote/project-workspace checks passed. Only two reviewed chat references changed. Original chat/sidebar restored; app left Ready with an empty draft. Evidence is in [conversation controls](docs/conversation-controls.md). Existing grants, fork/brief checks, history and explicit-send behavior are unchanged. The layout batch is local, uncommitted/unpushed; `graphify-out/` remains untouched. Next independent upgrade: useful task commit subjects, then PR integration.

## Current task branch upgrade — 2026-10-19 (ADR-173)

Delivered local task-branch provenance/discovery: exact saved creation commits for new branches; explicit older estimates and unavailable warnings; local behind counts against the recorded creation branch; active checked repository-root project discovery; explicit refresh with stale patch clearing. Reused/legacy branches retain their names and facts. Subfolder projects do not expose parent-repository changes. Discovery does not broaden Push access.

TypeScript checking, 1,106 passing TypeScript tests (eight normal opt-in skips), final focused repository/project checks and 745 Swift tests passed. Signed release build, all 80 gallery scenes / 14 visual comparisons and live saved-start/patch/refresh checks passed; app left Ready. [Behavior, limitations and evidence](docs/task-branches.md). Work remains local on main with ADR-171/172, uncommitted/unpushed; prior remote CI is not evidence for this revision. Next: improve task commit subjects, then PR links/status. `graphify-out/` is untouched.

## Current Git review upgrade — 2026-10-19 (ADR-172)

Keshab continued to the next capability after Files / Changes. The workspace now has a **Git** tab for the current writable project's actual working tree: branch/upstream/local ahead/behind, staged/unstaged/untracked/conflicted paths, exact per-file HEAD/index/disk comparisons, conflict base/ours/theirs, and presentation-only whitespace normalization. The current registered project is discovered directly; the existing helper-grant task-branch list remains a separate area. No commit/pull/push/merge/resolve/reset/delete or automatic remote operation is added.

Git inspection is bounded and asynchronous. It strips inherited Git routing, disables hooks/fsmonitor/optional writes/prompts/submodules and configured content filters, reads raw blobs without external diff/textconv, scopes subfolders to their own paths, and rechecks project access/root and HEAD/index. Late switched-chat results are withheld and section-matched errors remain visible. Existing task-branch diff/stat also explicitly disable external diff/textconv; displayed remote/error controls are stripped before credential sanitization. No migration, dependency, provider request or new file grant.

Verification: 1,101 TypeScript tests passed / eight normal opt-in skips; 744 Swift tests passed. Real repository tests cover mixed staged/working edits, renames (including original index paths), deletions, untracked files, unborn/detached branches, local divergence, real merge conflicts, subfolder isolation, unchanged index bytes, driver/filter non-execution, inherited routing, bounds/exclusions and in-flight access revocation. Wire/native tests cover changed-chat withholding, source-section identity and whitespace presentation. The live signed app showed staged/unstaged/untracked fixture entries; HEAD and staged source were distinct; working-file comparison and whitespace toggle worked. A fictional unmerged index showed Wednesday base / Thursday ours / Friday theirs without resolving anything; its index hash remained exactly unchanged. Final signed build passed. All 80 gallery fixtures and 14 visual comparisons passed (max older-baseline delta 0.166%); reviewed Git status/conflict/daylight scenes, added a Git reference and updated only the local workspace reference for the new tab. Reopened app left Ready on the fictional project’s Git status, empty composer, no task/approval, with its fictional conflict still unresolved.

Scope is read-only Git review. Broader task-branch discovery/saved bases, improved commit subjects, PR links/status, Git mutations, conflict prediction and confirmed branch cleanup remain separate. Local on main with the prior ADR-171 changes; no commit/push/remote CI is claimed. `graphify-out/` is untouched. [Behavior and evidence](docs/git-workspace.md). Stop after this review outcome; saved task-branch provenance/discovery is the next independent Git step.


## Current project workspace upgrade — 2026-10-19 (ADR-171)

Keshab authorized Files / Changes as one complete capability after the continuity upgrades. The current writable project chat now has bounded folder browsing/filtering, complete literal text previews, Add to chat as an unsent attachment, editor/Finder handoff, retained task checkpoint provenance, original/current diffs and confirmed single-file Undo. Wide windows show the workspace beside chat; narrower ones use the main pane until closed. Existing project/attachment/file permissions and checkpoint storage/retention remain authoritative; there is no migration, new grant, background model call, automatic send or automatic Undo retry.

The host rechecks current chat/project/root and excludes unsafe paths. File/line/list/transport budgets are explicit. Reviews verify both hashes; Undo refuses active work, stale reviews, later edits, missing/damaged originals and links. It targets one exact checkpoint even if other roots share the same relative filename. Workspace identity ignores project counts/recency so saving the first project chat does not clear its file preview; genuine chat/root/access changes do. Native state drops old/timed-out results.

Verification: TypeScript checking and full suite (1,091 passed, eight normal opt-in skips); 743 Swift tests passed. Additional focused admission checks cover Telegram/routine/shared API chats, wrong chat/project, busy Undo and no model call. Real signed app: created only fictional Cedar fixture files, browsed/previewed the project, added an unsent attachment, opened that exact file in TextEdit and revealed it in Finder. A real Kame task changed Wednesday → Thursday; Changes showed task #30 and both full versions, then native confirmation Undo restored Wednesday on disk and displayed Undone. The walkthrough exposed and prompted the first-save identity fix above. The signed release rebuild passed. All 78 gallery fixtures rendered, all 13 visual comparisons passed (max delta 0.166%), and the new reviewed workspace reference also matched a second render at 0.000%. Restart retained the project chat and Undone record. A second new project chat saved a reply-only request while the preview remained open; filtering and nested browsing passed live. Sidebar restored; app left Ready with an empty composer and fictional workspace open. See the evidence document for limits.

Scope is retained checkpointed task edits. Ordinary Git-worktree and shell edits may have no checkpoint; the panel states coverage and links to the existing branch review. General Git workflow/diffs, generated-file capture, multi-file apply and optional auto-open remain separate. Work is local on main; no publication is included in this request. Unrelated `graphify-out/` remains untouched. [Behavior and evidence](docs/project-workspace.md). Stop after this workspace outcome; Git workflow is the next independent upgrade.


## Current continuity upgrade — 2026-10-19 (ADR-170)

Keshab continued one capability at a time. The window now remembers its current saved writable chat and reopens it when the app/runtime starts. This addresses the confirmed startup behavior that previously began in a fresh chat despite a saved conversation being open at quit. Restoration happens synchronously before input listeners/voice work are available; Ready is followed by the existing chat-opened/chat-list snapshots. A choice made during voice warm-up wins; startup never reopens a chat again after input has begun.

Only a local chat identifier is added to the existing SQLite database. Selection follows the window, not the newest background exchange. Explicit New chat clears it until the first exchange is saved. Missing, pruned, archived, other-surface/shared chats and unavailable/archived projects fall back to a fresh chat without choosing an unrelated conversation. Briefs, transcripts, model/project associations, file grants and held input retain their existing scopes. Reopening does not submit drafts, call a provider, approve requests or retry work.

Verification: typecheck; 1,083 TypeScript tests passed / eight normal opt-in skips; 738 Swift tests passed; signed app rebuild; 75 gallery fixtures and all 12 comparisons passed with unchanged references. Added real SQLite/Core/wire checks for persistence, first-save selection, recency isolation, fresh-start intent, project replay, unavailable targets, warm-up user actions, retention/deletion and nonfatal storage errors. In the real app, the fictional Juniper chat and an unsent draft returned automatically after quit/relaunch, with Ready and no send. After a deliberate request, Codex recalled Juniper / Tuesday / copperfern. A separate New chat → quit/relaunch remained fresh. The fixture draft was consumed only after being explicitly replaced with that test request; the app is left Ready in the saved Juniper fixture. [Scope/evidence](docs/chat-reopening.md).

No native view, new protocol command, permission scope, automatic retry or broader workspace capability was added. Stop after this continuity outcome; unrelated `graphify-out/` is untouched.


## Current continuity upgrade — 2026-10-18 (ADR-169)

After the green baseline (93b7c1b; all three GitHub CI jobs passed), Keshab continued step 2: make the chat feel like the same assistant. Delivered one bounded outcome: a visible, editable **Chat brief** for saved writable chats. User-kept project details, decisions and next steps accompany every request outside the bounded transcript replay, across restarts and provider changes. No automatic summary, extra background model call, global fact or file grant is created. Other chats/forks start empty; explicit clearing stops future inclusion, while prior provider-session context may retain old versions.

Briefs are limited to 4,000 UTF-8 bytes, validated in storage/protocol/native UI, versioned to refuse stale overwrites and checked for the current idle writable chat. Lost acknowledgements can be checked without overwriting newer edits. A draft survives save failure/timeout and snapshot refresh; reload explicitly replaces it. Additive SQLite migration preserves old archives and existing grants. Briefs follow the chat's existing deletion/retention policy.

Verification: TypeScript checking; 1,076 TypeScript tests passed, eight opt-in skips; 738 Swift tests passed; signed release build; 75 gallery fixtures and 12 comparisons passed. Reviewed the two updated chat-reference images. Real app: saved fictional Juniper/Monday/mosslight, quit/reopened, observed the brief and received Monday/mosslight/outline from Codex without repeating those values; edited to Tuesday/copperfern and the next response used the new values. Clearing/saving/reopening remained empty. The fictional brief was left empty, app Ready. Scripted checks cover provider changes, live SDK updates, replay rollover, migration/reopen, isolation/fork/delete, bounds, stale saves and unchanged grants; the host wire test refuses background/read-only/noncurrent writes. Live cross-provider switching and very long chats remain separate acceptance cases. [Scope and evidence](docs/chat-brief.md).

Stop after this continuity capability; the workspace and broader upgrades remain separate. Unrelated `graphify-out/` remains untouched.


## Current baseline repair — 2026-10-18 (ADR-168)

Keshab selected step 1: establish a dependable release baseline, then continue upgrades one at a time. Focused verification and CI repair are authorized for this step; earlier skipped-test/deferred-CI entries below are historical.

Fixed native file-review answers dropping their review token, updated three stale event/error assertions, and replaced the chat-find method reference that crashed Swift 6.3.3 CI compilation with an explicit closure. A repeated suite exposed an early-waking Telegram retry losing its pending notification; it now keeps the retry armed. Gallery fixtures flatten chat rows correctly and replace unsupported native controls with their labels; five changed reference images were visually reviewed before replacement. The 1% visual threshold and all three blocking CI jobs remain enabled.

Local verification: TypeScript checking; 1,071 TypeScript tests passed / 8 normal opt-in skips; 736 Swift tests passed; release compilation; two signed-in Codex checks passed for own-chat archive retrieval after reopening and later checked edits reusing an explicit file grant. New real-filesystem/SQLite/native-approval checks exercise complete review, Apply, Undo after storage reopen, conflict preservation, missing undo storage, Stop/late approval, stale tokens and review bounds. These integration checks are not a claim of clicking the rich review card in the live app. The rebuilt signed app reached Ready, reopened the fictional Juniper chat and recalled Friday/riverstone. A real Stop returned Ready and recorded Stopped; Recovery restored only an unsent draft, then the fixture draft was cleared. Remote CI remains a separate release gate for the published revision. No new upgrade capability or broad acceptance of ADR-141–167 is claimed. Unrelated `graphify-out/` remains untouched. [Baseline evidence and limits](docs/release-baseline.md).


Renamed ZENO -> ATOM on 2026-10-13; entries below keep the name they were written under.

Last updated: 2026-10-18

Publication checkpoint (2026-10-18, ADR-167): Keshab requested pushing the native file-review batch and restarting ATOM. This publishes the reviewed implementation on main; batch-local/uncommitted and installed-app notes below describe implementation-time state. TypeScript/diff checks and Swift release compilation passed. Rebuild/restart follows this push; tests and known CI repairs remain skipped. No apply/Undo/live acceptance is claimed. Unrelated graphify-out stays local.

Implemented ADR-167 in source after pushing ADR-160–166 as a3e4363 to origin/main (verified). ReviewPreviewEdit now supports complete native reviews up to 32 KiB / 1,000 combined lines with Changes/Before/After, complete target paths and Apply only after diff preparation. Work-strip Review changes opens Board → Needs you. Per-request review tokens are checked by native state/model and the host bridge; generic/old-client/Telegram Allow cannot approve richer reviews. Telegram/API needs summaries omit review bodies/tokens and offer Decline only. Existing receipts, source checks, required undo copies and pending/failed target holds remain. **TypeScript checking, static source/security/diff review and Swift release compilation pass (48.16 seconds; /tmp/atom-file-review-release-final.log). No tests added/run, app/gallery/live UI/accessibility checks, migrations, checkpoint/apply/Undo or adapter/provider execution.** Installed app unchanged; ADR-167 local/uncommitted/unpushed on main after a3e4363; graphify-out preserved and known CI repairs deferred. No generated-file import or multi-file apply. [Scope and limits](docs/codex-native-file-review.md).

Publication checkpoint (2026-10-18, ADR-160–166): Keshab requested pushing the accumulated worker-model, inspection, MCP, browser, advisory-child, disposable-preview and reviewed-edit upgrades on main before continuing. Per-batch local/uncommitted notes below describe their implementation-time state. TypeScript/diff checks pass; earlier Swift release compilation is recorded in the relevant batches. No new tests, migrations, adapter/provider/apply/Undo execution, app launch or installation. Known CI repairs remain deferred; unrelated graphify-out stays local.

Publication checkpoint (2026-10-18): this commit collects the accumulated chat, task/foreground recovery and Codex worker/page-reading upgrades through ADR-159 on `main`. Statements below about local/uncommitted work describe each batch's implementation-time state. Verification limits remain unchanged: recent upgrades were compiled/typechecked within their documented scope; tests/live acceptance remain skipped where recorded. The installed app is unchanged.

Implemented ADR-166 in source: project folders workers can propose one short existing preview input's replacement with a host source receipt, native Read/Write/plan checks and fresh complete before/after approval. Changed sources or unavailable verified undo refuse; two serial attempts consume eligible inputs even on refusal. Pending/failed reviews hold this worker's host Write/Edit and further review of that file until task end. Required snapshots include worktrees. Additive guarded checkpoint rows pin expected output hashes across completion/restart, retaining normal Undo conflicts and explicit Force semantics. Receipts bind source hashes, not sandbox-generated text; no automatic diff import, larger reviews, file creation/deletion or multi-file apply. External-editor races and filesystem/SQLite atomicity remain limitations. **TypeScript checking and static source/security/diff review pass; no tests added/run, migration, apply/checkpoint/Undo execution, adapter/provider or app/live checks.** No Swift changes/build; installed app unchanged. ADR-160–166 local/uncommitted/unpushed on main after 2fe2250; graphify-out preserved and known CI failures deferred. Next: larger native review surface. [Scope and limits](docs/codex-preview-edits.md).

Implemented ADR-165 in source: project folders workers can request disposable shell previews using explicitly selected checked input copies, a separate read-only baseline and sandboxed diff. Native policy plus a fresh full-request card applies; the real task root and networking are denied to the command. Two serial attempts, bounded input/execution/output, best-effort work/scratch budgets and bounded process/temporary cleanup. Results are untrusted simulations; no automatic apply, real-project build/test evidence or shell undo. **TypeScript checking and static source/security/diff review pass; no tests added/run, adapter/sandbox/CLI/provider execution, migration or app/live checks.** No Swift changes/build in this batch; installed app unchanged. ADR-160–165 local/uncommitted/unpushed on main after 2fe2250; graphify-out preserved, known CI failures deferred. Next: review/apply design with source conflict detection and a fail-closed undo boundary. [Scope and limits](docs/codex-shell-previews.md).

Implemented ADR-164: root Codex workers can request bounded advisory reviews from another worker using supplied context only. Two attempts, one at a time, one generation, a 60-second child deadline, no tools/grants/skills/history/recursive workers and separate model/usage/Board records. Parent Stop/removal cancels children; child Stop leaves its parent running. Persisted advisory scope prevents independent Retry/Interrupt across restart/parent unlinking. Board details label advisory scope, hide independent rerun controls and link to a listed parent. Reports remain unverified advice, not external verification or approval. **TypeScript checking, Swift release compilation and static source/security/diff review pass; no tests added/run, runtime migration, provider/model calls, app/gallery/live checks.** Installed app unchanged; ADR-160–164 local/uncommitted on main after 2fe2250; graphify-out preserved, known CI failures deferred. General shell, built-in hosted search, tool-enabled/recursive children and omitted browser operations remain separate. [Scope and limits](docs/codex-advisory-workers.md).

Implemented ADR-163: Codex browser-granted non-think workers now have bounded navigation, text snapshots and form interactions in ATOM's existing per-worker Chromium profile. Native profile/site/plan checks and fresh interaction cards govern operations; exact returned/current refs, URL/target refresh after approval and checked redirected origins narrow stale actions/disclosure. Existing password/unknown-field cards and external-data taint apply. Stop/current-grant revocation closes owned connections without retry; external outcomes after interrupted dispatch remain unknown. Uploads, screenshots, tabs, dialogs, selectors and page code are outside scope. **TypeScript checking and static source/security/diff review pass; no tests added/run, browser/server startup, adapter/network/provider calls, migration or app/live acceptance.** No Swift changes/build; installed app unchanged. ADR-160–163 local/uncommitted on main after 2fe2250; graphify-out preserved, known CI failures deferred. Next: bounded nested-worker design; general shell/built-in search remain separate. [Scope and limits](docs/codex-browser.md).

Implemented ADR-162: Codex non-think workers can discover and call tested, enabled MCP servers assigned to them through checked host SDK tools. Live discovery intersects saved tested names; calls refresh the exposed definition and pass current grant/configuration, plan and trust/one-call approval checks. Argument cards use bounded redacted previews; external results/unknown dispatched outcomes require fresh approval for later external calls. Task-owned connections, including idle sessions, close on Stop/revocation; external effects are not rolled back and unknown outcomes never auto-retry. Bounded text/structured results only. **TypeScript checking and static source/security/diff review pass; no tests added/run, MCP server startup, adapter/network/provider calls or app/live acceptance.** No Swift changes/build in this batch; installed app unchanged. ADR-160–162 remain local/uncommitted on main after 2fe2250, with graphify-out preserved. Existing CI failures remain deliberately deferred. Next: browser adapter design; general shell/scripts/builds/tests, built-in hosted search and nested workers remain separate. [Scope and limits](docs/codex-external-mcp.md).

## Current verification baseline (2026-10-18)

Implemented ADR-161: Codex project folders workers gain read-only ProjectCommand inspection (pwd/ls/cat/wc/head/tail/grep) through fixed argv and a separate explicit Codex sandbox profile. Current project/task admission, native classifier/plan/read gates, path/secret checks, attempt/operand/output/time limits and process-group cancellation apply. No general shell, scripts, builds/tests, project writes or native shell enablement. **TypeScript checking/static review pass; no tests added/run, adapter/provider/app/live acceptance.** No Swift changes in this batch; preceding ADR-160 release compilation passed. Installed app unchanged; ADR-160/161 local/uncommitted on main. Existing CI remains failed and deliberately deferred. [Scope](docs/codex-project-inspection.md).

Implemented ADR-160: workers have a separate Codex model pin/picker, backed by additive helper storage. Host validation uses offered Codex models at save/task admission; unavailable pins refuse without fallback, clearing restores the chat's Codex model, and changes apply only to later Codex tasks. Claude pins/provider choice and execution permissions are unchanged. **TypeScript checking, Swift release compilation and static diff review pass; no tests added/run, migration/provider/gallery/app/live checks.** Installed app unchanged; local/uncommitted on main after 2fe2250. That pushed commit's CI remains failed (three TypeScript assertions and a Swift compiler crash); the user chose upgrades over CI repairs. Search remains a design gap; shell/browser/external MCP/nested workers are unsupported. [Scope](docs/codex-worker-models.md).

Implemented ADR-159: Codex research workers can read known public HTTPS pages through a bounded checked host adapter. Default-deny admission respects current global/project web configuration and worker/task state; two attempts per task, checked/pinned public IPv4 destinations, validated redirects, response/time/text limits and existing web-taint propagation. No search backend, browser session, native Codex network privilege or provider fallback. **TypeScript checking/static security and diff review pass; tests, adapter network calls, provider/app/live checks skipped by request.** No Swift changes/build; installed app unchanged. Local/uncommitted on `main`; historical totals do not validate ADR-141–159. Remaining Codex gaps include search, shell, browser, external MCP, worker pins and nested workers. [Scope](docs/codex-public-pages.md).

Implemented ADR-158: Codex workers can explicitly load assigned skill instructions through a bounded host tool; only successful returns count as use. Checked host calls populate the existing Board timeline with fresh ids, timing and generic outcomes, omitting file/skill bodies, edit payloads and plans. Main/worker capability descriptions no longer reuse Claude's unavailable shell/web contract. **TypeScript checking passes; static review only, no tests added/run or live/model/app checks.** No Swift changes/build in this batch; installed app unchanged. Local/uncommitted on `main`. Codex shell/web/browser/external MCP, provider-specific worker pins and nested workers remain unsupported. Historical totals do not validate ADR-141–158. [Scope](docs/codex-worker-capabilities.md).

Implemented ADR-157: foreground requests and question answers now retain local copies until durable host receipts; SQLite records accepted input before dispatch, accepted answers before model delivery, and normal completion atomically with the saved exchange. Restart holds interrupted attempts for review. Recovery inspects prompts/references/answers and completed reply parts, with explicit restore-to-draft and confirmed dismissal; repeated request ids do not dispatch a second model call. This does not reconcile external effects or preserve partial streams. **TypeScript checking and Swift release compilation pass; tests, migration execution, gallery, app launch, provider calls and live/crash/storage acceptance skipped by request.** Installed app unchanged; local/uncommitted on `main`. Historical totals do not validate ADR-141–157. [Scope and limits](docs/foreground-recovery.md).

Implemented ADR-156, the reading/work-visibility batch: monotonic foreground elapsed time, folded tool observations, bounded main-chat clarification cards and a read-only Access summary. Claude/Codex successful turns save question answers with the user message for restart/provider continuity; failed/cancelled answers and work logs remain transient. Cards never create grants or answer approval requests. Tool rows omit arguments/results and exclude background-worker history. Access reports last-inspected configuration, not unrestricted access. **TypeScript checking and Swift release compilation pass; tests, gallery, app launch, provider calls and live acceptance skipped by request.** Installed app unchanged; local/uncommitted on `main`. Historical totals do not validate ADR-141–156. [Scope and limits](docs/chat-work-visibility.md).

Implemented ADR-155, the user-requested conversation-controls batch: saved-history paging; edit/retry in a new chat with an unsent draft; transactional fork creation with request deduplication; persistent pin/archive and version-checked Undo. Archived native chats refuse new window text/voice turns, and shared-writer chats cannot be archived here. Saved context is a fresh replay byte estimate, not provider token telemetry. Claude's reported reset/limit state is surfaced with a prepare-for-later draft action; no automatic retry. Manual Compact remains unavailable in the current gateway. **TypeScript checking and Swift release compilation pass; tests, gallery, migration execution, app launch and live checks skipped by request.** Installed app unchanged; local/uncommitted on `main`. Historical totals do not validate ADR-141–155. [Scope and limits](docs/conversation-controls.md).

Implemented ADR-152–154, the user-requested final primary chat batch: Find in loaded chat messages (Command–F), checked project-path Finder chips/local links, and cancellable project-file @ search inserting relative references. Shift–Command–F retains global search. Find pauses follow and resets on chat replay; project navigation reads metadata only and grants no model access. **Tests, gallery, app launch and live keyboard/Finder/VoiceOver/security checks skipped by request.** Release compilation/static review only; installed app unchanged. Historical totals do not validate ADR-141–154. All 16 primary C/B/R items now have scoped implementations; this is not passing live acceptance or completion of the broader roadmap. [Scope](docs/chat-find-and-project-files.md).

Implemented the user-requested ADR-149–151 batch: Command–V hidden-control cleanup and long-paste text attachments, plus Reply to this for finished replies. Other composer paste/input routes receive hidden-control review before sending. Long-paste files are durable/owner-only, never auto-sent and respect the existing project-chat attachment restriction. **Tests, gallery, app launch and live clipboard/Undo/IME/keyboard/VoiceOver checks skipped by request.** Release compilation/static review only; installed app unchanged. Historical totals do not validate ADR-141–151. 13 of 16 primary chat-plan items now implemented; R2/R3/R5 remain, with the limitations documented in [scope](docs/chat-paste-and-quoting.md).

Implemented ADR-148 / B3: composer file chips show asynchronous thumbnails with icon fallback and open Quick Look on Preview. Remove remains separate; the row scrolls horizontally. Missing/unreadable files show a preview notice; removed/chat-switched views dismiss preview and invalidate thumbnail requests. **Tests, gallery, app launch and live preview/keyboard/VoiceOver checks skipped by request.** Release compilation/static review only; installed app unchanged. Historical totals do not validate ADR-141–148. [Scope](docs/chat-attachment-previews.md).

Implemented ADR-147 / R1: chat scrolling follows content growth only while at the end, pauses when reading older messages, and provides Scroll to end below the transcript. Chat changes/replays resume following; ordinary turn updates no longer call unconditional scrollTo. **Tests, gallery, app launch and live scrolling/keyboard/VoiceOver checks skipped by request.** Release compilation/static review only; installed app unchanged. Historical totals do not validate ADR-141–147. [Scope and remaining acceptance](docs/chat-scrolling.md).

Implemented ADR-146 / C5: long user messages have a collapsed preview and Show full message / Show less. Copy full message always uses the original transcript; history, model context and retry text are unchanged. **Tests, gallery and live UI/copy/accessibility checks skipped by request.** Release compilation/static review only; installed app unchanged. Historical test totals do not validate ADR-141–146. R1 scroll-following has not started. [Scope](docs/chat-message-collapse.md).

Implemented ADR-145 / C4: native quotes, horizontal rules, nested/task lists and code-language labels, with corresponding plain/rich clipboard output. Task states are display-only and code is not executed. Parsing is limited to 16 nested levels, retaining deeper source as text. **Tests, gallery and live rendering/copy/accessibility checks skipped by request.** Release compilation/static review only; existing parser expectations adjusted but unexecuted; installed app unchanged. Historical test totals do not validate ADR-141–145. C5/R1 have not started. [Scope](docs/chat-markdown.md).

Implemented ADR-144 (item 1 / C2): reply Copy offers Markdown/plain/rich formats; user messages have Copy; main-window Edit → Copy Last Reply (⌘⇧C) copies the latest finished reply only when the Chat window is active. Markdown is the reply/shortcut default; rich HTML is now explicit, while table defaults remain Markdown+HTML. **Tests and live clipboard/keyboard/VoiceOver checks skipped by request.** Release compilation/static review only; installed app unchanged. Historical test totals do not validate ADR-141–144. Item 2 has not started. [Details](docs/chat-copying.md).

Implemented ADR-143 (chat C1/C3): code and table blocks have persistent copy controls; tables export Markdown+HTML, TSV or CSV. Whole-reply Copy stays visible, with named accessibility actions and labelled message groups. Core table parsing retains alignment/escaped pipes for export. **Tests, gallery, clipboard pasting and keyboard/VoiceOver acceptance skipped by request.** Release compilation/static review only; one existing parser expectation updated but unexecuted; installed app unchanged. Historical test totals do not validate ADR-141–143. [Scope](docs/chat-copying.md).

Implemented ADR-142: follow-ups remain separate in an ordered queue, each with its own text/attachments, Edit and Remove. Return queues while busy; Command–Return sends the oldest live entry now. Stop/failure/navigation/restart hold all remaining entries for review. Snapshot version 2 retains order and accepts version-1 single messages. **Tests, gallery and live acceptance skipped by request; existing queue expectations updated but unexecuted.** Release compilation/static review only; installed app unchanged. Prior test totals do not validate ADR-141/142. [Details](docs/chat-input-recovery.md).

Implemented ADR-141: native chat drafts and waiting input now persist locally, shared by the panel and window. Restored queues wait for review rather than send automatically; saved input in other chats is reachable from the composer. Attachment references are retained, with missing files refused before send. **Tests, gallery and live acceptance were skipped at the user's request.** Release compilation/static review only; the earlier test totals below are historical baselines and do not validate these Swift changes. The installed app has not been replaced. [Scope and limits](docs/chat-input-recovery.md).

Implemented ADR-140: Stop cancels that task’s host approval immediately, even before SDK task-id delivery; late/cached decisions and answer-continuation races cannot create grants or allow stopped calls. Window task/retry activity now returns the header to Ready when work ends without overriding foreground work or another live approval. Real native Stop and signed-in Codex retry-completion checks passed on one fictional file; no restart was needed to clear Thinking. [Evidence](docs/task-state-lifecycle.md).

Implemented ADR-139: interrupted attempts retain their last step and wait for review; retries persist one linked attempt before dispatch. Real signed-in Codex recovery passed on the fictional two-file fixture: backend interruption after the first save, recovered card/last step/checkpoint, explicit retry on Codex, first file skipped unchanged, separate approval and save of the second file, completed report and one child attempt. The live check found and fixed loss of a new chat's model choice before its first answer; pending choices are now durable without inventing a transcript. This does not provide generic exactly-once edits or a main-chat turn journal. The stopped Claude approval-card and stale Thinking limitations are now resolved by ADR-140; Codex tool-call timeline entries remain separate. [Scope and evidence](docs/task-recovery.md).

- `pnpm typecheck` passes. full TypeScript suite: 1,063 passed, zero failed, eight model-dependent tests skipped using `--test-concurrency=2`; includes Local API/phone, recovery/provider persistence, task cancellation/grant races and window state coordination. Reduced concurrency avoids the previously observed Telegram timing flake; no production Telegram change in this task.
- `pnpm island:test`: all 733 tests in 134 suites pass, including interruption decoding, attention counts and retry linkage as well as the earlier diff/edit/search checks.
- `pnpm island:build` builds the release app and Calendar helper and signs ATOM with the local identity. The recent Swift features now compile; earlier "not compiled" entries below are historical. The build reported two existing Swift warnings in `IslandSettings.choice` and the dropped-command callback in `main.swift`.
- `pnpm test:visual`: 75 gallery images render and all 12 golden comparisons pass. Interruption cards and file-permission cards render across themes and were inspected. No golden was changed for recovery. The earlier model-settings reference update, Dashboard and fixed-date gallery fixes remain.
- The earlier baseline `pnpm island:ui-check` passed startup/window rendering, and Board’s file-specific Allow for chat choice saved the fictional Cedar fixture. The current recovery build and offscreen gallery pass. After unlocking the Mac, the rebuilt app opened in Ready state and Board → Needs you rendered normally with zero pending, failed or running jobs. The real Codex interruption/review/retry fixture now passes as described above.
- No lint script or coverage gate is configured. Coverage was not measured in this pass. The full suite skips eight opt-in model tests. The focused Codex file workflow passed separately on 2026-10-17; the new signed-in history-recovery check also passed separately on 2026-10-18 (one test, no skips, about 12.5 seconds); the recent features' complete UI acceptance is tracked below.

Implemented ADR-135–137 after the continuity investigation: full archived chat/project history, explicit continuing permission for one file in one chat with inspection/revocation, Codex host tools and real file-agent tasks, and text editing routed to the active chat's provider without fallback. Store/policy/protocol, actual local file operations over scripted Codex RPC, cancellation and provider-routing regressions pass. A new command test also confirms grants can be inspected/revoked without a model call.

Real signed-in Codex now passes the Core/router workflow: first delegated fixture edit, Cedar/Wednesday recall, later rewrite, one explicit grant, two completed jobs and six archived messages (51 seconds, one test, no skips). The earlier account-limit blocker is cleared. The real UI also passed the Board approval click, subsequent recall and a later rewrite without another approval. A fresh worker also rewrote it after a real app restart; inspect/revoke and the renewed card/Decline passed, leaving the file unchanged. The Codex note edit → review → save → reopen workflow passed. The physical quick-action → Codex grammar diff → Accept all → Replace in TextEdit workflow also passed, with the actual corrected document verified. All three everyday fixture workflows pass. The additional live password-field refusal passed using a native secure field containing fictional text: ATOM showed its refusal and no action buttons. This does not claim coverage of every browser/custom password control. Details are in `docs/everyday-workflows.md`. Codex workers currently lack shell/web/browser/external MCP, assigned Claude skill plugins, worker model pins and nested workers. ADR-138 now bounds replay and adds own-chat retrieval; it cannot recover previously discarded turns. Provider context limits still apply beyond the conversation replay budget.

Implemented ADR-138 (2026-10-18): full archive plus a bounded 48,000-byte conversation replay window, read-only literal own-chat search and 8 KiB original-message paging for Claude/Codex. Window growth retains Codex's prefix until the next advance. A real signed-in Codex run recovered an initial launch day/time omitted from the model context after reopening; scripted Claude/Codex tests cover provider changes, long-message reconstruction, shared-chat catch-up, preserved archives and isolation. Tool-free providers get an omission notice. This is a byte budget, not an exact token meter or a bound on system/tool/native session context. No new Swift/UI changes in this capability; the signed native build, 731 Swift checks and 72-image/12-golden results above are the previous verified baseline. Details: `docs/long-chat-history.md`.



The combined upgrade plan is saved in `docs/upgrade-roadmap.md`. A fresh source review of T3 Code at `f96aebeb4bbdaf2b3d05177bd115dad4b8b41a8b` is in `reference/t3code-second-review-2026-10-17.md`. It corrects old provider/billing/secret-storage notes and adds bounded own-chat history retrieval and durable work/input recovery as priority candidates. The review is static source evidence, not a passing live T3 Code test. It implements no product feature and leaves existing deferrals in force.

---

Phase 1 (Memory) has started at Keshab's request, with Phase 0.5's hands-on checks deferred, not dropped. Task 1.1 (ADR-058): ZENO keeps facts the user asks it to remember in a local SQLite file, uses them in every request, and forgets them on request; Settings → Memory lists and deletes them. Checked live in text on the Claude plan, across a restart. Task 1.2 (ADR-059): ZENO notes each conversation in two sentences in the background so a new one can pick up the thread, and offers to remember facts mentioned in passing. Task 1.3 (ADR-060): Calendar and Reminders through an EventKit helper inside ZENO.app; read the schedule, list reminders, add one. Task 1.4 (ADR-061): timers, spoken and shown when they end. Task 1.5 (ADR-062): weather. Task 1.6: answers 4–6 s instead of up to 19 s (thinking off, weather cached), and typing to ZENO in the Conversation tab. Next: Keshab allows Calendar and Reminders when macOS asks, and tries all of it by voice.

Keshab's end-to-end check (Task 0.5.9, 2026-10-03): talk, follow-up, interrupt, dictation, Settings and the Decline card all passed. Opening the panel made Wisp jump, and pointing near corners had no room for the bubble, so ADR-056 gives each part a fixed home: the panel hangs under a new menu-bar icon, Mac work shows in a strip above the Dock (step, Stop, Allow/Decline), and Wisp only points with a short label (Task 0.5.10). It is built and tested (301 Swift tests) but not yet seen on screen, because the Mac was locked. Next: Keshab's live look at 0.5.10, then pointing by voice.

Next idea, planned and not started (2026-10-05): shortcuts, so plain commands skip the model (ADR-071, Task 2.x); waits for Keshab's starting list.

Built (2026-10-10): a read-only `front_window` tool that gives the front app, plus the page title and address in Chrome, Arc, Edge and Brave, with no Accessibility (ADR-072, Task 2.y; idea from Coucou, MIT). It is on by default, and Safari gives its name only. Tested and read once on the real Mac from the terminal; not yet tried by voice. Task 2.x (shortcuts) still waits for Keshab's starting list.

Planned, not started (2026-10-10), ideas from Coucou (MIT): Wisp notices you, with eyes that follow the pointer and small reactions to clicks (ADR-073, Task 2.z; built and tested, not yet seen on the real screen), and dropping Wisp on a window with Option held to ask about it (ADR-074, Task 2.w; built and tested, not yet tried on the real screen). Both accepted as proposed. Task 2.w also waits for ADR-067's voice check. Keshab will do the voice checks (Task 2.y, ADR-067) later. Shortcuts (ADR-071, Task 2.x, 2026-10-10): built and tested with Keshab's list (open settings, open an app, play/pause, search YouTube or Google); not yet tried by voice.

Planned (2026-10-10): Phase 4, the Lantern redesign (ADR-084): one look grown from Wisp, rolled out screen by screen; 4.1–4.9 built and tested (colours and motion, menu-bar Wisp, header and tabs, Settings with "now", conversation, open and close, bubble, work strip, Helpers window); then the Void theme (ADR-086, flat black after Resend's style) became the default; avatars waiting for Keshab's images; 4.10 sounds not started.

Planned (2026-10-10): Phase 3, Helpers (ADR-081, revised by ADR-082): Wisp manages a team of seven workers with roles and souls (Sid researcher, Kame coder, Puff designer, Quill documenter, Penny financial information, Hana HR, Tinker improver), folder grants, skills, and Tinker proposing improvements you approve. Task 3.1 (store and Helpers window) built and tested, not yet opened on the real screen; 3.2 (jobs run: Sid researches on the Claude plan) built, tested and run once live; 3.2b (Laya chooses each job's model, ADR-083) built and tested, Laya checked live; 3.3–3.9 not started.

Planned (2026-10-10): orchestration after Paperclip (ADR-087): tasks with blockers and a task board, Wisp delegating a task tree, wake-ups and memory across runs, budgets, plan-first approval, routines, hand-offs between workers, and last an optional connection to a Paperclip Keshab installs himself (loopback only). Tasks 3.4–3.16 replace the earlier 3.4–3.9; 3.3 (souls) comes first. Then 3.17–3.22, each after its own ADR: companies and logins, a secrets manager, cloud sandboxes, team templates, a mobile web app, Codex and Hermes as workers. Task 3.3 (the team of seven and their souls, editable with versions) Task 3.4 (tasks that wait for each other, a board and a thread per task) , Task 3.5 (Wisp the manager: the `delegate` tool, "Sid, …" by voice, the combined report and one spoken line) , Task 3.6 (wake-ups and resumed sessions, "Start fresh") , Task 3.7 (daily budgets per worker and team, a plan limit) , Task 3.8 (plan first, approved by voice, card or window) , Task 3.9 (routines: daily, weekly or every N hours, one catch-up, overlaps skipped) , Task 3.10 (hand-offs between workers, checked in code) , Task 3.11 (folder grants; Kame, Puff and Quill in their folders, sandboxed, on their own branch, never pushed) , Task 3.12 (skills per worker) , Task 3.13 (ratings; Tinker's soul proposals, accepted, rejected or undone) , Task 3.14 (open a report in the worker's app) , Task 3.15 (workers at work on the island card; Wisp flies over with the team's line) , Task 3.16 (an optional, loopback-only connection to Keshab's own Paperclip) and new agents with their own roles, kits and soul.md (ADR-088) are built and tested (2026-10-11), not yet tried on the real screen or by voice.

Built (2026-10-11): one ZENO window and Pal (ADR-089): Wisp is now Pal, with eight premium characters drawn from JSON (Pal from Keshab's Strobi copy), and chat, board, team and settings in one window with a sidebar. Then ADR-090, after OpenMausBot and munder-difflin: an Overview page (counts, who is at work, goals, budget and plan use), a Needs you inbox, Issues with Retry (one automatic retry for failures a second try may fix), Plugins (MCP servers per worker: saved off, tested, every call asks on Pal's card unless trusted; skills at a glance), and an office floor on the Board (pals at desks or in the lounge, Pal at the manager's desk, envelopes on hand-offs). All built and tested; not yet tried on the real screen, and no real MCP server added yet.

Built (2026-10-11): ADR-092: ZENO runs on Keshab's Claude plan only (Gemini and the Claude API removed); published as a source release (v0.9.0), no app binary.

Built (2026-10-11): ADR-091, after Keshab's look at the window: roles instead of "No app", renaming pals, a top bar, the floor fitting the window, chat sound switches; macOS notifications (needs you, done, failed, budget and plan use); tokens recorded for every run and chat answer with a Dashboard; chats saved and listed in the sidebar in place of the team (the team moved to the Board); the team's git branches like pull requests with Push on his confirmed click; and an app icon. All built and tested; not yet tried on the real Mac.

Built (2026-10-12): ADR-095 packages 1–2: tasks run in parallel (Runs at once 1–10 in Settings, default 6; several tasks per worker), Pal is called ATOM on screen and in speech, and Managers (one per domain, "plans and reviews" or "group only") with Agents under them, on the Board, the floor and in Needs you. Built and tested; not yet tried on the real screen.

Built (2026-10-12): ADR-095 package 3: Sub-Agents: an Agent's run may start up to 4 helpers inside its own Claude Code run (searcher and reader for web work, coder and checker for folders), each with no more than the Agent's own tools, grants and skills; their cost counts toward its budget, and the task's thread lists them with their state and short result. ADR-095 is done. Built and tested; not yet tried with the real Claude Code.

Built (2026-10-12): ADR-096: the ZENO window has Back (the arrow, ⌘[ and the mouse back button) and a Save button on each typed field. Leaving with unsaved edits asks first. It builds; no tests ran, and Keshab has not tried it yet.

Built (2026-10-13, finished 2026-10-14): ADR-110 Phase N1, the native engine: with `ATOM_ENGINE=native`, each chat keeps one long-lived Claude Code session, so later turns read the prompt and tools from the cache. Off by default. Built and tested with a fake SDK; one small live probe (plain prefix 2.3k tokens, project 4.6k). Not yet tried in the real app.

Built (2026-10-14): ADR-110 Phase N2: with `ATOM_ENGINE=native`, ATOM's workers are Claude Code sub-agents with Board rows, kit and grant checks in hooks, and Bash only in project chats. Built and tested with a fake SDK; one live probe ran a Sid task end to end (prefix 3.8k plain, 5.7k project, 2.5k sub-agent). Not yet tried in the real app.

Built (2026-10-14): ADR-110 Phase N3: with `ATOM_ENGINE=native`, a later reply from an agent is spoken in the voice chat (not in a Quiet chat) and sent to Telegram for its chat. Routines and local API goals are main-agent turns, and the Board shows each agent's model. Built and tested with fakes. Not yet tried in the real app.

Fixed (2026-10-15), after Keshab used the app: Settings pages go back with the top-bar arrow. The window chat draws Markdown (tables, lists, code) and copies a table as HTML. A message typed in the window may get a structured reply; voice replies stay short and plain. Job token counts were too high (one message counted two or three times); new rows are right. `test:live` ends and passes. Built and tested (836 TypeScript, 584 Swift tests). Keshab tried the app by hand before these fixes; he has not yet tried the fixes.

Built (2026-10-15): ATOM's design system as an Open Design package (`design/atom-design-system/`) with a test against drift from the Swift themes, spacing on a 4 pt grid, keyboard focus restored on the sidebar rows, and a design review (`docs/design-research.md`). Next: the Dashboard's hierarchy, then the five states per page.

Fixed and built (2026-10-15), after Keshab's try of the Daylight build: the Chats list loads when the runtime is ready; the composer's voice button has its own corner and the model menu moved left; the Skills menu is names only; Plugins → Skills is a dropdown with an editor (ADR-114). Built and tested (588 Swift tests, 424 TypeScript tests in `apps/mac`); not yet tried by hand. The sidebar pages are draggable (any order, top or bottom group), and only the Chats list scrolls (2026-10-15; tested with a real drag). Second brain has a HUD look and Memory is its second tab (Settings → Memory is gone). MCP servers are added by pasting the Claude Desktop JSON, or one click to import its config file (ADR-115; saved switched off as before). The playground batch is done.

Built (2026-10-15): a new theme, Daylight (Settings → Appearance): Void's flat look in light, from Keshab's UI playground. Void stays the default. Built and tested (585 Swift tests); not yet tried on the real screen. Next from the playground: the sidebar order and compact rows, then the chat, then browser automation.

Fixed (2026-10-15): skills that improve themselves (ADR-094 A) had no trigger in the native engine, because nothing recorded which skill a task used. An agent's `Skill` call is now recorded, so a failed or badly rated task asks Tinker for an edit to that skill, and Keshab decides. Built and tested; not yet tried live (no ATOM skill has been used by an agent yet).

Built (2026-10-14): ADR-110 Phase N4: budgets, the plan limit that ATOM set and "Runs at once" are gone in both engines. Tasks start at once and wait only for Keshab (a plan to approve, an interrupted run). Old budget rows stay in the database, unread. Built and tested. Not yet tried in the real app. Phase N5 not started.

Built (2026-10-14): ADR-110 Phase N5: `native` is the only engine and the legacy engine, the job runner, Managers, team tasks, wake-ups and the Codex fallback are deleted. Typecheck is clean; no test ran. Not yet tried in the real app.

Built (2026-10-14): ADR-111 work plans (a big goal split across specific agents; code keeps the order and writes each brief), ADR-112 the second brain (linked notes and a graph), `search_chats`, `propose_skill`, an audit log, and a UI pass (Stop, Copy, Try again, New chat). Quality pass the same day (`revise-task.md`): dead code removed, more tests; the whole TypeScript suite passes in the cloud (815 tests). All Swift is uncompiled. Not yet tried in the real app.

Built (2026-10-14): ADR-113: a chat keeps its context when the provider changes (Claude, Codex, Gemini CLI), files can be attached to a message (text, code, PDFs, images), skills work in a chat (`/name`, the Skills menu, `use_skill`), and the model menu sits next to the input. TypeScript tested; Swift not compiled; not yet tried in the real app.

Planned (2026-10-10): four polish batches taken from Clicky, Coucou and a review of ZENO's setup: setup and errors (ADR-075, Task 2.A; built and tested, not yet tried on the real Mac), everyday polish (ADR-076, 2.B; built and tested, not yet tried on the real Mac), Wisp and voice polish (ADR-077, 2.C; built and tested, not yet seen on the real screen), Wisp's home display (ADR-078, 2.D; built and tested, not yet tried on two displays), settings tidy-up (ADR-079, 2.E; built and tested). Pointing from a screenshot (ADR-080, 2.F): built and tested, Cua only (main display), so it needs computer control on; not yet tried by voice.

---

## 1. Product

### Name

ZENO

### Positioning

> ZENO — The Intelligence Layer for Your Digital World.

---

## 2. Current Stage

### Architectural / Foundation Stage

The product architecture and development philosophy have been defined.

The implementation priority is now Phase 0.

Progress: **Phase 0 is complete (2026-10-02).** All tasks 0.1–0.11 are done; the voice loop was verified by the user speaking into the real microphone and by the live test suite (history: `docs/phase-0-tasks.md`). Open items from Phase 0: Claude live check (needs Anthropic credits); Gemini free-tier quota (about 20 requests per day).

**Current phase: Phase 0.5 — Desktop Island** (ADR-033 to ADR-042), planned 2026-10-02. Task 0.5.1 is done: the project now lives at `~/Developer/zeno`, outside iCloud. Task 0.5.2 is done: the runtime can be driven over JSON lines (`main.ts --island`, `docs/island-protocol.md`). Task 0.5.3 is done: `ZENO.app` (`pnpm island:build`) runs as a background app and supervises the runtime: starts it, restarts it after a crash, stops it on quit. Task 0.5.4 is done: a panel hidden above the top-centre that slides down on hover. Keshab then redirected the design: the top-centre is crowded by other apps, so the island moves to the left edge below the menu bar (ADR-037), and it gets real content: a live state with a level meter, and an expanded view with Conversation, Status and Settings (AI provider and model) in dark glass (ADR-038). Task 0.5.4b is built: a dark glass card at the left edge below the menu bar, showing ZENO's state with the model name and a live waveform while listening; it comes out by itself during a turn and for problems. Keshab then asked for settings inside the island, changeable shortcuts, FluidVoice-style dictation and a walking pet (ADR-039 to ADR-042). Tasks 0.5.5 to 0.5.8 are built (settings, shortcuts and signing, dictation, the pet). Dictation (ADR-047) runs inside the app with Parakeet and Right ⌘ + Right ⌥, and Keshab finds it satisfactory for now. ADR-053 changed hiding from a 90° sideways pose to a 35–50° lean with a hand on the edge (255 tests). ADR-052 added Wisp, speech bubble and panel controls to Settings (size, glow, movement, nap, bubble stay, panel size and background, with a reset; 252 tests). ADR-051 then made Wisp hold the island: no left-edge card while Wisp is on, a click on Wisp opens the features panel beside it, and Wisp tucks to a side edge after an idle timeout (built, tested and measured on screen; waits for Keshab's look). ADR-050 adds tap-to-start modes, a live preview, "um" removal and Wisp's speech bubble (built and tested; Keshab likes them and closed the rest of the FluidVoice list, so dictation is finished unless he asks for more). The voice conversation is switched off while dictation and speech are tuned (`ZENO_VOICE_ONLY=1` is a test mode that skips the AI). Next: Task 0.5.9 (End-to-End Island Test), which needs the conversation on.

---

## 3. Current Phase

### Phase 0.5 — Desktop Island

Target:

```text
Ctrl+Option held (any app)  /  pointer at left edge
    ↓
ZENO Island (Swift, apps/mac/island)
    ↕ JSON lines over stdin / stdout
ZENO runtime (Phase 0, apps/mac/src)
    ↓
Microphone → Whisper → Core → LLM Gateway → LLM → Kokoro → Speaker
```

### Next: Phase 1 — Memory (started 2026-10-04, Task 1.1 built)

### Completed

- Phase 0 — Voice Foundation (2026-10-02)

---

## 4. Current Architectural State

The following concepts have been defined:

- ZENO Core
- Identity
- Context
- Deterministic Router
- Decision Engine
- Laya / Jev integration point
- LLM Gateway
- Memory
- Knowledge
- Capability System
- Capability Manager
- Device Registry
- Device Manager
- Policy Engine
- Tasks
- Events
- Multi-device architecture
- Multi-user architecture
- Team knowledge
- Cloud architecture
- Provenance
- Observability

These are architectural definitions.

They do not necessarily mean all corresponding software modules currently exist.

---

## 5. Phase 0.5 Required Components

The current phase requires:

- a runtime mode driven by JSON lines over stdin / stdout
- the island app (Swift), which starts and supervises the runtime
- the hidden panel with hover reveal
- global push-to-talk (Ctrl+Option)
- live status, transcript and reply in the panel
- an expanded conversation view
- permission guidance (microphone, Input Monitoring)

Phase 0 components (microphone, Whisper, Core, LLM Gateway, providers, Kokoro, configuration, logging, error handling, tests) are built and reused unchanged.

---

## 6. Explicitly Deferred

The following remain future work (Phase 0.5 deferrals are listed in TASK.md):

- automatic memory (summaries, extraction without being asked), embeddings
- RAG
- knowledge graph
- team knowledge
- multi-user system
- cloud synchronization
- iOS node
- Windows node
- Mac computer control
- capability acquisition
- autonomous agent system
- multi-agent architecture
- Kubernetes
- microservices
- local general-purpose LLM
- Ollama

---

## 7. Architectural Decisions

Current major decisions:

- ZENO is a system, not a chatbot.
- LLM providers are replaceable.
- Voice processing can be local.
- General reasoning initially uses remote models.
- Ollama is not required.
- Deterministic routing comes first.
- Decision Engine is optional.
- Decision Engine is replaceable.
- Initial architecture is a modular monolith.
- Devices are nodes.
- Permissions are deterministic.
- Capabilities define controlled actions.
- Least privilege is mandatory.
- Knowledge is independent from the LLM.
- Memory is independent from conversation history.
- Provenance is important.
- Tasks and events are distinct.
- User should not need to select execution device.
- Phase 0 must remain small.
- Future architecture should not force premature implementation.

Phase 0 technical choices (ADR-026 to ADR-030):

- TypeScript / Node.js, pnpm workspace
- Push-to-talk input
- Claude as the first provider
- Kokoro-82M on ONNX (local) for TTS
- Session-only conversation history, nothing saved to disk

Later Phase 0 changes: Gemini as a second provider (ADR-031); Whisper small.en with a vocabulary prompt (ADR-032).

Phase 0.5 decisions (ADR-033 to ADR-042):

- A desktop island comes before Memory
- Native Swift app for the island; the Node runtime runs as its child process, talking JSON lines over stdin / stdout
- Hold Ctrl+Option to talk, from any app (listen-only key reading, Input Monitoring permission)
- The panel hangs below ZENO's menu-bar icon (ADR-056; was the left edge, ADR-037, then beside Wisp, ADR-051); ZENO's work on the Mac shows in a strip above the Dock
- Compact view: live state and level meter; expanded: Conversation, Status, Settings (provider and model); dark glass (ADR-038)
- Three looks, chosen in Settings → Appearance (ADR-057): Theme (Quiet Native, Luminous, Warm) for every surface and Wisp (Ghost, Orb, Companion), independently; text contrast tested in every theme

---

## 8. Phase 0 Definition of Done (met 2026-10-02)

Phase 0 was complete when:

```text
User speaks
    ↓
Microphone captures audio
    ↓
Whisper transcribes
    ↓
ZENO Core receives request
    ↓
LLM Gateway routes request
    ↓
Remote LLM responds
    ↓
ZENO receives response
    ↓
TTS generates audio
    ↓
Speaker produces response
```

The complete loop must be tested and observable.

---

## 9. Development Order

Phase 0.5 order: Tasks 0.5.1 to 0.5.8 in TASK.md, one at a time.

Phase 0 order, completed:

```text
0.1 Repository Foundation
        ↓
0.2 Configuration
        ↓
0.3 Audio Input
        ↓
0.4 Whisper Adapter
        ↓
0.5 ZENO Core
        ↓
0.6 LLM Gateway
        ↓
0.7 First Remote Provider
        ↓
0.8 TTS
        ↓
0.9 Voice Loop
        ↓
0.10 Error Handling
        ↓
0.11 End-to-End Test
```

Only one task should be actively implemented at a time.

---

## 10. Development Rule

Think about the entire system. Build only the next piece.

The existence of future architecture does not authorize implementing it early.

---

## 11. Current Success Criterion

The immediate goal is not to build the entire ZENO platform.

The immediate goal is:

> Build a small, reliable voice intelligence loop that can become the foundation of the larger ZENO system without requiring a rewrite.

---

## 12. Next Action

The code is built through ADR-105 (2026-10-13), the rename of ZENO to ATOM.

Next, in this order:

1. Keshab does the hand checks of built work. The tasks marked "not yet seen" or "not yet tried" in TASK.md list them. After the rename, Keshab grants the macOS permissions again for the new app.
2. The folder and repository rename happens later. Then the `ZENO_*` fallback goes.
3. B3.3 (WhatsApp) is skipped. B3.6 (smaller gaps: image and video generation, remote terminals) is open.

Older steps are in TASK.md.

---

## Final Principle

> Build the smallest system that can become the larger system.

**ADR-089 (2026-10-11):** Wisp is now Pal, in the app, its words and the code (saved settings keep their stored `zeno.wisp.*` names). Earlier entries above say Wisp as written then. Pal and every worker are now drawn from avatar definitions (Pal is Keshab's "Strobi copy"), and chat, the board and agents, and Settings are in one ZENO window.

## 2026-10-16: review and fixes

- Four rounds of read-only code review (runtime, helpers and gateway, security, Swift, tests and docs) found and fixed more than 60 problems. The list is in TASK.md ("Fixes from the code review", "Second review pass", "Third review pass") and in ADR-118 to ADR-120.
- Entries above about budgets, Managers, wake-ups and hand-offs are history: ADR-110 (N4 and N5) removed them.
- New: the Local API answers plans and retries only (ADR-120); Telegram sends are retried and have a how-to (`docs/telegram.md`); web searches are priced in the usage rows; WebFetch refuses local and private addresses.

## 2026-10-16 (later): what was built after the review

- **Phone page over Tailscale (ADR-121).** The Local API serves `/app` (chat, needs, tasks, goals, plan approvals) to Keshab's own tailnet; Host check, wrong-token lock, strict headers. How-to: `docs/mobile.md`. Phone chats are shared with the window.
- **Agents work in any folder (ADR-122, ADR-123).** One floor and three tiers for every agent: new files are free, changes to an existing file ask, delete and system-changing commands are refused; secrets, hidden folders, `~/Library` and important documents are never opened. After web text a session is tainted (self-change tools and long fetch addresses refused). Browser uploads ask each time.
- **Skills.** The self-improving loop works (skills an agent was given count as used when its task starts); `improve_skill` lets a chat propose an edit; the team prompt offers a skill after a good task.
- **Telegram.** Sender check (one person), backlog skipped on start, outbox retries, long messages resume, 401 and 409 wait five minutes. How-to: `docs/telegram.md`.
- **Tests and CI.** Smoke tests start a real runtime (`pnpm test`, `pnpm test:live`); the visual check (`pnpm test:visual`, `pnpm window:shot`); GitHub CI runs typecheck, TypeScript, Swift and visual (blocking) on every push.
- **Cleanup.** Dead Manager, wake-up and team-task code removed from the Swift app; `store.ts`, `Helpers.swift`, `Protocol.swift` and `IslandController.swift` split into cohesive files.
- Open items are listed in TASK.md ("Fourth review pass").
- **Design system page (ADR-124).** Settings → Design system shows the shared components (Showcase) and every token with value, Swift name and contrast (Tokens), in Void or Daylight. A test holds the page's catalog equal to tokens.css.
- **Chat box (ADR-125).** Shift+Return for new lines (up to 8, then scrolls), ⌘V attaches copied files and screenshots, ↑ brings back the last message, and every chat keeps its own unsent draft.
- **"@" in the chat box (ADR-126).** Type "@" to hand a message to a helper ("@Sid"), send a Second brain page with it, or pick a file.
- **Typing while ATOM answers (ADR-127).** Return makes the message wait for the answer ("Next", with Edit and Send now); ⌘Return sends at once.
- **Hide the sidebar (ADR-128).** ⌥⌘H, the View menu or the button hides the window's left panel; the choice is kept. Built and tested; not yet tried in the running window.
- **Edit review logic (ADR-129).** The code that compares two texts and lets you accept or deny each change is written and tested; nothing in the window uses it yet. The Swift is not compiled.
- **Search everything (ADR-130).** The sidebar search also finds Second brain pages, remembered facts, conversation notes, projects, agents, skills, routines and Settings pages. Nothing goes to a model. The Swift is not compiled; not tried in the app.
- **Remembering by itself (ADR-131).** After a chat, ATOM may show a quiet "Remember?" row above the chat box with a fact it noticed. It keeps the fact only when you press Remember. A switch in Settings → General turns it off. No tests; the Swift is not compiled; not tried in the app.
- **Daily brief (ADR-132).** Once a day ATOM can write a few short lines about your day: weather, events, reminders, finished tasks and what waits for you. It shows them as a card at the top of a new chat and on the Dashboard. It is off until you turn it on in Settings → General. No tests; the Swift is not compiled; not tried in the app.
- **Review view, Ask ATOM, quick actions, search keyboard (ADR-133, ADR-134).** Tinker's suggestions show as a diff. A note can be changed by asking ATOM. ⌃⌥K reads the text selected in any app and offers Summarize, Translate, Fix, Shorter and more, with Replace. ↑ ↓ Return work in the search list. No tests; the Swift is not compiled; not tried in the app.
