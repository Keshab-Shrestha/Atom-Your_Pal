# Native chat input recovery

Implemented 2026-10-18 (ADR-141). Release compilation and static review only; automated tests, gallery rendering and live/manual acceptance were skipped at the user's request. Prior 1,063 TypeScript/733 Swift/75-image totals apply to earlier capabilities, not this change. The installed app was not replaced by this source build.

The panel and main window now use the same per-chat composer. Each edit saves text, local file references and Second brain note ids. Switching views/chats no longer relies on a disappearing view handing its private state back to a stash. A note-only draft is retained too.

## Separate messages and send controls (ADR-142)

Implemented 2026-10-18. Compilation/static review only; tests, gallery and live checks skipped by request. Existing queue expectations were updated but not compiled/executed. Earlier test totals do not validate this change.

Each follow-up keeps its own text, file references, note ids and stable UUID. The live queue runs in FIFO order. Return and the queue button add one message while busy. **Command–Return appends the current draft and sends the oldest live entry now**, using the existing interrupt-and-send path; an empty composer sends the existing head. The head alone has Send next now. Both that button and the shortcut wait while an earlier submission has not begun an active turn. A queue icon, accessible label and visible keyboard hint distinguish Queue from Send.

Each entry has Edit and Remove. Edit needs an empty writable composer and moves only that entry into it; resubmitting adds a new entry at the end. File limits are per message, with no merging of words/files. The combined live/held limit is 20 messages per chat; a full queue keeps the incoming draft. The list scrolls after three rows.

After Stop, a relevant error, leaving the chat, or an app/runtime restart, **all** remaining entries are held for review. Edit and Discard act individually. Reviewing one entry does not re-enable automatic delivery of the others. The saved ordered array is never used to repopulate the live queue. A successful live turn advances only one entry and waits for the submitted turn to start before another idle can advance it. These are native state guards, not a turn-id acknowledgement protocol or proof of provider delivery. A missing attachment suspends the remaining live queue and retains every unsent entry for review.

**Saved input in other chats** opens a known chat in its existing context. Input whose original chat never completed an exchange (or is no longer in the saved list) can be moved into an empty writable current chat only by choosing it. That action carries text/attachment references, not permissions, project context or a provider choice. It is still unsent. The current Mac chat-delete command also removes that chat's local draft/held input; external deletion/pruning does not silently discard orphaned input.

## Local storage

`~/Library/Application Support/ATOM/ChatInput/input.json` is a version-2 plaintext JSON snapshot, separate from transcript/memory/task stores. The application owns its directory (0700). Temporary files are created 0600 with exclusive/no-follow opens, synchronized and atomically renamed over the snapshot. Loading refuses symlink/non-regular/non-owner files, tightens file permissions to 0600 and validates the schema/references. Gallery models receive no store and do not read/write user input.

Version 1 single-message snapshots remain readable: the old waiting message is wrapped as one held entry with a fresh UUID. The next save writes version 2. Version 2 rejects duplicate/malformed message ids and wrong-chat entries. Unsupported versions/corrupt content preserve the original file and disable persistence for that launch; older version-1 code refuses version-2 snapshots instead of overwriting them. No existing user snapshot was opened or modified during development.

Bounds: 100 chat entries, up to 20 combined live/held entries per chat, 128 KiB UTF-8 text per draft or waiting message, five combined files/notes per message and 8 MiB for the encoded snapshot. Oversized input stays in memory with a save-error notice; it is not silently truncated or evicted. Sending still uses the existing 4,000-character limit. Invalid/unreadable snapshots remain on disk and disable persistence for that launch, with a visible notice. Save failures retain the previous snapshot and current in-memory state; retry occurs on subsequent edits. Closing after a save failure can lose those new edits.

Attachment bytes are **not copied** into this store. Ordinary files may move/change/disappear, and clipboard images still use the existing temporary folder/24-hour cleanup. Missing file references remain available to remove or reattach and block submission. Note ids are resolved by the host at send time. Existing runtime type/size/secret/policy checks remain authoritative. Restoring a reference grants no file permission and does not index/send/log the draft text.

## Build record

`swift build --package-path apps/mac/island -c release` completed successfully. The build reported the existing warnings in `IslandSettings.choice` and the dropped-command capture in `main.swift`. `git diff --check` passed. No test command, gallery rendering, app launch or manual workflow was run for ADR-141/142; the installed application remains unchanged.

## Deliberate limits

This is unsent-input persistence, not an acknowledged main-chat turn journal. Local input is removed before transport handoff; a crash in that gap may lose the submission. Conversely, failed local removal can leave an old snapshot for review. Nothing is automatically replayed on restart. This does not guarantee exactly-once delivery, preserve pending approvals, resume provider sessions or recover effects of an interrupted turn.

Composer attachment thumbnails/Quick Look were implemented separately in [ADR-148](chat-attachment-previews.md), compiled only with live checks skipped. Queued/held attachment previews require Edit into the composer. Managed long-paste text files now retain their bytes separately under PastedText ([ADR-150](chat-paste-and-quoting.md)); screenshot retention is unchanged. Manual queue reordering and permanent pasted-image retention remain later proposals. No dependency, backend schema or wire protocol change. Existing queue assertions were updated for ADR-142 but were not compiled or executed; no test suite was run.

## ADR-157 extension (2026-10-18)

ChatInput v3 retains typed in-transit input and question intents until durable host receipts; v1/v2 still load. SQLite foreground records now preserve accepted input/answers and completed replies for explicit recovery. Unknown local messages stay held, with no automatic resend. This supersedes the earlier unsent-only scope for identified native sends, without claiming exactly-once effects. Compiled only; tests/migration/live checks skipped. [Current behavior and limits](foreground-recovery.md).
