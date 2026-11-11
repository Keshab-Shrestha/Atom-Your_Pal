# Chat visuals: the `ark-visual` block

ADR-276. This page is for agent and prompt authors.

## What it does

A reply can hold one fenced code block with the language `ark-visual`. The block holds one JSON object. The ARK window draws it as one card: stat tiles, bar rows, a line chart and tables, under a title. The card has two controls:

- **Copy** puts the numbers on the clipboard as Markdown tables.
- **Source** shows the JSON. Click **Card** to go back.

Use the block for numbers: test results, comparisons, measurements, costs. Do not use it for prose. For one chart with several series, use the `chart` block (2026-11-02) instead.

## Example

````text
```ark-visual
{"title":"Test run","blocks":[
  {"type":"stats","items":[
    {"label":"Passed","value":19,"tone":"good"},
    {"label":"Failed","value":2,"note":"Both in the cart","tone":"bad"},
    {"label":"Duration","value":"3.4s"}]},
  {"type":"bar","title":"Slowest tests","unit":"ms","data":[
    {"label":"checkout","value":1210},{"label":"login","value":340}]},
  {"type":"table","title":"Failures","columns":["Test","Error"],"rows":[
    ["cart total","expected 3 items, got 2"]]}
]}
```
````

## Grammar

The top level has exactly these keys:

| Key | Type | Rule |
|---|---|---|
| `title` | text | Required. 1 to 80 characters, one line. |
| `blocks` | array | Required. 1 to 6 blocks. |

Each block has a `type` and the keys of its type. Any other key makes the block invalid.

| Type | Keys | Rules |
|---|---|---|
| `stats` | `title?`, `items` | 1 to 12 items. Each item: `label` (text), `value` (text or number), `note` (text, optional), `tone` (`good`, `bad` or `neutral`, optional). |
| `bar` | `title?`, `unit?`, `data` | 1 to 40 points. Each point: `label` (text) and `value` (number). Labels are all different. |
| `line` | `title?`, `unit?`, `data` | The same rules as `bar`. |
| `table` | `title?`, `columns`, `rows` | 1 to 8 columns (text). 1 to 200 rows. Each row has one cell for each column. A cell is text or a number. |

Text limits: a title, label, column, unit, value or note has at most 80 characters. A table cell has at most 200 characters. Text has no line breaks and no hidden characters (for example U+202E). The whole block has at most 64,000 bytes.

## When the block is not valid

ARK does not guess. If the JSON does not parse, or one rule fails, the window shows the block as code. While a reply streams, the window shows "Drawing a card…" until the JSON is whole.

## Safety

The card draws only text and numbers. It runs no script, loads nothing from the network and shows no HTML. Speech skips the block. VoiceOver reads a short summary: the title, each stat, and for each chart its kind, its number of bars or points and its largest value.

The parser is `ArkVisual.parse` in `apps/mac/island/Sources/ArkIslandCore/ArkVisual.swift`. The tests are in `ArkVisualTests.swift`.
