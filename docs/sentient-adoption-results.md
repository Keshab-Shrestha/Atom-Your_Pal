# Sentient adaptation validation — 22 October 2026

The automated and isolated-provider portion of the combined gate passes. This is not installation/native interaction acceptance, a same-model performance benchmark, or full parity with Sentient's 33 inquiry features. The initial seven coding groups remain scoped as described in the [plan](sentient-adoption-plan.md).

## Evidence

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

- Install/restart the final signed build and exercise native interactions with fictional data: folder chooser/confirmation, editable reply/context/examples, summary original-message navigation, preparation Copy/editor, analysis controls/restart and backup configure/Stop/Copy. Verify keyboard/IME/accessibility, narrow windows and secure selection where applicable. Rendered snapshots and Core protocol tests do not cover the actual app controller.
- Before replacement, preserve the real selected chat/provider/thinking/access/draft, exact-file grant and revoke state, Browser address and pane preference. Verify them after restart. This pass deliberately leaves that running state untouched rather than claiming to have migrated it.
- Exercise a user-configured real compatible local server when available; no model download or different provider is implied. The HTTP fixture proves protocol/host handling, not a particular server/model's inference, cancellation or context size.
- Run the remaining relevant opt-in device/provider workflows, larger scanner race/fault-injection matrices, timezone/clock/budget edge cases and scheduling under real app lifecycle. The [case checklist](sentient-adoption-validation.md) remains a backlog; this report states what was actually covered.
- Run the requested controlled foreground startup/first-text/cache/token comparison under the same model/effort/task conditions. The table above is not that benchmark. Push and observe fresh hosted CI only when publishing is requested.

The next independent step is native workflow/restart acceptance, not another feature group or a claim that every checklist case has passed.
