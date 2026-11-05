# ARK Design System

> Category: Productivity & SaaS
> A calm Mac window for an assistant and a team of agents. Flat surfaces, hairlines, one accent, status as small dots, identifiers in monospace.

This file describes how the ARK window looks. The values are in `tokens.css`. A test keeps `tokens.css` equal to the Swift themes (`Theme.swift`). The package follows the Open Design design-system shape.

## 1. Visual Theme & Atmosphere

ARK is a tool you leave open all day. It must be quiet. It must show what the assistant and the agents are doing, and it must not compete for attention.

- **Two themes in this package.** Void is dark and is the default. Daylight is light.
- **Two materials (ADR-255).** Every theme has two materials. **Ambient glass** is the default: frosted panes over a soft, moving light. **Flat** is the alternative: one opaque colour per surface, a 1 px hairline as the edge, no blur, no gradient, no drop shadow, no glow. The system's Reduce Transparency always draws Flat. The values below are the flat ones; `AmbientGlass.swift` builds the glass ones from the same tones.
- **One accent.** In Void the accent is light grey. In Daylight it is indigo. Colour appears otherwise only as status.
- **Status is a small dot.** A dot with a word beside it. A dot alone never carries meaning.
- **Identifiers are monospaced.** Model names, app names, timings, shortcuts and file paths use the mono font.
- **Seven more themes exist in the app** (Obsidian & Electric Teal, Royal Plum & Lavender, Graphite & Champagne Gold, Midnight Sapphire, Graphite & Ember, Paper & Teal, Ink & Sage). They are not in this package. `AppTheme` in `Theme.swift` lists all nine.

## 2. Color Palette & Roles

Use tokens. Do not write a hex value in a view.

| Role | Token | Void | Daylight |
|---|---|---|---|
| Window | `--bg` | `#141414` | `#FEFFFF` |
| Card | `--surface` | `#141414` (edge by hairline) | `#FEFFFF` (edge by hairline) |
| Track, selected segment | `--surface-2` | `#202020` | `#F0F1F4` |
| Stronger fill | `--surface-3` | `#282828` | `#E5E6E9` |
| Hairline | `--border` | `#272727` | `#EAEBEB` |
| Hairline on hover | `--border-hover` | `#3E3E3E` | `#D0D1D1` |
| Main text | `--fg` | `#F2F2F2` | `#0F0F11` |
| Secondary text | `--fg-2` | `#B4B4B4` | `#525255` |
| Caption | `--fg-3` | `#8C8C8C` | `#717174` |
| Accent | `--accent` | `#DEDEDE` | `#4B53C2` |
| Text on accent | `--accent-on` | `#0F0F0F` | `#FFFFFF` |
| Listening, running | `--live` | `#79B6F4` | `#1F68BC` |
| Needs you | `--warn` | `#FABB41` | `#A15700` |
| Problem | `--danger` | `#FF8880` | `#C52B30` |
| Done, ready | `--success` | `#67D283` | `#00762C` |
| Identifier | `--identifier` | `#DEDEDE` | `#4B53C2` |

Rules:

- Text has three levels. Main text is at least 7:1 on the window. Secondary text and captions are at least 4.5:1. A test checks this for every theme.
- Secondary text is always softer than main text.
- Use a status colour on less than 5% of a screen.
- Show each state with a shape or a word too. Never colour alone.
- Use the accent on at most two things in one view: the main action, and one selected item.

## 3. Typography Rules

- **Sans:** the system font (SF Pro) by default. Settings > Appearance > Typeface also offers Helvetica Neue, Source Sans, Work Sans, Lato, Poppins, Nunito and Mulish (ADR-218). Helvetica Neue comes with macOS. The others are bundled files in `assets/fonts`, each with its SIL Open Font License 1.1 text. **Mono:** SF Mono in every typeface.
- **Titles:** SF Pro, semibold. **Identifiers and readouts:** mono.
- The scale has five sizes: **11, 13, 15, 20, 28 pt**. Use a size only for its role: caption, body, row title, page title, number. `AppFont` snaps any size a view asks for to this scale. Sizes above 30 pt (big numerals) stay as asked. `TypeScale` in `ArkIslandCore` is the one source. A test keeps `tokens.css` equal to it.
- Make hierarchy with three things together: size, weight, and colour level. A size alone is not hierarchy.
- Use two weights in a view: regular and semibold. Do not climb a ladder of weights.
- Use tabular (monospaced) figures for numbers that line up, such as token counts.
- The scale is in tokens.css as `--text-caption` to `--text-display`. Settings → Design system shows every token and component in Void and Daylight (ADR-124).

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

### Ambient glass

- **Panes are tints, not blur.** The window's panes (rail, sidebar, work area, workspace) are translucent tints of the theme over an ambient backdrop. The work area is the clearest.
- **The backdrop is light.** Three large, soft pools of colour: the theme's accent hue, a neighbour hue, and the mood. They drift slowly (31 to 46 s a cycle).
- **The light takes ARK's mood.** Calm: the theme's colours only. Active (listening, thinking, working, agents at work): blue. Attention (something needs you): amber. Problem: red. Plain code picks the mood from ARK's state.
- **Floating surfaces are frosted.** Menus, pickers, popovers, sheets and the agent panel use the system material, the theme's tint, a lit top edge and a soft shadow.
- **Text stays readable.** Text is a step stronger in glass. A test checks every theme and mood: main text 7:1 or more, secondary text and captions 4.5:1 or more, on every pane over the brightest light.
- **Masks stay opaque.** `surfaceSolid` is opaque in glass too. Use it only where something must hide what is under it, such as a terminal or a web view.

## 7. Motion

- Two durations: **150 ms** (state change, hover) and **200 ms** (something arrives). One curve (`--ease-standard`).
- ARK names its motion in `Motion.swift`: snap, settle, open, close. Things arrive with a little life and leave without fuss. Nothing springs on the way out.
- Every motion has a Reduce Motion form: a plain 150 ms fade. Breathing, cascades and the ambient drift stop.
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
