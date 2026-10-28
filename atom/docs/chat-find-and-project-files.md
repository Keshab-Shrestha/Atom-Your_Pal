# Chat find and project-file navigation

ADR-152–154, implemented 2026-10-18 in an explicitly requested three-feature batch. Release compilation/static review only. No tests added/run. Gallery, app launch, live keyboard/Finder/VoiceOver and security acceptance were skipped at the user's request. Installed app unchanged; historical totals do not validate ADR-141–154.

## Find in loaded messages (R2 / ADR-152)

In the main Chat window, Command–F opens Find in chat. Other pages retain global/sidebar Find, and Shift–Command–F always opens global/sidebar search. The menu actions require the main window to be key, with no sheet or shortcut recorder. No global key monitor is added.

Search is literal, case-insensitive and non-overlapping over the loaded user transcript and assistant reply source strings. It includes Markdown syntax, not only rendered prose. Queries are limited to 128 characters and results to 500; `500+` means more matches exist. An empty query has no matches. The UI shows a highlighted source excerpt and a current/total counter. Previous/Next buttons and Return/Shift–Return wrap among results. Escape or Close hides the bar. Key handlers defer while the field has marked IME text; actual IME behavior is not live verified.

The selected turn is outlined and scrolled into view after a guarded deferred request. Navigation targets the turn rather than a character offset, so a hit deep inside a very long turn may still require manual scrolling. A user-side hit temporarily expands a collapsed user message; the manual expansion preference is retained. The result snippet highlights the matching text; the renderer does not highlight individual spans inside Markdown blocks. Native end-following is suspended while Find is open. Closing Find keeps the current reading position/follow latch, with Scroll to end available when away. Replay, chat switch and conversation reset clear Find state.

This searches the current visible window, normally at most 50 turns. It does not load archives, search other chats, alter provider context or retrieve older history. Search data stays in memory and is never logged or sent to a model. Streaming/trimming, exact scroll placement, focus and keyboard/accessibility behavior remain live-unverified.

## Project paths in replies (R3 / ADR-153)

Finished replies in an active project can show file chips beneath the reply. Candidate extraction recognizes inline-code text, Markdown link targets and simple bare slash-separated paths. At most 24 candidates are examined from the first 64,000 characters, with up to eight valid unique files displayed. Complex Markdown/filenames may not be recognized; backticks and spaces work through code/link candidates, while bare-path grammar is intentionally narrower. Optional `:line`/`:line:column` suffixes are stripped; Finder selects the file, not an editor line.

Clicking a chip reveals/selects the existing file in Finder. Local file/relative Markdown links in a turn also use the same checked navigation, rather than opening arbitrary filesystem URLs. Other URL schemes keep their existing system handling. Missing/outside files produce a notice. No external editor is launched and no file bytes are read.

## Project files in @ (R5 / ADR-154)

Typing a trailing `@query` in a writable project chat searches names and relative paths. The token accepts letters, digits, `-`, `_`, `.` and `/`, up to 120 characters; spaces end it. File selection can still insert paths containing spaces. A 180 ms debounce precedes cancellable background metadata traversal. Stale query/chat/project/read-only results are discarded, and Escape cancels/closes the picker search.

The scan visits at most 5,000 entries, checks a 300 ms traversal budget between metadata operations, retains at most 200 candidates and displays six file rows. It does not guarantee a hard filesystem-call timeout or a complete project listing. Results are sorted naturally; a limit notice asks for a narrower query. Hidden entries, package descendants, symlinks and common dependency/build directories (`node_modules`, `vendor`, `build`, `dist`, `target`, `Pods`, `DerivedData`) are skipped. Gitignore files are not parsed; there is no shell, Git process, Spotlight query or persistent index.

File rows precede ordinary matches in the existing eight-row picker, reserving the existing A file… row when present. Helper/note behavior is retained. Selecting a project file revalidates its current metadata and inserts a backticked relative path followed by a space into the unsent draft, replacing only the trailing mention. It does not attach/copy/read the file, send a message or grant authority. A 4,000-character overflow leaves the draft/mention intact with a notice. The existing host project tools decide whether/how the model can read that reference after explicit submission. File attachments remain restricted in project chats as before.

## Native metadata boundary

Both features use the current runtime-supplied ProjectInfo. Missing/archived projects, changed/symlinked roots and invalid roots are unavailable. Roots must be a nonhidden project below the user's home (excluding Library) or a subfolder of a mounted volume. Files must be regular files strictly inside that root with identical standardized/canonical paths. Traversal and symlink targets are rejected, even when a symlink points back inside the project. Hidden components, backticks, controls/selected hidden scalars, `.pem` files and `id_rsa`/`id_ed25519` names are excluded. This UI policy is deliberately conservative; some files allowed by host tools may not appear here.

Existence/containment is checked again before insertion or Finder reveal. These checks do not pin filesystem identities against concurrent renames/replacements. Finder reveal is UI navigation, not a model read/write grant. Authoritative runtime project, secret-path, provider and tool checks remain unchanged. Metadata workers do not read contents, log paths, submit provider requests or store file lists. Snapshot rendering skips metadata tasks and Finder actions.

## Verification and next work

Only release compilation and static review, including `git diff --check`, were performed. Two initial Swift integration errors were repaired before successful compilation; there is no passing behavioral/security test claim. No runtime/wire/schema/provider/permission/dependency changes. All 16 primary C/B/R chat-plan items now have scoped implementations. Live acceptance, selection-editor work, arbitrary-selection quoting, archive paging and the broader roadmap remain outstanding. Next broader area: conversation controls, beginning with scope for editing/retrying earlier messages.
