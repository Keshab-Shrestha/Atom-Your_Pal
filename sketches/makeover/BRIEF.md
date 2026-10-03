# ZENO makeover — shared design brief (all three directions)

If you got here before this file existed: it exists now; carry on.

## The product
ZENO is a voice assistant for macOS, a background app with no Dock icon and no normal windows. The user holds a shortcut (⌃⌥), speaks, and ZENO answers aloud. It can also operate other Mac apps for the user ("computer control") and type dictation into any app (hold Right ⌘ + Right ⌥). Its mascot is **Wisp**, a small character about 64 pt tall that floats along just above the Dock, reacts to what ZENO is doing, and flies to things on screen to point at them. The owner wants a premium, polished feel and a proper makeover of every surface. Native implementation is SwiftUI/AppKit, so design only what SwiftUI can draw: gradients, blur materials, shapes, SF Symbols-like icons, springs. No 3D renders, no photos.

## Fixed structure (decided; do NOT change where things live)
1. **Menu-bar icon**: a small glyph in the macOS menu bar (top right, among other status icons), tinted by state. Clicking it opens the panel.
2. **Panel**: hangs directly under the menu-bar icon (like Control Centre / a Wi-Fi menu), about 360–400 pt wide and up to ~560 pt tall. It holds Conversation, Status and Settings. You may redesign the navigation inside it (tabs, a header gear icon, a sidebar, whatever), but it stays one panel under the icon.
3. **Status card**: when Wisp is off, a small card hangs under the menu-bar icon during a voice turn (state + live level meter + model name).
4. **Work strip**: bottom centre of the screen, just above the Dock and above Wisp's walkway, only while ZENO operates the Mac. It shows the current step plus a Stop button; while ZENO asks permission it grows to show a one-line question with Decline / Allow; at the end it says Done / Stopped / Couldn't finish. About 420 pt wide.
5. **Wisp** floats above the Dock. When pointing, it flies next to the target and shows ONLY a short label pill (2–4 words), never a big bubble.
6. **Wisp's speech bubble** (small, beside Wisp) is used for dictation only: "Dictating" with live words and a level meter, "Transcribing", "Typed · 12 words", "Copied to clipboard · a password field is focused". It must hug its content (no fixed wide banner).

## States to cover
ZENO states: Ready (idle), Listening (live mic level), Thinking, Speaking, Working on the Mac (step), Waiting for approval, Problem (e.g. "No internet", "Microphone permission needed"), Starting up.
Wisp moods: resting, floating/wandering, listening, thinking, speaking, problem, napping, carried (dragged by the user), hiding (leans in from a screen side edge with a hand on the edge when idle), pointing (with label).

## Panel content (use this realistic data, not lorem ipsum)
- Header: state + active model, e.g. "Ready · Claude Sonnet 5.5 (my plan)".
- Conversation: user said "What's on my calendar this afternoon?" → ZENO: "You have a design review at 3 and a call with Aiko at 4:30. Nothing after that." Then "In TextEdit, press return once" → ZENO: "Done — I pressed Return in TextEdit." Each answer has tiny timing metadata ("heard 0.6 s · AI 1.8 s · first sound 2.7 s"); make it subtle or reveal on hover. A "New conversation" action.
- Status: microphone (MacBook mic, live), speech recognition (Parakeet, on-device), voice (on-device), AI provider, computer control (on, approval required), runtime (running, restarts 0), last turn timings.
- Settings (the current version is a huge wall of chips; fix that):
  - AI model: providers Claude (API), Claude (my plan), Gemini; about 13 models in total. Use a provider picker + model popup, not 13 chips.
  - Shortcuts: Talk to ZENO ⌃⌥ (hold), Dictate Right ⌥⌘, Show or hide panel ⌃⌥Z, Cancel Esc. Each recordable.
  - Dictation: Start and stop (Hold / Tap / Hold or tap), Live preview (toggle), Remove "um" and "uh" (toggle).
  - Wisp: Show Wisp (toggle), Size (S/M/L/XL), Glow (Off/Soft/Normal/Bright), Movement (Stay put/Calm/Normal/Lively), Falls asleep after (Never/1/3/10 min), Hiding lean (Slight/Normal/Deep), Tuck away after (Never/15 s/30 s/1 min/5 min).
  - Speech bubble: Stays (1/2/4/8 s), Size, Background (Clear/Normal/Solid).
  - Panel: Size (Compact/Normal/Large), Background (Glass/Solid).
  - Quit ZENO.
  Group them sensibly (sub-pages or collapsible groups are fine), use the right control per setting (switch, popup, small segmented control, slider with stops), and keep helper text short. The panel must stay scannable.

## Deliverables (in your own folder)
1. `desktop.html` — exactly 1440×900, a fake macOS desktop: a pleasant abstract wallpaper (CSS gradients only), a realistic menu bar (Apple logo, an app name, menus, and on the right other status icons, ZENO's icon, the clock "Sat 3 Oct 18:42"), a Dock at the bottom, and a TextEdit-like window. Show at the same moment: the panel open under ZENO's icon (Conversation view); the work strip asking "Press Return in TextEdit?" with Decline / Allow; Wisp floating above the Dock in its listening or thinking mood. Also show a second, smaller Wisp pointing at the Control Centre icon in the top-right corner with the label pill "Control Centre" (to prove that corner works).
2. `board.html` — exactly 1440 wide, any height (around 2400–3200). A design board on a neutral dark or light backdrop, with labelled sections:
   (a) a Wisp mood sheet: all 10 moods, large (~120 px), each with a caption;
   (b) the panel in three views side by side: Conversation, Status, Settings (show the main Settings page and one sub-page or expanded group);
   (c) work strip in all states: step + Stop, asking (Decline / Allow), Done, Stopped, Couldn't finish;
   (d) the status card (Listening with a level meter, Thinking, Problem: "No internet");
   (e) dictation bubble states (Dictating with live words, Transcribing, Typed · 12 words, Copied to clipboard) plus the pointing label pill;
   (f) menu-bar icon in each state (idle, listening, thinking, speaking, working, needs attention, problem) at real size and at 4×;
   (g) a small tokens strip: colours, type scale, corner radii, spacing, motion (spring values), each named.
3. Render both to PNG with headless Brave (Chrome-compatible):
   ```
   B="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
   "$B" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1440,900 --screenshot=$PWD/desktop.png file://$PWD/desktop.html
   "$B" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1440,3000 --screenshot=$PWD/board.png file://$PWD/board.html
   ```
   (set the board's window height to the page's real height). Then LOOK at your PNGs with vision_analyze (ask it about clipping, overlaps, contrast, things that look broken or amateur), fix the problems, and re-render. Do at least two review passes. If vision_analyze errors (503), retry after ~20 s; you can crop with `sips` for close-up review.
4. `README.md` (short): the stance, key choices (colour, type, material, Wisp design, motion), and the strengths and weaknesses of this direction.

## Rules
- Self-contained HTML: inline CSS, inline SVG for Wisp and icons. No external fonts, images or CDNs (rendering runs offline). Use the system font stack (-apple-system, "SF Pro Text", "SF Pro Display", ui-rounded where asked).
- Wisp must be drawn in SVG with care: it is the brand. Make it look crafted, not clipart.
- Only touch your own folder. Do not modify anything else in the repo. Do not run git.
- Craft: consistent corner-radius scale (concentric radii inside the panel), one icon style, aligned text baselines, correct vibrancy contrast (secondary text at least ~60% white on dark glass), no clipped text.
- Final answer: absolute paths of desktop.png and board.png, plus 3–5 lines of notes on the direction and any known flaws.
