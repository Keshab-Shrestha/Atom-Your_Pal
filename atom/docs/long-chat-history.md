# Long-chat recovery — 2026-10-18

22 October continuation: [automatic continuity summaries](chat-continuity-summaries.md), ADR-190, extend this recovery mechanism without replacing archives or permission records. The new capability has compiler evidence only; earlier test results below do not certify it.

ATOM keeps the full saved transcript and selects a smaller conversation window for model replay. Claude and Codex can recover earlier messages through read-only tools scoped to that chat. This supersedes the earlier no-retrieval limitation in ADR-135.

## Replay and persistence

- The default conversation replay budget is 48,000 UTF-8 bytes, including the current question and a small per-message overhead, with at most 120 archived messages. When exceeded, selection advances to a recent suffix using about half the byte/message budget. Codex holds that start position as the chat grows, until it needs to advance again.
- This is a conservative conversation-text budget, not a provider token meter. System instructions, memory, skills, tool schemas and provider-native tool history have separate costs. Provider context limits can still fail explicitly.
- The current question is never silently shortened. An oversized question is refused before sending it, with a request to shorten it or attach the text as a file. Existing archived turns remain unchanged.
- Claude's cold replay and large shared-chat catch-up are bounded. A live or resumable Claude session retains the SDK's own context/compaction behavior; ATOM does not interrupt background agents just to reset context. Codex reopens its thread when the selected archive window changes, using the existing prefix check.
- Selection affects provider input only. `history()`, persistence, reopening and provider changes retain the full archive. Previously discarded messages cannot be recovered. Existing chat-count retention still applies.

## Own-chat tools

Claude receives `search_chat_history` and `read_chat_history` through its ATOM MCP server. Codex receives `atom_search_chat_history` and `atom_read_chat_history` through the checked host router.

| Tool | Input | Result |
| --- | --- | --- |
| Search | Literal `query` of 1–200 characters; optional exclusive `before` message number | At most eight matching excerpts, newest first, with IDs and `nextBefore` for older matches. Case insensitive; no regex or semantic search |
| Read | Optional `message` number (default 1) and `offset` (default 0) | At most eight messages and 8 KiB of JSON per page, chronological. `next.message` and `next.offset` continue, including within a long message |

IDs such as `m17` are one-based positions in this chat's archive. They remain stable when messages are appended, persisted and reopened. Read offsets count UTF-16 code units; clients should follow returned cursors. Paging preserves original text, including Unicode and control characters, without splitting valid surrogate pairs. Search excerpts may be partial; use Read for the original text.

The host binds the reader to one chat. Neither tool accepts a chat ID. After switching chats, an older session can read only its own persisted archive; a removed archive is empty. These tools are for the main assistant, not workers or isolated text-edit sessions. Historical text is data, not new instructions or file permission. Existing policy, approvals and explicit grants remain authoritative.

The Gemini CLI remains tool-free. It gets bounded replay and an explicit omission notice, with instructions to request the missing detail or suggest Claude/Codex instead of pretending to retrieve it. Existing `search_chats` for other saved chats is unchanged.

## Verification

- Unit checks cover replay size, stable window growth, literal search/pagination, deep matches in large messages, complete Unicode/control-character reconstruction, malformed cursors, unknown other-chat arguments and cancellation.
- Real SQLite archive plus scripted Codex JSON-RPC and Claude SDK checks recover an initial fact absent from the replay, preserve every archived message across reopening/provider change, retain Codex's prefix on the next turn, and isolate old chat readers after switching/removal. A native shared-chat regression bounds a large catch-up while preserving the archive and live Claude session. Codex worker tests verify archive tools are not inherited.
- A **real signed-in Codex** run reopened an 82-message fictional chat, recovered “Friday at 09:40” through a checked history tool despite its absence from the initial model context, answered correctly and preserved the original archive (one test, no skips, about 12.5 seconds). This tests the Core/router/provider path, not a long-chat UI interaction or a real Claude account. The updated ATOM runtime was then restarted while idle; the real window opened in Ready state with no running jobs.

Repeat the opt-in check with:

```sh
ATOM_LIVE_CODEX_TESTS=1 node --test --test-name-pattern='recover an omitted fact' tests/codex.live.test.ts
```

No provider fallback, generated summary, new database schema, dependency, chat UI paging or context-meter UI is introduced. See [STATUS](../STATUS.md) for current check totals and [the roadmap](upgrade-roadmap.md) for subsequent work.
