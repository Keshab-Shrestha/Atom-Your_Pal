# Desktop themes and text input

19 October 2026. Requested fixes to Appearance, text fields, chat navigation and spacing.

The desktop now uses the full selected theme palette instead of replacing it with one neutral dark/light palette. Void, Lantern, Lantern Day, Quiet Native, Luminous, Warm and Daylight update the open window, sidebar, native control appearance and companion. The existing stored theme value is retained. The separate Light/Dark shortcuts were removed so there is one theme selection.

Design system is removed from Settings navigation, Overview and global search. The component catalog remains available to internal gallery rendering.

A New chat plus button sits beside the Chats heading and uses the existing draft-aware new-conversation operation. The sidebar is 232 points wide with 8-point side padding (formerly 248/14). Between-exchange spacing is 16 points (formerly 28); user-to-reply spacing is 12 (formerly 24). Existing message menus, saved history and permission state retain their behavior.

## Text fields

Shared multiline form fields wrap and grow, with a visible focus border and 12-point inner padding. Schedule instructions start at five visible lines; longer fields grow to sixteen before scrolling internally. That is a display height, not an input length limit. Notes, agent instructions, chat briefs, task messages, skill source and plugin forms reuse the field. The MCP configuration paste field also uses a growing editor.

Ordinary human-authored text no longer has per-field character/byte caps or counters. Matching native validation, JSON command parsing and storage paths accept the complete text: chat prompts, queued drafts, question answers, chat briefs, schedules/tasks/goals, comments/feedback, agent names/roles/instructions, task labels, manual facts, note titles/bodies, project/chat names, searches and skill editing. Long pastes remain text in the chat composer rather than becoming files automatically. Skill editing reads the whole source and keeps the whole prior file in its backup.

Empty/type/format validation, hidden-control rejection, stale-version/current-chat checks and all permission/approval boundaries remain. Technical identifiers, file/configuration schemas, attachment counts and admission, aggregate draft/recovery storage, search term/result counts and model-generated context/tool/output budgets retain their existing resource protections. Removing a form cap does not promise an unlimited provider context window or disk space. Long instructions can increase provider input usage; this batch does not shorten history, briefs or permissions to compensate.

## Verification

- TypeScript checking passes. 256 targeted helper/memory/wire/native/brief/question/skill tests pass. A schedule with over 50,000 Unicode characters survives create, edit, database close/reopen and task creation exactly. A long human answer survives recovery with the same content hash; changing it cannot reuse the old receipt. Skill source/read/edit/backup and long note/name/fact/brief paths are checked without provider calls.
- 752 Swift tests in 138 suites pass, including long prompts, briefs, names and complete search serialization; the Design system page is absent from user Settings/search.
- Signed release build with ATOM Local Signing passes. Live inspection confirmed all seven palettes visibly change the same open window; Warm was restored. No Design system entry remains in the Settings sidebar or Overview.
- The Chats plus opens the fresh-chat start screen. Reopening the existing notebook conversation retains its table and replies with the denser spacing.
- A fictional 22-line schedule draft exceeding 1,000 characters was pasted through the real editor. The field grew, retained all lines, showed no counter and enabled Create; Undo cleared it. Canceled without creating a schedule or running an agent. Original conversation, empty composer, Warm theme and sidebar order were restored.

No paid model call, project file edit, new permission, schema migration or dependency was used. All 89 gallery scenes render. Reviewed the nine intentionally changed chat, sidebar and settings references and updated only those images; the other twelve references remain unchanged. A separate render verifies all 21 comparisons. Live native screenshots were also inspected. Extremely large input/IME/accessibility combinations are not all covered by these checks.
