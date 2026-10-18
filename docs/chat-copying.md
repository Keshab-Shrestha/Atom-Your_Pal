# Chat copying

ADR-143, implemented 2026-10-18. This delivers the saved chat plan's C1/C3: individual code/table copy with persistent native controls and accessibility actions. Release compilation/static review only. Automated tests, gallery rendering, app launch, actual clipboard pasting, keyboard focus and VoiceOver acceptance were skipped at the user's request. The installed app remains unchanged. Historical 733-Swift/75-gallery and TypeScript totals do not validate ADR-141–143.

## Reply formats and user-message Copy (ADR-144)

Implemented 2026-10-18, completing item 1 / C2 only. Release compilation and static review only; tests, gallery, app launch and actual clipboard/keyboard/VoiceOver acceptance remain skipped. No tests were added or run. The installed app is unchanged; prior test totals do not validate ADR-141–144.

Reply Copy now opens a menu with **Markdown**, **Plain text** and **Rich text**. Primary click defaults to Markdown, which preserves the original reply text and publishes no HTML. Plain text removes supported block/inline Markdown, keeps code bodies literal, retains readable list markers and uses tabs/newlines for tables. Rich text publishes the existing HTML rendering with a plain-text fallback. Destination applications choose which representation they accept; this is HTML clipboard formatting, not an RTF export or full Markdown fidelity.

Each nonempty user message has **Copy message** below its bubble plus an accessibility action. It copies the transcript exactly as typed, including literal Markdown, without HTML. Shared control feedback and the generic Copied/Copy failed announcement remain.

**Edit → Copy Last Reply (⌘⇧C)** copies the latest nonempty finished reply as Markdown from the current visible conversation. It skips a newer streaming reply; a settled failed reply's received text can still be copied. Validation and execution both require ATOM's active main Chat window, no attached sheet and no shortcut recording. With no finished reply, or outside that scope, it is disabled. It is not a global shortcut and does not read older archived turns. Ordinary ⌘C is unchanged.

Table copy remains Markdown+HTML by default, with TSV/CSV alternatives. Reply default copying deliberately changes ADR-143's automatic Markdown+HTML combination: choose Rich text explicitly for formatted paste.

## User behavior

- **Copy code** copies only the displayed parsed code body, with no Markdown fences or language tag.
- **Copy table** uses Markdown as plain text plus a rich HTML table in the same clipboard item. Its menu also offers TSV and CSV. Each action copies only that table, including its header.
- **Copy reply** remains visible below a finished reply; ADR-144 adds the explicit format menu described above. Timing text shares its footer rather than covering Copy.
- Pointer hover is no longer needed to make these controls exist. Buttons/menus retain native keyboard behavior; reply/code/table groups expose named accessibility actions. Message groups say You said and ATOM said. Actual focus order and VoiceOver behavior remain unverified.
- Standard copy controls show Copied with a checkmark for about 1.4 seconds, or Copy failed if clipboard preparation/write fails. Accessibility also announces that generic outcome. Custom accessibility actions use the same writer/announcement.
- Code/table controls are visible but disabled during streaming, with an explanatory tooltip. They become active once the reply settles, including received text from a failed reply.

## Serialization

`MarkdownCopy` in AtomIslandCore contains pure clipboard formatting. It does not access AppKit, providers, tools, files or the clipboard. `ChatClipboard` prepares one `NSPasteboardItem`, checks each representation, clears the old clipboard only after preparation, and checks the final write. A failed final write may still leave the clipboard empty; its previous contents are not read or restored.

| Format | Plain-text representation | Additional clipboard representation |
| --- | --- | --- |
| Code | Parsed displayed body, without fences | None |
| Table default | Normalized Markdown table | Rich HTML table |
| Table TSV | Tab-separated plain cell values | Native tabular text |
| Table CSV | Comma-separated plain cell values | None |
| Reply Markdown (default/shortcut) | Original reply Markdown/text | None |
| Reply plain text | Parsed text with supported formatting removed | None |
| Reply rich text | Plain-text fallback | Existing rich HTML rendering |
| User message | Exact transcript text | None |

Markdown table output preserves alignment markers, escapes unescaped pipes and normalizes cell line breaks to spaces. Parsing now respects escaped pipes in cells and retains alignment metadata. Exports pad/truncate parsed rows to header width, consistent with existing rendering. TSV/CSV remove supported inline formatting through Foundation's inline parser, double embedded quotes, quote cells containing their delimiter/quotes/line breaks and separate rows with CRLF. These are data exports; how a destination interprets the pasted values/formats depends on that app.

HTML uses the existing small block renderer with escaped text and static tags/alignment styles. It embeds no raw HTML resources. Full GitHub-flavored Markdown is not supported. Code copying uses the already parsed body, including the parser's existing CRLF normalization; it is not a byte-for-byte source-file export. Clipboard source text is neither logged nor announced.

## Verification and limits

The release app is compiled with `swift build --package-path apps/mac/island -c release`; static review includes `git diff --check`. One existing parser expectation was updated for the new alignment metadata but was not compiled or executed. No test command, gallery rendering or interactive workflow is part of ADR-143/144. No dependency, backend/schema/wire or authorization change.

C2 is implemented in source by ADR-144. ADR-145 adds quotes, rules, nested/task lists and code-language labels, with corresponding plain/rich copying; see [Markdown scope](chat-markdown.md). Tests and live acceptance remain skipped. ADR-146 adds long-user-message collapse ([scope](chat-message-collapse.md)); Copy full message retains the original transcript in both display states. Cross-paragraph selection and follow-the-end scrolling remain separate steps.
