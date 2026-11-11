# Rust Phase 0.2: spike check results

ADR-278, docs/rust-migration-plan.md, Phase 0 and section 10. The spike crate is `rust/crates/ark-spike`. It is a normal Rune app. ARK does not ship it. It changes no Rune file. `rust/crates/ark-spike/CHECKLIST.md` gives the steps for the checks that need a person.

Checked on 12 November 2026 on an Apple M4 Mac mini, macOS 27.0.1, two 1920 × 1080 displays (scale 1), Rune `b556a38`, toolchain 1.99.1.

Result words: **works**; **works with a patch** (a change to Rune or a spike-side workaround is necessary); **does not work**; **owner to run** (a person must do the check).

How the agent tested: it ran each check window, posted pointer events with `probe.swift` (`CGEvent`), used System Events (Accessibility API) for keys, menu clicks and the accessibility tree, and captured only the spike's own windows with `screencapture -l <window id>`. Evidence lines are the `spike:` log lines of the check.

## Results

| Check | How tested | Result | Evidence | Patch needed | Next |
| --- | --- | --- | --- | --- | --- |
| A. Keys, text change, undo, paste forms in a Rune field | Headless `--script` (test `tests/headless.rs`); System Events keystrokes into the live window | Works | `single key: Backspace`, `single key: Command('z') cmd`, `single paste: text="Ship it" html=true`, `single change: "abShip it"`; live: `single change: "hi"` | None | — |
| A. Japanese IME (preedit, candidate window, commit) | Not run: it needs a person and a change of input source | Owner to run | The log shows `preedit` lines for it | — | CHECKLIST A1–A3 |
| A. macOS dictation, FluidVoice, emoji picker | Not run | Owner to run | — | — | CHECKLIST A4–A6 |
| A. Rich paste from apps, image paste, selection, spell check, context menu | Not run (the headless script proves the paste routing only) | Owner to run | — | — | CHECKLIST A7–A12 |
| B1. `NSStatusItem` through objc2 next to a Rune window | Live; System Events clicks the menu bar item and the menu item | Works (spike-side objc2, no Rune patch) | `status item added: visible=true`; menu items `Spike click`; `status item menu click: Spike click` | None. Phase 3 puts it in `ark-mac` | — |
| B2. Hover in a non-key `App::overlay` panel, app active | Live; pointer moved over the panel while the spike was the active app | Works | `panel hover: true`, `panel hover: false` | None | — |
| B2. Hover in a non-key panel, other app active | Live; Finder active, pointer moved over the panel | Does not work | No hover line | Yes: the panel must get mouse-moved events while another app is active (for example a tracking area with `NSTrackingActiveAlways`) | Patch in Phase 3 before the island hover reveal |
| B3. `WindowOptions::overlay(display)` on the main display: click-through | Live; click on the spike's target window under the overlay | Works | `target 0 press`; the overlay logs no press | None | — |
| B3. Click on an overlay that takes clicks (`--catch`, `set_click_through(false)`) | Live; Finder active, click on the overlay box | The click activates the app (Finder → ark-spike) | `overlay 0 press`; frontmost app changed to ark-spike | Only if ARK must not activate: use a non-activating panel | Decide per overlay in Phase 3 |
| B3. Overlay that takes clicks: transparent area | Live; click on a clear area over the target window | It takes every click on the whole display | No `target 0 press` | Use `OverlayInput::Regions` style hit regions | — |
| B3. `WindowOptions::overlay` on the second display | Live; display 2 showed a full-screen app | Does not show over a full-screen Space; owner to run on a normal desktop | Overlay 1 exists at (-1920, 0, 1920, 1080), not on screen; also not with `canJoinAllSpaces`, `fullScreenAuxiliary`, level 25 and `orderFrontRegardless` (`--all-spaces`). A normal window placed on display 2 moved to display 1. | Possibly: build it as a non-activating `NSPanel` | CHECKLIST B4–B7 |
| B3. `App::overlay` panel on the second display (`OverlayOptions::display`) | Live | Works, also over the full-screen Space | Panel window at (-1840, 240); `panel on display 1 hover: true` | None. The README line "per-monitor placement unsupported" is out of date | — |
| C1. `NSVisualEffectView` `.hudWindow` behind a transparent Rune window | Live; capture of the spike window | Works with a patch | Material 13 under the Rune text. Without the fix, the material view hides Rune's drawing. | Spike-side fix: lift the `CAMetalLayer` to zPosition 1, as Rune's own material host does. Better: add `SystemMaterial::Hud` and `Sidebar` (materials 13 and 7) to `system_material/macos.rs` | The real blur: owner to look (CHECKLIST C1). A window capture shows the material as a flat grey. |
| C2. `WKWebView` child view over the Rune layer | Live; capture; click on its button and keystrokes into its text box | Works | The page draws; "Button clicked in WKWebView"; the text box shows `abc` | Spike-side: web view layer zPosition 2 (above the lifted Metal layer) | — |
| C2. `WKWebView` in the accessibility tree | System Events `entire contents` of the window | Does not work | The window shows only Rune's AccessKit nodes; the web page is missing | Yes: Rune's AccessKit view must list native child views as accessibility children | CHECKLIST C4 (VoiceOver) |
| C3. Rune embed host in a SwiftUI view | SwiftPM program `embed-host/` (no Xcode project) links ark-spike as a static library | Works for drawing and typed keys | The text check draws in an `NSViewRepresentable`; `single change: "no hey"`, `single key: Backspace` through `interpretKeyEvents` | None for this; the caret rect for the candidate window is a fixed spot in the spike (a real host asks `Runtime::caret`) | IME, dictation, emoji, click: owner to run (CHECKLIST C5–C8) |
| D. AccessKit tree exposed to macOS | System Events: role, title, value and identifier of each element in the live window | Works | `Heading` "ARK spike: text" (id heading); `AXTextField` "Single-line field" (id single); `AXTextArea` "Multi-line field"; `AXButton` "Test button"; `AXStaticText`; `AXGroup` (id log) | Check: the heading role is "Heading", not "AXHeading" | VoiceOver may not list it as a heading (CHECKLIST D4) |
| D. Accessibility actions | System Events `AXPress` on the button; set `AXValue` on the text area | Works | `test button pressed`; `multi change: "set by AX"` | None | — |
| D. VoiceOver speech | Not run: an agent cannot hear VoiceOver | Owner to run | — | — | CHECKLIST D1–D5 |

## The `claude` CLI for option 2B (plan section 5a)

The agent read `claude --version` and `claude --help` only. It ran nothing that sends a prompt or uses the plan quota.

- Version: 2.1.312 (Claude Code), a native arm64 binary.
- Stream JSON: `--input-format stream-json` and `--output-format stream-json` (both with `-p`/`--print`). Also `--include-partial-messages`, `--replay-user-messages` and `--include-hook-events`.
- MCP: `--mcp-config <configs...>` and `--strict-mcp-config`.
- Permission tool: `--permission-prompt-tool <tool>`. It is a hidden flag: `--help` does not list it, but the binary has it, and the `--permission-prompts host|none` help text names it.
- Settings and hooks: `--settings <file-or-json>` and `--setting-sources <sources>` (user, project, local). `--bare` skips hooks from settings and plugins, so option 2B must not use `--bare`.
- Sessions: `-r`/`--resume [value]`, `--session-id <uuid>`, `--fork-session`, `-c`/`--continue`.
- Other flags option 2B uses: `--effort <level>`, `--agents <json-or-file>`, `--plugin-dir <path>`, `--tools <tools...>`, `--permission-mode <mode>`.
- Not checked: that hooks from `--settings` run when `--setting-sources` is empty. This needs a session. Check it in the Phase 2 spike with a fake `claude` first, then on a fixture chat with the owner's consent.

## Build cost

- Clean debug build of ark-hello (`cargo build --locked`): 133 s CPU, as in Phase 0.1 (137 s). The wall time was 106 s, not 43 s, because the Mac was busy with other work.
- `cargo build --locked -p ark-spike` after that: 36 s wall, 59 s CPU. Most of it builds `rune` a second time, because ark-spike turns on more objc2 features and Cargo unifies features per build. `cargo clippy -p ark-spike --all-targets --no-deps`: 24 s. `cargo test -p ark-spike`: 6 s. CI adds about the same.
- The ark-spike debug binary is 134 MB (ark-hello: 103 MB).
- `ark-spike` adds two lock entries: `ark-spike` and `objc2-web-kit` v0.3.2 (Zlib OR Apache-2.0 OR MIT). The other objc2 crates are already in the lock.
- The embed host's static library is 361 MB in a debug build. CI does not build it.

## Note for the next GUI check

Synthetic input moves the pointer and changes the active app. During this check one click and a few keystrokes reached the owner's browser on display 2, because that display showed a full-screen app and the spike window there was not visible. Also some of the owner's own typing reached the embed host window while it was active. Run GUI checks only when nobody uses the Mac. Click only on the spike's own windows on a display with a normal desktop.
