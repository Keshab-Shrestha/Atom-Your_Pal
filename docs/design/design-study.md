# ZENO design study: from "works" to "a product with a face"

Status: proposal, October 2026. Nothing here is built into the live app yet. The mockups are gallery-only views in
`apps/mac/island/Sources/ZenoIsland/DesignStudy/` and render as sheet `14-design-study-*` (see the end of this file).

The brief, in Keshab's words: keep every feature, rebuild the look and feel from zero, with "those swift motions and
colour accents and the premium feel" of Coucou and Clicky. The design should grow from Wisp, ZENO's strongest asset.

---

## 1. What makes Coucou and Clicky feel premium

Both are references only. Coucou's code is MIT but its name, the Mochi character, icons, sounds and media are not
licensed (`coucou/LICENSE-ASSETS.md`); Clicky is MIT (`clicky-src/LICENSE`). We take techniques and numbers, never
assets, names or characters.

### Coucou (`~/Developer/Github-Project/coucou/NotchBuddy/Sources/App`)

| What | Where | Why it reads as premium |
|---|---|---|
| **Asymmetric open and close.** Opening is a spring `response 0.5, damping 0.72`; closing is a fast ease-out curve `timingCurve(0.45, 0, 0.2, 1, 0.34s)`. | `IslandRootView.swift:33-34`, `IslandWindowController.swift:437-441` | Things arrive with a little life and leave without fuss. Closing never bounces, so dismissal feels instant and confident. |
| **Content hand-off, not a cut.** The outgoing view fades with `easeIn 0.16`; the incoming one waits 0.16 s, then springs in (`0.4 / 0.8`) from scale 0.97 and opacity 0. | `IslandRootView.swift:461-472` | The surface changes shape first, then the content settles into it. No two things move at once. |
| **One spring family.** Hover `0.2 / 0.7`; tabs and small toggles `0.3 / 0.8`; detail panes `0.28 / 0.82`; geometry `0.5 / 0.72`. | `IslandRootView.swift:568, 612, 646`; `IslandViewContent.swift:1961-1995` | Every motion in the app shares a vocabulary, so it feels made by one hand. |
| **Staggered arrival.** Lists of agents arrive 35 ms apart. | `IslandViewContent.swift:4223` | A cascade reads as "alive" without being slow. |
| **The character is the status light.** Mochi's glow colour changes by state (working blue `#3B9EFF`, thinking violet `#A78BFA`, approval amber `#F5A524`, error `#F4505E`, done `#34D399`); glow opacity 0.15 at rest, 0.65 when busy, eased over 0.4 s. | `IslandRootView.swift:288-305, 348-367` | Status is not a badge in a corner; it is the character's light. The UI chrome stays monochrome. |
| **Pure black surface** (`Color.black`), rounded 14 compact and 22 expanded. | `IslandRootView.swift:58-59`; `CoucouKit/IslandTypes.swift:174-178` | Merges with the notch; zero decoration; the only colour on screen is meaningful. |
| **Icon tabs in capsules**, 30x22, selected `#1D1F23` fill, idle `#8E939C`, hover white 7%. | `IslandRootView.swift:565-584` | Navigation weighs almost nothing; content gets the space. |
| **Pills that pulse once.** A new pill springs to 1.06 with a white ring (`0.25 / 0.55`), then eases back after 0.45 s. | `IslandViewContent.swift:4635-4647` | One beat of attention, then calm. |
| **Sound on every state change** (open, close, hover, finish, approval…) at volume 0.12. | `SoundEngine.swift:7-25`; `IslandWindowController.swift:442-444` | Audio confirms what moved, quietly. |
| **Settings live in a real window** with an `NSVisualEffectView` sidebar, not inside the island. | `SettingsView.swift:151-183, 1939-1950` | The island stays small and expressive; dense controls get a proper home. |
| **Type**: 10-14 pt system, semibold for names, `#F5F6F8` / `#8E939C` / `#6B7079` greys. | `IslandRootView.swift:534-542, 621-630` | Tight, quiet, consistent density. |

### Clicky (`clicky-src/leanring-buddy`)

| What | Where | Why it reads as premium |
|---|---|---|
| **One accent, one meaning.** A single blue `#3380FF` is the buddy, its glow, its waveform, its spinner and its pointing bubble. | `DesignSystem.swift:144`; `OverlayWindow.swift:709-776` | The colour *is* the companion. Everything else is grey. |
| **The companion changes form by state**: cursor triangle, then a 5-bar waveform while listening, then a spinner while thinking, all the same blue with a 6-8 pt glow. | `OverlayWindow.swift:709-746` (waveform, bars 2 pt wide, `linear 0.08` to level), `749-776` (spinner, `linear 0.8` loop) | State is shown on the character, at the point of attention, not in a status bar. |
| **Snappy follow spring** `response 0.2, damping 0.6`; speech bubble pops from 0.5x with `0.4 / 0.6`, glow brightest at the start of the pop. | `OverlayWindow.swift:210, 262-291` | Fast and physical; the bubble's flash says "new". |
| **Hand-tuned flight**: bezier arc with smoothstep easing, the buddy scales to 1.3x mid-flight and faces its direction of travel. | `OverlayWindow.swift:520-570` | Motion with intent, not linear tweening. |
| **Layered surfaces**: background `#101211`, then `#171918`, `#202221`, `#272A29`, `#2E3130`; borders `#373B39` / `#444947`; text `#ECEEED` / `#ADB5B2` / `#6B736F`. | `DesignSystem.swift:28-59` | Elevation by lightness, not by drop shadows. |
| **Two-layer shadow** on floating surfaces: `black 0.5, r20, y10` plus `black 0.3, r4, y2`. | `CompanionPanelView.swift:721-726`; tooltip `DesignSystem.swift:643-644` | A soft long shadow for depth plus a tight one for contact: the panel sits on the desktop instead of floating vaguely. |
| **Hover that breathes.** Primary button: colour snaps in 0.15 s, scale swells to 1.03 over 0.6 s, accent glow builds and then breathes on a 2.5 s loop; press snaps to 0.97 in 0.1 s. | `DesignSystem.swift:245-332` | Every interactive thing answers the pointer, with different speeds for different properties. |
| **Tooltips with intent**: shown after 0.6 s, hidden instantly, top-lit border gradient. | `DesignSystem.swift:588-652` | Native-feeling patience; no flicker. |
| **Status dot with glow** beside the name, text status on the right. | `CompanionPanelView.swift:85-121, 728-740` | A single, tiny, alive signal in the header. |
| **Radii**: 6 tags, 8 controls, 10 cards and bubbles, 12 panels, capsule buttons. | `DesignSystem.swift:200-211` | Small, consistent, concentric. |

### What the two share

1. **The character carries the colour; the chrome is monochrome.** Neither app uses a palette of decorative accents.
2. **One spring vocabulary**, asymmetric in and out, never more than one thing moving at once.
3. **Glow as the accent's material.** Colour arrives as light (shadow-as-glow), not as flat fills.
4. **Depth by two-layer shadows and lightness steps**, not by grey cards.
5. **Small type, tight density, plenty of air** where it matters.

---

## 2. Why ZENO feels like slop today, screen by screen

Renders: `scratchpad/gallery/` (2-conversation, 2-settings-full, 5-wisp-moods, 6-wisp-bubble, 8-computer-control,
9-*-panel, 12-everyday, 13-helpers).

**The panel header** (`ExpandedView.swift:12-36`). A green waveform glyph (`Theme.tint(.ready)` = `success`
`#5FD38D`, `Theme.swift` native palette) says "Ready". Green appears nowhere else in Wisp's world. Wisp, the actual
character, is absent from the header. Two grey icon circles sit on the right.

**The tab bar** (`ExpandedView.swift:88-122`). A full-width grey segmented control, the most generic macOS/iOS widget
there is. It takes a whole row and says nothing about ZENO.

**Conversation** (`ConversationView.swift:134-200`). User messages are teal chat bubbles (`userBubble` = accent at
18%); Wisp's replies carry a 14 pt ghost avatar on every message (`ConversationView.swift:155`), too small to read as
Wisp and repeated until it is noise. There is no hierarchy between the reply arriving now and old turns. "New
conversation" is a large grey button competing with the composer.

**Settings home** (`SettingsTab.swift:42-55, 91-129`). Eight identical rows, each with a cyan rounded-square icon
tile: iOS Settings, transplanted. One card at the top of a 460 pt panel (`IslandGeometry.swift:10`) leaves most of the
surface empty (see 2-settings-full). Status lives in a separate tab with the same grey grouped rows, so the panel
spends a tab on four facts.

**Accents clash.** Green (ready, waveform), teal (chat bubbles, icons, links, toggles), purple (thinking halo on Wisp
and the dots), cyan (listening glow), amber (approval), orange-red (problem). Six hues, none of them owning a meaning
the user can learn, and none of them tied to Wisp's light.

**Motion** is mostly `easeOut 0.16-0.22` crossfades (`IslandPanel.swift:73, 94, 135`; `IslandController.swift:523-532`;
`SettingsTab.swift:15, 48`; `WorkStrip.swift:139, 162, 321-341`). The only springs are the tab pill (`0.28 / 0.85`)
and Wisp's bubble (`WispBubble.swift:86`, `0.34 / 0.78`, the best motion in the app). Nothing cascades, nothing
answers hover, open and close use the same curve.

**Wisp's bubble** (`WispBubble.swift:53-90`, `BubbleLayout.swift:30`). A 340x60 dark notification card with an icon in
a tinted circle, a title and a bar waveform. It reads as a system toast that happens to have a tail; Wisp's own light
is not in it.

**The work strip** (8-computer-control). Approval is a heavy dark card with an amber border and a full amber button;
fine as a warning, but it shares nothing with the panel or the bubble.

**The Helpers window** (`HelpersView.swift:101-150, 282-355`). Grey grouped rows again, three differently coloured
state badges (Queued grey, Running teal, Done green), a teal "Add" button, generic person icons for Sid, Kame and
Puff. It looks like a settings pane, not a team at work.

**The menu-bar item** (`WorkStrip.swift:36-55`). Seven different SF Symbols (hourglass, waveform, mic, text bubble,
sparkles, speaker, hand) swap in by state, some coloured. None of them is Wisp, so the one thing always on screen has
no identity.

**Underneath all of it**: no signature. Swap the name and this could be any assistant built from stock controls.

---

## 3. Three directions

All three keep every feature reachable, merge the Status tab into the top of Settings (the four facts and the plan
meters become a "now" block, which also fills the empty Settings panel), respect Reduce Motion (every spring has a
plain fade fallback of 0.15 s) and keep body and secondary text at WCAG AA (ratios measured below).

Shared motion vocabulary (borrowed in spirit from Coucou and Clicky, named for ZENO):

| Name | Spring | Used for |
|---|---|---|
| `wisp.snap` | response 0.20, damping 0.70 | hover, press (scale 0.97), toggles |
| `wisp.settle` | response 0.30, damping 0.82 | tab change, page push, row expand |
| `wisp.open` | response 0.46, damping 0.74 | panel, bubble and strip appearing |
| `wisp.close` | `timingCurve(0.45, 0, 0.2, 1)` 0.26 s | anything leaving: never springs |
| `wisp.breathe` | `easeInOut` 2.4 s, repeat | the light while listening or thinking |
| content hand-off | outgoing `easeIn 0.14`; incoming waits 0.12 s, then `wisp.settle` from scale 0.98 | tab and page switches |
| cascade | 30 ms per row, cap 8 rows | Settings rows, job list, conversation history on open |
| Reduce Motion | every spring becomes `easeOut 0.15`; no scale, no breathing, no cascade; glow is static | all |

### A. Lantern (recommended)

**Idea.** Wisp is a will-o'-the-wisp: a small light in the dark. The interface is deep night glass in cool greys, and
the *only* colour is Wisp's own light, `#8FD3FF` (already `ghostGlow` in `WispView.swift:64`). State is shown by how
brightly and how alive that light burns, never by changing hue: dim at rest, brighter while listening, breathing while
thinking, brightest while speaking. The light falls from Wisp in the header across the top of the panel, lies under
the selected tab, glows at the caret of a reply still arriving and powers the microphone. Amber appears only for "Wisp
needs you" and coral only for "something went wrong".

Mockups: `A-lantern-panel-conversation-and-settings.png`, `A-lantern-bubble-strip-helpers.png`.

**Colour tokens**

| Token | Dark (default) | Light ("Lantern Day") | Contrast |
|---|---|---|---|
| surface | `#10162A` (top `#161F3A`), glass alpha 0.82 | `#F3F6FB` (top `#FAFCFE`), alpha 0.88 | |
| well (raised) | white 4.5%, hairline white 7% | `#1B2A44` 4%, hairline 8% | |
| text | `#EAF1FF` | `#121A2E` | 15.8 / 16.0 |
| text2 | `#A7B4CC` | `#4A5670` | 8.6 / 7.3 |
| text3 | `#7F8BA6` | `#5E6A82` | 5.3 / 5.0 |
| light (the accent) | `#8FD3FF` (core `#D6F1FF`) | text/controls `#1F6FA8`, glow stays `#8FD3FF` | 11.1 / 5.0 |
| on light | `#0B1B33` | white | 10.6 |
| attention | `#FFC069`, on it `#2B1A00` | `#A86200` | 11.1 / 4.8 |
| problem | `#FF8A7A` | `#B42318` | |

**Accent strategy.** One hue, many brightnesses. Light intensity (the radial glow at the header and the panel rim's
top highlight) maps to state: rest 0.15, listening 0.30 + `wisp.breathe`, thinking 0.24 + slow breathe, speaking
0.42, acting 0.30. Old conversation turns drop to text2 so the light stays with the newest words.

**Type** (SF Pro, SF Pro Rounded for names and states, both system):
10.5 caption / 11.5 secondary / 12.5 UI / 13.5 reply (line height 1.38) / 15 state (Rounded semibold) / 18 window
titles (Rounded semibold). Weights: regular, medium, semibold only. Digits `monospacedDigit` in meters.

**Spacing and radius.** 4 pt grid: 4, 8, 12, 14, 18, 24. Panel radius 22, wells 14 (22 minus 8 inset), controls 9,
pills capsule; bubble 18. Panel padding 18, wells 14.

**Materials.** Night glass: `.ultraThinMaterial` under the surface tint at 0.82, a top-lit rim (white 16% to 5%),
two-layer shadow (`black 0.45 r28 y18` + `black 0.30 r3 y1`). The light is drawn as radial gradients and
shadow-glows, never as flat fills, except the mic button and toggle which are lit objects.

**Motion.** Panel opens with `wisp.open` from the menu-bar item (scale 0.96, anchor top-trailing, 6 pt drop), closes
with `wisp.close`. The tab light slides between words with `matchedGeometryEffect` on `wisp.settle`. Reply words fade
in over 0.25 s each (newest at 28% to 100%) with the caret light leading. The header glow eases between brightness
levels over 0.4 s (Coucou's glow timing). Settings rows cascade on first open. Hover lifts rows to white 6% with
`wisp.snap`.

**What changes**

* *Panel, conversation*: header is Wisp (34 pt, live mood) plus the state in Rounded and the model; tabs become two
  words ("Conversation", "Settings") with the light underneath; user messages are quiet slips in text2, Wisp's replies
  full-width text with no per-message avatar; "New conversation" becomes a pencil icon in the tab row; composer is a
  capsule with a lit mic button and the hold shortcut in its placeholder.
* *Panel, Settings*: a "now" well first (plan and model, the two meters, microphone, voice, last-turn time: everything
  Status showed, with "Change model" opening AI model), then two wells of rows with monochrome glyphs and the current
  value. No coloured icon tiles. Pages push with the content hand-off.
* *Status tab*: removed; its content is the "now" well. The Status page's per-stage timings move under "Last turn" in
  that well (tap to expand).
* *Wisp's bubble*: night glass, 18 pt radius, no icon circle (Wisp is right below it). While listening, the rim and
  a pool of light underneath are lit and the meter is Wisp's light; otherwise the rim is a white hairline. Notices
  needing you get the amber rim and dot. Grows from the tail with `wisp.open`, leaves with `wisp.close`.
* *Work strip*: same glass; approval uses the amber family with Allow as the one filled button, Decline with its `esc`
  key hint.
* *Helpers*: a real window with a darker sidebar; helpers as letter discs, a working helper ringed by a moving arc of
  Wisp's light; jobs as one list with state as a dot (lit and glowing = running, ring = queued, solid grey = done),
  a progress line of light for "3 of 8 pages", model and Laya's reason in text3, "Read report" as the only lit button.
* *Menu-bar item*: one Wisp silhouette glyph (template, so it follows the menu bar's appearance). While listening it
  gains the light; asking and problem tint it amber and coral. No more symbol swapping.

### B. Mist

**Idea.** Daylight. A pale, cool pearl glass with Wisp's own ink (`#1B2A44`, the colour of its eyes,
`WispView.swift:65`) as the accent. Wisp's words are set in New York (the system serif), so its voice reads as a voice,
distinct from the interface; your words are plain SF Pro on a white slip. The glow belongs to Wisp alone (a soft halo
in the centred header) and to the live microphone. Settings becomes a small board of tiles where the value is the
headline (the shortcut as real keycaps, Wisp's size with Wisp beside it, "3 facts").

Mockup: `B-mist-panel-conversation-and-settings.png`.

| Token | Light (default) | Dark ("Mist Night") | Contrast |
|---|---|---|---|
| surface | `#EDF1F6` (top `#F8FAFD`) | `#1A2133` (top `#212A40`) | |
| tile | white 72%, white hairline | white 6%, white 8% hairline | |
| ink (text and accent) | `#1B2A44` | `#E6ECF5` | 12.7 / 13.5 |
| ink2 | `#4F5D78` | `#B3BDD0` | 5.8 |
| ink3 | `#626E87` | `#8E9AB3` | 4.5 / 5.7 |
| glow | `#8FD3FF` (halo only) | `#8FD3FF` | |
| attention | `#A86200` | `#FFC069` | 4.8 |
| problem | `#B42318` | `#FF8A7A` | |

**Accent strategy.** Ink is the accent: selected toggle, mic button, Change, meters. Colour appears only as Wisp's halo
(its intensity follows state) and amber/coral for attention and problems.

**Type.** New York 15 (replies, line height 1.45), 17 medium (tile values), 19 semibold (model name); SF Pro 11 / 11.5
/ 12.5 for interface. **Spacing**: 4 pt grid, panel padding 14-20. **Radius**: panel 24, tiles 16, keycaps 7, pills
capsule. **Materials**: `.regularMaterial` under a pearl tint at 0.88; a white top rim; navy-tinted two-layer shadow
(`#1B2A44` 18% r30 y16 + 10% r2 y1).

**Motion.** Softer than Lantern: `wisp.open` with damping 0.82 (no visible overshoot), the ink pill slides between
Talk and Settings with `wisp.settle`, tiles cascade 30 ms. Wisp's halo breathes while listening. Reply words fade in.

**What changes.** Header centred on Wisp with the state under it, Helpers and Close as corner buttons, a two-item ink
toggle. Conversation in serif with user slips. Settings tiles: AI model with meters and the Status facts in one line;
Shortcuts as keycaps; Wisp; Memory; Dictation; then a short list for What can I ask?, Appearance, General. Bubble: a
white slip with a navy-tinted shadow, live words in New York, the meter in glow blue. Work strip: white card, amber
hairline, ink Decline and amber Allow. Helpers: a light window with tile-like job cards and ink buttons. Menu-bar
item: the Wisp glyph in ink (template).

### C. Halo

**Idea.** The panel is a true-black island that grows out of the menu bar: square shoulders where it meets the bar,
a deep rounded hem (12 top, 30 bottom). Its rim is lit in the colour of what Wisp is doing, one colour at a time:
listening cyan, thinking violet, speaking ice, asking amber, a problem coral, done mint. At rest the rim goes dark.
The state is named in big rounded type, and the menu-bar item becomes a pill that fills with the state colour and
shows a tiny live meter. The most expressive of the three; closest to Coucou's black island, but hanging from the menu
bar of a Mac without a notch.

Mockup: `C-halo-panel-conversation-and-settings.png`.

| Token | Dark (default) | Light ("Halo White") | Contrast |
|---|---|---|---|
| surface | `#000000` | `#FFFFFF` | |
| raised | white 7% | black 5% | |
| text / text2 / text3 | white 94% / 64% / 48% | black 88% / 62% / 54% | dark 18.9 / 8.3 / 4.9; light 14 / 6.2 / 4.6 |
| listening | `#5BE3FF` | `#0E7490` | 5.4 on white |
| thinking | `#A98BFF` | `#6D28D9` | 7.8 / 7.1 |
| speaking | `#9AD8FF` | `#1F6FA8` | 13.6 |
| asking | `#FFC069` | `#A86200` | |
| problem | `#FF7A6B` | `#B42318` | |
| done | `#6EE7B7` | `#047857` | |

**Accent strategy.** The accent is "Wisp's current state", shown once on the rim, the state word, the caret and the
menu-bar pill. Never two state colours on screen at once.

**Type.** SF Pro Rounded bold 24 for the state word; SF Pro 12.5 / 13.5 / 15 medium for the reply arriving now; 11
captions. **Spacing**: 4 pt grid, panel padding 18. **Radius**: 12 shoulders / 30 hem, raised blocks 18, cells
none (a hairline keypad), capsule tabs. **Materials**: no blur; black is black. Rim = angular-gradient stroke 1 pt
plus the same blurred 3 pt; state-coloured shadow `r26 y12` at 35%.

**Motion.** The island grows downward from the menu bar with `wisp.open` (height first, content hand-off after),
retracts with `wisp.close`. The rim's angular gradient rotates once per 2.4 s while thinking, pulses with the voice
while listening (Clicky's 0.08 s level follow), holds still while speaking. State word cross-fades with
`contentTransition(.interpolate)`. Reduce Motion: rim static, no rotation.

**What changes.** Header becomes a stage (Wisp 46 pt, state word, model) with icon tabs (Conversation, Settings,
Helpers) in a capsule. Conversation as a transcript: your words as quiet chevron lines, Wisp's current reply larger
with a lit bar. Settings: plan rings (5-hour outer, week inner) with the Status facts, then a 2x5 hairline keypad
including Helpers, then "Last turn" timings. Bubble: a black capsule with a state-coloured rim. Work strip: black,
amber rim. Helpers: black window, each job's dot in the state colour. Menu-bar item: a pill that fills with the state
colour and shows a live meter.

### How the three differ, in one line each

* **A. Lantern**: night glass and one light; state is brightness. Calm, native, unmistakably Wisp.
* **B. Mist**: daylight and ink; Wisp speaks in a serif voice; settings as a value-first board.
* **C. Halo**: a black island from the menu bar; the rim carries the state colour; loud and kinetic.

---

## 4. Recommendation: A. Lantern

Lantern is the only direction where the design *is* Wisp: its colour is Wisp's glow, its states are Wisp's moods,
and the menu-bar item is Wisp's silhouette, so the product gets a signature without adding anything foreign. It fixes
every audit item at once (one accent replaces six, the header shows Wisp, Settings fills with real information, the
segmented control disappears) while staying close to the native dark look Keshab already uses, so it can be rolled
out screen by screen through the existing `ThemePalette` without a rewrite. Mist is a strong light-mode companion
(keep it as "Lantern Day" ideas); Halo is the most dramatic but its multi-hue rim brings back the colour noise we are
removing.

### Rollout order (each step builds, tests and is verified on its own)

1. **Tokens and motion.** Add a `lantern` `ThemePalette` (dark and light) and a small `Motion` enum with the named
   springs and Reduce Motion fallbacks. Make it the default theme; Quiet Native, Luminous and Warm stay selectable.
   Verify: `ThemeTests` (add contrast checks for the new palette), gallery sheet 9 renders.
2. **Menu-bar item.** Replace the per-state SF Symbols with the Wisp glyph (template), lit for listening, amber for
   asking, coral for a problem. Verify: an icon test on the symbol/tint mapping; check in light and dark menu bars.
3. **Panel header and tabs.** Live Wisp in the header, state in Rounded, two word tabs with the light underneath;
   header glow brightness from state. Verify: gallery 2-conversation, keyboard tab order, VoiceOver labels.
4. **Settings home with "now".** Move the Status tab's content into the top well, drop the coloured icon tiles, group
   the rows, add the page hand-off and cascade. Remove the Status tab last. Verify: every Settings page and every
   Status fact still reachable (extend `SettingsProtocolTests` / `EverydayPolishTests`), gallery 2-settings-full has no
   empty half.
5. **Conversation.** User slips, full-width replies without per-message avatars, receding older turns, streaming caret
   light, pencil for New conversation, lit mic in the composer. Verify: `ConversationTests`, gallery 2-conversation and
   4-empty-conversation.
6. **Panel open and close.** `wisp.open` from the menu-bar item, `wisp.close` out (`IslandController.swift:519-535`).
   Verify by eye with Reduce Motion on and off.
7. **Wisp's bubble.** Night glass, lit rim and pool while listening, light meter, amber for attention
   (`WispBubble.swift`, `BubbleLayout.swift`). Verify: `BubbleLayoutTests`, `BubbleRuleTests`, gallery 6.
8. **Work strip and point label.** Same glass, amber approval with Allow as the only fill. Verify: `WorkStripTests`,
   gallery 8.
9. **Helpers window.** Letter discs with the working arc, dot states, progress line, lit "Read report". Verify:
   `HelpersTests`, gallery 13.
10. **Sounds (optional, separate decision).** ZENO's own short cues for open, close, listening and done, at low volume,
    behind the existing Sounds setting. Our own recordings only.

---

## 5. Mockup files

Gallery-only SwiftUI (nothing in the live app imports them; they read no model):

* `apps/mac/island/Sources/ZenoIsland/DesignStudy/DesignStudy.swift`: sheet entry, sample copy, wallpapers, menu bar.
* `.../DesignStudy/LanternMock.swift`: A, panel in conversation and Settings, Wisp glyph, streaming text.
* `.../DesignStudy/LanternExtras.swift`: A, bubble states, approval strip, Helpers window.
* `.../DesignStudy/MistMock.swift`: B.
* `.../DesignStudy/HaloMock.swift`: C.

Render: `cd apps/mac/island && swift build && ZENO_ISLAND_GALLERY=<dir> .build/debug/ZenoIsland` (all sheets, the
study last), or add `ZENO_ISLAND_GALLERY_ONLY=design` for the study alone. Output:
`14-design-study-a-lantern.png`, `14-design-study-b-mist.png`, `14-design-study-c-halo.png`,
`14-design-study-a-lantern-bubble-helpers.png`.

Mockups use flat fills where the real app would use blur (`ImageRenderer` cannot draw materials) and a drawn composer
in place of the live text field (which renders as a placeholder in snapshots).
