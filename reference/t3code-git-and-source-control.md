# T3 Code: git and source control

> Review update (2026-10-17): [second source review](t3code-second-review-2026-10-17.md) records corrections and pinned evidence. Use the [combined roadmap](../docs/upgrade-roadmap.md) for current ATOM status. Detailed observations below retain the earlier snapshot unless updated explicitly.

Source: https://github.com/pingdotgg/t3code (MIT licence). Read at commit `2fbd4318` (2026-10-17), in a shallow clone.
All paths below are relative to the root of that clone, unless a path starts with `ATOM:`.
ATOM paths start with `ATOM:` and are relative to this repository.

How to read this file:

- "Verified" means I read the code or the document named.
- "Not found" means I searched and found nothing.
- "Unverified" means I did not run it or I could not confirm it.
- T3 Code is the MIT-licensed work of its authors. Copy ideas, not code, unless the licence note is kept.

## 1. Feature list

### 1.1 Branches (refs)

- List refs, local and remote, with search and paging. The current ref and the default ref come first. Type `VcsRef`; function `listRefs`.
- Create a branch (`createRef`), switch to it (`switchRef`), rename it (`renameBranch`), delete a local one (`deleteLocalBranch`, `-d` unless `force`).
- Switching to a remote branch makes a local tracking branch (`checkout --track`). Verified in `switchRef`.
- Commit on a new branch: the "Commit on new branch" button sets `featureBranch` in `GitRunStackedActionInput`. A model suggests the name. `resolveAutoFeatureBranchName` makes it unique.
- Push or open a PR from the default branch asks first. The dialog offers "Check out feature branch & continue". See `requiresDefaultBranchConfirmation`.
- Detached HEAD: push and PR actions refuse with "Cannot push from detached HEAD."
- Remote detection: the host comes from the remote URL (`detectSourceControlProviderFromGitRemoteUrl`). Forks get their own remote through `ensureRemote`.

### 1.2 Worktrees

- Each thread runs in "Local" (the project folder) or "New worktree". Verified in `BranchToolbarEnvModeSelector.tsx`.
- Worktree path: `<worktrees folder>/<repo name>/<branch with "/" changed to "-">`. Verified in `createWorktree`.
- The branch starts as `t3/<8 hex>` (`buildTemporaryWorktreeBranchName`). A model renames it after the first message (`ThreadLaunchService.ts`, `generateBranchName`). Naming mode, prefix and instructions are settings.
- Base branch picker (`WorktreeBaseBranchPicker.tsx`). Option "start from origin": fetch first, then branch from the remote commit.
- `createWorktree` writes `branch.<new>.gh-merge-base` into git config, so `gh` knows the base.
- Submodules: a setting picks none, shallow or recursive. A `t3.json` file in the branch can override it.
- Setup script and progress stages: `fetch`, `checkout`, `setup-script`, `agent` (`WorktreeSetupTracker.ts`). The user can cancel.
- Reuse a previous worktree (`PreviousWorktreeItemContent.tsx`).
- A missing worktree is rebuilt on rollback only if its path is in a managed folder (`makeIsManagedWorktreePath`).
- Agents get three MCP tools: `t3_worktree_handoff`, `t3_worktree_status`, `t3_worktree_list` (`apps/server/src/mcp/toolkits/worktree/tools.ts`).
- Remove: `removeWorktree` runs `git worktree remove` (with `-c status.showUntrackedFiles=normal`). A worktree that is already gone is a no-op plus `prune`.
- Automatic cleanup rules (`WorktreeCleanupRules` in `packages/contracts/src/settings.ts`): after N days, after settle, on merge, on delete, when unchanged. Default keeps worktrees with uncommitted changes (`worktreeKeepWhen`).

### 1.3 Commit

- Commit dialog: file list with check boxes, line counts, optional message. Empty message means "generate". Verified in `GitActionsControl.tsx`.
- The model sees the staged file list (cut to 8,000 characters) and the staged patch (cut to 50,000). Verified in `resolveCommitAndBranchSuggestion`.
- `prepareCommitContext` builds the staged view in a temporary index file. The real index stays unchanged.
- `sanitizeCommitMessage`: first line only, no trailing dot, at most 72 characters, fallback "Update project files".
- Style setting "Repository conventions" reads project instructions and recent commit subjects (`resolveStylePolicy`).
- Git hooks run. Hook name, output and exit code stream to the UI (`hook_started`, `hook_output`, `hook_finished`).
- Staging uses `--literal-pathspecs add -A -- <paths>`.

### 1.4 Push, pull, fetch

- Push: `git push -u -- <remote> HEAD:refs/heads/<branch>`. It skips when nothing is ahead (`skipped_up_to_date`). Verified in `pushCurrentBranch`.
- Force push: not found in normal flows. The only `--force-with-lease` is in `packages/source-control-github/src/server/githubStackRebase.ts`.
- Pull: `git pull --ff-only` (`pullCurrentBranch`). A diverged branch shows "Sync ref" disabled with the hint "Rebase/merge first".
- Background fetch: setting `automaticGitFetchInterval`. Per-project `defaultAutoPull` is off by default.
- Publish a local repository: creates the hosted repository, adds `origin`, pushes (`PublishRepositoryDialog`).
- Ahead, behind and ahead-of-default counts are in the status (`VcsStatusRemoteResult`).

### 1.5 Pull requests (change requests)

- One action runs several steps: `GitStackedAction` = `commit`, `push`, `create_pr`, `commit_push`, `commit_push_pr`. Progress events: `branch`, `commit`, `push`, `pr`.
- Create: title and body come from the commit list, the diff summary and the diff (cut to 20,000 / 20,000 / 60,000 characters). A host template can guide it. An open PR for the branch is reused (`opened_existing`).
- Open: the result toast has a call to action `open_pr` with the URL. The status carries the branch PR (number, state, draft).
- Check out a PR into a local checkout or a new worktree: `preparePullRequestThread`, mode `local` or `worktree`. It fetches `refs/pull/<n>/head`.
- PR page: list with filters (`all`, `reviewing`, `authored`); tabs for summary, code, guide, timeline.
- Checks: `PullRequestChecksState` = passing, failing, pending. Each check has a `required` flag.
- Merge state: `PullRequestMergeability` = mergeable, conflicting, unknown. Base comparison: up-to-date, behind, unknown.
- Actions (`PullRequestAction`): merge, ready, draft, close, reopen, delete-branch, update-branch, enable and disable auto-merge, revert, approve-workflows. Merge methods: merge, squash, rebase.
- Review: comments, review threads, line comments as a draft review, verdicts (comment, approve, request-changes), reviewers, labels, reactions, "viewed" marks per file.
- Stacks (GitHub): merge stack and rebase stack.
- Issue linking (host issues, "closes #n"): not found. PR linking to threads exists: a thread links many PRs (`link_pull_request`, `linkedThreads.ts`).
- Agents can watch a PR (`watch_pull_request`). The server checks every 2 minutes and wakes the agent on a failed check, passed required checks, new remarks or a conflict. Verified in `docs/user/source-control.md`.
- Hand-offs to an agent: "Fix findings" and "Resolve conflicts" (`buildResolveConflictsPrompt` in `PullRequestDetailPanel.tsx`).
- Option "Remove agent credits when merging" (`removeAgentCreditsOnMerge`, off by default).

### 1.6 Checkpoints, revert, discard, stash

- A checkpoint is saved after each turn (see 2.5). The user can rewind to before any message.
- The rewind dialog has two buttons: "Revert files too" and "Revert and keep changes". Verified in `ChatView.tsx` (`pendingRevert`).
- Restore refuses when the workspace is shared with another thread (`SHARED_WORKSPACE_RESTORE_MESSAGE`).
- Discard changes of one file: not found.
- Git stash: not found. The "stash" in the web app is a stash of unsent composer prompts (`promptStashStore.ts`).
- Conflict resolution in the UI: not found. T3 Code sends the conflict to an agent as a prompt.
- Interactive rebase, cherry-pick, blame, history graph: not found.

### 1.7 Diff views

- Scope menu: "Changes" (merge base against the working tree), "Uncommitted", "Latest turn", "Turn N". Verified in `DiffPanel.tsx`.
- "Changes" compares the merge base (branch and chosen base ref) with the working tree, so uncommitted work shows too. This is from the code; I did not run it. The user can pick another base ref.
- "Uncommitted" is `HEAD` against the working tree. Staged and unstaged changes are not separate. Untracked files join through `git add --intent-to-add` in a temporary index. Verified in `getReviewDiffPreview`.
- Whole thread diff: `getFullThreadDiff` in `CheckpointDiffQuery.ts`. Per file: `reviewGetDiffFileContents` (old and new contents).
- Layout: stacked or split. Line wrap toggle. Hide whitespace toggle (`--ignore-all-space`). File tree. Collapse all. Refresh. Verified.
- Line comments: select lines in the diff, write a comment, and it goes to the composer (`AnnotatableCodeView.tsx`).
- A file brought in by a pull or merge during a turn is hidden from that turn's diff (`isGitImport`, `listAuthoredPaths`).

### 1.8 Hosts and sign-in

- Hosts: GitHub, GitLab, Forgejo and Gitea, Bitbucket, Azure DevOps, GitCafe.
- GitHub: API with a token. Order: saved token, `GH_TOKEN`, then `gh auth token`. Verified in `GitHubCredentials.ts`.
- GitLab uses the `glab` program. Azure DevOps uses `az`. Forgejo uses `fj`, else `tea`. GitCafe uses `cafe` or a token. Bitbucket uses a token.
- A "Rescan" button in Settings → Source Control detects the programs and the sign-in state.

## 2. Architecture

### 2.1 Layers

```text
Web or mobile UI  --WebSocket RPC-->  ws.ts handlers
   GitWorkflowService -> GitManager (workflows: stacked action, PR, text generation)
      GitVcsDriver (git commands)      SourceControlProviderRegistry (host)
         VcsProcess (run a program)       SourceControlProvider (one per host)
   VcsStatusBroadcaster (status stream)   CheckpointStore -> VcsDriver.checkpoints
```

Verified files: `apps/server/src/ws.ts`, `apps/server/src/git/GitWorkflowService.ts`, `apps/server/src/git/GitManager.ts`, `apps/server/src/vcs/*.ts`.

### 2.2 The host provider interface

- `packages/source-control-core/src/server/SourceControlProvider.ts` defines the service `SourceControlProvider`. A host implements:
  `listChangeRequests`, `getChangeRequest`, `createChangeRequest`, `getRepositoryCloneUrls`, `createRepository`, `getDefaultBranch`, `checkoutChangeRequest`.
- It has optional parts: `headBranchProbe`, `readChangeRequestTemplate`, `repositoryNameFromRemoteUrl`, `refineRepositoryIdentity`, `resolveLink`.
- PR review features are a second interface, `PullRequestProviderApi` (`PullRequestProvider.ts`). It covers list, detail, checks, activity, diff, merge, comments and reviews.
- A driver bundles the parts: `SourceControlDriver { kind, make }`. `make` returns `{ sourceControl, discovery, pullRequests }`. `pullRequests` is null when the build cannot read PRs for that host. See `driver.ts` and `defineSourceControlDriver`.
- `discovery` has three types: `cli` (executable, `versionArgs`, `authArgs`, `parseAuth`), `api` (`probeAuth`) and `managed-cli`. See `discovery.ts`.
- The kind is an open string (`SourceControlProviderKind`). A client that does not know a kind shows a generic view.
- Each host package has a `client/definition.ts` with its words ("pull request" or "merge request"). The registry list is `apps/server/src/sourceControl/builtInDrivers.ts`.
- `SourceControlProviderRegistry` picks the driver from the remote URL. It caches a detection for 5 seconds and an unknown-remote answer for 5 minutes.
- `SourceControlHost` is the service a driver uses to run programs and read settings. It keeps host packages free of server details.
- `SourceControlRateLimit.ts` pauses a host after a rate-limit answer. An `Interactive` flag lets a user action use a reserved quota.
- `packages/source-control-testing/src/TestSourceControlHost.ts` is a fake host for tests.

### 2.3 How git commands run

- All git and `gh` calls go through `VcsProcess.run` (`apps/server/src/vcs/VcsProcess.ts`) and `executeGit` in `GitVcsDriverCore.ts`.
- Arguments are an array. No shell runs. Verified: `ChildProcess.make(executable, args, { cwd, env })`.
- Limits: default timeout 30,000 ms (`DEFAULT_TIMEOUT_MS`), default output 1,000,000 bytes, 8 processes at once, 4 for `gh`. Worktree add: 300,000 ms. Push and commit set their own limits.
- Environment: `executeGit` sets `GIT_OPTIONAL_LOCKS=0`, so status polling does not take `index.lock`.
- Background fetch uses `STATUS_UPSTREAM_REFRESH_ENV`: `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=""`, `SSH_ASKPASS=""`, `SSH_ASKPASS_REQUIRE=never`, `GCM_INTERACTIVE=never`.
- `explicitBareRepositoryEnv` sets `safe.bareRepository=explicit` through `GIT_CONFIG_COUNT`. A folder that looks like a bare repository cannot run its config. Its comment explains the attack.
- `refuseOptionLikeRefName` rejects a ref that starts with `-`. Commands put `--` before refs and paths. Paths use `:(top,literal)<path>` or `--literal-pathspecs`.
- Errors are tagged (`GitCommandError`, `VcsProcessExitError`) with a `reason` (`authentication_failed`, `host_key_unverified`, `remote_unreachable`, and others). The stderr text is not stored: "it echoes argv and remote URLs, which can hold credentials" (`packages/contracts/src/git.ts`).
- `transportSafeSourceControlErrorValue` strips control characters, URL user names, passwords, queries and fragments, and cuts the value to 256 characters.
- `classifyNonZeroExit` maps stderr text to `authentication`, `rate-limited`, `not-found` or `command-failed`.
- A lock-file race is retried twice, 75 ms apart, for checkpoint capture only (`isTransientGitExit`).
- Folder check: `KnownWorkspaces.assertContains(cwd)` checks that a client path is a project, a managed worktree or a thread worktree (`apps/server/src/workspace/KnownWorkspaces.ts`). I found it called only in `WorkspaceFileSystem.ts`. I did not find it in the git handlers of `ws.ts`. Treat that as unverified.
- Per-folder lock: `withWorkspaceLease(cwd, effect)` serialises work on one folder (`workspaceLease.ts`).

### 2.4 Status: polling and push to clients

- `subscribeVcsStatus` (`WS_METHODS`) opens a stream. `VcsStatusBroadcaster.streamStatus` sends `snapshot`, then `localUpdated` and `remoteUpdated` (`VcsStatusStreamEvent`).
- The server caches local and remote status with a fingerprint. It sends an event only when the fingerprint changes.
- Remote status (upstream, ahead and behind, PR) is polled per folder. Default interval 30 seconds. After a failure the delay doubles from 30 seconds up to 15 minutes (`remoteRefreshFailureDelay`).
- One poller serves all subscribers of a folder. Passive observers set `includeRemote: false` and cause no polling.
- Local status has no file watcher. I found `fs.watch` only for keybindings, settings and themes. Local status refreshes after each git RPC (`refreshGitStatus` in `ws.ts`), when the git menu opens and when the diff panel gets focus.
- PR lookups are cached. Failures use a growing TTL (`prLookupFailureTtl`). The last known PR is kept while a lookup fails.
- The client merges events with `applyGitStatusStreamEvent` (`packages/shared/src/git.ts`).

### 2.5 How checkpoints are stored

- A checkpoint is a normal git commit under a private ref. It does not touch the user's branch, index or stash.
- Ref name: `refs/t3/orchestration-v2/checkpoints/<scope key>/ordinal/<n>` (`checkpointRefForScopeOrdinal`). The older helper `checkpointRefForThreadTurn` uses `refs/t3/checkpoints/<thread>/turn/<n>`.
- Capture (`GitVcsDriver.ts`, `checkpoints.captureCheckpoint`):
  1. Copy the real index to a temporary file in the git common dir. Set `GIT_INDEX_FILE` to it.
  2. `read-tree HEAD`, then `add -A -- .` (tracked, changed and untracked files, not ignored ones).
  3. `write-tree`, then `commit-tree <tree> -p HEAD -m "t3 checkpoint ref=<ref>"`.
  4. `update-ref <ref> <commit>` with `core.fsync=objects,reference` so a crash cannot leave empty ref files.
  5. Remove the temporary index in all cases.
- The author is "T3 Code <t3code@users.noreply.github.com>". Parent `HEAD` lets `listAuthoredPaths` see how `HEAD` moved.
- Special cases handled: sparse checkout, an embedded repository with no commit (excluded and retried), no `HEAD` yet.
- Restore (`restoreCheckpoint`): `git restore --source <commit> --worktree --staged -- .`, then `git clean -fd -- .`, then `git reset --quiet -- .`. Ignored files stay. Verified.
- Diff (`diffCheckpoints`): `git diff --no-color --no-ext-diff --no-textconv` between two refs. Output limit 10,000,000 bytes (`CHECKPOINT_DIFF_MAX_OUTPUT_BYTES`). Paths go in batches of 24,000 characters (`batchFilePaths`) for the Windows command limit.
- Stale refs after a rewind are deleted with `update-ref -d` (`deleteStaleRefs`, `deleteCheckpointRefs`).
- The rollback service (`CheckpointRollbackService.ts`) checks that the checkpoint is `ready`, the provider is still active and the worktree is isolated (`CheckpointRestoreSafety.ts`). The UI refuses while a turn runs.

### 2.6 Text generation

- `TextGeneration` has `generateCommitMessage`, `generatePrContent` and `generateBranchName`. Each runs on the model the user picked in Settings → Source Control (`sourceControlWriterModelSelection`).
- Prompts are in `packages/provider-core/src/server/textGenerationPrompts.ts`. The commit prompt asks for a JSON object with `subject` and `body`. The subject is imperative, at most 72 characters, no final dot.
- I did not find text in `buildCommitMessagePrompt` that marks the patch as data, not instructions. Unverified for the other prompts.

## 3. How the UI presents it

- Branch toolbar (`BranchToolbar.tsx`): a workspace chooser (Local or New worktree), an environment chooser, and a branch chooser (`BranchToolbarBranchSelector.tsx`). The chooser can also check out a PR when the user types a PR reference.
- A started thread locks its workspace choice (`envLocked`). The label then shows the worktree.
- Git actions control (`GitActionsControl.tsx`): a split button. The main button is a "quick action" that changes with the state: Commit, "Commit & push", "Commit, push & PR", "Push & create PR", Pull, "Publish repository". `resolveQuickAction` picks it in `GitActionsControl.logic.ts`.
- The menu next to it lists Commit, Push and Create PR. A disabled item shows the reason in a tooltip (for example, "Branch is behind upstream. Pull/rebase before pushing.").
- The control needs the permission `canWriteSourceControl`.
- Commit dialog: title "Commit changes". File list with check boxes, "+/-" counts, an edit-files mode, message field with placeholder "Leave empty to auto-generate". Buttons: Cancel, "Commit on new branch", Commit.
- Default-branch dialog: states the action and offers to continue or to "Check out feature branch & continue".
- Progress: a status line with the stage ("Generating commit message...", "Pushing to origin...", "Creating pull request..."), elapsed time and the last hook output line.
- Result toast: stays 10 seconds on success (`GIT_ACTION_SUCCESS_VISIBLE_MS`). It has one button. The server sets the kind: `open_pr` opens the URL, `run_action` runs a next step, `none` shows no button.
- Diff panel (`DiffPanel.tsx`): scope menu, base ref combobox with a local/remote switch per ref, line stats, refresh, collapse all, stacked/split toggle, wrap toggle, whitespace toggle, file tree. Uses the `@pierre/diffs` library (verified in imports).
- Truncation: the server marks a diff `truncated` and appends a marker. The preview limit is 120,000 bytes (`REVIEW_DIFF_PATCH_MAX_OUTPUT_BYTES`); one file up to 1 MiB.
- Pull request page (`components/pullRequest/`): list rows with state, checks and conflict glyphs; a detail panel with a primary button that changes with the state (merge, mark ready, enable auto-merge); a checks popover that groups checks; "Resolve conflicts" button when `mergeability` is `conflicting`.
- Thread panel (`ThreadPullRequestsPanel.tsx`): the PRs linked to a thread, grouped by stack.
- Rewind dialog: "Edit from here?" with "Revert files too" (destructive style) and "Revert and keep changes".
- Settings (`SourceControlSettings.tsx`, `SourceControlHostSettings.tsx`, `StorageSettings.tsx`): host status and sign-in help, writing style, branch naming, worktree location, cleanup rules.

## 4. Where to look

| Feature | File (T3 Code) |
| --- | --- |
| Git commands, status, commit, push, pull, worktree | `apps/server/src/vcs/GitVcsDriverCore.ts` |
| Checkpoint ops (capture, restore, diff) | `apps/server/src/vcs/GitVcsDriver.ts`, `apps/server/src/vcs/VcsDriver.ts` |
| Run a program safely | `apps/server/src/vcs/VcsProcess.ts` |
| Status stream and polling | `apps/server/src/vcs/VcsStatusBroadcaster.ts` |
| Commit, PR, stacked action | `apps/server/src/git/GitManager.ts` (`runStackedAction`, `runCommitStep`, `runPrStep`) |
| Service that the RPC layer calls | `apps/server/src/git/GitWorkflowService.ts` |
| RPC handlers and method names | `apps/server/src/ws.ts`, `packages/contracts/src/rpc.ts` |
| Git schemas (status, actions, errors) | `packages/contracts/src/git.ts` |
| Host schemas and sign-in states | `packages/contracts/src/sourceControl.ts` |
| PR schemas | `packages/contracts/src/pullRequest.ts` |
| Diff preview schemas | `packages/contracts/src/review.ts` |
| Host interface | `packages/source-control-core/src/server/SourceControlProvider.ts`, `PullRequestProvider.ts`, `driver.ts`, `discovery.ts` |
| Host registry | `apps/server/src/sourceControl/SourceControlProviderRegistry.ts`, `builtInDrivers.ts` |
| GitHub sign-in | `packages/source-control-github/src/server/GitHubCredentials.ts` |
| GitLab through `glab` | `packages/source-control-gitlab/src/server/GitLabCli.ts` |
| Rate limit | `packages/source-control-core/src/server/SourceControlRateLimit.ts` |
| Checkpoint refs and scopes | `apps/server/src/orchestration-v2/CheckpointService.ts` |
| Rewind and restore safety | `CheckpointRollbackService.ts`, `CheckpointRestoreSafety.ts` (same folder) |
| Turn and thread diffs | `apps/server/src/checkpointing/CheckpointDiffQuery.ts`, `Diffs.ts` |
| Worktree creation for a thread | `apps/server/src/orchestration-v2/ThreadLaunchService.ts` |
| Worktree folder rules | `apps/server/src/worktreesDirectory.ts` |
| Worktree cleanup | `apps/server/src/storageCleanup.ts` |
| Allowed folders | `apps/server/src/workspace/KnownWorkspaces.ts` |
| PR watch and link | `apps/server/src/orchestration-v2/pullRequestWatch.ts`, `apps/server/src/git/linkCreatedPullRequest.ts` |
| Commit message prompt | `packages/provider-core/src/server/textGenerationPrompts.ts` |
| Branch name helpers | `packages/shared/src/git.ts` |
| Git actions button and dialogs | `apps/web/src/components/GitActionsControl.tsx`, `GitActionsControl.logic.ts` |
| Branch toolbar, base branch picker | `apps/web/src/components/BranchToolbar.tsx`, `BranchToolbarBranchSelector.tsx`, `WorktreeBaseBranchPicker.tsx` |
| Diff panel and diff parts | `apps/web/src/components/DiffPanel.tsx`, `apps/web/src/components/diffs/` |
| PR page | `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` |
| Rewind dialog | `apps/web/src/components/ChatView.tsx` (`pendingRevert`) |
| Status in the client | `packages/client-runtime/src/state/vcs.ts` |
| User guide | `docs/user/source-control.md`, `docs/user/project-settings.md` |

## 5. What ATOM has today, and the gap

### 5.1 ATOM today (verified)

- Worktree per task: `ATOM:apps/mac/src/worktree.ts`, `prepareWorkdir(folder, taskId, worktrees)`. Branch `atom/task-<id>` (old `zeno/task-<id>` kept). Worktree path `<worktrees>/task-<id>`, outside the repository.
- It runs `git worktree add -b <branch> <tree>`. It gives no start point, so the branch starts at the current `HEAD` of the repository.
- Commit: `commitWork` runs `git add -A`, then `git commit --no-verify` as "ATOM". The message is `ATOM task <id>`. It runs when the agent ends (`ATOM:apps/mac/src/native-safety.ts`, `agentEnded`).
- Guard: `worktreeIntact` checks that `.git` in the worktree is still a file that points into the repository. Git runs with `core.hooksPath=/dev/null` and `core.fsmonitor=false`.
- List: `ATOM:apps/mac/src/git-branches.ts`, `zenoBranches(repo)`. For each branch it shows commits since the base, changed files with counts, the remote address without credentials, and `pushed` = `no`, `yes` or `changed`. The base is `origin/HEAD`, else the current branch.
- Diff: `branchDiff` gives `base...branch` as one text. Limit 200,000 characters. Only task branches (`BRANCH_PATTERN` in `ATOM:apps/mac/src/branch-prefix.ts`).
- Push: `pushBranch` runs `git push --no-verify origin refs/heads/<b>:refs/heads/<b>`. Never forced. No prompts (`GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS`, `SSH_ASKPASS` empty). Timeout 120 s. Error text goes through `cleanRemote` and is cut to 200 characters.
- Wiring: `ATOM:apps/mac/src/island-wiring.ts`, `createIslandGit`. `allowedRepo` refuses a repository that is not in a granted folder. Commands `git.list`, `git.push`, `git.diff` are in `docs/island-protocol.md` (lines 279-281). `ATOM:apps/mac/src/island-commands.ts` checks `repo` is an absolute path and `branch` matches `BRANCH_COMMAND_PATTERN`.
- UI: `ATOM:apps/mac/island/Sources/AtomIsland/DashboardView.swift` (`GitSection`, `GitBranchCard`, `DiffText`) and `HelpersGit.swift` (`GitBranch`, `canPush`). Push shows an alert with the commit count and the remote. `DiffText` shows 400 lines, colours added and removed lines.
- Undo of file edits outside git: `ATOM:services/helpers/src/checkpoints.ts` (copies before the first edit, hash check, `force` for a changed file, 14-day sweep). Files inside the worktree are left to git (`checkpointBefore` in `folder-run.ts`).
- ADR-129 added a text diff engine in Swift (`TextDiff.hunks`). It diffs two texts, not git patches.

### 5.2 Gap against T3 Code

| Area | T3 Code | ATOM |
| --- | --- | --- |
| Pull request | Create, open, status, checks, merge | None. The user opens the host by hand after the push |
| Host detection | From the remote URL, six hosts | Only `origin` address shown. No host name |
| Base branch | Chosen by the user, saved in git config | Not saved. Guessed at read time (`baseOf`) |
| Ahead and behind | Counts for upstream and default branch | Commit count since base only. No "behind" |
| Branch cleanup | Rules, protect dirty trees, remove worktree | None found (no `worktree remove` in `apps/mac/src`) |
| Commit message | Model writes it from the patch, then it is sanitised | Fixed text `ATOM task <id>` |
| Per-file diff | Lazy per-file, old and new contents | One text for the whole branch |
| Diff options | Split, wrap, hide whitespace, file tree | Unified text, first 400 lines |
| Status refresh | Stream with fingerprint, 30 s remote poll | `git.list` when the Dashboard opens only |
| Per-run snapshot in git | Checkpoint refs | Not needed yet: one commit per task |
| Conflict help | Host mergeability, hand-off prompt to agent | None |

Probable bug or gap (unverified at run time): `createIslandGit` lists only repositories found from `helpers.list()[].grants`. ADR-122 removed per-agent folders, and `prepareWorkdir` now uses `team.project.cwd`. A project folder that no helper has in its grants may never show on the Dashboard. A test would settle it.

## 6. Ideas for ATOM, ranked

Rules that apply to every idea: push only on the user's confirmed click, never by a worker or model, never forced, no secret in code or logs, no new heavy dependency.

### 6.1 Safety checks from T3 Code that ATOM should copy

1. `safe.bareRepository=explicit` on every git call (`explicitBareRepositoryEnv`). ATOM guards the worktree link, but the project folder itself can still hold a planted bare repository. Needs git 2.38 or newer; older git ignores it.
2. `GIT_OPTIONAL_LOCKS=0` on read-only calls, so ATOM never blocks the user's own git.
3. `--no-ext-diff --no-textconv` on `branchDiff` and `zenoBranches` (`diffCheckpoints` does it). Risk today is low because the sandbox cannot write `.git/config`. The change is cheap.
4. Add `GCM_INTERACTIVE=never` and `SSH_ASKPASS_REQUIRE=never` to the push environment, as `STATUS_UPSTREAM_REFRESH_ENV` does.
5. Strip control characters from error text, as `transportSafeSourceControlErrorValue` does, and keep the length cap.
6. Keep stderr out of structured errors. ATOM already cuts and cleans it. Add a `reason` tag (`authentication_failed`, `host_key_unverified`, `remote_unreachable`) so the card can give the fix in plain words.
7. Restore only in an isolated worktree (`isCheckpointRestoreIsolated`). ATOM's worktree per task already isolates. Keep it if ATOM adds a "reset" action.
8. Protect work before delete: T3 Code keeps worktrees with uncommitted changes (`worktreeKeepWhen`). Copy this for any ATOM cleanup.
9. `refuseOptionLikeRefName` and `--`. ATOM covers this with `BRANCH_PATTERN`. Do not loosen the pattern (for example, to add a title slug) without the same checks.
10. Treat generated text as data. Show it to the user before it leaves the Mac (ADR-123).

### 6.2 Ranked ideas

**1. "Open pull request" button after a push (size S)**

- What: a button on the branch card that opens the host's "compare" page in the browser.
- Why: ATOM stops at the push. The user must find the page by hand. T3 Code makes the PR through the host API or the host program; ATOM needs no token for this.
- Fit: the click only opens an address. No push, no credential, no API. Build the address in code from `cleanRemote(origin)` and a branch that matches `BRANCH_PATTERN`. Allow `https` only. Build it for known hosts only (GitHub, GitLab).
- First step: add `hostOf(remote)` in `ATOM:apps/mac/src/git-branches.ts` with a test. Return `{ kind, compareUrl }` in the `git` event. Port: `detectSourceControlProviderFromGitRemoteUrl` (`packages/shared/src/git.ts`).

**2. Fix the branch list scope and refresh it (size S)**

- What: list repositories from project folders as well as grants. Send a `git` event after `commitWork` returns true.
- Why: see the gap in 5.2. T3 Code pushes status to the client (`VcsStatusBroadcaster`). ATOM refreshes only when the Dashboard opens.
- Fit: read-only. The `allowedRepo` check must use the same list, so the rule stays "granted or project folder".
- First step: write a test with a project folder and no grant. Then change `grantedRepos` in `island-wiring.ts`.

**3. Save the base at creation; show "behind" (size S)**

- What: when `prepareWorkdir` makes the branch, store the base ref and its commit in the helpers store. Show "behind N" with `git rev-list --left-right --count <base>...<branch>`.
- Why: today `baseOf` guesses at read time, so a diff can change when the user switches branch. T3 Code saves `gh-merge-base` and shows ahead and behind.
- Fit: read-only git. Keep it in ATOM's store, not in the user's git config.
- First step: add a `base` column for the task. Add the count to `ZenoBranch`. Show a warning badge in `GitBranchCard`.

**4. Hardening pack (size S)**

- What: items 1 to 5 of 6.1 in one change to `git()` in `worktree.ts`, `branchDiff` and `pushBranch`.
- Why: cheap, and each item closes a known attack or a hang.
- Fit: least privilege. No behaviour change for the user.
- First step: add the `-c safe.bareRepository=explicit` option and `GIT_OPTIONAL_LOCKS=0` to `git()`. Run the existing tests in `git-branches.test.ts`.

**5. Discard a task branch on a confirmed click (size M)**

- What: a "Discard…" button. It removes the worktree and deletes the branch.
- Why: ATOM never removes worktrees, so they pile up (I found no removal code). T3 Code has `removeWorktree`, `deleteLocalBranch` and cleanup rules.
- Fit: the user confirms. The card shows the commit count that would be lost and whether the branch is pushed. Refuse if the worktree has uncommitted changes. Run `git worktree remove` without `--force`. Delete with `-d`; use `-D` only after a second confirmation for an unpushed branch. Only `BRANCH_PATTERN` branches and only worktrees inside ATOM's `worktrees` folder (as `makeIsManagedWorktreePath` does).
- First step: add `discardBranch(repo, branch)` with tests for dirty tree, unpushed branch and already-gone worktree (treat as success and `prune`).

**6. Better commit message (size S, then M)**

- What: S: use the task's report title as the subject. Clean it with the `sanitizeCommitMessage` rules (first line, no final dot, 72 characters). M: let a small model write it from the staged patch.
- Why: `ATOM task 7` tells the reviewer nothing. T3 Code writes real messages.
- Fit: the message is data. It goes only into a local commit. The user sees it on the branch card before any push. The S step uses no new model call (deterministic first).
- First step: pass `helpers.report(job)?.title` into `commitWork` and sanitise it. Keep `ATOM task <id>` as the fallback.

**7. Per-file diff and diff options (size M)**

- What: `git.diff` takes an optional `file`. Add a hide-whitespace toggle (`--ignore-all-space`) and a file list that opens one file.
- Why: a 400-line cut hides most of a large branch. T3 Code loads one file at a time and marks truncation.
- Fit: read-only. Use `:(top,literal)<path>` for the path, as T3 Code does. Check the path is in the branch's file list first.
- First step: split `branchDiff` output by `diff --git` headers in TypeScript. Send file names first, and send a file's text on request.

**8. Read-only PR status through `gh` (size M)**

- What: after a push, show the PR state and checks. Run `gh pr view <branch> --json state,statusCheckRollup,mergeable` with fixed arguments.
- Why: it closes the loop (pushed, PR open, checks green, merged). T3 Code has `PullRequestChecksState` and `PullRequestMergeability`.
- Fit: uses the user's own `gh` sign-in. ATOM never reads the token. T3 Code runs `gh auth token` and calls the API itself. ATOM should not copy that part. Run on click only, or poll no faster than every 2 minutes as T3 Code's watch does. Show nothing if `gh` is missing. PR titles and comments are data from other people (ADR-123).
- First step: write `prStatus(repo, branch)` with a timeout, an output limit and a JSON parser. Test it with a fake `gh`.

**9. Local conflict preview (size S, not from T3 Code)**

- What: run `git merge-tree --write-tree <base> <branch>` to learn whether the branch merges cleanly. Show "may conflict" on the card.
- Why: T3 Code relies on the host's `mergeability`. ATOM has no host call, and this one needs no working tree.
- Fit: read-only. Needs git 2.38 or newer. Unverified here: I did not run it.
- First step: add `mergeCheck(repo, base, branch)` and a test with two branches that edit the same line.

**10. Checkpoint refs for a task with several runs (size L, later)**

- What: save a private ref (for example `refs/atom/checkpoints/<task>/<n>`) with a temporary index, as `captureCheckpoint` does.
- Why: it gives per-run diffs and "undo this run". Today one task makes one commit, so it is not needed yet.
- Fit: private refs are not pushed (`git.push` names one branch). Do it when tasks resume across runs and the user asks for per-run review.
- First step: none now. Keep the idea. Re-read `GitVcsDriver.ts` lines 793-1060 when needed.

**11. Hand-off prompts: "Resolve conflicts", "Fix review findings" (size M, later)**

- What: a button that starts an agent task in the same worktree with a fixed prompt.
- Why: T3 Code does this instead of a conflict UI. It fits ATOM's agent model.
- Fit: the user starts the task. The agent commits to the task branch and never pushes. Review comments are untrusted text (ADR-123).
- First step: wait for idea 8.

### 6.3 Not recommended for ATOM now

- A provider interface for six hosts (`SourceControlDriver`). ATOM needs one link builder first. Add the interface when a second host needs API calls.
- API tokens for hosts stored in ATOM. They add secrets to handle.
- Model-written branch names. ATOM's push rule depends on the strict `atom/task-<id>` pattern.
- Running repository hooks. T3 Code runs them and streams the output. ATOM disables them on purpose, because they would run outside the sandbox.
- Auto-pull, auto-merge, stack merge, `--force-with-lease`. Each acts without a fresh click.
- A watcher that wakes an agent on PR events (`watch_pull_request`). It lets text from others start work. Needs its own ADR.
- Cherry-pick, rebase UI, stash. T3 Code has none of these either (not found).
