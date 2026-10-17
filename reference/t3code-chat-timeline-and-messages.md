# T3 Code: chat timeline and message rendering

Source: github.com/pingdotgg/t3code (MIT licence). Read on 2026-10-17 from the shallow clone at commit `2fbd4318`.
Also read: the mobile package `react-native-enriched-markdown` (MIT, Software Mansion; T3 fork), unpacked from `apps/mobile/deps/*.tgz` into a scratch folder.
A claim marked "unverified" was not checked in code or by a test. Nobody ran T3 Code or ATOM for this file.
Paths without a prefix are under `apps/web/src/`.

Summary:
- T3 Code draws a reply as real HTML. The browser handles selection. A copy handler turns the selected HTML back into Markdown.
- ATOM draws a reply as separate SwiftUI blocks. SwiftUI cannot select across blocks. This is the root of the copy complaint.
- T3 mobile uses native text views with the same limit: selection cannot cross a table or a code block. Its tables have their own copy menu.
- The best first fix for ATOM is copy actions on each block, plus a copy menu for the whole reply. It is small and safe.

---

## 1. What T3 Code does

### 1.1 The parts

| Part | Choice |
| --- | --- |
| Timeline list | `LegendList` from `@legendapp/list/react`, a virtual list (`components/chat/MessagesTimeline.tsx`) |
| Markdown | `react-markdown` ^10 with remark and rehype plugins (`components/ChatMarkdown.tsx`) |
| Code colour | Shiki through `@pierre/diffs` (`getSharedHighlighter`) |
| Diagrams | `mermaid` ^11 |
| Popups and menus | Base UI wrappers in `components/ui` (Tooltip, Menu, Collapsible, Toast) |

Rows are built by pure functions in `MessagesTimeline.logic.ts` (about 2,270 lines) with tests. The view only draws rows.

### 1.2 Markdown pipeline (topic 1)

Plugins come from `packages/shared/src/markdownPipeline.ts`.

| Stage | What it does |
| --- | --- |
| `remark-gfm` | Tables, task lists, strikethrough, autolinks |
| `remark-breaks` | Keeps single line breaks. Used for user text, tool text, and some replies (`shouldPreserveAssistantLineBreaks`) |
| `remarkGithubAlerts` | `> [!NOTE]` blocks with icon and colour (Note, Tip, Important, Warning, Caution) |
| `remarkNormalizeListItemIndentation` | Repairs over-indented list items |
| `remarkCodexDirectives` | Reads Codex file citations and artifact cards |
| `remarkPreserveCodeMeta` | Keeps the text after the language on a fence (the file title) |
| `rehypeRaw` + `rehypeSanitize` | Raw HTML in a reply is allowed but sanitised. Extra link schemes: `file`, `t3-citation`, `t3-context`, thread link |

Other facts:
- User messages turn raw HTML off (`parseRawHtml={false}`). Their HTML shows as inert text. Test: `MessagesTimeline.test.tsx`, "renders unsafe user HTML as inert source text".
- The component map `CHAT_MARKDOWN_COMPONENTS` is a constant. A comment says: keep component types stable when streaming changes.
- Headings inside a message get `aria-level` shifted down (`headingLevelOffset`, level 3 and below). The page outline stays valid.
- `<details>` becomes a collapsible (`MarkdownDetails`). Find (mod+f) opens it when a match is inside.
- Task list boxes can be clicked in some views (`onTaskListChange`).
- Math: none. A grep for katex and remark-math finds nothing. The mobile fork sets `latexMath: false`.
- Mermaid blocks show a diagram with a Show code / Show diagram toggle (`MarkdownMermaidCodeBlock`). While streaming, the code shows, not the diagram.

### 1.3 Streaming text (topic 1)

- A message has a `streaming` flag. The reply goes to `ChatMarkdown` with `isStreaming`.
- `markdown-incremental.ts` caches the parse of a finished prefix. A closed top-level fence plus a blank line is the cut point. Only the tail parses again. It runs only while streaming and only when the text has a fence.
- An open fence is drawn as code at once. Highlight is incremental by line (`lib/incrementalHighlighting.ts`). Finished lines keep their DOM nodes (`components/chat/HighlightedCodeLines.tsx`), so a selection survives new tokens.
- While streaming, "Run in terminal" and diagram drawing wait for the closed fence. Test: `ChatMarkdown.test.tsx`, "ChatMarkdown streaming".
- A half-written table: `remark-gfm` makes a table only after the divider row. Before that, the text is a paragraph (unverified: no T3 test covers it).
- New blocks fade in with opacity only, 600 ms, only while `data-streaming` is set (`index.css`). Reduced motion turns it off.
- There is no caret. The signs of work are the "Working for 12s" row and a "Thinking" shimmer row (see 1.7).

### 1.4 Code blocks (topic 1)

- Shiki with the Oniguruma WASM engine on purpose (`lib/syntaxHighlighting.ts`). A comment says the JS engine can hang on backtracking.
- Result cache: an LRU with 500 entries and 50 MB (`highlightedCodeCache`).
- A frame (`MarkdownCodeBlockFrame`) has a header with the language name or a file icon, or the fence title. The header is `select-none`, so a drag over the code does not copy it.
- Buttons in the header (toolbar role, label "Code block actions"):
  - Wrap lines (toggle, `aria-pressed`). The default comes from the client setting `wordWrap`.
  - Run in terminal. Only for shell languages, a closed fence, one command, no control characters.
  - Copy code. Writes the raw code. The icon becomes a check for 1.2 seconds. An error goes to `reportMarkdownActionFailure`.
- No collapse for long code. A long line scrolls sideways when wrap is off. (The composer docs say very large blocks skip colour, but that is the composer only.)

### 1.5 Tables (topic 1)

- A real `<table>` inside a `ScrollArea` with an edge fade (`MarkdownTable`). The header row is bold. Rows have thin separators.
- Default: each cell is one line, cut with an ellipsis at 24 rem. A button under the table, "Expand table cells", lets cells wrap.
- A copy button under the table opens a menu: "Copy as Markdown" and "Copy as CSV".
  - Both write text only (`navigator.clipboard.writeText`). No HTML flavour. No TSV.
  - Markdown: one row per line, pipes in a cell escaped as `\|`, line breaks in a cell become a space, alignment kept as `:---:` or `---:`.
  - CSV: spaces collapsed, a cell with comma, quote or line break is quoted, quotes doubled.
  - Code: `serializeTableElementToMarkdown` and `serializeTableElementToCsv` in `markdown-clipboard.ts`. No test file calls them (grep checked). The rules above come from the code.
- Mouse selection over cells, then Cmd+C: the copy handler (see 1.6) gives the table as a Markdown table in plain text and as cleaned HTML. Notes or Docs can then paste a real table (the paste result is unverified).

### 1.6 Copy and selection (topic 2)

| Action | How it works | Format | Feedback |
| --- | --- | --- | --- |
| Copy a reply | `MessageCopyButton` in the meta row under the reply. Only on the last reply of a turn. Hidden while streaming | Raw Markdown, text only | Icon becomes a check. A small "Copied!" tooltip for 1 s. "Failed to copy" on error (`ui/anchoredCopyToast.ts`) |
| Copy a user message | Same button in the row under the bubble | Raw text. Adds a private type for context chips | Same |
| Copy a prompt link | Second button when the message is a prompt link (`docs/user/prompt-links.md`) | Link | Same |
| Copy code | Header button | Raw code | Check icon |
| Copy table | Menu under the table | Markdown or CSV | Check icon |
| Select, then Cmd+C | `onCopy` on the reply element calls `chatMarkdownClipboardPayload(selection)` | Plain text = rebuilt Markdown. HTML = cleaned selected HTML | None |
| Copy plan | Plan menu: "Copy to clipboard", "Download as markdown", "Save to workspace" | Markdown | "Copied!" in the menu item |
| Copy a link | Right-click menu "Copy Link" | URL | None seen |
| Copy a file path | Right-click on a file chip: "Copy relative path", "Copy full path" | Path | Toast |
| Copy an image | Right-click an image: "Copy image" (PNG), "Copy URL", "Copy full path", "Save image" | Image or text | Toast |
| Copy a thread reference | Key command `thread.copyReference`, default mod+shift+c | Text | Unverified |
| Tool output | No copy button (checked). The text of an open row is selectable (`select-text`) | Plain | None |

Rules of the selection copy (`markdown-clipboard.ts`, tests in `markdown-clipboard.test.ts`):
- The code walks the selected DOM and writes Markdown. It writes `#` headings, `**bold**`, `*italic*`, `~~strike~~`, lists with numbers and task boxes, `>` quotes, `---`, images, `<details>`, and tables.
- A link becomes `[text](url)` only for http and https. Other links keep their text.
- Inline code gets a backtick fence longer than any backtick run inside.
- A block of code gets a fence longer than any fence inside. The language is added unless it is `text`.
- If the selection holds only code, no fence is added. Tests: "keeps a highlighted block code selection plain", "omits fences when a selection past the last line drags in the whole code block".
- If the selection holds prose and code, the fence is added. Test: "still fences a code block copied alongside prose".
- A rendered chip (file, skill, citation, card) carries its Markdown in `data-markdown-copy`. The copy uses that text. Test: "uses a rendered card's explicit Markdown copy representation".
- Buttons, inputs, SVG, `aria-hidden`, `select-none` and `sr-only` elements are dropped.
- Select all and triple click are the browser defaults (unverified). Selection across rows works for rows that are mounted. How the virtual list keeps far rows (unverified).

Selection tools:
- Cite: select text in one reply. A floating "Cite" button appears at the end of the selection (`AssistantSelectionToolbar`). Tab moves focus to it. Escape closes it. The composer gets a chip with an optional comment. The chip is plain text (`t3-citation:` link), so it survives copy, reload and stash. A click on the chip scrolls back to the source and highlights it (`docs/internals/assistant-citations.md`).
- Find in thread: `chat.find`, default mod+f. It searches the whole thread on the server, shows "2/9", moves with Enter and Shift+Enter, closes with Escape. Matches are painted with the CSS Custom Highlight API (`CSS.highlights`, `threadFindHighlights.ts`).

### 1.7 The timeline (topic 3)

Row kinds (type `MessagesTimelineRow` in `MessagesTimeline.logic.ts`): `message`, `assistant-meta`, `work`, `work-live`, `work-toggle`, `working`, `thinking`, `turn-fold`, `attempt-fold`, `context-compaction`, `event`, `proposed-plan`, `html-render`, `mcp-app`, `worktree-setup`.

| Thing | How T3 Code shows it |
| --- | --- |
| User message | A bubble on the right (`bg-message`, `rounded-2xl`, 80% width). Hidden `h3` "You" for screen readers. Image thumbnails in a 2-column grid above the text. File rows with Preview and Download buttons |
| Long user message | Over 600 characters or 8 lines: cut to a short height with a fade. Button "Show full message" / "Show less" |
| Who sent it | A small line: "Sent by automation", "Sent by T3 Code", "Sent by another agent" (a link). Marks "From queue" and "Steer" |
| Assistant reply | No bubble. Full width. Hidden `h3` "T3 Code". Markdown. Changed files card. Meta row |
| Meta row actions | Appear on hover, on focus inside, and always on touch. Copy, "Fork from this response", time. A status pill if the item is not completed |
| User row actions | Time (tooltip has the full date), "Edit from here" (rewind, off while working), Copy, Copy prompt link |
| Reasoning | A "Thought" row. First line as preview. Expands to italic Markdown |
| Tool calls | Grouped into one summary row: "Read 3 files, Ran 2 commands" (`summarizeToolGroup`, at most two parts). Click opens the group |
| Open group | A small virtual list, `role="region"` "Tool calls", max height about 18 rem, edge fades, scroll position remembered |
| One tool entry | Row with icon, label, time on hover, chevron. Opens to: highlighted command (`ShellCommandBlock`), output, JSON input, viewed image, file list |
| Command output | `CommandOutputPanel`: max height 20 rem, ANSI colours, follows the tail until the reader scrolls up. Streams only while the row is open |
| File change | Path, `+N -M`, button "Open diff" (`V2ItemInspector`). A per-reply card "N changed files" with a tree, "Open diff", "Expand all folders" |
| Running now | `work-live` row with a shimmer. "Thinking" row. `working` row: "Working for 12s" |
| Turn finished | All work folds into one line: "Worked for 22s" or "You stopped after 8s". The final reply stays below. A chevron opens it |
| Steered turn | `attempt-fold`: "Superseded attempt" and "Cut off by a steer" |
| Compaction | A line with a label, "Compacting…" with a shimmer while active (`role="separator"`) |
| Plan | `ProposedPlanCard`: Markdown, cut at a height, "Expand plan", actions menu |
| Approval or question | Not in the timeline as buttons. The panels sit above the composer (`ComposerPendingApprovalPanel`, `ComposerPendingUserInputPanel`; files listed, not read). An answered question is a timeline row with the answer preview |
| Checkpoint | `checkpoint` item shows file count and a "Roll back" button. "Edit from here" uses the checkpoint turn count |
| System rows | `TimelineSystemDivider` (line, label, optional action pill), setup card, "Open chat" link for a created thread, subagent group with avatars and elapsed time |
| Error | Banner above the list (`ThreadErrorBanner`): 3 lines, tooltip with all text, close button per session, warning colour for a usage limit. An error row inside the list. A "Retry" button only for a workspace setup failure |
| Missing | Retry or regenerate on a reply. Delete a message. (Grep in `MessagesTimeline.tsx` finds none.) |

Timestamps: hidden until hover or focus. The tooltip shows the full date. A setting picks the format.

Scrolling (`timelineScrollAnchoring.ts`, `ChatView.tsx`):
- Three modes: `following-end`, `anchoring-new-turn`, `free-scrolling`.
- When the user sends a message, the new message moves near the top (24 px offset) with spare space below. The view does not jump to the bottom. The reply grows into the spare space.
- Following the end stops when the user scrolls away. The list position is saved per thread.
- A "Scroll to end" pill shows after 150 ms away from the end. It hides at once at the end. The delay stops a flash when a thread opens.
- A minimap strip at the right edge has one tick per user message. Hover shows the question and the final answer. Click jumps. Label: "Jump to message: …".
- History pages: the first load holds about 75 recent rows (`docs/internals/performance-regressions.md`). A "Load earlier turns" button sits at the top.

Performance rules:
- `AGENTS.md` rule 2: audit for large WebSocket messages, animations that load the GPU, and slow lists.
- `performance-regressions.md`: command output is not in the event stream. It goes to a hub with a bounded tail and flows only to open rows.
- `web-ui.md`: handlers in big components use `useStableCallback`. The React Compiler is required on all files.
- In code: row objects keep identity between updates (`useStableRows`, `useIncrementalTimelineRows`). The live timer writes to a DOM node each second without a React render (`WorkingTimer`). Shimmers run only while visible (`observeVisibleAnimation`). Memo equality for file links (`areMarkdownFileLinkPropsEqual`).

### 1.8 Links, files, images, mentions (topic 1 and 4)

- Web link: opens in the integrated browser or the system browser, by a setting. Alt-click opens outside. A favicon shows beside the host. Right-click menu: "Open in integrated browser", "Open in system browser", "Copy Link". A pull request link gets a hover preview.
- Inline code that looks like a file path becomes a file chip (`inlineCodeFilePathCandidate`). Chip text is the short path. Two files with the same name get a parent folder suffix. `path:12` keeps the line.
- File chip click: opens the file in the right panel. Cmd or Ctrl click opens the editor. A PDF opens in the browser. Right-click: Preview media, Open in editor, Reveal in Finder, Copy relative path, Copy full path. A remote host hides the shell actions.
- Image: click opens `ExpandedImageDialog`. Zoom to 8x (`ZoomableImage`), pan with keys, move through the images of the message. Right-click menu in `MediaActions`. Images set `draggable={false}`, so drag out is off (checked).
- Skills and context: skill names become chips (`renderSkillInlineMarkdownChildren`). User messages show composer chips for files, images, terminal output, picked elements, pull requests and review comments.

### 1.9 Empty, loading, error states (topic 5)

- Empty thread: one muted line, "Send a message to start the conversation." A new draft shows a hero headline with a project picker (`DraftHeroHeadline.tsx`).
- Loading a thread: an empty box with `data-timeline-loading`. No spinner in the list. A sync row above the composer has `role="status"`.
- Older history: button "Load earlier turns" / "Loading earlier turns…". A failure shows a `role="status"` line.
- Errors: see the table in 1.7.

### 1.10 Accessibility and keyboard (topic 6)

- Hidden `h3` per message ("You", "T3 Code"). Message headings are shifted so the outline stays valid.
- Disclosure rows are buttons with `aria-expanded`. Work entries have `role="button"`, `tabIndex=0`, Enter and Space.
- A failed tool has the label "tool call failed" (not only colour). Icon buttons have `aria-label` and a tooltip.
- Hover actions also show on focus inside and on touch. Focus rings use `focus-visible`.
- Reduced motion is respected in CSS and in the scroll behaviour.
- Toggles that change height set `data-scroll-anchor-ignore`, so the list does not jump.
- `docs/user/keyboard-focus.md` is short. It covers only the palette and the composer. I found no key to move between messages (unverified).
- Key commands for the thread: `chat.find` (mod+f), `thread.copyReference` (mod+shift+c). I saw no "copy last reply" command (unverified: only part of the list was read).

### 1.11 T3 mobile: native text (important for ATOM)

The mobile app does not use a web view. It uses `react-native-enriched-markdown` (T3 fork `fork/t3-mobile`, file `apps/mobile/src/native/EnrichedMarkdownText.tsx`, `flavor="github"`, `selectable`).
Facts from its docs and sources (unpacked scratch copy):
- `flavor="commonmark"`: all Markdown goes into one text view. Select all works. There are no table grids.
- `flavor="github"`: the document splits into segments. Runs of paragraphs, headings and lists share one text view. Tables, fenced code, math and block quotes are separate views. The doc says: "Text selection cannot span across segments."
- Smart copy of a selection (iOS): plain text, Markdown, HTML, RTF and RTFD together. Menu item "Copy as Markdown".
- A table is a native grid with horizontal scroll. Its long-press menu has "Copy" and "Copy as Markdown". "Copy" writes plain text with tabs between cells (TSV), Markdown and HTML at once (`ios/segments/TableContainerView.m`).
- A code block has a header with the language and a copy button. While the block still streams, copy is off.
- Streaming options: `tableMode` `progressive` or `hidden`, and `codeBlockMode`. They hide a half table until a blank line follows.
- macOS is supported through react-native-macos. Doc `MACOS.md` lists limits: no math, VoiceOver "stubbed", no tail fade.
- The fork adds clipboard metadata so a copy keeps composer chips.

---

## 2. Where to look

| Feature | Path |
| --- | --- |
| All Markdown renderers (table, code, links, images, files) | `apps/web/src/components/ChatMarkdown.tsx` |
| Plugin list and sanitise schema | `packages/shared/src/markdownPipeline.ts` |
| Streaming parse cache | `apps/web/src/markdown-incremental.ts`, `markdown-incremental.test.tsx` |
| Selection to Markdown and HTML; table to Markdown and CSV | `apps/web/src/markdown-clipboard.ts`, `markdown-clipboard.test.ts` |
| Code colour | `apps/web/src/lib/syntaxHighlighting.ts`, `lib/incrementalHighlighting.ts`, `components/chat/HighlightedCodeLines.tsx` |
| Mermaid | `apps/web/src/components/chat/MermaidDiagram.tsx` |
| Link rules and file links | `apps/web/src/markdown-links.ts`, `components/chat/externalLinkContextMenu.ts` |
| Images and media menu | `components/chat/ExpandedImageDialog.tsx`, `ZoomableImage.tsx`, `components/media/MediaActions.tsx` |
| Citations | `docs/internals/assistant-citations.md`, `components/chat/AssistantSelectionToolbar.tsx`, `AssistantCitationChip.tsx` |
| Timeline list and rows | `components/chat/MessagesTimeline.tsx` |
| Row building rules and fold labels | `components/chat/MessagesTimeline.logic.ts`, `MessagesTimeline.logic.test.ts` |
| User row, collapse, actions | `MessagesTimeline.tsx`: `UserTimelineRow`, `CollapsibleUserMessageBody` |
| Assistant row, meta, fork | `MessagesTimeline.tsx`: `AssistantTimelineRow`, `AssistantMessageMeta`, `AssistantForkButton` |
| Copy button and toast | `components/chat/MessageCopyButton.tsx`, `hooks/useCopyToClipboard.ts`, `components/ui/anchoredCopyToast.ts` |
| Work log layout | `components/chat/WorkLog.tsx`, `WorkLog.browser.test.tsx` |
| Tool group summary text | `packages/client-runtime/src/work-log/presentation.ts` (`summarizeToolGroup`) |
| Tool item bodies | `components/chat/V2ItemInspector.tsx`, `CommandOutputPanel.tsx`, `ShellCommandBlock.tsx` |
| Plans | `components/chat/ProposedPlanCard.tsx` |
| Changed files card | `components/chat/ChangedFilesTree.tsx` |
| Error banner | `components/chat/ThreadErrorBanner.tsx` |
| Scroll modes, scroll pill | `components/chat/timelineScrollAnchoring.ts`, `components/ChatView.tsx` (`showScrollToBottom`) |
| Minimap | `MessagesTimeline.tsx` (`TimelineMinimap`), `components/chat/timelineMinimapItems.ts` |
| Find in thread | `components/chat/ThreadFindBar.tsx`, `useThreadFind.ts`, `threadFindHighlights.ts`, `docs/user/keybindings.md` |
| Perf rules | `AGENTS.md`, `docs/internals/performance-regressions.md`, `docs/internals/web-ui.md` |
| Keyboard | `docs/user/keyboard-focus.md`, `packages/shared/src/keybindings.ts` |
| Native Markdown on mobile | `apps/mobile/src/native/EnrichedMarkdownText.tsx`, `apps/mobile/deps/README.md`; in the tarball: `docs/COPY_OPTIONS.md`, `MARKDOWN_STREAMING.md`, `API_REFERENCE.md` (`flavor`), `MACOS.md`, `ios/segments/TableContainerView.m` |

---

## 3. What ATOM has today, and the gap

ATOM files read: `ConversationView.swift` (`TurnView`, `ReplyText`, `ConversationTab`), `MarkdownReply.swift`, `MarkdownBlocks.swift`, `MarkdownHTML.swift`, `Conversation.swift`, `ComposerPaste.swift` (all under `apps/mac/island/Sources/`).

How ATOM draws a turn: a user bubble (`Text`, 12.5 pt) and a reply. A plain reply is one `Text` with a glow caret while spoken. A rich reply is `MarkdownReply`: a `VStack` of blocks, one `Text` or grid per block.
The reply arrives as one event, `reply(String)`, and replaces the text of the turn (`Conversation.apply`). Token streaming is unverified.

| Feature | ATOM today | T3 Code | Gap |
| --- | --- | --- | --- |
| Parser | Own `MarkdownBlocks.parse`: paragraph, heading, list, code, table. Inline marks by `AttributedString(markdown:)` | remark with GFM and many plugins | No blockquote, rule, nested list, task list, image, code language |
| Selection | `.textSelection(.enabled)` on the block stack. One `Text` at a time | Browser selection over the whole reply | Cannot select across blocks. A table cannot be selected as a whole |
| Copy a reply | One hover button, top right. Plain text = Markdown. HTML if rich | Button on the last reply of a turn, Markdown only | ATOM is already richer here. No feedback after the click |
| Copy a user message | None (select only) | Button on hover | Missing |
| Copy code | None | Header button | Missing |
| Copy table | None. Only the whole-reply HTML has a table | Menu: Markdown, CSV | Missing |
| Copy of a selection | System default, plain text of one `Text` | Rebuilt Markdown plus clean HTML | Large. Needs an AppKit text view |
| HTML flavour | `MarkdownBlocks.html`: bold, italic, code only | Full HTML from the DOM | Links, code language, quotes lost |
| Code block | Mono text, sideways scroll, grey box | Language label, colour, wrap toggle, copy, run | No label, colour, wrap, copy |
| Table look | `Grid` when it fits, else one card per row. Cell max width 260 | Scroll table with fade, expand cells | ATOM cards are a good fit for a narrow window. No horizontal scroll option |
| Links | Inline links by `AttributedString` (opening: unverified) | Favicon, menu, preview | No menu, no copy link |
| File paths | Plain text | Chips with open and reveal | Missing |
| Images in a reply | None | Expand, zoom, save, copy | Missing |
| Attachments in a turn | Not in the turn model (`Turn` holds text only) | Thumbnails and file rows | Missing in the turn |
| Hover actions | Copy (finished reply only). Timings line: "heard … · AI … · first sound …" | Copy, fork, edit, time | No keyboard or VoiceOver way to Copy: the button is only in the tree while hovered |
| Long user message | Always full | Collapse at 600 characters or 8 lines | Missing |
| Reasoning, tools, work log | Not in the chat. `WorkStrip.swift` shows ATOM work at the Dock (ADR-056) | Grouped, folded, "Worked for 22s" | Needs runtime events. Large |
| Working indicator | `ThinkingDots` while no reply. Glow caret while spoken | "Working for N s" row | Equal in spirit. No elapsed time |
| Scroll | `LazyVStack` in a `ScrollView`. Every change of `turns` animates to the last turn | Follow only at the end. Pill "Scroll to end". New message anchors near top | ATOM pulls the view down even when the reader scrolled up |
| Long chats | `Conversation` keeps 50 turns. `LazyVStack` | Virtual list, paging | Fine for now |
| Find in chat | None in the chat (global search exists) | mod+f, highlight | Missing |
| Empty state | Pal, hint, brief card, examples | One muted line | ATOM is richer |
| Failed turn | Reply (if any), red line, "Try again" button | Banner, row. No retry for a reply | ATOM is ahead |
| Notices | `.notice` line with icon | System divider | Equal |
| Accessibility | `ThinkingDots` label. Timings hidden when not hovered | Hidden headings, `aria-expanded`, focus-visible actions | Add turn labels and a Copy action |
| Quote in composer | None | Cite button on selection | Needs selection access (AppKit) |

---

## 4. Ideas for ATOM, ranked

Rules for every idea: one capability, one ADR, one TASK entry (CLAUDE.md section 3). Deterministic code goes in `AtomIslandCore`. No new dependency without a reason (section 18). I could not compile Swift here. Each first step is small so a Mac build can check it.

What is hard in SwiftUI (macOS 14 target, `Package.swift`):
- `.textSelection(.enabled)` works inside one `Text`. There is no API to read the selection or to catch Copy (unverified: `onCopyCommand` may work only on a focused view).
- A `Text` cannot show a table. `Grid` cells are separate `Text` views.
- Hover buttons need state. ATOM writes `State(initialValue:)` because the Command Line Tools have no macro plugin. Keep that style.
- A view that appears only on hover is missing from the accessibility tree.

### Idea 1: Copy actions on code blocks and tables (size S to M)

- What: A small button row at the top right of each code block and table, shown on hover and on keyboard focus. Code: Copy. Table: menu with "Copy table" (Markdown as text, HTML as rich), "Copy as TSV", "Copy as CSV". The icon turns into a check for 1.2 seconds.
- Why: It fixes the main complaint. T3 Code has the same pair (Copy code, Copy table). T3 mobile also writes three flavours at once for a table.
- How it fits: Pure SwiftUI inside `MarkdownReply.view(for:)`. Table formats are plain functions in Core, so they are testable. The grid and the cards both get the same button.
- Hard part: Placing a hover overlay on a `ViewThatFits`. Put the overlay on the result of `table(header:rows:)`.
- First step: Add three functions in `MarkdownBlocks` (Core): `tableMarkdown(header:rows:)`, `tableTSV(header:rows:)`, `tableHTML(header:rows:)`. Reuse the private `html(of:)`. Test them with the table already used in `MarkdownBlocksTests`. Then add one `CopyButton` view.
- Rules to copy from T3: escape pipes as `\|`, turn line breaks in a cell into a space, keep alignment marks, quote CSV cells that hold a comma, quote or line break.

### Idea 2: One copy menu for the whole reply and for the user's words (size S to M)

- What: Right-click on a reply gives "Copy as Markdown", "Copy as plain text", "Copy as rich text". The user bubble gets a hover Copy button. Add a key (for example Cmd+Shift+C) for "Copy last reply".
- Why: Today there is one Copy, and only for finished replies. T3 Code has Copy on user messages too.
- How it fits: `TurnView.copy` already writes Markdown and HTML. Move it into one helper in the `AtomIsland` target (`ReplyClipboard`) and call it from the button, the menu and the key. The key goes into `ShortcutEngine` with the window shortcuts (check ADR rules first).
- Hard part: `.contextMenu` on a view that has `.textSelection` may replace the system Copy item (unverified). Test on a Mac. If it does, put the menu on the turn frame, not on the text.
- First step: Add the helper and the user-bubble button. Add the menu after.

### Idea 3: Make the Copy button reachable without the mouse (size S)

- What: Add `.accessibilityAction(named: "Copy reply")` on each turn. Show the hover buttons also on keyboard focus. Label the turns "You said" and "ATOM said".
- Why: T3 Code shows actions on hover, on focus inside, and always on touch. In ATOM the button does not exist for VoiceOver until hover.
- How it fits: Small change in `TurnView`. No new data.
- First step: Add the accessibility action to `TurnView`, and keep the button in the layout with `opacity` instead of an `if`.

### Idea 4: A fuller parser, and a better HTML flavour (size M)

- What: Add block quote, horizontal rule, nested lists, task lists and the code language to `MarkdownBlock`. Keep the language in `.code`. Show the language as a small label above the code. Make `MarkdownBlocks.html` write links and `<code class="language-x">`.
- Why: The chat "feels like plain text" partly because quotes, rules and nested lists fall into plain paragraphs. A table is only one of the gaps.
- How it fits: Core only, with tests in `MarkdownBlocksTests`. Keep the shape `case code(String)` working by adding `case code(language: String?, text: String)` and fixing the call sites. Do not add a dependency. A syntax colour library is a later decision (CLAUDE.md section 18).
- Hard part: Nested lists need indent tracking. The current parser trims every line.
- Alternative (unverified): Foundation's `AttributedString(markdown:)` with full syntax reads block structure (`PresentationIntent`). It could replace the parser. Check on a Mac whether tables and code language survive. The parser we own is easier to test.
- First step: Code language label and block quote. These two are the most common in AI replies.

### Idea 5: Follow the end only when the reader is at the end (size M)

- What: Stop the automatic scroll when the reader scrolls up. Show a "Scroll to end" pill, with a 150 ms delay before it shows. Do not move the view when the reader scrolled up and a reply arrives.
- Why: Today `.onChange(of: model.conversation.turns)` scrolls to the last turn every time. T3 Code follows only at the end and keeps the position per thread.
- How it fits: View state in `ConversationTab`. On macOS 14, `ScrollViewReader` has no scroll position read. `onScrollGeometryChange` needs macOS 15 (unverified). A fallback: an `NSScrollView` probe like `WindowProbe`.
- First step: Check which API exists on the build Mac, then write a small pure type in Core, `FollowState`, that takes "distance from end" and says follow or not.

### Idea 6: Collapse long user messages (size S)

- What: Above 600 characters or 8 lines, show a short height with a fade and a "Show full message" button.
- Why: A pasted block fills the screen. T3 Code does this with `shouldCollapseUserMessage`.
- How it fits: A `lineLimit` switch in `TurnView`. A pure function `shouldCollapse(_:)` in Core with a test.
- First step: Write the function and the test with the same limits.

### Idea 7: Segmented text views for drag-select across paragraphs (size L, spike first)

- What: Draw each run of paragraphs, headings, lists and quotes as one `NSTextView` (`NSAttributedString`). Keep code blocks and tables as their own SwiftUI blocks with their own copy buttons (idea 1).
- Why: This is the exact model of T3 mobile (`flavor="github"`). Users there accept "selection stops at a table". It also allows "Cite" and "copy selection as Markdown" later, because AppKit can read the selection.
- How it fits: `NSViewRepresentable`. ATOM has three simple ones already. The hard part is height: the view must report its height for a given width. Use `sizeThatFits` (macOS 13+) and `layoutManager` used rect (unverified).
- Risk: High without a compiler. Do it only after ideas 1 to 4 are shipped and a Mac is at hand.
- First step: A one-day spike in the gallery (`IslandGallery.swift`): one reply as an attributed string in a non-scrolling `NSTextView`, with the theme colours. Measure height, selection and VoiceOver.

### Idea 8: Find in chat (size M)

- What: Cmd+F in the chat window opens a small bar. It counts matches over the 50 turns and moves with Enter.
- Why: T3 Code has `chat.find`. Long chats need it.
- How it fits: Search the turn text in Core (deterministic). To paint matches in `Text`, build an `AttributedString` with a background on the match ranges.
- First step: A Core function `findMatches(in:query:)` returning turn id and range. Test it.

### Idea 9: File path chips in replies (size M)

- What: Inline code that looks like a file path (`path/file.swift:12`) becomes a small chip. Click reveals it in Finder or opens it. Right-click: Copy path.
- Why: T3 Code does this for every project reply. ATOM project chats (ADR-107) talk about files.
- How it fits: Core: a path detector with tests (copy the idea of `inlineCodeFilePathCandidate`). The runtime must confirm the file exists in the project. Policy applies: open only inside the project folder (CLAUDE.md section 12).
- First step: The detector and its tests. No UI.

### Idea 10: "Worked for N s" and a folded work log (size L, needs runtime)

- What: Show one line per turn, "Worked for 22s", that opens a list of steps.
- Why: It is the biggest part of the T3 timeline. It needs events for tool calls that the chat model does not carry (`Turn` holds only text and timings).
- How it fits: Needs a new protocol event and an ADR. Not before a real need.
- First step: Do nothing now. Show `TurnTimings` total on hover (it already shows a summary).

### Not recommended now

- A `WKWebView` for the whole chat (see the comparison below). Large rewrite.
- Mermaid, math, citations toolbar, minimap, fork buttons on every reply. Low value or covered in other files (`t3code-ideas-for-atom.md`, ideas 24 and 25).
- Syntax colour with a library. Wait until idea 4 is shipped.

### The three ways to get good selection and copy

(a) Keep SwiftUI blocks and add copy buttons per block.
(b) Draw each message as one `NSTextView` with an `NSAttributedString`.
(c) Draw each message in a `WKWebView` with HTML.

| Criterion | (a) SwiftUI blocks + buttons | (b) One NSTextView per message | (c) WKWebView per message |
| --- | --- | --- | --- |
| Drag-select over a whole message | No. One `Text` at a time | Yes, including table text if the table is text | Yes, everything |
| Copy of a selection as Markdown | No (plain text of one `Text`) | Yes. ATOM can catch `copy:` and write Markdown, RTF and HTML | Browser gives plain text and HTML. Markdown needs a script like T3's `markdown-clipboard.ts` |
| Tables | Grid or cards, as now. Copy button gives exact Markdown, TSV, HTML | `NSTextTable` (TextKit 1 only, unverified) or tab-aligned text. No horizontal scroll. Wide tables wrap or break. T3 mobile did not do this: it uses a separate grid view | Real `<table>`. Scroll, wrap, copy all work. Same as T3 web |
| Streaming | Not needed today (one `reply` event). Easy later | Replacing the string resets the selection unless handled. Fine for whole replies | DOM patch by script. Selection can survive |
| Theme (6 themes, glow) | Native. No change | Map theme colours to attributes. Code box and quote bar need custom drawing | CSS variables set by Swift. Pal glow caret is hard |
| Long chats (50 turns, `LazyVStack`) | Light | One text view per reply is fine (unverified) | One web view per turn is heavy: many web content processes or large memory (unverified) |
| Scroll inside a scroll view | Native | Native, if scrolling is off in the text view | Wheel events go to the web view and block the outer scroll unless forwarded (unverified) |
| VoiceOver | Good for `Text`. Needs the Copy action (idea 3) | Good. `NSTextView` is the reference text control | Good in WebKit. Tables read as tables |
| Height measure | None | Needed. Width-dependent. A frequent bug source | Needed. Script message per change |
| Security | Nothing new | Nothing new | Must escape all text, turn script off, route links outside. New attack surface (CLAUDE.md section 12) |
| Dev gallery snapshots | `islandSnapshot` flat mode exists | Probably blank in `ImageRenderer` (unverified) | Blank in `ImageRenderer` |
| Risk without a compiler | Low. Plain SwiftUI and Foundation | High. Layout and sizing need trials | High. Two languages, bridge, process, entitlements |
| Effort | S to M | L | L to XL |
| What T3 uses | n/a | T3 mobile (segments) | T3 web (DOM) |

Recommendation:
1. Do (a) now: ideas 1, 2, 3 and 4. They are small, they fix the table and copy complaint, and they keep the build safe.
2. Then run the (b) spike as a segmented design (idea 7): text views for prose, SwiftUI blocks for code and tables. That is how T3 mobile solved the same problem. Do not put tables into the text view.
3. Do not choose (c) unless ATOM later wants whole-chat find, selection across turns and Markdown copy of any selection in one step. T3 web shows (c) works, but it costs memory, a bridge and a security review.
4. Whatever the choice, keep the Markdown-to-clipboard code in Core. All three options need it.

### Decisions I need from you

1. Default for "Copy table": Markdown as text plus HTML (my pick), or tab-separated text (what T3 mobile does)?
2. Should the key for "Copy last reply" be Cmd+Shift+C, or another key?
3. May I extend `MarkdownBlock` (idea 4)? The `code` case changes shape, and the call sites in `MarkdownReply.swift` and `MarkdownHTML.swift` change with it.
4. Is a Mac build available for the (b) spike, and for checking `.contextMenu` with `.textSelection`?

### What this file does not cover

Settings, providers, git and the right panel (other files in this folder). The mobile timeline outside the Markdown view. Server projection of timeline rows. Voice input.
