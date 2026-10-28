# Native before/after review for preview-input edits

Implemented in source on 2026-10-18, ADR-167, after publishing ADR-160–166 as a3e4363 on origin/main. This expands the existing one-file proposal review; it does not import shell-generated files or apply an untrusted diff.

## Review flow

When the host offers approveFileEdit, ReviewPreviewEdit uses a complete native review instead of the quoted 600-character card. Original and proposed text together must fit 32 KiB of UTF-8 and 1,000 newline-delimited lines. The canonical absolute target path must fit 300 UTF-16 units without hidden controls. Oversized and unchanged reviews refuse; nothing is clipped. Existing strict text/input/source/ownership checks still apply.

The work strip's Review changes button opens ATOM → Board → Needs you, respecting the existing unsaved-edit navigation prompt. The detailed card shows the target path and offers Changes, Before and After tabs. Changes uses the existing bounded text-diff implementation on a background task, marking removals with strikethrough and additions in green; its accessibility text names added/removed content. Before/After provide complete selectable monospaced text in a horizontal/vertical scroll region, with the content exposed to accessibility. Content is literal text; no Markdown, web view, file reopening or code execution occurs in the UI.

Apply change is disabled until diff preparation finishes and the displayed request is current. Decline and Apply answer the captured request id and review token; a stale rendered button cannot answer a newer request. Task cancellation, expiry and runtime restart still remove the pending request. The existing UI presents one current approval; this is not a new concurrent approval inbox or guarantee the user read every character.

## Approval and compatibility

The bridge adds optional fileReview to the existing private approval.request event: path, complete before/after text and a fresh per-request UUID token. The new optional reviewToken on approval.answer must match the bridge's pending review before any approval is accepted. It is a compatibility/staleness guard, not cryptographic proof of rendering or human review and not a new authorization credential for external APIs.

Both the native ApprovalState and host bridge refuse a generic Allow lacking the matching token. The work strip only opens the detailed view; it cannot approve directly. Telegram and local API needs summaries omit text bodies/tokens and expose Decline only for these requests; old/manual generic Allow responses cannot approve them. Native notifications still contain the bounded summary only. The private UI pipe and transient host/native approval state necessarily carry the full review text. No new raw text logging, approval history or external endpoint is added.

Hosts without the optional richer review method retain ADR-166's bounded quoted small-card path. A declined, expired, malformed or unsupported native review never automatically falls back to a small card or Write/Edit. An older installed UI ignores the new optional event field and cannot approve the native review because its reply lacks the token. Upgrading the running UI is therefore required to use it. Protocol version remains one with optional fields; normal approval payloads/answers keep their existing behavior.

The bridge review wait is at most 120 seconds; the existing combined admission/review deadline and parent task deadline can end it sooner. Diff work is bounded by input size and the existing algorithm; cancellation discards late results, but does not prove immediate termination of a background diff computation. Synchronous source/commit filesystem operations retain their prior lack of a hard wall-time bound.

## Apply and undo boundary

The larger UI does not change the actual edit protocol: same-worker source receipts, two serial one-use attempts, current native Read/Write/plan policy, fresh source checks, required verified checkpoint and final staged replacement. Pending/refused/uncertain reviews retain the same worker's target hold against Write/Edit and repeated review. Guarded expected-output hashes remain fixed across completion/restart for normal Undo conflict detection. No new SQLite migration is added in ADR-167; ADR-166's additive checkpoint column remains unexecuted in this development session.

One existing selected file only; no additions, deletion, generated-file capture, multi-file transaction or automatic shell patch import. External editor/in-flight filesystem races, explicit Force semantics, checkpoint retention, ACL/xattr preservation limits and filesystem/SQLite/power-loss uncertainty remain as documented in [reviewed preview edits](codex-preview-edits.md). A preview receipt binds input hashes, not proof that the shell produced the proposed replacement or that a real build/test passed.

## Verification and next step

TypeScript checking, static source/security/diff review and Swift release compilation pass (48.16 seconds; /tmp/atom-file-review-release-final.log). No tests added/run, app/gallery launch, accessibility/keyboard/live UI acceptance, checkpoint/apply/Undo or runtime migration execution, adapter/provider calls. The installed app is unchanged. ADR-167 remains local/uncommitted/unpushed after a3e4363; unrelated graphify-out is untouched and the known CI repairs remain deferred.

Next independent scope: generated-file proposal capture design that keeps command-controlled content out of unsandboxed filesystem reads, retaining explicit review and source/undo bounds. Multi-file apply, general real-project shell writes, built-in hosted search, tool-enabled/recursive children and omitted browser operations remain separate.
