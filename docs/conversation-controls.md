# Conversation controls

Implemented 2026-10-18, ADR-155, as Keshab's requested complete conversation-controls batch. TypeScript checking and Swift release compilation pass. Tests, gallery, app launch, migration execution and live acceptance were skipped by request. The installed app is unchanged; changes remain local on `main`.

## Edit, retry and fork

Saved history opens a read-only sheet with First/Reload, Previous, Next and Latest saved. Each response contains up to eight saved messages and an 8 KiB JSON budget. Large messages continue in exact text chunks; Copy this part copies that chunk. UTF-16 cursors avoid splitting surrogate pairs. Latest starts at the last eight saved messages and may still need Next for large messages. This sheet is separate from the live transcript's 50-turn display limit and Find in loaded messages.

Each saved user message offers Edit in new chat and Retry in new chat. Both copy the saved prefix **before** that user message into a fresh chat, then put the original prompt in an unsent draft. Review, edit and explicitly send it. Fork through here includes the selected saved message; Fork saved chat includes the whole saved transcript. Reopened transcript user rows also expose Earlier message actions when the host supplied their saved sequence number. Newly streamed rows use Saved history until they have authoritative saved numbering.

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
