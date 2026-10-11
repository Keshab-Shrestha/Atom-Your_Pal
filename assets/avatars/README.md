# Avatars (ADR-085)

Characters designed by Keshab in Bible Strong Avatar Lab (https://avatars.bible-strong.app) and exported with its
Photo Mode. Only the exported images live here. The Lab and its packages are AGPL-3.0, so none of their code is used
in ZENO, and none of the Lab's own sample characters (such as Strobi) are used.

## How to export

In the Studio: Export → Photo Mode → **PNG**, **512 × 512**, **transparent background**, the character centred
with a little room around it. One file per expression.

## Where to put them

One folder per character, lower case, files named by expression:

    assets/avatars/pal/neutral.png
    assets/avatars/pal/listening.png
    ...
    assets/avatars/sid/neutral.png

### Pal (all nine)

| File | When ZENO shows it |
|---|---|
| `neutral.png` | resting and floating |
| `happy.png` | the hello when ZENO starts, a finished job |
| `listening.png` | listening to you (eyes open, attentive) |
| `thinking.png` | thinking (eyes up or to the side) |
| `speaking.png` | speaking, mouth open |
| `speaking-closed.png` | speaking, mouth closed (alternates with `speaking.png` while talking) |
| `worried.png` | a problem |
| `sleepy.png` | napping (eyes closed) |
| `surprised.png` | being carried, a click |

### Each helper: Sid, Kame, Puff, Quill, Penny, Hana, Tinker (four each)

| File | When ZENO shows it |
|---|---|
| `neutral.png` | idle |
| `working.png` | a job is running (focused) |
| `happy.png` | a job finished |
| `worried.png` | a job failed |

A missing file falls back to today's drawing, so characters can arrive one at a time.
