# ark-spike: checks for the owner

These checks need a person at the Mac. An agent cannot do them. Write each result in the table at the end: **works**, **patch** (works only with a change to Rune) or **no** (does not work). Then copy the results into `docs/rust-phase-0-results.md`.

The spike does not touch the running ARK, `data/`, `.env` or `config/`.

## Before you start

1. Open Terminal. Go to the `rust` folder of the repository.
2. Put rustup on the PATH: `export PATH="$(brew --prefix rustup)/bin:$PATH"`.
3. Build the spike: `cargo build -p ark-spike`.
4. Each check opens its own window. The log at the bottom of the window shows each event. Terminal shows the same lines with the prefix `spike:`.
5. Close a check with Cmd+Q, or run `pkill -x ark-spike`.

## A. Text input

Run `target/debug/ark-spike --check text`. The window has a single-line field and a multi-line field.

| # | Step | Expected result |
| --- | --- | --- |
| A1 | Turn on a Japanese input source (Settings > Keyboard > Input Sources). Click the single-line field. Type `nihongo`. | The underlined composition shows in the field. The log shows `single preedit: …` lines. |
| A2 | Press Space to convert. Press Return to accept. | The candidate window shows near the field. The log shows `single preedit end` and a `single change` with the kanji. |
| A3 | Do A1 and A2 in the multi-line field. | The same, with `multi` in the log. |
| A4 | Click a field. Start macOS dictation (Fn Fn, or your dictation key). Say a short sentence. Stop dictation. | The words go into the field. The log shows `change` lines. |
| A5 | Do A4 with FluidVoice (hold Right Cmd + Right Option). | The words go into the field. |
| A6 | Press Ctrl+Cmd+Space. Pick an emoji. | The emoji goes into the field. |
| A7 | Copy formatted text from Safari or Notes. Paste it with Cmd+V into a field. | The plain text goes in. The log shows `paste: … html=true` (or `rtf=true`). |
| A8 | Copy an image (for example from Preview). Paste it into a field. | The log shows `paste: … image=true`. No text goes in. |
| A9 | Type text. Press Cmd+Z, then Cmd+Shift+Z. | Undo removes the text. Redo puts it back. |
| A10 | Select text with the mouse, with Shift+Arrow and with a double click. Copy and paste it. | Selection, copy and paste work as in a Mac text field. |
| A11 | In the multi-line field, type a word with a spelling error, for example `teh`. | A red underline shows under the word. Right-click shows the spelling choices. |
| A12 | Right-click a field. | A context menu shows. Note what is missing (Writing Tools, Services, Look Up). |

## B. Windows

Run `target/debug/ark-spike --check windows`. It adds a menu bar item "ARK spike", a small panel at the top of the main display, a panel on each other display, and on each display a full-display overlay with one box and a small "target" window.

| # | Step | Expected result |
| --- | --- | --- |
| B1 | Click "ARK spike" in the menu bar. Click "Spike click". | The menu shows. The log shows `status item menu click: Spike click`. |
| B2 | Click another app (for example Finder), so that ARK spike is not active. Move the pointer over the panel at the top of the main display. | Today: no `panel hover` line (a known gap). Write what you see. |
| B3 | Click the ARK spike window. Move the pointer over the panel again. | The log shows `panel hover: true`, then `false` when the pointer leaves. |
| B4 | Use a second display that shows a normal desktop, not a full-screen app. Look at that display. | The overlay box "overlay 1: full-display overlay box" and the "target 1" window show on it. |
| B5 | On the second display, click the "target 1" window under the overlay. | The log shows `target 1 press`. The overlay does not take the click. |
| B6 | Quit. Run `target/debug/ark-spike --check windows --catch`. Click Finder. Click the overlay box on the second display. | The log shows `overlay 1 press`. Note if ARK spike becomes the active app. |
| B7 | Put a full-screen app on the second display. Run `--check windows --all-spaces`. | Note if the overlay box shows over the full-screen app. |

## C. Native views

Run `target/debug/ark-spike --check views`. A striped window sits behind a transparent window.

| # | Step | Expected result |
| --- | --- | --- |
| C1 | Look at the left half of the window. | You see the stripes through a dark, blurred material. The white Rune text is on top of the material. |
| C2 | Click the text box in the white web page on the right. Type text. Use a Japanese input source. Use dictation. | The text goes into the web page. |
| C3 | Click "Click me" in the web page. | The paragraph changes to "Button clicked in WKWebView". |
| C4 | Turn on VoiceOver (Cmd+F5). Move into the web page. | Note if VoiceOver can read the web page. Today the accessibility tree does not show it. |

Embed host: go to `rust/crates/ark-spike/embed-host` and run `./build.sh`. A SwiftUI window shows the text check inside it.

| # | Step | Expected result |
| --- | --- | --- |
| C5 | Click the single-line field. Type text. Press Backspace. | The text shows. The log shows `key` and `change` lines. |
| C6 | Use a Japanese input source in the field (as A1 and A2). | The log shows `preedit` lines, then a `change` with the kanji. |
| C7 | Use dictation and the emoji picker in the field. | The text goes into the field. |
| C8 | Click "Test button". | The log shows `test button pressed`. |

## D. Accessibility (VoiceOver)

Run `target/debug/ark-spike --check a11y`.

| # | Step | Expected result |
| --- | --- | --- |
| D1 | Turn on VoiceOver (Cmd+F5). Press VO+Right Arrow through the window. | VoiceOver reads the heading "ARK spike: text", "Single-line field, text field", "Multi-line field, text area", "Test button, button" and the log lines. |
| D2 | Move to "Test button". Press VO+Space. | The log shows `test button pressed`. |
| D3 | Move to the single-line field. Type text. | VoiceOver reads each typed character. |
| D4 | Open the rotor (VO+U). Look at Headings. | "ARK spike: text" is in the list. Rune reports the role as "Heading", not "AXHeading". |
| D5 | Turn off VoiceOver (Cmd+F5). | |

## Results

| Check | Result (works / patch / no) | Note |
| --- | --- | --- |
| A1 | | |
| A2 | | |
| A3 | | |
| A4 | | |
| A5 | | |
| A6 | | |
| A7 | | |
| A8 | | |
| A9 | | |
| A10 | | |
| A11 | | |
| A12 | | |
| B1 | | |
| B2 | | |
| B3 | | |
| B4 | | |
| B5 | | |
| B6 | | |
| B7 | | |
| C1 | | |
| C2 | | |
| C3 | | |
| C4 | | |
| C5 | | |
| C6 | | |
| C7 | | |
| C8 | | |
| D1 | | |
| D2 | | |
| D3 | | |
| D4 | | |

## Agent tools

`probe.swift` lists the windows of a process and posts pointer events: `swiftc -O probe.swift -o /tmp/ark-probe`. Synthetic input moves the pointer and changes the active app. Run it only when nobody uses the Mac. Click only on the spike's own windows. A window on a display that shows a full-screen app is not visible, so a click there goes to that app.
