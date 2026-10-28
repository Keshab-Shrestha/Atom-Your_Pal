# Style reference: Resend (shared by Keshab, 2026-10-10)

Used for ADR-086 (the Void theme). Style rules only: no Resend name, logo, imagery or commercial fonts are used in ATOM.

> black velvet with violet neon. Theme: dark.

Near-total darkness: pure black canvas, hairline graphite borders, white-on-black typography. Anti-decorative: no gradient wash, no marketing illustration. The brand violet (#9281f7) appears in identifiers, status icons and code, never on buttons. A monospaced face carries every code block, badge and inline label. Components are sharp or gently rounded (6 px / 16 px), low elevation, and use 1 px borders rather than shadows. Motion is restrained: fade-and-slide, 150 ms ease-out on hover.

## Colours

| Name | Value | Role |
|---|---|---|
| Void Black | `#000000` | canvas, card surfaces, scrims |
| Graphite Hairline | `#292d30` | 1 px borders on cards, inputs, buttons, code blocks, dividers |
| White | `#ffffff` | headings, button labels, icons on dark |
| Bone White | `#f0f0f0` | body text, secondary headings, icon strokes |
| Ash Gray | `#a1a4a5` | muted text, badge labels, metadata |
| Smoke Gray | `#abafb4` | links, inactive button text, captions |
| Iron | `#6e727a` | subtle strokes, disabled states |
| Charcoal | `#464a4d` | text that should disappear into the surface |
| Iris Violet | `#9281f7` (gradient to `#9a54dc`) | identifiers, tags, short emphasis; icon containers |
| Iris Violet Glow | `#baa7ff` | violet text accent |
| Signal Blue | `#3b9eff` | filled action, selected navigation (used sparingly) |
| Sky Blue | `#70b8ff` | blue text accent / status |
| Pulse Green | `#3ad389` | green accent / status |
| Alarm Red | `#ff9592` | red accent / status |
| Amber | `#ffca16` | yellow accent / status |
| Surface Gradient | `#1b1b1b` to `#030303` | subtle card lift, edge fades |

## Type

- Body and UI: Inter (substitute: system sans) 400/500/600 at 12, 14, 16, 18, 24 px; line heights 1.33–1.6.
- Display: a high-contrast serif at 77–96 px, weight 400, tracking −0.01em (only for one hero line).
- Section headlines: a geometric sans at 56 px, weight 400, tracking −0.05em.
- Mono: code, identifiers, badges and labels at 12–16 px.
- Scale: caption 12/1.33 · body-sm 14/1.43 · body 16/1.5 · subheading 20/1 · heading-sm 24/1.5.

## Spacing and shape

4 px base, comfortable density: 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 64. Card padding 32, element gap 16.
Radii: buttons, badges, inputs 6 · cards 16 · large panels 24. Never mix radii within one component.
Elevation: 1 px hairlines, never drop shadows; at most a faint 1 px ring (`rgba(176,199,217,0.145)`). Overlays: black at 95 % with a 25 px blur.

## Components

- **Primary button (ghost):** transparent, 1 px `#292d30`, white text, 6 px radius, 12×16 padding; hover brings the border towards white. Never filled, never colourful.
- **Text link:** no background or border, `#f0f0f0` 14 px, white on hover; optional trailing chevron.
- **Pill:** transparent, 1 px hairline, `#f0f0f0` 14 px, capsule, 6×12 padding.
- **Card:** black, 1 px hairline, 16 px radius, 32 px padding (24 when dense), no shadow.
- **Code window:** black, hairline, 16 px radius, mono 12–14 px; violet for strings, blue for file names, green for success, red for errors.
- **Status dot:** a small filled dot with a mono label: green delivered, blue opened, violet clicked, red bounced, amber complained.
- **Identifier:** mono 12–14 px in violet, no background.
- **Icons:** 1–1.5 px stroke outlines in `#f0f0f0` or `#a1a4a5`.

## Do / don't

- Do use pure `#000000`; separate layers with 1 px `#292d30`; keep buttons ghost; use 6 and 16 px radii only; keep violet for identifiers; keep status colours for status.
- Don't add gradients, glows or colour washes; don't use filled colourful buttons; don't use shadows for elevation; don't colour card backgrounds; don't use violet for large headings; don't add accent hues to chrome.
