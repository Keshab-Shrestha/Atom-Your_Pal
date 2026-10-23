# Computer readiness and safe driver recovery

Implemented 21 October 2026, ADR-187, as the first capability in the [Sentient adoption plan](sentient-adoption-plan.md).

When Computer control is enabled (`ATOM_COMPUTER=1`) and the chat's access policy permits the tool, ask ATOM to check computer readiness. The existing `computer` tool now offers `action: "status"`. This is an explicit check, not an automatic app-start scan.

## What the check establishes

It starts or reuses ATOM's standard-mode Cua Driver, completes MCP initialization and lists the advertised methods. It checks all twelve methods needed by the current app-input and screenshot tools, including paginated capability lists. It reports initial startup duration, protocol-probe duration and whether the existing helper was reused. Missing methods or an invalid capability response produce an installation/update error.

The check never calls app enumeration, window reads, screenshot capture or input methods. It therefore **does not certify Accessibility, Screen Recording, a specific app, locked-screen behavior or action delivery**. It grants no permissions and does not repair/install anything. Existing checked computer policy and per-chat access continue to govern all real actions.

**Permission status (23 October 2026).** When the driver advertises `check_permissions`, `status` also calls it with `prompt: false` and `probe_direct_capture: false`. This read-only call shows no system dialog and reads no screen. The reply states Accessibility and Screen Recording as granted or missing, and names the identity that holds the grants (normally `com.trycua.driver`, reported through the driver daemon). If a grant is missing, the reply points to System Settings → Privacy & Security or `cua-driver permissions grant`; ATOM changes no permission. If the call fails, the reply says the status is unknown, and `status` stays ready. Older drivers without `check_permissions` keep the earlier "not tested" wording. A granted flag still does not certify a specific app, a locked screen or action delivery.

Live check, driver 0.28.2: the probe advertised `check_permissions`, and the read-only call reported Accessibility and Screen Recording granted for `com.trycua.driver` (attribution `driver-daemon`).

`computer.transport` logs initialization, probe and actual call duration/success. Actual calls include only the fixed method name, never arguments, output, typed text or screen content. Timings are local diagnostics, not token accounting or a provider benchmark. The helper remains lazy; a probe can prepare it for the next requested action within its existing two-minute idle lifetime.

## Recovery

Pending replies and initialization state belong to one owned process generation. Timeouts, cancellation, pipe failure or crashes retire that exact child; an unresponsive SIGTERM gets a SIGKILL after 500 ms. The next operation waits for owned-process termination before starting a replacement. No competing app helper is signalled. Killing the transport is not an undo and cannot prove that an already-delivered input had no effect.

The transport never retries an action. Unknown outcomes say so. Numbered window elements belong to the generation that observed them; input rechecks that generation after any approval wait and before sending. Failed observations, stale tokens and transport exceptions discard the old target. A successful fresh `look` is required before further input. A protocol readiness result is not a window observation. Driver policy refusals keep their existing stop/repeat guidance.

Idle shutdown is scheduled only after active work finishes. Previously its countdown ran during the active call, so sufficiently long configured calls could be terminated as if idle. Timeout recovery previously left a live old helper; failed fresh observations could leave the earlier window target available. These paths now have regression coverage.

## Verification

- Controlled subprocess tests cover lazy reuse, content-free probe/pagination, missing/invalid/endless capability listings, initialization failure, call timeout, cancellation during startup/work, crash/restart, late old exit, idle lifetime, bounded hung-helper termination and rejection of an old generation before input.
- Tool tests cover readiness wording/absence of permissions claims, no reads or approvals during status, failed-read target removal, uncertain-input non-replay, stale generation and a restart during approval. Existing secret-field, blocked-app, risky-key/click, screen-capture and host access-policy checks remain relevant.
- Typecheck and full TypeScript regression pass: 1,167 passed, eight live opt-in skips. Final focused computer/transport/screenshot/host-policy regression: 173 passed. No Swift/UI/protocol change; native build/gallery tests were not rerun.
- Installed-driver protocol-only sample: **141 ms** cold helper initialization + **4 ms** probe, followed by **2 ms** warm probe with the same helper. One sample, local machine; no desktop content read, input sent or model request made. This is not a task completion, permission or Sentient-versus-ATOM speed result.

The Swift UI/protocol is unchanged. These TypeScript host sources are read from the checkout on runtime launch; the currently running host is not hot-patched. Restarting ATOM loads the change. Chat databases, archives, drafts, grants and provider configuration are not migrated or rewritten by this capability.


## Reliability baseline and fixes (23 October 2026)

Harness: ATOM's real `computer` tool against the live Cua Driver 0.28.2, with no model in the loop. Approvals are granted only for TextEdit. Task: a fictional untitled TextEdit document, five rounds of look → click the text area → type a fixed sentence with `look_after`.

Before the fixes:
- With no document open, `look` chose an off-screen helper window ("Save Panel Accessory View"). The look reported success with no elements. Every following input failed with "The TextEdit window is on another desktop (Space) or ATOM cannot read it", which was wrong.
- Clicking the text area failed in every round with `AXUIElementPerformAction(AXPress) returned -25206`. Text views have no press action.

Fixes:
- `look` now falls back to an off-screen window only if the driver reports it on another Space (`on_current_space: false`). Helper windows (no Space) and hidden panels on this Space are skipped, and the reply says no window is open. Drivers that omit the field keep the earlier fallback.
- A click that fails with -25206 on a text area, text field, search field or combo box now says the element cannot be pressed and that `type` with that element focuses it. Nothing was clicked. The tool description now says a field needs no click before typing.

After the fixes, five rounds:
- `look` chose the document window every time.
- `type`: 5 of 5 confirmed (1.9–2.3 s each, including `look_after`).
- The guided click refusal: 5 of 5 (about 1.1 s each, 3.1 s on the first).
- `look`: 0.7–1.0 s. `open`: 1.5 s.

Still open:
- Background `cmd+w` reported "could not confirm" and did not close the window (2 of 2). Menu shortcuts sent in the background may not reach the app.
- The "Delete" button of TextEdit's save sheet cannot be pressed: the parent window refuses it (`element_outside_target_window`), and the sheet window exposes no buttons. A foreground `cmd+delete` did not close it either.
- `look` shows at most 80 characters of a value, so long text cannot be checked from a look.
- A window on another Space was not tested live.

Tests: three new tool tests; 102 computer, transport and screen tests pass; typecheck passes.


## Speed baseline and first reduction (23 October 2026)

Task: in a new fictional chat on Opus 5.5, "use the Calculator app to compute 12 times 7". Calculator was closed before each run. Times come from `computer.action` and `computer.transport` log lines and from send-to-usage-row wall time.

| Run | Wall time | Tool calls | Cached input | Output |
| --- | --- | --- | --- | --- |
| 1 (before) | 51.0 s | 8 (open, look, 6 clicks) | 93,096 | 974 |
| 2 (after) | 36.5 s | 8 (same) | 34,410 | 869 |

Where the time goes:
- Each driver click takes 2.2–3.3 s and ends "could not confirm". A direct, model-free check gives the same 2.5 s (3.25 s for the first click). The driver seems to wait for a visible effect before it gives up. Its click schema has no option to skip this, so ATOM cannot remove it. Report it upstream.
- `list_apps` cost 0.55–0.85 s on every `look` and `look_after`.
- The model: run 1 waited about 1.6–1.8 s between clicks, while run 2 issued the six clicks back to back. Most of the difference between the runs is this model behavior, not ATOM; with n = 1, do not read it as a speed result.

Reduction: `look` now reuses the app of the last good look (name, bundle ID, pid) while that process still owns windows, and skips `list_apps`. If the process owns no windows, `look` does the full lookup once. Measured live: the repeat `look_after` took 14 ms (`list_windows`) plus 277 ms (window read) without `list_apps`, saving about 0.6–0.8 s per repeat look. Two new tests; 104 computer tests pass.

Correctness finding: both runs failed to report the result ("couldn't read its display"). The display exists in the driver's tree as unnumbered static text (`AXStaticText = "84" (Edit field)`), but `look` lists only numbered elements, so the model never sees it. **Fixed the same day:** `look` now adds a "Text on screen (read only)" line from the driver's `tree_markdown`. It keeps only unnumbered `AXStaticText = "…" (label)` entries, skips text whose label the existing secret-label check matches (password, PIN, token and so on), removes duplicates, and keeps at most 20 entries of 80 characters. The text is shown only and is never actionable. One new test; 105 computer tests pass. Live recheck (run 3, same task): 34.5 s, and the reply was "Calculator shows 12 times 7 equals 84." Runs 1 and 2 could not read the display.


## Visibility (23 October 2026)

Baseline: during a Calculator task, screenshots every 3 s showed no current step anywhere. The island showed only the pal and a dot. The window header said "Using you…" (cut off). The chat's work row said only "Working for 6s · 3 observed calls". The island's status already held the step text ("Clicking in Calculator") from the existing `computer.step` events, but no visible view showed it.

Change: `IslandStatus.currentStep` returns that step only while ATOM is using the Mac (`.acting`), and nil otherwise. The latest turn's work row shows it while the work runs: "Working for 13s · 9 observed calls · Clicking in Calculator". The step text stays action and app only. No element labels or typed text are added.

Checks: one new core test; 791 Swift tests pass; the release app builds; no gallery golden changed by more than 1%. A live run, with captures every 2 s, showed "Opening Calculator" and then "Clicking in Calculator" in the row, and the reply was "12 times 7 is 84".

Not changed: the island's collapsed look and the cut-off window header.

## PR review correction — cached app identity (23 October 2026)

A cached PID is reused only while the current helper generation and returned window metadata confirm the same app/owner. Missing or changed ownership falls back to fresh app lookup and existing blocked-app policy. A window-state PID/app/window mismatch is refused before publishing actionable elements. Failed window enumeration is reported instead of interpreted as a normal list. This closes the PID-reuse regression while retaining repeat-look savings for verified owners; older drivers without ownership metadata take the slower fresh-lookup path. The focused tests include a replacement blocked app, helper restart and a mismatched observation.

## PR review correction — cursor lifecycle and malformed input (23 October 2026)

Cursor start/finish operations carry a lifecycle revision. A delayed start cannot enable an ended task, and a delayed finish cannot hide a newly started task. Cleanup attempts disable even when the return-to-island screen lookup or movement fails. Error-valued driver replies are failures, not silently counted as success. Input delivery mode validation runs before approvals or step/cursor callbacks; it never prompts the user for an invalid request. No native foreground action was exercised by these regressions.

Read-only status steps update their work label without starting the cursor; the readiness probe retains ownership of cold helper initialization instead of measuring an inadvertently prewarmed session. A focused bridge regression covers this ordering.

## Pinned follow-up reads and uncertain input (23 October 2026)

Post-action observations now read the pinned observed window directly rather than enumerating windows again. Helper generation and returned app/PID/window identity must still match. Unverifiable or suspected-no-op input automatically returns one fresh observation; it does not repeat the input or convert an uncertain verdict into success. Confirmed input adds no unrequested read. Regression tests verify call counts and uncertainty. This saves a window-enumeration call and can avoid another model round trip; no new live speed benchmark or removal of the driver verification wait is claimed.
