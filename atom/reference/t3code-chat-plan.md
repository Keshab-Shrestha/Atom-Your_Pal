# Chat plan: what to copy from T3 Code

> Review update (2026-10-17): [second source review](t3code-second-review-2026-10-17.md) records corrections and pinned evidence. Use the [combined roadmap](../docs/upgrade-roadmap.md) for current ATOM status. Detailed observations below retain the earlier snapshot unless updated explicitly.

This plan joins two files: `t3code-chat-timeline-and-messages.md` (how T3 Code draws and copies messages) and `t3code-composer-and-controls.md` (the chat box).
It answers one complaint: ATOM's chat feels like plain text, and a table is hard to copy.

## Why the chat feels like plain text

- ATOM draws a Markdown reply as separate SwiftUI blocks (`MarkdownReply.swift`). SwiftUI lets you select text inside one `Text` only.
- A table is a grid of many small `Text` pieces. You cannot select it with the mouse as one thing.
- The only copy action is one button for the whole reply (`TurnView.copy`). It does put a real HTML table on the clipboard, but you cannot copy one table or one code block alone.
- The Copy button appears on hover only. It does not exist for the keyboard or VoiceOver.
- The parser knows paragraphs, headings, flat lists, code and tables. A quote, a rule, a nested list and the code language fall back to plain paragraphs.
- The scroll jumps to the newest turn every time. Long user messages fill the screen.

T3 Code web is a web page, so selection and copy come from the browser. T3 Code mobile has the same limit as ATOM. It draws prose as selectable segments and tables as separate blocks, and it adds copy buttons.

## Technical choice for selection and copy

| Option | Verdict |
| --- | --- |
| (a) Keep SwiftUI blocks, add copy buttons per block | Do now. Small, safe, fixes the table complaint |
| (b) One `NSTextView` per run of prose, code and tables stay as blocks | Spike later. This is T3 mobile's model. Needs a Mac build |
| (c) A `WKWebView` per message | Not now. Memory, a bridge and a new attack surface |

Keep the Markdown-to-clipboard code in `AtomIslandCore`. All three options need it.

## Phases

Each item is its own task and ADR (CLAUDE.md section 3). Stop after each. Sizes: S under a day, M a few days, L a week or more.

### Phase 1: copy and read (SwiftUI and Core only, low risk)

| # | Item | From | Size |
| --- | --- | --- | --- |
| C1 | Copy button on each code block ("Copy code") and each table (menu: Markdown plus HTML, TSV, CSV). The icon shows a check for about a second | timeline idea 1 | S to M |
| C2 | One copy menu on a reply (Markdown, plain text, rich text), a Copy button on the user's bubble, and a key for "Copy last reply" | timeline idea 2 | S to M |
| C3 | Make Copy reachable by keyboard and VoiceOver: an accessibility action, the button kept in the layout, turns labelled "You said" and "ATOM said" | timeline idea 3 | S |
| C4 | A fuller parser: block quote, horizontal rule, nested and task lists, code language shown as a small label | timeline idea 4 | M |
| C5 | Collapse a long user message (over about 600 characters or 8 lines) with "Show full message" | timeline idea 6 | S |

Table copy rules to copy from T3 Code: escape `|` as `\|`, turn a line break in a cell into a space, keep the alignment marks, and quote a CSV cell that holds a comma, a quote or a line break.

### Phase 2: the chat box

| # | Item | From | Size |
| --- | --- | --- | --- |
| B1 | State-aware placeholder and send button: the tooltip says Return waits and Cmd+Return sends now, and a disabled control says why | composer idea 1 | S |
| B2 | Strip hidden characters (zero-width, bidi, tag characters) from pasted text, with a notice | composer idea 3 | S |
| B3 | Thumbnails and Quick Look on attached file chips. A pasted screenshot shows only a file name today | composer idea 2 | S to M |
| B4 | Save drafts to disk. Today a draft is lost when ATOM quits (ADR-125) | composer idea 4 | S |
| B5 | A list of waiting messages with Edit, Send now and Remove. ADR-127 joins them into one message today | composer idea 5 | M |
| B6 | Long paste (4000 characters or more) becomes a file attachment | sessions idea 8 in the ideas file | S |

### Phase 3: reading comfort

| # | Item | From | Size |
| --- | --- | --- | --- |
| R1 | Follow the newest text only when the reader is at the end; a "Scroll to end" pill otherwise. Needs a check of which scroll API the build Mac has | timeline idea 5 | M |
| R2 | Find in chat (Cmd+F) over the turns, with match counts | timeline idea 8 | M |
| R3 | File path chips in project replies (click reveals the file; only inside the project folder) | timeline idea 9 | M |
| R4 | "Reply to this": quote a selection or a reply into the next message | composer file | M |
| R5 | A file search in the "@" menu for project chats | composer file | M |

### Phase 4: spike

| # | Item | From | Size |
| --- | --- | --- | --- |
| S1 | Segmented `NSTextView` for prose, so drag-select works across paragraphs. Code and tables stay as blocks with their copy buttons. One day in the gallery first | timeline idea 7 | L |

### Later (needs the runtime)

- "Worked for N s" and a folded work log of tool calls. The chat model carries only text and timings today. It needs a new protocol event and an ADR.
- A question card where the model asks the user something; a read-only "Access" pill; `atom://` prompt links.

## Suggested start

1. C1 and C3 together: copy buttons on code and tables, reachable from the keyboard. This fixes the complaint you named.
2. C2, then C4.
3. B1, B2, B4 (all small).
4. Run the S1 spike only when a Mac build is at hand.

## Status

Date: 2026-10-17. Status: **deferred**. Keshab said: "no need to upgrade now, but include in reference."
No chat code changed. This file is the saved plan for later.

## Decisions (defaults, to confirm when work starts)

1. "Copy table" default: Markdown as text plus HTML. The other choice is tab-separated text (what T3 mobile does).
   Default: Markdown plus HTML. Notes and Pages then paste a real table.
2. The key for "Copy last reply". Default: Cmd+Shift+C.
3. May C4 change the `MarkdownBlock.code` case to carry the language? Default: yes.
   The call sites in `MarkdownReply.swift` and `MarkdownHTML.swift` change with it.
4. Is a Mac build at hand for the S1 spike and for checking `.contextMenu` with `.textSelection`? Not yet. Skip S1 until one is.

## How to start later

1. Say "start the chat plan". Work begins with C1 and C3 and the defaults above.
2. Follow CLAUDE.md: one item at a time, an ADR, a TASK entry.
