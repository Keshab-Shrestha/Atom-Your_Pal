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
