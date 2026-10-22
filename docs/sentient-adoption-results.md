# Sentient adaptation validation — 22 October 2026

**Next work:** the [parity and release plan](sentient-parity-release-plan.md) reconciles the latest completed batches below and sequences the still-open search bug, hosted visual gate, native acceptance, benchmark and broader parity work. Planning is not acceptance evidence.

The automated and isolated-provider portion of the combined gate passes. The first signed native restart/backup acceptance batch below also passes. Remaining native workflows, a same-model performance benchmark and full parity with Sentient's 33 inquiry features are not certified. The initial seven coding groups remain scoped as described in the [plan](sentient-adoption-plan.md).

## Native long-chat continuity batch — completed with two observations

Use one new fictional chat in the Cedar project: five ~10.8 KB logbook parts (54 KB in total) with unique decisions C1–C5, then one short follow-up. Each part asks for the one-line reply "Noted part N." The baseline is a private `memory.db` backup. Drive the running signed app through Accessibility. Keshab asked for no test-suite runs in this batch.

- The background summary runs once after the chat passes the 48 KB replay limit: `chat.continuity` saved, messages m1–m4, 22 KB in, 869 bytes out, `claude-plan / claude-opus-5-5`. It stops at m4 because of the 28 KB batch budget.
- The stored summary has five items with correct citations. Decisions C1 (spare lid, porch) and C2 (rain barrel tap, east bed) match the fixture exactly.
- Chat options → Saved context details shows 10 saved messages, 54.4 KB archived, a 21.9 KB fresh replay with 5 earlier messages omitted, and coverage m1–m4. Review derived summary shows the same five items. Read original m3 opens Saved history at m3, and the page text contains decision C2 exactly.
- Pause and clear removes the derived copy (`enabled=0`, summary empty) and shows "Paused. The derived copy was cleared; original history and your Chat brief are unchanged." The 10 original messages keep their exact hash. `chat_access` and `chat_reasoning` match the pre-test baseline.
- Enable returns to "Ready for long chats" with no derived copy. A clean quit and relaunch runs no summary job and keeps the state.
- The next exchange rebuilds the summary from scratch (m1–m4).
- Cleanup: the original chat is selected again. The clipboard is unchanged.

Remaining differences from the baseline, all expected: the fictional chat (12 messages), its continuity row, its automatic chat summary note in Second brain with one link, the navigation row, and 7 foreground attempt records.

The first send of part 1 started a turn that was stopped 8 seconds later, when the window was minimized and then closed. That attempt stays as a recovery item with its fictional text, so the chat menu shows "Recovery (2)". Everything after it was resent normally.

Observations:
1. Coverage gap by design: after five parts, m5 is outside the fresh replay and not yet in the summary. Each exchange advances at most one 28 KB batch, and there is no catch-up loop. The history tools can still read m5.
2. One summary item says "Parts 3-5 have not arrived yet." That was true for the covered prefix m1–m4, but it reads as a claim about the current chat. The panel already says to check cited originals.

Not covered: Codex or Gemini chats, cancellation by a foreground turn during a summary job, deletion or fork of a summarized chat, grant/revoke with exact-file grants (this chat has none), and keyboard, IME and VoiceOver use of the details popover.

## Native prepared-work batch — completed with one finding

Keshab chose fictional input only. The brief has no per-calendar or per-list selection, so Events, Reminders, Weather, Finished tasks and What waits are turned off for the test. The only input is two fictional timers, started in one new fictional chat. The baseline is a private `memory.db` backup with no saved brief settings (defaults apply), no briefs and no preparation usage. Drive the running signed app through Accessibility.

- Brief me with every input empty makes no model call: `brief.made` with `source: template`, 0 parts, no preparation admission.
- Run 1 (one timer): one admission, a model brief, and 0 cards. The design allows zero cards; a single "kettle check" timer gives nothing to prepare.
- Run 2 (two timers): the second admission, 1 card from 2 sources. The card "Draft agenda and checklist: Cedar team sync" is marked "Draft only", says the timer label is cut off, and says no date, attendees or topics came with the sources. Its source is resolved by the host: `timers:2` with the exact excerpt and capture time.
- Review and edit shows the title, body and captured excerpt. Copy edited text puts exactly the edited title, a blank line and the edited body on the clipboard as plain text. Restore generated text brings back the generated title and body exactly. Close discards an edit: reopening shows the generated title. The stored card stays equal to the generated text; nothing is saved back.
- Run 3 at 2 of 2: a template brief with no model call, status `budget`, usage unchanged. The Dashboard says the budget is used, keeps the earlier card and labels it "Showing earlier saved cards; these excerpts have not been refreshed."
- Restart: no brief runs. Usage, settings, the card and its labels are unchanged.
- Pause (Prepare work off): "Preparation is paused. Previously saved cards remain available." The card stays.
- Cleanup: brief settings are back to the default values, the clipboard is restored exactly, and the original chat is selected again.

Remaining differences from the baseline, all expected: the fictional chat (2 turns), its automatic chat summary and mirrored "Chat note 2026-10-22" in Second brain, 4 brief rows (14-day retention), today's preparation count (2) and a saved settings row holding the default values. The two fictional timers end by about 21:33.

Finding: the plain brief says "Plain version: the model was not available" after the empty-input run and after the budget-limited run. In both cases the model was available; the real reasons are "no usable sources" and "budget used". **Fixed the same day:** the footer now reads "no usable source excerpts" or "today's preparation budget is used" from the stored preparation status, and keeps "the model was not available" for real failures. A Swift regression test covers all four cases. An empty brief made with preparation off still shows the model-failure text, because that run records no reason.

Not covered: the scheduled daily brief, cancellation by pause or foreground chat during a running preparation, Telegram and speech exclusion (both are off here), Calendar, Reminders, Weather and Board inputs, and keyboard, IME and VoiceOver use of the editor.

## Native imported-note analysis batch — completed with two findings

Use a new fictional folder `~/Documents/ATOM fixture cedar-analysis-r2` with three notes: two short notes and one 33 KB logbook (three chunks). The baseline is a private `memory.db` backup with no source and empty analysis tables. Drive the running signed app through Accessibility and the native folder chooser. The job model is `claude-plan / claude-opus-5-5 · low`.

- Preview lists exactly the two first files with 0 skipped. Import adds two notes (34 total). The first job analyzes both in two attempts. Each report states note ID, text offsets, source check time, model and preparation time, and separates the note's content from open questions. The content matches the fixture.
- Copy analysis puts text on the clipboard that equals the stored report byte for byte (810 bytes). Read original note opens the note in the graph with `Imported · current` provenance and its source path.
- Clear analysis → Cancel keeps both reports.
- Add the logbook and Refresh: 3 imported. The next job reuses both earlier reports with no attempt and sends the logbook chunks.
- Restart: quit and relaunch the app. The job state, attempt count and reports are unchanged, and no analysis request is sent.
- Resume makes exactly one attempt, for the unfinished chunk only. Finished chunks are not sent again. The job reaches `done`.
- Edit a source file and Refresh: only that note's report is removed. The next job reuses 4 chunks and makes 1 attempt.
- Budget: with 7 of 7 attempts used, a new job pauses with reason `budget`, sends nothing and offers Resume.
- Clear analysis → Clear derived analysis removes all reports, the job and the schedule settings (the daily limit returns to 3). Today's count of 7 stays.
- Remove source and imported copies → 32 notes and 25 links. The source and analysis tables are empty except the usage counter. Source files are untouched apart from the two fixture edits.
- Cleanup: the original chat is restored. The clipboard is restored exactly. `config/island.json` is unchanged. 47 of 48 non-FTS tables match the pre-test hashes. The difference is `source_analysis_usage` (one row: 7 attempts today), which the design keeps on purpose.

Findings:
1. One logbook chunk failed its output check once ("The model returned an empty, oversized or invalid report"). Resume then succeeded on the same chunk. The check rejects output over 6,000 raw or 3,500 cleaned bytes, invalid text, or text that looks like a secret. The cause of this failure is not known.
2. The log line `source.analysis_failed` carries no failure stage or category. [Source analysis](source-analysis-jobs.md) says logs contain fixed failure categories. So finding 1 cannot be diagnosed from the log. **Fixed the same day:** the line now carries `stage` (`reading`, `model`, `output` or `checkpoint`) and still no error or report text. A regression test covers the `output` and `model` stages. The cause of finding 1 stays unknown until it happens again with the new log.

Observation: when a job finishes, the Pause button is replaced in place by Clear analysis… A click at that moment opens the Clear confirmation, which happened once during this run. The confirmation prevented any loss; Cancel kept everything.

Effect on the user: this run used 7 analysis attempts on the Claude plan today. The daily limit is back to 3, so analysis is exhausted until tomorrow if a source is connected again today. The fixture folder stays in Documents, which syncs to iCloud.

Not covered: scheduled daily runs, foreground-chat interruption, runtime stop during a chunk, repeated Resume packets, concurrency races, and keyboard, IME and VoiceOver use of this panel.

## Native local backup Copy/Clear/Forget batch — completed

Use an owned fictional loopback fixture on `127.0.0.1:18431` with model `cedar-fixture-r2`. The fixture logs method, path, message roles, model, tool presence and size only. The baseline is a private `memory.db` backup, the clipboard text and the `config/` folder (no `local-backup.json`). Drive the running signed app through Accessibility.

- Save writes `config/local-backup.json` with mode 0600 and the two fields only. It sends no `/v1` request.
- Check server sends one `GET /v1/models`. Send sends one `POST /v1/chat/completions` with roles system/user, the exact model ID and no tools. The reply shows the configured model name.
- Copy on the reply and on the prompt puts the exact turn text on the clipboard, as plain text only.
- Clear → Cancel keeps both turns. Clear → Clear removes both turns, keeps the configuration and sends no request. The next send carries roles system/user only, so cleared turns do not return.
- Forget → Cancel keeps the configuration and the turns. Forget → Forget deletes `local-backup.json`, clears the turns and both fields, shows "Not checked" and sends no request.
- Cleanup: close the panel and return to the original chat (Opus 5.5, Off, Saved permissions, empty composer). Restore the original clipboard text exactly. Stop the fixture. The `config/island.json` hash is unchanged. All 48 non-FTS tables match the pre-test hashes.

Observation, not a defect: Clear also discards the server check. Send stays disabled until Check server runs again. The reason shows only inside the collapsed Server configuration section. Decide whether the panel should say so.

A separate local tool (`PortPilot/0.1`) sends `GET /` to new listening ports every four seconds. These requests do not come from ATOM and are excluded above.

Limits: fixture replies are synthetic. No real local model ran. Keyboard, IME, VoiceOver and compact layout of this panel are not covered here.

## Saved reply context/examples — completed with approved cleanup

Use one new authored fictional note, `Cedar reply context R8 20261022` (ID 37), and a private baseline before creation. There are no saved writing examples at baseline. Preserve the original/revised fixture text, exact sample and generated reply separately for recovery.

- Native Find for the unique date returns exactly the fixture, unchecked. Check it, expand Included context and inspect the exact excerpt. Remove deselects it without deleting the note; re-selection works.
- Type a fictional writing example and explicitly Save. Preferences contain its exact Unicode text, but the inclusion checkbox stays Off. Save alone does not opt in or make a model call.
- After selecting the note, revise **only that owned fixture** through the normal memory-store API to simulate a concurrent external edit. Native Generate rejects the stale revision. Reload shows the revised excerpt unchecked and requires explicit review/re-selection. This is a backend fixture edit plus real native guard interaction, not a claim that cross-window note editing was exercised.
- Re-select the revised note, opt in to the sample, and Generate once. The actual Opus 5.5/Low reply uses the revised Blue Room 75 and 23 notebooks, which are absent from the source question. Diagnostics record `sources: 1` and `style: true`. No model call is needed for lookup, Save or the stale-reference rejection path; one valid generation completes.
- Close, cleanly quit and restart the same signed app. All eleven observed notes/links/source/history/access/reasoning/grant/navigation/project tables retain exact pre-restart hashes, and the saved example remains exact on disk. Original 32 note rows and original chat/access/project records are unchanged; only the test note/sample were added. Current chat, empty composer, Opus 5.5/Off/Saved permissions and the user's current project/theme remain intact. The fictional TextEdit question is unchanged.

- After Keshab physically reopens the panel, the exact saved sample is visible with inclusion Off. Intent, background, search, context selection and output are empty; Copy is disabled. The selected fictional conversation is unchanged.
- With explicit action-time approval, click Forget saved examples. The editor clears, inclusion stays Off, the native removal message appears and `atom.reply.writingExamples` is absent from preferences.
- Review the exact revised fixture title/body, then Delete → Delete for good for only note 37. Counts return to 32 notes/25 links. Clear and re-enter the unique date query: No note matches. Compare all 31 original application tables against the pre-fixture baseline: every count and hash matches. Restore the original chat with empty composer, Opus 5.5/Off/Saved permissions, current project/theme and hidden workspace. Close only the saved fictional TextEdit document and temporary Finder build window. Recovery files remain private and preserved.

Cleanup exposed one **open UI defect**: the selected note's deletion updates graph counts immediately but leaves its active search result visible until the query is cleared and re-entered. The database deletion and refreshed search are correct; immediate search-result invalidation is not certified.

Private evidence is under `/tmp/atom-reply-context-native-j8eifzic`, including baseline/restart/panel/cleanup reports and recovery copies. No app source/build/automated test changed in this batch. No real personal source or writing sample was sent, no foreground chat message was added and no permission expanded. This does not certify imported-note provenance UI, native Codex behavior, secure-field/IME/accessibility or the still-unresolved hosted Terminal visual comparison.

## Native contextual reply batch — generation/edit/Copy/Cancel completed

Prepare one new fictional Cedar conversation in TextEdit and an updated private database/preferences baseline reflecting the user's current chat/project/theme. Writing examples are initially empty. Automated Control–Option–K inserts a control character, so restore the fictional input and ask Keshab for the physical shortcut. He confirms the selected Cedar capture.

Find an activation defect during native inspection: the reopen handler forces the main chat forward even when another page/panel is visible. Limit its explicit reveal to `hasVisibleWindows == false`. Release compilation passes in 41.18 seconds; rebuild with the existing **ATOM Local Signing** identity and pass strict codesign verification. Finder Open still reveals a hidden main window; repeated Open while Board is visible preserves Board. After the physical post-rebuild handoff, the automation reaches the actual floating Quick actions and Draft a reply panels. This now has native evidence beyond the earlier source/Board inspection.

- The panel shows `claude-plan / claude-opus-5-5`, draft effort Low; main-chat thinking stays Off. Captured conversation text matches the fictional source. Initial saved context is empty/unselected, and writing-example inclusion is Off.
- Edit intent/background and manually provided fictional style. An explicit local search for the removed unique fixture note yields no candidates. Opt in to the typed style without saving it, then Generate. A valid short unsent reply appears in an editable field; no new chat exchange is created.
- Manually edit the draft and press Copy. The panel stays open with a copy confirmation. Manually paste into a **separate blank test document** to verify the exact edited Unicode text, then save that artifact in the private acceptance folder. The original source conversation remains unchanged before/after; ATOM did not paste or send it.
- Change intent: the earlier draft displays an inputs-changed notice. Four manual admissions are exercised in total: three complete, one is cancelled. Two short regenerations finish before a Cancel action can be dispatched; they are not evidence of cancellation. A longer numbered-text fixture exposes the running Cancel control; press it using a fresh accessibility snapshot. The panel reports **Drafting stopped. Nothing was pasted or sent.**, preserves the earlier edited draft and its stale-input attribution, and re-enables Copy. A later native read still shows that same draft; no fourth successful result is logged.
- Close the ephemeral panel and return to the selected Cedar chat, empty composer, Opus 5.5/Off/Saved permissions and hidden workspace. Preserve the user's current project filter/theme. Save the original fictional TextEdit source in the private acceptance folder as well, and close both document windows without deleting the artifacts. Close the temporary Finder build window.

All eleven observed notes/links/source/history/access/reasoning/grant/navigation/project tables match exact pre-draft hashes. Saved writing examples remain absent; workspace width/surface preferences match too. Successful `reply.draft` diagnostics contain only sizes/counts/style (zero sources, style explicitly included), with three completions and no later cancelled-result publication. Four admissions are manual attempts, not automatic retries. Aborted provider work may consume tokens; this is not a timing/cache/token/cost or semantic-quality benchmark.

This bounded native Claude generation/edit/Copy/Cancel workflow passes. Explicit saved-source checkbox/revision review, native Save/Forget/restart examples, Codex's native panel path, Close/reopen form reset, secure fields and broader keyboard/IME/accessibility remain separate acceptance cases; their automated/isolated-provider evidence is not a substitute. No real source/writing example/private thread was sent, saved access was unchanged and no general local model was installed. The activation correction and these results are recorded in this batch; the hosted Terminal rendering mismatch remains unresolved.

## Native notes-folder batch — completed

Use one new fictional two-note folder and a private consistent database snapshot. The real app starts with no connected folder; 32 pre-existing notes and 25 links are the baseline. No real personal source is selected or sent to a model.

- Native folder chooser → Preview shows the two supported Markdown/text filenames, with two hidden/unsupported entries skipped. Cancel leaves brain notes/links/source tables, chats and grants byte-for-byte unchanged.
- Import adds exactly two notes. Source status shows the canonical folder, checked time, zero corrections/conflicts/missing/exclusions and two skipped entries. Search finds the imported note; its editor shows original path and `current` provenance. Imported nested text preserves leading whitespace, newlines and Japanese characters exactly.
- Save a fictional local correction in the native editor. The label changes to `corrected`; the original Markdown file stays byte-for-byte unchanged. Manual refresh preserves the saved correction.
- Change only the fictional source file, then Refresh. Status shows one conflict; the native editor still contains the saved correction. `Use file version` is disabled while there is an unsaved editor change and enabled when the editor matches its saved copy.
- Open the explicit replacement confirmation and Cancel. The correction and conflict survive. Preserve an exact additional copy of the fictional correction with the private acceptance snapshot.

Keshab explicitly approved applying Use file version and removing only this test source and its two imported copies. The native replacement matches the current fictional source exactly and returns to `current`. Temporarily move only the fictional nested file outside the folder; Refresh reports one missing copy while preserving its full saved text. Restore that same file and Refresh returns to zero missing copies.

Cleanly quit/relaunch the existing signed app without rebuilding. The connected source, provenance, both copies, links and original chat/access records retain exact pre-restart table hashes. The native Sources panel shows two current copies, daily analysis Off and zero model attempts. Apply the approved Remove source confirmation: the panel becomes disconnected; Second brain returns to **32 notes and 25 links**, and searching the unique fixture title reports no match.

Every observed original non-FTS application table matches its pre-test row hash after cleanup, including notes/links/source metadata and all seven history/access/reasoning/grant/navigation/project tables. Originals and the separate correction backup remain preserved; no fixture folder was deleted. Restore the original chat, empty composer, Opus 5.5/Off/Saved permissions, hidden workspace and empty brain search; close the temporary Finder window. No analysis/model request, schedule change, new permission, real-source selection or real-note edit occurred. This completes this bounded native notes workflow, not the entire race/fault/accessibility checklist.

Hosted [run 39727840071](https://github.com/Keshab-Shrestha/Atom-Your_Pal/actions/runs/39727840071), head `a095a04`, passes TypeScript and Swift but still fails compact Terminal visual comparison (1.877%). Inspect its artifact and diff: the fixed fictional path now matches; the remaining difference is the vertically shifted centered explanatory text. The earlier fixed-path change resolves the home-directory dependency, **not** the entire hosted rendering failure. Dark Terminal differs by 1.378% when compared separately; the CI loop stops at compact. Keep the existing threshold and scenes. This remains a separate unresolved rendering-stability check; do not report hosted CI as passing.

## Signed native restart and backup batch

Published the adaptation as `4251304` on `origin/main`. Rebuilt the actual repository app bundle using the existing **ATOM Local Signing** identity; `codesign --verify --deep --strict` passes. Preserve a private consistent SQLite/defaults/draft snapshot and the prior bundle before replacement. Native interactions use the app's real controls, not gallery snapshots.

- Find and fix a reopen defect: Launch Services opening an already-running menu-bar app now shows the main window idempotently. Verify Finder Open reveals the hidden window and repeated Open keeps it visible. Background cold startup remains background startup; this does not change login behavior.
- Verify the selected fictional project chat, its two original messages, Opus 5.5, Off thinking and Saved permissions after restart. A fictional unsent draft survives restart; clear only that added text to restore the originally empty composer. Once the provider catalog loads, Off returns normally.
- Verify Terminal remains selected with a stopped shell, the divider remains 379 pixels, and the Browser address remains empty. Restore the hidden workspace afterward. No shell was started.
- Compare exact row hashes before and after replacement/native checks: all 229 messages, 55 chats, the chat access/reasoning/navigation rows, zero exact-file grants and two projects are unchanged. This real baseline has no exact-file grant; Full access/grant/revoke coverage remains the separate fictional automated evidence above.
- Open Saved context details: the short chat reports ready for future long-chat summaries with no summary required. No pause/clear action or model call occurs.
- Exercise Settings → AI model → Local text backup using an owned fictional loopback HTTP fixture. Save makes **zero requests** and writes mode `0600`; Check server makes one content-free model-list request. The first answer and follow-up render the exact configured model and synthetic usage. Captured request roles are system/user, then system/user/assistant/user; no cloud chat/source/tool/credential data is transmitted.
- Stop a delayed third request: earlier replies and the unsent message remain; no incomplete turn is committed. Close/reopen starts an empty temporary conversation. Cleanly quit, move the exact fixture configuration into the private rollback snapshot, and restart unconfigured. Stop the owned fixture server. No local model/server software was downloaded or installed. Fixture timing/token numbers are synthetic, not inference or performance evidence.

The new hosted [run 39713011016](https://github.com/Keshab-Shrestha/Atom-Your_Pal/actions/runs/39713011016) passes TypeScript and Swift. Its visual job fails at compact Terminal (2.200%). Inspect the actual artifact and red diff: its path contains the CI home directory, and the centered explanatory text also shifts vertically. Give the gallery project a fixed fictional absolute path matching its response root, and inspect/update only the compact/dark Terminal references. The isolated final gallery renders all 114 scenes and all 43 local comparisons pass at the existing 1% threshold. A new hosted run is still required to establish the result on that runner; local success does not certify it.

The later notes batch above completes its bounded native import/correction/conflict/restart/cleanup workflow. The bounded contextual generation/edit/Copy/Cancel workflow is also covered above. Explicit saved-context/example lifecycle, long-chat original-message navigation, prepared-card editing/Copy, analysis restart/resume, keyboard/IME/accessibility and real compatible local inference remain subsequent acceptance work. The first-text/cache/token comparison remains a separate controlled benchmark. No user notes, account/calendar content, access expansion or new cloud-chat response was needed in this batch. Unrelated `graphify-out/` stays untouched.

## Earlier automated evidence

| Check | Result |
| --- | --- |
| TypeScript | `pnpm typecheck` passes |
| Complete ordinary TypeScript suite | 1,215 cases: 1,205 pass, ten opt-in live skips, zero failures |
| Swift | 787 tests in 147 suites pass |
| Adaptation-specific mechanical coverage | 37 new TypeScript tests, one additional native-policy test, six new Swift tests; fictional stores/files/HTTP only |
| Isolated signed-in provider smoke | Two opt-in tests pass, eight actual model responses across Claude/Codex |
| Release build | Passes; final native build 41.20 seconds, existing capture/native-build warnings |
| Native rendering | 114 scenes, six new adaptation scenes, required-file/nontrivial-image checks pass |
| Visual comparisons | 43 references pass at the existing 1% threshold, after inspecting two intentional updates and adding three new references |
| Signature | Isolated temporary app copy passes ad-hoc signature verification; installed app and its signing/permissions were not changed |
| Repository | Static diff and whitespace review; no commit/push, no changes to unrelated graphify output |

The ten ordinary-suite skips include the two new provider tests, which were separately enabled and passed. The eight other pre-existing live tests were not enabled: some exercise audio, computer use or broader worker actions. Passing mocks, protocols and rendered images does not certify those interactions.

Focused coverage is in `services/memory/src/sentient-adaptation.test.ts`, `apps/mac/src/sentient-adaptation.test.ts`, `apps/mac/src/local-backup.test.ts`, Gateway's `providers/local-backup.test.ts`, `native-safety.test.ts`, and `SentientAdaptationTests.swift`.

## What the fixtures prove

| Group | Exercised evidence |
| --- | --- |
| Computer readiness/recovery | Existing full-suite transport, timeout/cancellation, observation/policy and owned-process regression checks remain green; no real input/capture during this pass |
| Notes folder | Preview without publication, cancelled/changed tokens, malformed/hidden/oversized/linked files, replaced root, atomic multi-note rollback, title collision/ghost links, search, whitespace, correction/conflict/missing/restore/exclusion/disconnect and reopened source state |
| Contextual replies | Only explicit source picks enter the task; source/profile revision checks, independent no-memory lookup, Gemini refusal, cancellation-ignoring writer, concurrent admission and request/output budgets; native request serialization and actual Claude/Codex output |
| Continuity | Original references/Unicode/prefix and version validation, pause idempotence, chat isolation/deletion, background cancellation, original archive retention and actual corrected-date summary output |
| Prepared briefs | Source-reference resolution, malformed/injected/hidden-control rejection, legacy schema migration, corrupt derived-copy handling, persistent budget, earlier-card retention, cancellation/no delivery and actual provider output parsing |
| Source analysis | Hash/profile cache identity, atomic report/cursor rollback, note-change invalidation, duplicate Resume, explicit restart recovery, stale Start refusal, Unicode chunks, durable budget pause, Clear without budget reset and actual provider report output |
| Local backup | Literal URL restrictions/default-port normalization, content-free GET, exact POST/no credentials/proxy/tools, malformed/status/redirect/compression/size/model/tool-response rejection, deadline, unknown usage/incomplete output, source-free successful follow-ups, configuration persistence/mode/symlink refusal, concurrency/cancel/late result, revision and duplicate-send protection, Reload without inference |

A reopened fictional database preserves exact original chat messages, Full access choice and an exact-file grant. Another chat cannot inherit that grant; explicit revoke removes it. Source disconnect and derived-summary/analysis changes do not rewrite those originals. A native post-read hook test proves imported-note data changes a previously allowed action to denial, including a Full access path. These are deterministic fixture checks, not inspection of or changes to the user's real database.

## Actual provider checks

`ATOM_LIVE_TESTS=1 node --test apps/mac/src/sentient-adaptation.live.test.ts` uses tool-free Gateway jobs with short fictional Cedar text. Claude used advertised `claude-haiku-5-5`; Codex used `gpt-6-luna` at Low. All four output contracts parsed successfully for both providers, including a correction from Wednesday to Thursday and host-resolved preparation references. No chat/store/app runtime was started, and no real notes, writing examples, screen, account content or external action entered these prompts. Claude sessions were nonpersistent; Codex threads were ephemeral.

| Stage | Claude total | Codex total |
| --- | --- | --- |
| Reply draft | 2.883 s | 5.216 s |
| Continuity summary | 4.482 s | 4.536 s |
| Prepared brief | 5.999 s | 4.608 s |
| Note analysis | 5.531 s | 5.444 s |

These are one-run isolated completion durations, with different models and adapter startup/output formats. They do **not** measure app startup, foreground first text, cache stability, token cost/efficiency or comparative model speed. Input task payloads were 151–204 bytes; provider instructions/envelopes are additional. No local general model was installed or run; local compatibility was exercised with an owned loopback HTTP fixture.

## Failures found and resolved

- The environment-name audit interpreted the imported-note reference marker as an environment variable. Rename the marker to `[IMPORTED_NOTE_REFERENCE_DATA]`; keep the environment audit strict. Its producers and consumers share the same constant, and policy tests cover its action-denial behavior.
- Add explicit Claude/Codex admission in the contextual-draft service itself, in addition to the isolated-writer restriction. Gemini's existing selected-text reply action stays unchanged.
- Plain SwiftUI scroll views rendered empty in the image renderer. Reuse ATOM's existing snapshot-aware `Scrollable` wrapper in the draft/backup panels and suppress draft context lookup during snapshot capture. This is renderer coverage, not proof of live scrolling/keyboard behavior.
- The backup composer was below the fold with configuration/replies. Keep Message/Send/Stop outside the scrolling area, collapse saved configuration, and allow a shorter sheet. Inspect light and 500-point dark renders with composer controls visible.
- The old Terminal CI failure was a stale compact Browser reference. Download and inspect the actual `ui-gallery` artifact from [run 39616156486](https://github.com/Keshab-Shrestha/Atom-Your_Pal/actions/runs/39616156486), head `f63b00a`: its old reference shows four surface tabs; Terminal intentionally changed compact navigation to a surface menu. The CI output and current local output both show that menu. Their direct pixel difference is 0.928%, while the original CI comparison against old tabs was 1.308%. Update only this inspected reference; do not change tolerance or hide the scene. A new hosted CI run has not occurred.
- The Model settings image gains the intentional Local backup card and longer height. Inspect old/new, then update that reference. Add reviewed light/compact-dark backup and prepared-card references. All other existing references remain unchanged.

Gallery work used a temporary app copy and throwaway defaults; it did not replace or quit the running ATOM app. The gallery exits before runtime startup. It emitted a macOS temporary-bundle sandbox-extension diagnostic but completed with zero `gallery:` errors and every expected image. The isolated binary was verified; this does not certify the installed app's signature or TCC retention after replacement.

## Remaining release acceptance

- Complete the remaining native interactions with fictional data: explicit saved reply-source selection/revision handling and example Save/Forget/restart, the native Codex reply path, summary original-message navigation in a long chat, preparation Copy/editor, analysis controls/restart and backup Copy. The bounded native folder and backup configure/Stop workflows are now recorded above. Verify keyboard/IME/accessibility, narrow windows and secure selection where applicable. Rendered snapshots and Core protocol tests do not cover the actual app controller.
- The signed native batch verifies the observed restart baseline above. Continue preserving the selected chat/provider/thinking/access/draft, grants, Browser address and pane preference through later fixture workflows; do not infer real grant/revoke behavior from the baseline with zero grants.
- Exercise a user-configured real compatible local server when available; no model download or different provider is implied. The HTTP fixture proves protocol/host handling, not a particular server/model's inference, cancellation or context size.
- Run the remaining relevant opt-in device/provider workflows, larger scanner race/fault-injection matrices, timezone/clock/budget edge cases and scheduling under real app lifecycle. The [case checklist](sentient-adoption-validation.md) remains a backlog; this report states what was actually covered.
- Run the requested controlled foreground startup/first-text/cache/token comparison under the same model/effort/task conditions. The table above is not that benchmark. Observe the next hosted run after the native/gallery follow-up is published.

The next independent step is native workflow/restart acceptance, not another feature group or a claim that every checklist case has passed.
