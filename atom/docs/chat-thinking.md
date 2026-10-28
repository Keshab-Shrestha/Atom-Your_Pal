# Thinking for a chat

19 October 2026, ADR-179. The composer has a Thinking selector next to the provider/model choice. It uses the selected model’s reported levels, not a guessed list based on its name. More thinking may take longer and use more tokens.

**Default** retains ATOM’s existing behavior: Claude extended thinking off, Codex Low (or the catalog default if Low is not supported). Choosing a level affects the next main window chat turn. No message is submitted by choosing it. Existing chats are not opted into more thinking automatically. The preference is saved separately for each chat/provider/model, including before the first reply; switching back to a model restores its choice. New chats start at Default. Explicit forks copy preferences into independent rows; deletion/retention removes saved-chat preferences.

Claude’s installed Agent SDK reports adaptive-thinking and effort support. Supported models offer Off plus the advertised effort levels; older models without adaptive effort offer Off. A non-Off choice uses `thinking: adaptive` and `effort` in the existing checked session. Changing it reopens Claude with its saved session id (or existing replay fallback), retaining archive, brief, drafts and grants. Unchanged settings reuse the session. A background task prevents a changed-context session from being closed underneath it; finish it before sending with the new settings.

Codex’s signed-in app-server `model/list` reports each model’s effort levels. Its next `turn/start` receives the captured effort while the same thread, prefix and host tool policy remain. Catalog discovery only initializes and lists models; it does not create a thread or send a prompt, and refuses unsolicited tool requests. It has a deadline, bounded pagination and owned-process cleanup. Both catalogs refresh independently; a failed refresh retains the last successful catalog. Discovery uses the existing signed-in programs and never reads authentication files.

Unknown/custom model capability data and Gemini CLI do not get invented levels. The menu explains the limitation and offers a real catalog refresh. A previously saved level that stops being offered refuses before a model call; choose Default or refresh to resolve it. This setting does not change worker model pins, background one-shot jobs, voice, API or routine defaults.

## Host and storage contract

`chat.reasoning` carries exact chat/provider/model identity and a level (empty string for Default). The host refuses a noncurrent, shared/read-only, archived or busy chat, a changed model, unsupported level or extra command fields. Native actions bind to the rendered chat/model snapshot, and the label updates from confirmed host state. A turn captures reasoning before asynchronous context/tool work; later preference changes cannot change that request.

The additive `chat_reasoning` SQLite table stores non-secret ids and a bounded effort identifier under a compound chat/provider/model key. It is independent from transcripts, briefs, sessions and file grants. Fork copying occurs inside the existing fork transaction. The `chats` event adds the authoritative supported levels, default, selected/effective choice and limitation note. Older native clients ignore the additive field; new clients do not display a selector against a runtime without that field.

All provider requests still pass through the LLM Gateway/native session path. Tool allowlists, sandbox profiles, approval gates and plan-only billing checks are unchanged. No Full access mode, new external endpoint, dependency, automatic fallback or provider inference is introduced by catalog discovery.

## Verification

TypeScript checking passes. 227 targeted model-settings/native-core/private-wire/provider/memory checks pass, including per-turn effort changes with Codex thread reuse, Claude resume and unchanged permission hooks, async admission capture, model/catalog failure behavior, long input regression, SQLite close/reopen/fork/reset/delete and refusal before writes for stale/shared/archived/busy chats. The installed Claude and Codex catalogs were read without prompts; GPT-6 Luna reports Low/Medium/High/Extra high/Max, while models that support Ultra report it separately. Claude’s catalog distinguishes adaptive effort models from older Off-only models.

755 Swift tests in 139 suites pass, including additive event decoding, older-runtime behavior and captured chat/model command serialization. The signed release build passes. All 89 gallery scenes and 21 visual comparisons pass against the reviewed polish references, with no further reference changes for thinking. The composer snapshot path does not render native menus, so these comparisons do not certify the new menu’s interactions.

Verification completed on 21 October: the full TypeScript suite passes (1,121 passed, eight normal opt-in skips), and the final model-settings check/typecheck passes after adding the Off-only model explanation. The signed app signature also verifies. Native inspection initially timed out when ATOM had no accessible open main window; the user opened it, and opened it again after the deliberate quit/relaunch. No persistent blocker remains.

Live native checks, with no model prompt submitted:

- In the existing fictional notebook chat (Opus 5.5), the menu offered Default (Off), Off and the installed model’s Low/Medium/High/Extra high/Max levels. Selected Medium and observed the host-confirmed label.
- Entered exactly `Cedar thinking check — unsent.` without sending it. Switched to the user’s movie chat: Haiku 5.5 remained Off. Returned to the fictional chat: Medium and the exact draft returned, with the original notebook table/replies intact.
- Quit and relaunched ATOM; after opening its main window, the same saved chat reopened with Medium and the exact draft. Read-only checks independently confirmed the persisted preference and draft. Cleared only the fictional draft and selected Default (Off), confirmed by the native label.
- In another existing fictional exact-reply chat, temporarily switched from app-default Opus to GPT-6 Luna. Its menu offered Default (Low), Low/Medium/High/Extra high/Max and no unsupported Ultra. Selected High and observed the confirmed label, then reset Default (Low) and restored model inheritance (Opus 5.5 / Off).
- Returned to the user’s original movie conversation: Haiku 5.5 / Off, empty composer, Ready, unchanged theme/sidebar arrangement. No chat, transcript, fact, grant, project file or model response was created by the walkthrough.

The menu row was activated with a native selection followed by Return while the composer was empty. Native click-based model selection also worked. Full physical keyboard/VoiceOver/IME combinations and every provider inference behavior are not live-certified.

No new model response has been requested for these checks; adapter protocol/session behavior is verified with controlled transports. Work remains local and uncommitted/unpushed alongside the prior requested desktop polish. The next independent capability is checked access modes; Full access remains separate.
