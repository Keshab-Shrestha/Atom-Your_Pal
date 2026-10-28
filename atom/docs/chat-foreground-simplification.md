# Chat foreground simplification — 27 October 2026

The user asked for the natural chat presentation of the foreground Codex app. Computer Use denied access to Codex itself, so the current Codex window was not inspected or copied pixel for pixel. This change uses the previously supplied chat references, direct inspection of ATOM, and the apple-design skill's progressive-disclosure and restraint principles.

## Visible changes

- A short “Message ATOM…” prompt and quieter focus border.
- A compact footer with model, thinking and access selections together. A + menu contains file attachment and Skills. Drag/drop, pasted attachments, @mentions and slash commands retain their existing paths. Very narrow panes and larger fonts can wrap controls without dropping them.
- Neutral user bubbles and tighter reply line/Markdown paragraph spacing. The conversation and composer share a centered column capped at 880 points in wide windows.
- Completed foreground replies with no observed calls or questions omit the routine elapsed-time row. Live work, stopped/failed work, tool calls, omitted observations and questions retain their work disclosure.
- Completed/background task results move from a permanent transcript row to Chat options → Task results. Existing reports, host evidence, working-copy review and Git confirmation remain available there. Git listing for this view occurs when it is opened.

## Boundaries and verification

Native presentation only: no provider prompt, permission, memory, saved history, Stop handler or draft persistence changes. The previous uncommitted stopped-task-summary correction remains intact; unrelated graphify-out/ is untouched. No commit/push requested for this slice.

Verification completed:

- Final native release compilation passed (AtomIsland: 54.04 seconds), packaging with ATOM Local Signing passed, and strict deep signature verification passed. Existing main.swift capture and Swift build-system deprecation warnings remain.
- The focused chat gallery rendered 13 scenes with isolated preferences and no runtime/model calls. Visually inspected representative dark/light everyday layouts, larger text in a narrow window, empty chat and a multiline draft. Unsupported native menu drawing in ImageRenderer was corrected by using the same static labels in snapshots; live menus retain their original actions and checks.
- The running app restored the selected Cedar chat, project filter, Haiku 5.5, Off thinking, Saved permissions and the existing whitespace draft after relaunch. At the current window size the footer uses one row (previously two).
- Live + menu exposed Attach files and the existing Skills submenu. Chat options → Task results opened all six current-chat fixture tasks. Opening task 48 retained host evidence, execution details, working-copy metadata, Show changes and the protected/disabled Push control. Closed the panel without changing a task, file or branch.
- Final live access and thinking menus opened with the original choices; dismissed both without selecting anything. Git diff whitespace checks passed.

No model request, unit-test suite or new live computer-task cancellation trial was run. Existing Stop/queue handlers were not changed; visual review does not establish cancellation correctness. Changes remain uncommitted and unpushed.
