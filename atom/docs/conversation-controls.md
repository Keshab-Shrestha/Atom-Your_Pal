# Conversation controls

ADR-175 now applies the requested T3 Code visual design to the chat page, including hover/focus message menus and a neutral native layout. Header utilities remain grouped as below. [Current design and evidence](chat-t3-design.md).

## Compact action menus (ADR-174, 2026-10-19)

Keshab requested a calmer chat with more space for messages. The header now has one **Chat options** ellipsis. It contains Find in chat, Saved history, Chat brief, Fork saved chat, Pin/Archive, project folder details/reveal, Chat access, Saved context details and Recovery. The old two utility rows and replay estimate label are removed from the transcript area; the cache-cost notice now lives in Saved context details. A small attention dot and an accessible count keep existing recovery items discoverable. Files / Changes remains a compact workspace icon beside Chat options. Mutation feedback and active work/approval/error cards stay visible. Sheets and popovers are attached to the stable header view, rather than transient menu items.

Each user message has a small **Message actions** ellipsis beside its bubble, containing exact full-message Copy, long-message expansion and available Edit/Retry in new chat actions. Each completed reply has **Reply actions** for Markdown/plain/rich Copy, Reply to this and timing information. The same actions are defined as native context menus and named accessibility actions. These controls add no footer row; a fixed reply gutter avoids a width jump when streaming finishes. Code/table copy controls and checked file links remain beside their specific content. Copy still uses the existing checked clipboard writer and accessibility announcement; menu actions do not add a persistent Copied label. Existing fork/history/brief/permission/send checks are unchanged.

This is a native presentation change without provider, protocol, storage, migration or permission changes. Verification: all **745 Swift tests / 137 suites passed**, the signed release build passed with ATOM Local Signing, and all **80 gallery scenes / 14 visual comparisons passed**. Reviewed the dark and daylight chat scenes and updated only those two references; final comparison deltas were 0.101% and 0.000%, with the largest other baseline delta 0.238%. The final build has no warning from the new menu component. No TypeScript code changed in this presentation batch.

Live signed app: verified Chat options contents; opened and closed Saved history, Chat brief without saving, Chat access, Saved context details and Recovery. Verified reply format choices and exact fictional plain-text copy by pasting into the unsent composer; Reply to this produced the expected unsent quote. Both test drafts were cleared. Message actions showed Copy/Edit/Retry; no fork or retry was executed. The final rebuilt app no longer shows the cache notice above chat; it remains visible in context details. A fictional project chat exposed its folder details/reveal command in Chat options and its direct Files / Changes icon opened the workspace. Restored the original Juniper fictional chat, prior collapsed project sidebar state and empty composer; app left Ready with no running work or approval.

Logs: `/tmp/atom-chat-menus-swift.log`, `/tmp/atom-chat-menus-build-final.log`, `/tmp/atom-chat-menus-gallery-final.log`. Gallery: `/tmp/atom-chat-menus-gallery-final`. VoiceOver, all selectable-text context-menu combinations and every long-message/menu focus combination are not live-certified. Existing pure copying/collapse/history/fork/brief tests passed; serialization, gates and callbacks were not changed. These layout changes remain local and uncommitted/unpushed. The earlier workspace/Git upgrade commit **818b644** was pushed and all GitHub checks passed: https://github.com/Keshab-Shrestha/Atom-Your_Pal/actions/runs/39192624047 . Prior implementation notes below are historical.

Implemented 2026-10-18, ADR-155, as Keshab's requested complete conversation-controls batch. TypeScript checking and Swift release compilation pass. Tests, gallery, app launch, migration execution and live acceptance were skipped by request. The installed app is unchanged; changes remain local on `main`.

## Edit, retry and fork

Saved history opens a read-only sheet with First/Reload, Previous, Next and Latest saved. Each response contains up to eight saved messages and an 8 KiB JSON budget. Large messages continue in exact text chunks; Copy this part copies that chunk. UTF-16 cursors avoid splitting surrogate pairs. Latest starts at the last eight saved messages and may still need Next for large messages. This sheet is separate from the live transcript's 50-turn display limit and Find in loaded messages.

Each saved user message offers Edit in new chat and Retry in new chat. Both copy the saved prefix **before** that user message into a fresh chat, then put the original prompt in an unsent draft. Review, edit and explicitly send it. Fork through here includes the selected saved message; Fork saved chat includes the whole saved transcript. Reopened transcript user rows expose Edit/Retry in their Message actions menu when the host supplied their saved sequence number. Newly streamed rows use Saved history until they have authoritative saved numbering.

The original transcript is unchanged. Existing file/network effects are not rolled back. A fork copies saved text, project association and the chat's own provider/model choice. It does not copy a provider session, exact-file chat grants, attachment bytes, running jobs or pending approvals. Current project configuration and policy still apply. Historical attachment text is only data; reattach files and obtain any required permission before new work.

Forks require an idle foreground turn and idle source chat. The selected history revision must still match. Missing/archived projects refuse new forks. Copy limits are 20,000 source messages and 16 MiB of copied text; a restored prompt must fit 128 KiB. The normal composer send limit still applies, so a large restored prompt needs editing or attachment before submission.

SQLite creates the child transcript and a request record in one transaction. The request UUID determines its private chat id. Check result resends the same request, reopening an existing child without creating another or restoring/sending input again. A retained tombstone prevents a deleted child from being resurrected by that old request. This is fork-creation deduplication, not an exactly-once guarantee for model or file effects. A lost initial response can leave the prompt unrestored; it remains in the source history. A changed composer is never overwritten.

The latest failed turn's Review retry restores its prompt to an empty writable composer without sending. An unsaved failed prompt cannot supply a saved fork point.

## Pin, archive and Undo

Chat menus and sidebar context menus persist Pin/Unpin and Archive/Unarchive. Pins sort first. Archived chats move into Archived chats in the sidebar; an open archive remains readable, with its composer disabled. The native host also refuses new window text/voice turns while archived. Waiting input is held for review. Chats shared with Telegram, routines or the Local API cannot be archived here; their other writer would otherwise keep using them.

Undo pin/archive reverses the latest acknowledged organization change only if its metadata version still matches. It is transient, not a durable undo history. Archive is not deletion. Existing permanent Delete chat remains separate and cannot be undone by this control. Unknown mutations stay pending with Check result; metadata version conflicts require refresh rather than silently overwriting a newer change.

Existing databases gain `pinned`, `archived` and `flags_version` columns, defaulting to zero, plus `chat_branches` request records. Fork creation never prunes another chat. Ordinary future saves retain up to 200 unprotected plain chats or 500 unprotected chats per project, excluding pins, archives and source chats with a living child fork. Protected chats can exceed these counts; explicit deletion is still allowed. Branch tombstones persist after deletion. Project deletion cleanup enumerates all associated ids, including protected chats. No aggregate protected-history quota or tombstone cleanup UI is added.

The normal summary limits remain 60 plain chats and 60 per project, augmented by up to 500 pinned and 500 archived summaries. Show all loaded chats expands the native list; it does not fetch an unlimited chat catalog. Saved-history paging covers messages within an available saved chat.

## Context and provider limits

Saved context shows a **fresh saved conversation replay byte estimate** against the existing 48,000-byte replay budget, estimated archive text size, omitted message count and total saved message count. It is not a provider token/context meter or actual disk allocation. It excludes system prompts, tools, in-flight input and SDK memory; a live provider session can differ from a fresh replay estimate. The full archive is retained subject to the chat retention policy above.

The current gateway exposes no manual Compact operation. The UI says so; this batch does not send a `/compact` string as a user prompt, reset the provider session or invent SDK support. Exact provider context telemetry and a supported manual Compact remain future work.

Claude's existing `rate_limit_info` supplies an optional reset timestamp and limit status. These now cross the gateway/protocol into the native UI as **last reported** information. Unknown timestamps/status stay absent; a passed timestamp does not prove quota is restored. Prepare last prompt for later creates an unsent retry fork. Nothing is scheduled or sent automatically. Codex/Gemini reset telemetry and durable limit scheduling remain unsupported.

## Verification limits

`pnpm typecheck` and `swift build --package-path apps/mac/island -c release` pass. Static review covers parser bounds, SQL transactions/version checks, fork request reuse, archive send refusal and stale response handling. Two pre-existing Swift warnings remain in `IslandSettings.swift` and `main.swift`. No tests were added/run, no production database was opened for verification, and no app was installed/launched. Runtime migration, restart/transport failures, paging Unicode, keyboard/VoiceOver behavior and real provider reset handling have not passed live acceptance.

Next broader area: reading/work visibility (elapsed work time, folded tool log, question cards/access indicator), scoped separately. Selection-aware editor work, durable delivery, provider parity and workspace/Git remain separate roadmap items.
