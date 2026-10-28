# Reopen the last saved chat

ATOM now returns to the saved writable chat you last had open. Its conversation, project/model choice, saved brief, existing file permissions and locally saved draft remain associated with that same chat. Open a saved chat once after this update to establish the choice. No newest-chat guess is made for an installation that has no recorded selection.

**New chat** is an explicit fresh start: quitting before its first saved exchange will reopen fresh, rather than revive the previous conversation. Once a new chat's first exchange is saved, it becomes the remembered selection automatically. Unsaved new-chat drafts remain in the existing held-input recovery flow; they do not turn an unsaved session into a saved conversation.

## Startup behavior

The existing memory database stores one window-selection identifier. Only island/window mode uses it; terminal, Telegram, API and routine cores keep their existing startup behavior. Background exchanges do not select their chats on the window's behalf.

At runtime construction, before command listeners and voice requests can run, ATOM validates the saved chat's metadata and project availability and resumes its existing replay. Transcript selection uses the same replay path as manually opening the chat. Native tools still check the project's actual folder/access on use.

After voice warm-up, the runtime sends Ready and the current conversation/list through existing protocol events. It takes the current selection at that moment, so a manual New chat or other choice made during warm-up cannot be overwritten by late startup history. When idle and a fresh start is appropriate, an empty conversation snapshot also clears the previous runtime's displayed history.

Reopening only loads local conversation state. It does not send a prompt or draft, replay queued input, grant access, answer cards or restart stopped/uncertain work. Existing recovery records and explicit review/send requirements remain in force. Other enabled schedules retain their existing behavior.

Deleted, pruned, archived, Telegram/routine/shared API chats and chats belonging to unavailable/archived projects are not automatically reopened. The app starts fresh, without choosing a different saved chat. Existing transcript retention applies; this preference does not pin or preserve a chat forever. A storage problem gives a generic notice and leaves manual chat selection available; raw storage details/chat text are not added to navigation logs.

## Verification — 2026-10-19

- Typecheck and full TypeScript suite: 1,083 passed, eight normal opt-in skips, zero failed. The final focused run includes the first-save selection check.
- Swift: 738 tests in 136 suites passed. No Swift sources changed in this capability.
- Signed release bundle rebuilt; 75 gallery fixtures and all 12 comparisons passed. Reference images unchanged. Coverage was not measured.
- New real SQLite/Core/island-wire checks reopen a database, resume the exact selected transcript/model, retain its brief and file grant, observe no provider call or speech until an explicit request, and show that a newer background exchange does not win selection. New chat clears selection, and a newly saved first exchange establishes a new one.
- Additional checks cover empty/deleted/archived/other-surface targets, unavailable projects, checked project replay, warm-up New chat precedence, retention/deletion and nonfatal storage failure without exposing raw error text.
- Real app, fictional data: selected the saved Juniper fixture, entered an unsent marker, quit/relaunched and clicked only the app's pet to show the window. Juniper was already current and the exact draft remained in the composer, with the app Ready. After explicitly replacing/sending a recall request, Codex returned Juniper / Tuesday / copperfern. New chat followed by another quit/relaunch remained New chat. Finally reopened the saved fixture and left the app Ready with an empty composer.

The real UI pass uses Codex in a plain saved chat. Live project-folder failures, every provider and a forced runtime crash with held queue entries remain separate acceptance cases. Existing project/model/permission/queue tests continue to cover their own boundaries. This is conversation reopening, not automatic task recovery or full window/page/scroll-position restoration.
