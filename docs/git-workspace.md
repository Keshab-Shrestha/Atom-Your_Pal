# Git review in the project workspace

ADR-172, 2026-10-19. This is the next review capability after Files / Changes, not the complete Git roadmap.

Open a writable project chat → **Files / Changes → Git**. Refresh reads the current local working tree. It shows the branch (including unborn/detached states), configured upstream and ahead/behind counts when available. Counts use local refs; Refresh never fetches.

Changed paths are grouped as **Conflicts**, **Staged**, **Unstaged**, and **Untracked**. A file with both staged and later working edits appears in both groups. Renames keep their source name. Tracked deletions can be reviewed even when the working file is gone. Hidden/protected/generated/link paths and submodules are excluded, following the workspace's existing rules. A project below a repository root sees paths in that project folder only; cross-boundary renames are omitted rather than reading outside the project.

Select a file for its complete bounded raw-text comparison:

- Staged: HEAD original → index entry; a staged rename uses its original HEAD path.
- Unstaged: index entry → working file; an unstaged rename uses its original index path.
- Untracked: absent original → working file.
- Conflict: exact unmerged **Ours / Theirs** index stages, with **Base** separately available. Missing stages show as absent/empty. This is an inspection of existing conflict state, not a proposed resolution or a merge feasibility prediction.

**Before / After / Base** preserve literal source text. **Ignore whitespace** only normalizes spaces, indentation and trailing whitespace in the comparison view; literal tabs retain exact source. No patch is applied. Files remain subject to the workspace's complete UTF-8, control-character, 32 KiB / 1,000-line limits; binary/oversized or unsupported entries refuse rather than truncate. Attach working file and Reveal in Finder recheck the existing working-file target, so a deleted file cannot be attached or opened as a different file.

## Host boundaries

New `workspace` actions `git` and `gitReview` use the existing request/chat/project identity checks; `gitReview` also identifies one of the four sections. Git reads are asynchronous; previous-chat results are withheld. The project root and availability are rechecked after reading. Native state matches request, source chat/project, action, path and section before showing a result.

No shell is used. Fixed Git argument lists disable hooks, fsmonitor, optional index writes, interactive prompts and implicit bare-repository discovery. Inherited `GIT_*` routing/config variables are removed. Status suppresses submodules. Configured clean/smudge/process filters are overridden to empty with required=false before status can invoke them; the window explains raw-byte differences for repositories using filters. File versions come from raw `cat-file blob` objects and the checked disk reader, not external diff/textconv commands. HEAD/index are rechecked around each file comparison. Raw Git stderr, credential values and executable filter configuration never enter the protocol or logs. The existing task-branch diff/stat path now also explicitly disables external diffs/textconv, and remote/error display strips control codes before credential sanitization.

One Git read runs at a time. Each subprocess has an eight-second timeout and a 256 KiB stdout/stderr budget. The native request can time out while bounded host reads finish; refresh is explicit and no operation retries automatically. Status returns at most 200 entries / 128 KiB, with an explicit limit notice; very large raw status output refuses before returning a partial list. This is a point-in-time inspection, not an atomic repository snapshot or filesystem watcher.

## Task working copies (23 October 2026)

Native coder completion now leaves changes uncommitted, including when a task explicitly forbids commits. The originating chat can open its task report, actual tracked working-copy diff, path and existing Push control without switching to Dashboard. Dirty copies disable Push; the host also refuses while edits remain or a task is queued/running. Commit explicitly in Terminal after review. The terminal initially uses the original project directory; the copied, shell-quoted `cd` command identifies the isolated task copy and is never executed automatically. New untracked contents are not included in task patch previews until staged. Task working-copy status/diff uses the same bounded, filter-disabled Git environment as project review. Existing historical commits are preserved. [Live task-32 acceptance](workflow-fixes.md).

## Scope and remaining Git work

The project Git pane has no stage, commit, fetch, pull, push, merge, resolve, reset or delete action. Task-branch push remains separately confirmed and now also refuses dirty/running tasks. Task-branch discovery beyond helper grants, PR links/status, conflict prediction and confirmed branch cleanup remain separate. The Git tab discovers the current registered project's working tree directly, without relying on helper-grant branch discovery. Checkpoint Undo remains on Changes; uncheckpointed Git/shell writes are not offered an invented Undo.

## Verification

- TypeScript checking passed. Full suite: **1,101 passed / eight normal opt-in skips / zero failed**. Real temporary repositories cover staged/unstaged/mixed edits, spaces, staged and unstaged rename sources, deletion, untracked files, unborn/detached heads, local divergence, actual merge conflict stages, subfolder isolation, disabled executable filters/drivers, inherited Git routing, excluded/oversized/invalid files, unchanged index bytes and access revocation during an awaited read. The focused wire test also checks changed-chat withholding and section-matched refusal receipts.
- Swift: **744 tests / 137 suites passed**. Native checks cover source-stage request identity, literal source preservation and presentation-only whitespace normalization. Existing workspace regression tests remain green.
- Live app: reused only the fictional `Cedar Workspace Check` fixture, initialized it as a local repository, and prepared one staged file, one working edit and an untracked draft. No personal files were staged, committed or pushed. The pane showed `main`, no upstream, and the three distinct groups; the hidden fictional `.env` and `.git` were excluded.
- Staged review showed `src/readme.md` HEAD with “review the launch outline” and index with “approve the launch outline.” Unstaged `launch.txt` showed Wednesday → Thursday against the index. The whitespace checkbox changed only comparison presentation. Fictional unmerged index stages in `conflict-check.txt` exposed Wednesday Base, Thursday Ours and Friday Theirs. The working conflict markers and index remained unresolved; a before/after SHA-256 confirmed the fixture index stayed byte-for-byte unchanged across the UI reads. No provider request, network fetch or resolution was triggered.
- The final signed release bundle rebuilt successfully with the existing ATOM Local Signing identity. All **80 gallery fixtures and 14 visual comparisons passed** (largest unchanged-baseline delta 0.166%). Reviewed the new Git status/conflict scenes, including daylight; added the Git status reference and updated the workspace reference for its new Git tab. The 12 older baseline references remain unchanged. The app was reopened and left Ready on the fictional project’s Git status with an empty composer and no active task/approval. The fictional conflict remains explicitly unresolved for inspection. This batch remains local and uncommitted/unpushed with ADR-171; prior remote CI is not evidence for the new revision.

Not live-certified: every custom filter/drive implementation, pathological repository sizes, malicious same-user filesystem races and all rebase/cherry-pick conflict variants. The comparisons are bounded point-in-time reads. Ours/Theirs retain Git's stage meaning; this view does not infer source-branch intent or prescribe a resolution.
