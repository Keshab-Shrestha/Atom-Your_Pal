# Richer native Markdown

ADR-145 / C4, implemented 2026-10-18. This step adds native Markdown blocks only. Verification is limited to release compilation and static diff review. Tests, gallery rendering, app launch and actual copy/keyboard/VoiceOver workflows were skipped at the user's request. The installed app remains unchanged; historical test/gallery totals do not validate ADR-141–145.

## Supported additions

| Syntax | Native display | Rich / plain clipboard behavior |
| --- | --- | --- |
| Explicit `>` quotes, including nested quotes | Indented content with a quote bar and accessibility group label | Static HTML blockquotes / plain quote contents |
| Three or more matching `-`, `*` or `_`, optionally spaced | Section separator | Static HTML rule / readable plain separator |
| Nested ordered/unordered lists | Indented child blocks; ordered lists keep their starting number | Nested HTML lists / indented plain children |
| `[ ]`, `[x]`, `[X]` after a list marker | Static incomplete/completed check indicator, with accessible state label | Static task glyphs / `[ ]` or `[x]` text; numbered tasks retain their ordinal |
| Backtick or tilde fences with language info | Monospaced code and a language label beside Copy code | Escaped code HTML / literal code text; the label is not included in Copy code |

List child blocks require indentation to the parent's content column. Tabs use four-column stops. Blank-separated siblings and indented child paragraphs/quotes/code are accepted. Ordinary wrapped list text can continue until a blank line or another block starts. Quote continuation lines need their explicit `>` markers.

Fences need at least three backticks or tildes. A close must use the same marker, at least the opening count, and no trailing info. Shorter fences inside a longer fence remain code. An unfinished streaming block keeps the text received so far. The first info token becomes a label only if it is at most 48 ASCII letters/digits or `_+.#-`; invalid/absent labels display Code. Line endings normalize to LF in parsed blocks. This is not syntax highlighting or byte-for-byte source-file export.

Task indicators are not editable controls and do not create or complete ATOM tasks. Source Markdown and saved conversation history remain unchanged. Exact Markdown reply copying is unaffected; plain/rich formats now serialize the expanded block tree. Existing table alignment/escaped-pipe behavior and individual code/table copy actions remain.

## Bounds and limitations

The Core tree parser permits 16 nested quote/list levels. Deeper remaining syntax is shown as paragraph text. SwiftUI recursively renders native nodes with an erased recursive boundary; no WebView, embedded HTML or external rendering dependency is introduced. HTML clipboard output escapes text and uses fixed tags/alignment values; task state uses glyphs rather than interactive inputs. Language labels are text only and never select a runner or file path.

This is not full CommonMark/GFM. Setext headings, general indented code, reference links, lazy unmarked quote continuation and complete mixed-block/loose-list grammar remain unsupported. Unsupported forms generally remain text or use the existing basic blocks. Raw HTML is not embedded. Inline HTML export retains its existing limited bold/italic/code handling. Destination apps may render copied formatting differently.

## Verification record

Release compilation uses `swift build --package-path apps/mac/island -c release`; static review includes `git diff --check`. Existing parser expectations for structured list items and code language metadata were adjusted to match the API, but were not compiled or executed. No new test cases or visual fixtures were added; tests and visual checks were not run. No backend/schema/wire/provider/permission/dependency change.

C5 long-user-message collapse is implemented separately by ADR-146 ([scope](chat-message-collapse.md)), with compilation only and tests/live checks skipped. R1 follow-the-end scrolling remains proposed.
