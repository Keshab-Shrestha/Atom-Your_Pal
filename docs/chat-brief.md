# Chat brief

Open a saved writable chat, click **Chat brief** near Saved history, and keep the project, decisions or next step you want ATOM to have on every request. Click **Save for this chat**. A new chat needs a saved exchange before its brief is available. The editor is unavailable while a request is active.

For example:

```text
Project: Juniper
Launch decision: Monday
Next step: prepare the one-page outline
```

The brief is optional and maintained by you. Ordinary archived history and history-recovery tools continue to work without it. It is not an automatically accurate summary of everything said. New corrections in your current request take precedence; update the brief when you want to retain a changed decision.

## Persistence and scope

The latest saved value accompanies each request in that exact chat, outside the conversation replay window, on Claude, Codex and tool-free provider routes. No extra model call is made. It survives app restart and provider changes. This is additional prompt data, not an expansion of the provider's context window.

Other chats and forks start with an empty brief. A fork may precede decisions in the current brief, so copying it could carry future or superseded information into that branch. The brief is stored in the existing local chat database and follows that chat's retention/deletion policy; pin important chats if you need to retain them under the existing retention rules.

Clear the editor and save to stop including its text in future requests. Earlier versions may remain in a provider session or prior provider requests; clearing is not remote erasure or proof that the model forgot the fact. The archive itself is not rewritten.

## Save behavior and access

- Limit: 4,000 UTF-8 bytes. Japanese/emoji consume more than one byte. Newlines and tabs are supported; hidden controls are refused.
- Save requires the current idle writable chat. Telegram, routine and shared API chats cannot be edited through this control.
- A version check refuses an overwrite when another edit has already won. Your draft remains available to copy/reconcile. **Replace draft with saved** explicitly reloads the current stored value.
- A missing acknowledgement leaves Save unconfirmed. **Check save result** can repeat the same operation; it cannot overwrite a newer version. Saving a newer local draft requires a separate Save.
- The brief goes to the chat's selected model when the next request is made. Brief text is background data, never file permission or global memory. Existing exact-file/chat grants, protected-file checks and approval cards remain authoritative. Writing “allow all files” here grants nothing.

## Verification — 2026-10-18

Typecheck, 1,076 TypeScript tests (eight normal opt-in skips), 738 Swift tests, signed release compilation, 75 gallery fixtures and all 12 image comparisons passed locally. Two reviewed chat-reference images include the new button. No coverage percentage was measured.

New fixture checks cover legacy database migration and reopening, Unicode and byte limits, hidden controls, lost acknowledgement, stale-save conflict, explicit clearing, archive/grant preservation, missing/deleted chats, empty forks and cross-chat isolation. Scripted provider checks cover replay rollover, gateway-to-Claude switching, latest edits and clearing in a live SDK session. A runtime wire check verifies busy/noncurrent/shared/read-only brief writes never reach storage. Native checks cover bounded decode and the versioned save/receipt shape.

Live in the rebuilt app, using fictional data only:

1. Saved Juniper / Monday / mosslight / prepare the one-page launch outline through the native editor.
2. Quit and relaunched, reopened the chat and observed the same brief.
3. Asked for its current decisions without supplying their values. Codex returned Monday, mosslight and the outline step, superseding the older Friday/riverstone conversation context.
4. Edited the brief to Tuesday / copperfern / review the launch outline. The next reply used those new values.
5. Cleared and saved, then reopened the editor; it remained empty. Left the app Ready, with an empty fixture brief and no unsent input.

Live cross-provider switching, arbitrary very-long-chat behavior, every conflict/timeout UI path and automatic decision extraction are not claimed. The broader continuity phase still benefits from daily use and feedback. No shared editor, workspace/Git capability, generated-file import or provider fallback was added.
