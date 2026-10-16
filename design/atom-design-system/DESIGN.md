# ATOM Design System

> Category: Productivity & SaaS
> A calm Mac window for an assistant and a team of agents. Flat surfaces, hairlines, one accent, status as small dots, identifiers in monospace.

This file describes how the ATOM window looks. The values are in `tokens.css`. A test keeps `tokens.css` equal to the Swift themes (`Theme.swift`). The package follows the Open Design design-system shape.

## 1. Visual Theme & Atmosphere

ATOM is a tool you leave open all day. It must be quiet. It must show what the assistant and the agents are doing, and it must not compete for attention.

- **Two themes in this package.** Void is dark and is the default. Daylight is light.
- **Flat.** A surface is one opaque colour. A 1 px hairline is the edge of a card. No blur, no gradient, no drop shadow, no glow.
- **One accent.** In Void the accent is white. In Daylight it is indigo. Colour appears otherwise only as status.
- **Status is a small dot.** A dot with a word beside it. A dot alone never carries meaning.
- **Identifiers are monospaced.** Model names, app names, timings, shortcuts and file paths use the mono font.
- **Glass themes exist** (Lantern, Lantern Day, Quiet Native, Luminous, Warm). They are not in this package.

## 2. Color Palette & Roles

Use tokens. Do not write a hex value in a view.

| Role | Token | Void | Daylight |
|---|---|---|---|
| Window | `--bg` | `#000000` | `#F6F6F8` |
| Card | `--surface` | `#000000` (edge by hairline) | `#F6F6F8` (edge by hairline) |
| Track, selected segment | `--surface-2` | `#16181B` | `#ECEEF3` |
| Stronger fill | `--surface-3` | `#222529` | `#E0E3EB` |
| Hairline | `--border` | `#292D30` | `#D8DBE3` |
| Hairline on hover | `--border-hover` | `#6E727A` | `#A3A8B6` |
| Main text | `--fg` | `#F0F0F0` | `#3F3F50` |
| Secondary text | `--fg-2` | `#A1A4A5` | `#6B6B78` |
| Caption | `--fg-3` | `#878B92` | `#6B6B78` |
| Accent | `--accent` | `#FFFFFF` | `#5B50E6` |
| Text on accent | `--accent-on` | `#000000` | `#FFFFFF` |
| Listening, running | `--live` | `#70B8FF` | `#1D5FD1` |
| Needs you | `--warn` | `#FFCA16` | `#8F5600` |
| Problem | `--danger` | `#FF9592` | `#B42318` |
| Done, ready | `--success` | `#3AD389` | `#167A53` |
| Identifier | `--identifier` | `#BAA7FF` | `#5B50E6` |

Rules:

- Text has three levels. Main text is at least 7:1 on the window. Secondary text and captions are at least 4.5:1. A test checks this for every theme.
- Secondary text is always softer than main text.
- Use a status colour on less than 5% of a screen.
- Show each state with a shape or a word too. Never colour alone.
- Use the accent on at most two things in one view: the main action, and one selected item.

## 3. Typography Rules

- **Sans:** the system font (SF Pro). **Mono:** SF Mono.
- **Titles:** SF Pro, semibold. **Identifiers and readouts:** mono.
- The window's sizes today are 10.5, 11, 11.5, 12, 12.5, 13, 18 and 26 pt. Move toward one scale: **11, 12, 13, 15, 18, 26**. Use a size only for its role: caption, secondary, body, row title, page title, number.
- Make hierarchy with three things together: size, weight, and colour level. A size alone is not hierarchy.
- Use two weights in a view: regular and semibold. Do not climb a ladder of weights.
- Use tabular (monospaced) figures for numbers that line up, such as token counts.
- The scale is in tokens.css as `--text-caption` to `--text-number`. Settings → Design system shows every token and component in Void and Daylight (ADR-124).

## 4. Spacing & Layout

- **4 px grid.** Use 4, 8, 12, 16, 20, 24 and 32. The tokens are `--space-1` to `--space-8`.
- The window has a sidebar of 224 pt and a main pane. The main pane has a top bar. The top bar has 36 pt above it, so its content sits level with the app name in the sidebar.
- A page reads in a column of at most 680 pt.
- The sidebar has two groups of pages that the user can arrange by dragging. Only the Chats list scrolls.
- Gaps between groups are larger than gaps inside a group. Do not use one gap everywhere.

## 5. Component Stylings

- **Row (sidebar page):** a circle with a symbol, a title in semibold, a caption below. The selected row has a hairline. A row takes keyboard focus. Return and Space press it.
- **Card:** a hairline and a radius of `--radius-md`. No fill in Void.
- **Button:** in Void a ghost button (a hairline, no fill). It brightens its hairline on hover. The main action may use `--accent`.
- **Status dot:** 6 to 8 pt. Always with a word.
- **Identifier:** mono, in `--identifier`.
- **Empty state:** a short headline, one sentence that says why, and one action.
- **Error:** say what happened, why if known, and what the user can do. Keep what the user typed.
- **Drag:** a row that can move shows a line where it will land.

## 6. Depth & Elevation

Two levels only.

| Level | Treatment | Use |
|---|---|---|
| Flat | `none` | The window, rows |
| Ring | a 1 px hairline (`--elev-ring`) | Cards, fields, menus |

Do not add a third level. Depth in the dark theme comes from a lighter surface step (`--surface-2`, `--surface-3`) and a hairline, not from a shadow. Shadows are invisible on black.

## 7. Motion

- Two durations: **150 ms** (state change, hover) and **200 ms** (something arrives). One curve (`--ease-standard`).
- ATOM names its motion in `Motion.swift`: snap, settle, open, close. Things arrive with a little life and leave without fuss. Nothing springs on the way out.
- Every motion has a Reduce Motion form: a plain 150 ms fade. Breathing and cascades stop.
- Move only to show a change of state or a relation. Do not move to decorate.

## 8. Accessibility

- Contrast: see section 2. Tests check every theme.
- **Focus must stay visible.** Every control that takes a click also takes the keyboard. A custom row that is not a `Button` adds `.focusable()`, Return and Space, and an accessibility press action.
- Do not remove the focus ring.
- A touch or click target is at least 24 pt, and 28 pt or more where there is room.
- Every icon-only button has an accessibility label.
- Do not use colour alone for state.
- Reduce Motion is respected everywhere.

## 9. State coverage

Every list, table, card, form and page has five states. The populated state is the easy one. The others are where a design fails.

| State | Must have |
|---|---|
| Loading | A skeleton or a quiet "Loading…", and a way out if it takes long |
| Empty | A headline, one sentence, one action. Say what to do first |
| Error | What happened, why, what to do, and a retry. Keep the user's input |
| Populated | The state the design was drawn for |
| Edge | A long name, a missing value, thousands of rows. The layout must not break |

## 10. Do's and Don'ts

Do:

- Use a token for every colour, radius and gap.
- Use a hairline for an edge and a lighter surface for depth.
- Show status as a dot with a word.
- Write identifiers in mono.
- Make an empty state tell the user what to do.

Don't:

- Don't use a shadow, a glow or a gradient in a flat theme.
- Don't use the accent as decoration.
- Don't give a card a coloured edge on one side. That is a mark of generic generated design.
- Don't show invented numbers or filler text in a real view.
- Don't use an emoji as an icon. Use a monoline SF Symbol.
- Don't let a control work by mouse only.
- Don't use one size and one weight for every line of text.
