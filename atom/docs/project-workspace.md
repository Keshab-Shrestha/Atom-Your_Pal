# Files / Changes workspace

Follow-up ADR-172 adds a read-only **Git** tab for actual working-tree changes, per-file comparisons and existing conflict stages. See [Git workspace](git-workspace.md) for its independent scope/evidence; checkpoint coverage below is unchanged.

ADR-171, 2026-10-19. One project workspace outcome, authorized as a whole batch after the continuity upgrades.

Open **Workspace** from the chat top bar and choose Files, Changes or Git. ADR-182 adds a resizable split, a surface chooser, retained per-surface previews and keyboard controls. In narrow windows it covers chat until closed. [Pane behavior and verification](workspace-pane.md). Other chats’ drafts and permission scopes keep their existing behavior.

## Files

- Browse one folder at a time, return with Up, and filter the loaded folder by name. Each listing examines at most 1,000 names and returns at most 300 entries / 128 KiB, with an explicit limit notice. It is not a recursive search or a complete project index.
- Preview complete read-only UTF-8 text, at most 32 KiB and 1,000 lines. Binary, invalid UTF-8, hidden-control and oversized content refuse rather than truncate. Bodies render literally, never as Markdown, HTML or executable content.
- **Add to chat** adds a file reference to the current unsent draft. It never sends a message or grants permission. Existing attachment checks/copying run when the user sends.
- **Open → Open in editor…** chooses an application and passes the checked file URL through NSWorkspace, without shell commands. **Reveal in Finder** selects the file; the folder view can open the project in Finder. Targets are checked again after the editor picker.
- Hidden, generated, protected, symlinked and hard-linked file paths are excluded. Generated directory exclusions match existing project navigation. File previews do not automatically go to a model.

## Changes

Changes lists retained ATOM task checkpoints inside this project's exact canonical root, newest first (at most 200 / 256 KiB). Each row names the project-relative path, task number/text, task state, modified/created kind and checkpoint state. It queries checkpoint provenance independently of the Board's recent-job display limit. Metadata for a removed file can remain visible; preview of a missing file refuses.

A review compares the verified saved original with the **current on-disk text**. It offers Changes / Original / Current views. The current file can include edits made after the named task; those reviews explicitly disable Undo. This does not reconstruct a historic after-image that was never stored.

**Undo this file change…** requires a fresh review and a separate confirmation. The token binds the exact checkpoint, task, absolute target, original hash and current hash. The host checks the current writable project chat, root availability, current task/file state and hashes again. It refuses active work, later edits, missing/damaged originals, stale or absent tokens and links; it never exposes Force. Undo restores a modified file or removes the exact created file. Duplicate relative names from different grant roots cannot undo another file.

This uses existing checkpoint storage and restore behavior; no database migration, parallel archive or new file grant is introduced. Copies normally expire with existing 14-day cleanup. Completed Undo remains visible while its checkpoint metadata is retained. Lost responses time out with an instruction to refresh; Undo is never automatically repeated.

**Scope:** tracked task edits only. Ordinary Git-worktree edits may have no checkpoint, and shell writes are not checkpointed. The workspace says this explicitly and links to the existing Dashboard branch review. General working-tree discovery, per-file Git diffs, branch/commit/pull/push/conflict improvements, editing file bodies, generated-file import and multi-file apply remain the separate Git/tool upgrades. Refresh is explicit; there is no filesystem watcher or automatic opening after a task.

## Boundaries

The private JSON-line `workspace` command/response carries a request UUID, source chat, project, action and project-relative path. List/read/changes/review are local deterministic requests, not provider tools. Only the current writable local project chat can use them; Telegram/routine/shared API chats refuse. The host resolves the project from the existing store on every request. Paths never select arbitrary roots. Native state rejects old, timed-out or mismatched results and clears preview bodies on navigation/restart. Errors avoid raw OS details and file content; bodies, paths and task text are not added to logs.

As with existing checkpoint restore, checks and atomic rename do not provide a filesystem-wide transaction or prevent an external editor from racing in the final check/write interval. This feature does not add a power-loss/metadata preservation guarantee or change the Board's separately confirmed Force behavior.

## Verification

- `pnpm typecheck` passed. Full TypeScript suite: **1,091 passed, eight normal opt-in skips, zero failures**. Seven real-filesystem/store checks cover Unicode roots, metadata/list limits, protected/link/binary/size exclusions, store reopen, exact provenance, wrong task/target, active work, damaged originals, stale review, exact created-file removal and duplicate-relative-path isolation. A focused wire check also refuses wrong chat/project, Telegram/routine/shared API chats and busy Undo, with no model call.
- Swift suite: **743 tests / 137 suites passed**. New checks cover command/receipt serialization, old/cross-chat results, oversized previews, uncertain Undo timeouts and workspace identity. Count/recency updates preserve previews; real chat/root/access changes invalidate them.
- Signed release bundle rebuilt with the existing `ATOM Local Signing` identity. **78 gallery fixtures** include file lists, task provenance, literal previews, original/current diff and daylight layout. All **13 visual comparisons passed** (largest delta 0.166%); the new reviewed workspace reference also matched a separate render exactly (0.000%). No existing reference was changed.
- Real UI: created a **Cedar Workspace Check** project containing only fictional data in `~/Documents/ATOM-workspace-check-kQerNh`. Browsed root/src, filtered the folder, previewed both files, added an unsent attachment without sending it, opened the exact file in TextEdit and verified Finder selected the same URL. The test attachment was removed before the later deliberate task request.
- A real Kame task **#30** changed `launch.txt` from Wednesday to Thursday using the existing checked file flow. Changes showed task provenance and complete Original/Current text. Native confirmation Undo restored Wednesday on disk and showed Undone. Quit/relaunch retained the saved project chat and Undone record. A second new project chat saved a deliberate reply-only request (seven seconds, zero observed tool calls) while the current preview remained open; project chat count advanced from one to two. This verifies the first-save refresh correction discovered in the walkthrough.
- The app is left Ready with the fictional project's workspace open, sidebar restored, no pending approval/running task and an empty composer. The earlier fictional Stop-recovery record is retained. Fixture files/chats are examples, not user work. No push or remote CI for this local revision is claimed.

Remaining coverage: failure/crash/power-loss races and all external editors/drive providers are not live-certified by these checks. Existing checkpoint restore limitations still apply. General Git workflow, uncheckpointed shell/working-tree discovery and generated/multi-file apply remain separate upgrades.
