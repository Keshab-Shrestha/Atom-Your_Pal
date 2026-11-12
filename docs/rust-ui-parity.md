# Rust UI parity

This list compares the Swift screens in `apps/mac/island/Sources/ArkIsland` with `rust/crates/ark-app`.
Status words: **done** (in ark-app), **partial** (some of it), **open** (not started).
Rust logic comes from `ark-core` where a module exists.

## Done

| Swift source | ark-app |
| --- | --- |
| ConversationView (messages, tool cards, approval cards, composer) | `view/chat.rs` |
| Streaming reply text | `reply.delta` event, `view/chat.rs` |
| ChatQuestionsCard | `view/chat.rs` question card |
| Sidebar chats list | `view/sidebar.rs` |
| HelpersView and HelpersTasksView (cards, Stop, Retry) | `view/pages.rs` (agents, tasks) |
| HelpersSoulView (soul text) | `form.rs` soul editor |
| New agent, new task | `form.rs` |
| DashboardView (tiles, tools) | `view/pages.rs` dashboard |
| Settings, ModelPage | `view/pages.rs` settings |
| Brief switches | `view/pages.rs` settings |
| MemoryPage, BrainView (list, open, delete) | `view/pages.rs` memory |
| ChatAttachments (file picker) | composer chips |
| VoicePill | `overlay.rs` |
| Dictation shortcut | `mac.rs` |
| Menu bar item | `mac.rs` |

## Done in the second round

| Swift source | ark-app |
| --- | --- |
| ChatFindBar | `view/chat.rs` find bar, `ark-ui/src/find.rs` (cmd+F) |
| ChatCopyControl | Copy button on each answer |
| MarkdownReply tables | Rune Markdown component (GFM tables) |
| CommandPaletteView | `palette.rs`, `view/palette.rs` (cmd+K) |
| ChatDetailsSurface | details card (palette entry "Chat details"), basic facts only |
| DefaultsPage, access and thinking | settings card, `chat.defaults`, `prefs.rs`; Full access asks twice |
| AppearancePage | System, Light, Dark. Translucency (ADR-277) is open |
| ShortcutsPage, ShortcutEngine | `ark_core::shortcuts` drives the global keys; the settings page lists them (read only) |
| HelpersCheckpointView | task details: report, file changes, Undo (`job.open`, `job.undo`) |
| FileDiffCard, FileEditReview | `view/diff.rs`, review card on an approval (`ark_core::diff`) |
| ArkVisualCard | `view/visual.rs` (`ark_core::visual`); bars show for line charts too |
| BoardTeamView org chart | team card on the agents page (`ark_core::org`) |
| ProjectsSection (basic) | projects page: add folder, new chat, archive, remove |
| OwnerWelcomeSheet, GeneralPage name | first-run name form, Settings > General, `owner.set` |
| VoicePill, status | pill shows Listening, Transcribing, Thinking, Speaking, Needs you |

## Done in the third round

| Swift source | ark-app |
| --- | --- |
| ShortcutRecorder | `recorder.rs`, Change and Reset on each shortcut; saved in prefs |
| ChatAccessMenu, ChatModelPicker, ChatReasoningMenu | pickers in the chat details card |
| Translucent window (ADR-277) | choice in Appearance; the window opens transparent after a restart. Fills stay opaque, so only the frame margin shows the desktop |
| ProjectSettingsSheet (basic) | rename, web search, model on the projects page |
| PermissionChecker | macOS permissions card with System Settings links |
| BrainView search | search field and hits; the note card shows links and backlinks |
| ProjectGitView, git branches | branches page: commits, files, diff, push |

## Done in the fourth round

| Swift source | ark-app |
| --- | --- |
| BrainView graph | `ark-ui/src/graph.rs` (force layout) drawn with a Rune canvas. Dots only: no labels and no click on a dot (the list below opens notes) |
| ProjectSourceSheet | New empty project, clone a Git URL, clone from GitHub (`project.create`; Node does the work) |
| ProjectWorkspaceView (files) | Files view per project: folders and file text (`workspace` list and read) |
| SetupViews, keys | API keys in the macOS Keychain (service `dev.ark.island`, account = variable name). The runtime child gets them in its environment at start. A key is never shown again or logged |
| First run without Node | With a forwarder and no Node, the app starts `ark-runtime` with `/bin/cat` as the stand-in child and `ARK_RUNTIME_NATIVE_CHAT=1`. Commands only Node knows are dropped |

## Tests added

- `rust/crates/ark-runtime/tests/e2e.rs`: the app Bridge, the real `ark-runtime` binary and a mock Anthropic server on localhost.
  It checks `reply.delta` then `reply`, the saved messages in SQLite, and an approval round trip for `write_file`.
  It uses a fixture database in a temp folder and never the owner's data.

## Open

- Native first run needs a chat database and `ui-state.json` that Node creates. Without them native chat cannot list or save chats.
- Brain graph labels and click on a dot.
- Project settings sheet details (folder grants) and the git workspace review (`gitStatus`, `gitReview`).
- The workspace browser and terminal (see below).
- Real translucent fills (blur) in the sidebar and panels.

## Not planned for the first Rust release

Pal and pet (PalView, PetController, OrbitCharacter), office floor, workflows canvas, workspace browser and terminal,
reply drafts, plugins, local backup, updater. Each needs its own decision.

## Parity check

`rust/crates/ark-app/tests/headless.rs`, test `screens_match_the_swift_goldens_in_brightness`, draws five screens with `--snap`
and compares the mean brightness with the Swift golden in `tests/ui-golden` (tolerance 0.15).
The Rust PNGs go to `ARK_PARITY_DIR` (default `target/tmp/parity`) for a look by eye.
A brightness check does not find layout differences. A pixel compare needs the same fonts and window size.
