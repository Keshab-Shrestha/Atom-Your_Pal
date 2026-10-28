# Pasted text and reply quoting

ADR-149–151, implemented 2026-10-18 as a batch explicitly requested by Keshab. Release compilation/static review only. No tests added/run. Gallery, app launch, clipboard/Undo, IME, keyboard and VoiceOver workflows were skipped by request. Installed app unchanged; historical totals do not validate ADR-141–151.

## Hidden controls (B2 / ADR-149)

Command–V in the focused composer/key window cleans pasted text before insertion. Removed Unicode scalars are NUL, U+061C, U+200B, U+200E/F, U+2060, U+FEFF, U+202A–E, U+2066–9, U+E0001 and orphaned U+E0020–E007F tags. A count notice explains the change. Tag sequences in black-flag emoji grapheme clusters ending in the cancel tag are retained. ZWJ/ZWNJ, variation selectors, ordinary language text, newlines and tabs are retained. This is a deliberate subset; it does not remove all invisible characters or neutralize prompt injection.

Short changed text uses the active NSTextView's native insertion at its selection; unchanged short text uses normal paste. A paste containing only removed controls leaves the existing selection untouched. Marked IME text bypasses interception. The clipboard is not overwritten. Native insertion is intended to preserve ordinary text Undo; actual Undo/IME behavior remains unverified.

The interceptor covers unmodified Command–V, preserving the existing file/image paste priority. Edit-menu/context-menu paste and modified paste shortcuts retain native behavior. Before a composer send or local slash-command dispatch, the current draft is checked again. If controls are found, cleanup updates the draft, shows a review notice and stops that send; the user must send again. Programmatic submitComposer also checks. This does not rewrite saved transcripts, arbitrary attached files, previously queued entries, voice input or other application surfaces.

## Long paste files (B6 / ADR-150)

A cleaned Command–V paste of at least 4,000 grapheme clusters, or one that would put the editor over 4,000 after replacing its current selection, becomes a UTF-8 `.txt` attachment. The existing draft/selection and clipboard remain unchanged. The notice says it was attached and reports any cleanup. Nothing sends automatically. Thumbnail/Quick Look and Remove use the existing attachment UI. Other paste routes still retain long text and the existing send-length refusal; they do not automatically create files.

Conversion needs a free slot within the existing five combined file/note limit. Files are nonempty and at most 10 MiB. Full slots, storage failures and oversize input show a notice without consuming clipboard data or editing the draft. The existing runtime refuses attachments in project chats, so conversion there stops with instructions to save the paste in the project folder or use a chat outside the project. ATOM does not write a new file into a project automatically.

Files are stored as `~/Library/Application Support/ATOM/PastedText/Pasted text <UUID>.txt`. The directory is opened without following a final symlink, owner checked and restricted to 0700. Exclusive/no-follow file creation uses 0600, writes are synchronized, and failed writes remove their partial file. Existing files are never overwritten. Only a successful file path enters the ordinary persisted draft references; a draft-save failure still has the existing visible persistence-error behavior.

These bytes persist across restarts and are not subject to the screenshot temp-folder cleanup. They are **not automatically deleted**, including after Send, Remove, Discard or chat deletion, because references can be shared by recovered input. This can accumulate files; no cleanup UI or total-directory quota is added. The clipboard's full text is written locally after cleanup, not logged or sent until explicit submission. Host type/size/secret-path/project checks and per-chat attachment limits remain authoritative. Provider inline expansion still has its existing text budgets; saving a complete file does not guarantee every provider receives every character inline.

## Reply to this (R4 small scope / ADR-151)

Finished nonempty assistant replies offer **Reply to this** beside Copy and as an accessibility action. The model resolves the turn id against the current conversation, refuses read-only/streaming/stale turns, and appends a quote after the existing draft. It requests focus for the composer in the key window. Existing draft text, attachments and queue order are preserved; nothing is submitted.

The quote uses the reply's first 600 characters/eight logical lines, with an ellipsis when truncated, prefixes each line with `> `, and ends with two newlines. Line endings normalize only in the new quote; source history is untouched. Hidden controls are cleaned in quoted text too. If the combined draft would exceed 4,000 characters, the action refuses with a notice rather than truncate the draft. Emoji-only/whitespace behavior follows the same pure text helpers.

This is the saved plan's small whole-reply-excerpt action, not an arbitrary text-selection toolbar, a linked citation chip, a conversation fork or a retry. Precise caret placement/focus, accessibility and layout still need live acceptance. No backend/wire/schema/provider/permission/dependency change.

## Verification

Only `swift build --package-path apps/mac/island -c release` and static review including `git diff --check` were used. Tests and live app checks remain skipped. Next primary chat items: Find in chat (R2), project-path links (R3), and project-file @ search (R5).
