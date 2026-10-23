# Live everyday and developer acceptance — 23 October 2026

User requested actual app use for daily chat, developer work and computer tasks, plus a concrete path to an overall 8/10. This is a product walkthrough, not a Swift test-suite result.

## Environment and scope

- Running signed ATOM 0.5.0 built from `fafe567`; native UI operated through Cua. Existing selected main-chat model was Opus 5.5, thinking Off, Saved permissions. The delegated coder used the existing helper model selection.
- No production source change, rebuild, Swift suite or general TypeScript suite ran. The only executed code checks were the two tests in a deliberately broken fictional JavaScript project, run inside ATOM's Terminal and by its coder.
- Three fictional chats were retained. Daily: `97263cad-9415-4545-b439-16d33b0cfd0c`; developer: `8717c73d-e9c3-443a-9760-c683d551b716`; computer: `d2d95a1c-dfdb-4e79-a7da-6a0b78f72c92`.
- Added project `Cedar Live Acceptance` (`p-1a72854c`) at `~/Documents/ATOM-live-acceptance-vmh7kxvb/Cedar Numbers`. Its only remote is the adjacent local bare `handoff.git`, not GitHub. Its generated coder and task #31 remain for review. Existing projects were not used for code changes. No permanent cleanup was performed.
- Timings below are ATOM's displayed completed-work durations, not instrumented first-token measurements or statistical latency benchmarks.

## Daily chat — passed within this scope

1. Started a fresh chat. Fictional picnic: Friday, 14 apples, 9 pears, south gate. Asked for day and total without tools or saved memory. Correct answer: Friday, 23 fruit. Displayed work: 3 seconds, zero observed tool calls.
2. Corrected day to Saturday and consumed four apples. ATOM retained south gate and answered 19 remaining, including 10 apples and 9 pears. Displayed work: 1 second, zero observed calls.
3. Entered the exact unsent draft `UNSENT restart check: Cedar blanket stays in this draft.`, quit normally and relaunched the same bundle. Current chat, exact draft, project, Opus/Off/Saved permissions and original conversation were retained.
4. Replaced the test draft with a recall request. ATOM correctly recalled Saturday, south gate and 19 fruit after restart. Displayed work: 3 seconds, zero observed calls.
5. Opened Saved context details. It correctly distinguished archived replay, automatic summaries and permission authority, but the explanation was a dense technical block.

Test-driver mistake: an earlier fictional draft labelled UNSENT was accidentally sent when Return followed a menu interaction. This was not a spontaneous app send and is not counted as a draft-persistence failure. The separate exact restart draft above was checked unsent before and after restart.

Not established: long-chat summarization, standing fact memory/conflicts, cross-chat isolation, permission revocation or remembered write permission. This short chat cannot certify those paths.

## Developer work — core path passed, authority/reporting gap found

1. Registered the isolated local repository through New project → Local folder, then started its project chat. Project creation selected the sidebar filter while deliberately preserving the previously open chat; the UI explained that the current chat was outside the filter.
2. Ran `node --test fruit.test.mjs` in ATOM's Terminal. The deliberate subtraction bug produced one failure and one pass: `5 !== 23`.
3. Asked the project coder to inspect two files, change only `fruit.mjs` to addition, preserve tests, use checked editing, and **not commit or push**.
4. Task #31 changed the isolated worktree `data/worktrees/task-31`, not the original project. Its report said the original absolute-path edit was refused by worktree isolation. The report said both checks passed; its worker timestamps span about 12.6 seconds. Main-chat delegation initially displayed 10 seconds; that is not end-to-end completion time.
5. Final chat follow-up explicitly explained that the worktree held the fix and the original project still had the bug. This was useful and honest about file location. Initial inspection of only the project folder could otherwise have looked like a failed edit.
6. Dashboard → Git → Cedar Numbers → Show changes displayed exactly `return apples - pears;` → `return apples + pears;` and one changed file.
7. Independently ran both checks again in ATOM's Terminal after explicitly changing to the task worktree: two passes, zero failures. The test file remained unchanged. Both original project and task worktree ended clean.
8. Used ATOM's native Push confirmation for only `atom/task-31` to the owned local bare remote. UI showed Pushed; independent Git inspection confirmed the destination ref exactly matched `8f397e7e35ba982bc258d513c416dac133ca567c`. Original project main remained at fixture baseline `c1d4b5a`. No real remote, main branch or PR was modified.

**Confirmed gap:** the host automatically created commit `8f397e7` (`ATOM task 31`) despite the no-commit request. Both worker report and final chat said nothing was committed. The model's claim and host's actual effect disagree. Isolation is useful; automatic commit behavior must be exposed and reconciled with explicit user instructions. The branch review/push controls work but are far from the chat that initiated the task. Merge/apply-to-main and hosted PR/CI were not exercised.

## Computer tasks — correct result and uncertainty, weak speed/control discoverability

- Requested Calculator only: clear earlier contents, compute 27 × 13, observe the display and distinguish confirmed observation from unconfirmed input. No files, shell, web or other apps were requested.
- ATOM displayed Looking at Calculator and Clicking in Calculator in the current work row. It finished in 48 seconds with 11 observed tool calls. One initial look failed because Calculator was not running; ATOM opened it and continued.
- Final answer correctly reported 351 and explained that subsequent screen observations showed expected changes even though the driver could not independently confirm the clicks. Independent native inspection showed Last Expression `27 × 13` and Edit field `351`.
- This is one successful trial with a different prompt from earlier 34.5-second trials. It establishes neither a speed improvement nor a regression against those trials.
- Started a second, longer digit-entry trial to exercise cancellation. While status was Using your Mac, the main composer's Stop button disappeared and the microphone hint returned. The current-step row stayed visible. Source inspection confirms `ConversationView.answering` includes transcribing/thinking/speaking and excludes acting.
- Synthetic Escape did not stop the task; later clicks continued. This does **not** establish that the physical global Escape shortcut is broken, because synthetic/background shortcut delivery is not equivalent to a physical shortcut.
- An explicit stop message with Command–Return (Send next now) successfully interrupted the old task. It displayed Stopped after 40 seconds / nine calls, then returned the requested `Stopped.` in one second with zero observed calls. The final in-flight click logged an error; no subsequent computer action appeared through final inspection. Cancellation does not undo already-delivered input.

## Window/runtime interruptions — observed, cause unresolved

Launch initially exposed only the companion; the synthetic main-window shortcut did not reveal the full window, and opening the app through Finder did. Two attempts to open the completed task card returned noWindowsAvailable around window/process interruptions. One reopened instance displayed an .env/settings error, while its log actually reported `app.refused` for an existing runtime PID and exit 78. Restart ATOM recovered Ready and the saved chat.

No new ATOM crash report established a crash, and the origin of the quit/relaunch events was not determined. Do not label task-card opening as a proven crash or a root cause. Duplicate-runtime refusal being presented as a settings problem was directly observed. These interruptions prevent calling the whole session friction-free.

## What would justify an overall 8/10

Current judgment remains approximately 6.5–7/10 overall: daily chat is useful; developer and computer paths work with intervention. This is a subjective assessment from a small walkthrough, not a population usability score.

Priority order:

1. **Consistent control and truthful effects.** Keep Stop visible during computer activity and approval waits; identify stopping versus stopped. Show actual host-created commits and worktree destinations. An explicit no-commit request must be honored or the constraint explained before dispatch. Completion needs the actual artifact, check result, branch/commit and handoff state.
2. **Reliable opening and recovery.** One clear route to the full window. Handle an old runtime still exiting without a misleading .env error. Investigate the observed task-window interruptions before changing behavior on an unproven diagnosis.
3. **One developer outcome panel.** Keep task progress, changed files/diff, actual checks, isolated branch, review/push and next integration step beside the originating chat. Retain explicit confirmation for push/merge and distinguish working-copy success from changes applied to the original project.
4. **Compact daily chat with understandable memory.** A brief default explanation of what the chat remembers and where it came from; technical replay/budget details behind disclosure. Preserve drafts/model/access across restart. Measure first visible text separately from completion time.
5. **Measured computer efficiency.** Remove unnecessary look/open round trips and investigate driver click verification waits while retaining ownership checks and observations. Use fixed cold/warm trials with identical models/prompts; report task success, calls and median/p95 time rather than presenting one favorable run.
6. **Finish release acceptance before widening features.** Install/reopen/provider failure, interrupted work, backup/recovery and scope revocation need repeatable live evidence. Broader source intake can follow a reliable core.

Proposed acceptance targets (not achieved claims): at least 9/10 unassisted completions for each fixed workflow across fresh/restarted sessions; no lost draft/history/grant or false completion; Stop reachable throughout every running state with no newly issued action after cancellation acknowledgment; all developer results identify exact worktree, checks and Git effects. For simple no-tool chat, initially target median first text below three seconds and p95 below eight, then validate against the selected provider. For the fixed Calculator task, first target median below 30 seconds over ten equivalent runs while preserving observed correctness. These are product goals, not promises or current measurements.

Final state: app Ready, computer trial stopped, empty composer, no intentional active shell or task. Fictional fixtures/recovery records retained. No app fixes, Swift suites, real Git push or publication performed in this inquiry.
