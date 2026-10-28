# Web panel contract, version 1 — 28 October 2026

This document defines how the Swift app and a web panel exchange data.
It belongs to ADR-211. The plan is in [html-to-native-plan.md](html-to-native-plan.md).
No code implements this contract yet. Phase 1 implements it.

## Terms

- **Host**: the Swift code that owns the web view.
- **Panel**: one HTML page in the app bundle. It shows data. It does not act.
- **Message**: one JSON object that crosses between host and panel.

## What a panel may do

A panel may show read-only visuals that change often.
A panel may not do any of these things:

- send a chat message, run a tool, change a file, or change a setting
- approve, deny, or grant any permission
- read a file, the network, the clipboard, or a secret
- keep state between loads

If an action is needed, the panel asks for an **intent**. The host decides.

## Files

- Each panel lives in `apps/mac/island/Web/<panel>/`. The build copies it to `Resources/web/<panel>/` in the app.
- The entry file is `index.html`. Styles and scripts are separate files in the same folder.
- A panel file never contains base64 images.
- The host loads the page with `loadFileURL(_:allowingReadAccessTo:)`. The access folder is the panel folder only.
- Every page has this CSP in a `<meta>` tag: `default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'`.

## Web view settings

1. Use `WKWebsiteDataStore.nonPersistent()`.
2. Allow the first load. Cancel every later navigation, window open and download.
3. Turn off link preview and back-forward gestures.
4. Add one script message handler named `atomPanel`.
5. Run all host code on the main actor.

## Host to panel

The host calls `window.atomPanel.receive(message)` with `callAsyncJavaScript`.
The host passes the message as an argument. The host never builds JavaScript from text.

Every message has `v` (the contract version, `1`) and `type`.

| type | Fields | When |
|---|---|---|
| `init` | `panel`, `scheme`, `tokens`, `textScale`, `reduceMotion` | After the panel sends `ready` |
| `theme` | `scheme`, `tokens`, `textScale`, `reduceMotion` | The user changes the theme or text size |
| `data` | `revision`, `payload` | New data exists. `revision` always rises. |
| `reset` | none | The chat or task changes |

- `scheme` is `light` or `dark`.
- `tokens` maps a token name to a CSS value. Token names start with `--`. The host builds this map from `Theme.swift`. Phase 1 fixes the list. The first names are `--bg`, `--panel`, `--text`, `--muted`, `--quiet`, `--line`, `--fill`, `--accent`, `--accent-text`, `--green`, `--blue`.
- `textScale` is a number from 0.8 to 2.0. The panel multiplies all type sizes by it.
- The panel ignores a `data` message with a `revision` that is not higher than the last one.

## Panel to host

The panel calls `window.webkit.messageHandlers.atomPanel.postMessage(message)`.

| type | Fields | Meaning |
|---|---|---|
| `ready` | `v`, `panel` | The page loaded. Send `init`. |
| `resize` | `v`, `height` | The page content needs this height in points. |
| `intent` | `v`, `name`, `args` | The panel asks the host to do something. |

The host checks every message. The host drops a message and logs one line if any check fails.

1. The message is a JSON object of 16 KiB or less.
2. `v` is `1`.
3. `type` is in the table above.
4. No field is unknown for that type.
5. `height` is a number from 0 to 4000. The host clamps it to the space it has.
6. For `intent`, `name` is in the allowlist of that panel.
7. Every id matches `^[A-Za-z0-9._:-]{1,128}$`.

The host never trusts an intent. The host checks the current state again, then uses the normal command path and the policy engine.
A message from a panel never carries a secret, a token, or a user path.

## Run panel, version 1

The Run panel shows one chat turn. The data comes from `ChatWorkSnapshot` (`ChatWork.swift`).

### Data payload

```json
{
  "chat": "string",
  "turn": "string",
  "state": "string",
  "elapsedMs": 0,
  "calls": [{ "id": "string", "tool": "string", "state": "string", "ms": 0 }],
  "omitted": 0,
  "questions": [{ "id": "string", "prompt": "string", "state": "string" }],
  "unavailable": ["pipeline", "lanes", "evidence"]
}
```

- `state`, and each call and question `state`, is a string. The panel shows an unknown value as neutral text.
- `ms` is a number or `null`.
- `calls` has at most 200 items. `omitted` counts the rest.
- `questions` has at most 50 items.
- If the payload is too large, the host drops calls from the end and adds them to `omitted`.
- Each string is at most 500 characters. The host truncates it.
- The payload is at most 256 KiB.
- The host leaves out the question `answer` and `error` fields. They can hold user text.
- `unavailable` lists the sections that the runtime does not report yet. The panel shows "Not available" for each one.

### Intents

The Run panel has no intents in the first release. The allowlist is empty, so the host drops every `intent` message from it.

Reserved for later: `selectCall` with `{ "id": "string" }`. It will highlight that call in the native chat. It needs native highlight support first. Add an intent only by a new ADR or an ADR update.

### Where it shows

The Run panel is the Run surface in the workspace pane, beside Files, Changes, Git, Browser and Terminal. It works in any chat. It shows the latest turn of the open chat.

## Page rules

1. Escape all text from the data before it goes into the page.
2. Do not use `fetch`, `XMLHttpRequest`, `localStorage`, `sessionStorage`, `eval`, or `new Function`.
3. Honour `textScale`, `scheme` and `reduceMotion`.
4. Set an `aria-label` on the panel root. Make every control reachable by keyboard.
5. Do not include the simulated chat engine from the preview.
6. Show a clear empty state before the first `data` message.

## Versioning

- This is version 1.
- A change that breaks a field needs version 2.
- The host refuses a panel that reports a version it does not know.

## Tests for Phase 1

These tests run with `pnpm island:test`. They live in `AtomIslandCore`.

- The parser accepts each valid message.
- The parser rejects each failed check in the list above.
- The navigation policy allows the first load and cancels the rest.
- The payload builder truncates strings, caps the call count, and leaves out `answer` and `error`.
