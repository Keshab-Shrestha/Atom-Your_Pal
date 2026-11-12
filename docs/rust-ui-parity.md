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

## Open, in build order

Chat-adjacent first.

1. **Find in chat** (ChatFindBar). Pure text search over loaded messages. Build in `ark-ui`.
2. **Copy a message** (ChatCopyControl). Needs a clipboard call.
3. **Markdown tables** (MarkdownReply, `ark_core::visual::markdown_table`). Check the Rune Markdown component first.
4. **Command palette** (CommandPaletteView). A list of screens and actions with a filter.
5. **Chat details** (ChatDetailsSurface). Chat title, model, message count.
6. **Chat defaults** (DefaultsPage, ChatAccessMenu, ChatReasoningMenu). Command `chat.defaults`.
7. **Shortcuts page** (ShortcutsPage, ShortcutEngine). Use `ark_core::shortcuts`.
8. **Appearance settings** (AppearancePage, translucency ADR-277). Theme choice, translucency switch.
9. **Jobs and checkpoints** (HelpersCheckpointView, `ark_core::jobs`).
10. **Diff views** (FileDiffCard, FileEditReview, EditReviewView). Use `ark_core::diff`.
11. **ark-visual card** (ArkVisualCard). Use `ark_core::visual`.
12. **Org chart** (BoardTeamView, `ark_core::org`).
13. **Projects and folders** (ProjectsSection, ProjectWorkspaceView, ProjectSettingsSheet, ProjectSourceSheet).
14. **Onboarding** (OwnerWelcomeSheet, SetupViews).

## Not planned for the first Rust release

Pal and pet (PalView, PetController, OrbitCharacter), office floor, workflows canvas, workspace browser and terminal,
reply drafts, plugins, local backup, updater. Each needs its own decision.

## Parity check

`rust/crates/ark-app/tests/headless.rs` draws each screen with `--snap`.
The golden PNGs in `tests/ui-golden` come from the Swift gallery. The two sets differ in layout and fonts today.
The check writes the Rust PNG to the scratch folder (`ARK_PARITY_DIR`) next to the golden file name for a visual compare.
It does not fail on a pixel difference yet.
