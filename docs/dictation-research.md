# Dictation Research: What FluidVoice Does, and What ZENO Should Take From It

Written 2026-10-02 for Task 0.5.7 (Dictation, ADR-041).

## Method and licence

- **Read:** FluidVoice's public source (version 1.6.x), its README, the installed app (1.6.9) and its own log at `~/Library/Logs/Fluid/Fluid.log`.
- **Licence:** FluidVoice is GPL-3.0. Nothing here is copied. This document records *what it does and why it works*; ZENO's code is written from scratch (ADR-039).
- **FluidAudio** (the speech SDK underneath, by FluidInference) is Apache-2.0 and may be used as a dependency.
- **Measured vs. read:** the timings below come from FluidVoice's log of Keshab's own use (10 sessions, 22 transcriptions). Everything else is from reading the source.

## The finding that matters most: why it feels instant

FluidVoice's log of Keshab's own sessions, in milliseconds:

| Step | FluidVoice (median) | ZENO today |
|---|---|---|
| Key pressed → microphone capturing | **65** (24–88) | about 200–550 (ffmpeg starts from nothing) |
| First audio sample after start | **94** | not measured (includes the ffmpeg start above) |
| Transcribing the recording | **56** (real-time factor 0.01) | about 600–1000 (Whisper small.en, a new process each time) |
| Key released → text ready | **103** | about 1000+ |
| Typing the text into the app | **1** | not built |

Three design choices explain it:

1. **The microphone is prepared, not recorded, while idle.** The capture device is opened and ready ("capture phase: prepared" in 11 of 12 sessions) but nothing is kept. Pressing the key only flips it to running, which takes about 65 ms. There is **no rolling audio buffer**: the source says the old cross-session pre-roll buffer was deliberately replaced by per-session timestamps, so nothing is recorded before the key is pressed. ZENO should do the same: it is faster and better for privacy than a hot recording buffer.
2. **The speech model stays loaded.** Parakeet runs on the Apple Neural Engine and is warmed up at launch (and after a model change). Nothing is loaded when the key is pressed.
3. **A final pass over the whole recording.** While you talk it runs a rough preview every 0.6 s (for the on-screen overlay), but the text that is typed always comes from one pass over the whole recording (`source=full` in all 22 sessions), so the preview never lowers accuracy.

My earlier guess, that FluidVoice keeps the microphone recording all the time, was wrong; "prepared" is the right description.

## The pipeline, step by step

1. **Shortcut.** A system-wide event tap watches the keys. Right Cmd + Right Option (key codes 54 and 61) is a modifier-only shortcut, held to talk. The tap re-enables itself if macOS disables it.
2. **Where the text will go.** When dictation starts it notes the focused app and text field. When it finishes it restores focus to that exact target, so the text lands in the right place even if you switched windows meanwhile.
3. **Capture.** Native Core Audio capture on the chosen device, with a device that may be unplugged, Bluetooth or changing sample rate handled explicitly. Samples are converted to 16 kHz mono.
4. **Short recordings.** A recording under 1 second is padded with silence so a word like "yes" still transcribes. A silence check skips recordings that contain nothing.
5. **Transcribe.** Parakeet TDT v3 (English and 24 other languages), with a custom vocabulary of terms and spoken aliases (for example "fluid voice" and "fluid boys" for "FluidVoice") that nudges the decoder toward the right spelling.
6. **Tidy.** Spoken punctuation ("comma", "new line") becomes punctuation, with rules per app. An optional local or cloud model can reword the text, and it is **off** for Keshab (`DictationPromptOff`).
7. **Insert.** Several methods in order: set the text directly through the Accessibility API at the cursor, replace the selection, then paste or type as Unicode keystrokes. It checks that the paste landed, and **waits for the physical modifier keys to be released** before pasting. This matters for a modifier-only shortcut: if Cmd or Option is still down, the paste becomes a different shortcut.

## What ZENO should take

| Idea | Why | Where it goes |
|---|---|---|
| Prepare the capture device while idle; start it on the key press | 65 ms instead of 200–550 ms; fixes the lost first words | New small native capture helper (below) |
| Keep the model loaded | Removes per-use start-up | Same helper |
| Parakeet instead of Whisper for dictation | Measured 26% vs 30% of words wrong on the same recordings; 0.2 s vs 0.6 s | Same helper |
| One full pass for the final text | Accuracy | Dictation mode |
| Pad short clips; skip silent ones | Short words work; no stray text | Dictation mode |
| Custom vocabulary with aliases | "ZENO", "Keshab", "Kokoro", "Parakeet" came out wrong in every engine | Settings, with a default list |
| Remember the target; restore focus; wait for modifiers to be released | Text goes where you started, and the paste does not become a shortcut | Island (Swift) |
| Direct insertion first, paste as the fallback | No clipboard disturbance in most apps | Island (Swift); ZENO's spec already restores the clipboard |
| Hold to talk, with toggle as an option | Matches Keshab's habit; Right Cmd + Right Option | Shortcut engine already supports modifier-only holds |

## What ZENO should not take

- **Fluid Intelligence** (their private model that rewrites text): not available, and not needed; dictation stays as spoken.
- **Meeting capture, command mode, write mode, audio history, analytics:** different capabilities. One capability at a time (CLAUDE.md §3).
- **Their code:** GPL-3.0.

## Open questions for Keshab

1. **Engine.** Parakeet needs a Swift helper (FluidAudio is Swift). The alternative is to stay on Whisper small.en, which is simpler but about 3 times slower and slightly less accurate on the tests so far. Recommendation: Parakeet in a helper, with Whisper as the fallback if the helper fails.
2. **Languages.** ZENO is English-only today. Parakeet TDT v3 also covers 24 other languages, if wanted later.
3. **Streaming preview text** (words appearing as you speak): useful for confidence, but not needed for the first version. Recommendation: later.

## Measurements still needed

- Re-run the three-sentence test with the prepared-device approach, to confirm the first words are no longer lost.
- A larger test set (at least 20 sentences, mixed lengths, names and numbers). Three sentences is too few to decide an engine.
- ZENO's current microphone start time measured inside ZENO itself, not only with a separate ffmpeg test.
