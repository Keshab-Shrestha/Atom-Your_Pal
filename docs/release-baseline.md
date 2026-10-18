# Release baseline — 2026-10-18

Scope: repair the existing release checks and verify the everyday continuity/edit/recovery paths before adding further capabilities. Earlier deferred-test notes describe their original batches, not this baseline run.

## Repairs

- Native rich-file approvals already required a matching review token. ComputerBridge's public answer callback accidentally omitted that fourth argument, refusing valid Apply answers. Forward it unchanged; generic, expired and mismatched answers remain unable to apply.
- Three island tests expected obsolete sequence/error output. Their expectations now match the existing sequenced chat events and held-input notice.
- An explicit chat-find binding setter replaces the method reference implicated in the Swift 6.3.3 CI compiler crash. Local Xcode uses Swift 6.4; the remote build is required to establish compatibility.
- A Telegram push timer can wake before its wall-clock deadline. Such a check now schedules the remaining wait instead of dropping the retry. A frozen-clock regression covers that case and duplicate prevention.
- ImageRenderer cannot draw some AppKit controls. Gallery mode now renders their labels, omits native composer drop/focus plumbing, and stacks chat rows vertically. Runtime controls retain their native actions. Five reviewed references cover the intended chat controls/copy actions and corrected fixture layout/composer. The pixel tolerance stays at 1%.

## Evidence

| Check | Result and boundary |
| --- | --- |
| `pnpm typecheck` | Passed. |
| `pnpm test` | 1,071 passed, 8 skipped, 0 failed (1,079 total). Opt-in provider tests are not counted as passed when skipped. |
| `sh apps/mac/island/test.sh` | 736 tests in 135 suites passed. |
| `swift build -c release --product AtomIsland` | Passed locally with Swift 6.4. Existing actor/capture warnings remain. |
| `ATOM_LIVE_CODEX_TESTS=1 node --test tests/codex.live.test.ts` | Both signed-in checks passed: omitted fact retrieval after reopening; checked edit, retained context and later rewrite using one explicit exact-file/chat grant. Fictional temporary data only. |
| Native rich review | Seven new host/filesystem integration cases plus three native protocol/state cases. Valid complete review >600 characters applies; Undo restores after reopening SQLite; later human edits remain conflicts; changed source, missing undo storage, oversized review, generic/stale/late approval and Stop refuse replacement. This is not an automated click through the rich card. |
| Existing recovery and permission checks | Focused fixture checks passed for task cancellation, durable file-grant reopen/isolation and abrupt process recovery with explicit retry. |
| Visual gate | 75 generated fixtures; all 12 golden comparisons passed (maximum 0.166% changed pixels). Five changed images reviewed before updating. Gallery substitutes labels for unsupported native rendering; it does not verify native interaction, accessibility or scrolling. Some older unrelated native-control placeholders remain in fixtures. |
| GitHub CI | All three jobs remain required: TypeScript, Swift and visual. Consult the [main workflow runs](https://github.com/Keshab-Shrestha/Atom-Your_Pal/actions/workflows/ci.yml?query=branch%3Amain) for the published revision; local compilation alone is not Swift 6.3.3 evidence. |

Local logs are under `/tmp/atom-baseline-*.log` and may disappear. The regressions and commands above are the durable reproduction route. Coverage percentage was not measured. Newer browser, external MCP, advisory-worker and shell-preview features retain their individually documented acceptance gaps; passing this baseline does not certify all of them. No distribution/signing/notarization claim for other Macs.

The rebuilt, locally signed app reached Ready. After quitting/relaunching and reopening the fictional Juniper chat, it correctly recalled Juniper / Friday / riverstone. The real Stop button ended a separate fictional response after three seconds with zero observed tool calls, returned Ready, and added a Stopped recovery record. Review → Restore put that prompt into the composer without sending; Ready and the draft were observed together, then the fixture draft was cleared. The chat and recovery record remain available for inspection. No real user file or password was involved in these UI checks.
