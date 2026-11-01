# Speech-to-Text Benchmark

The product was called ZENO, then ATOM (ADR-105, ADR-213). This file now uses the name ARK.

Date: 2026-10-02. Machine: Mac mini (Apple Silicon), whisper.cpp via Homebrew `whisper-cli`, English.

## Method

- 8 typical ARK commands, including names and places (Kathmandu, Keshab, Rohan, Tokyo).
- Spoken by 4 macOS voices (Aman, Daniel, Samantha, Rishi) at 190 words per minute.
- Processed to match the Mac mini's default microphone: 16 kHz mono, peak about -16 dB, pink room noise, 120 Hz–6 kHz band.
- Word error rate after normalizing punctuation and numbers ("seven thirty" = "7:30").
- Vocabulary prompt: `Ark, Keshab, Kathmandu, Nepali, Tokyo, TypeScript.`

## Results

| Model | Prompt | Word errors | Avg time per command | ~10 s of speech |
|---|---|---|---|---|
| base.en | none | 9.8% | 271 ms | 383 ms |
| base.en | vocabulary | 4.9% | 256 ms | — |
| small.en | none | 3.7% | 620 ms | 845 ms |
| small.en | vocabulary | 2.4% | 557 ms | — |
| large-v3-turbo q5_0 | none | 2.4% | 1,431 ms | 1,521 ms |
| large-v3-turbo q5_0 | vocabulary | 1.2% | 1,376 ms | — |

Suppressing non-speech tokens (`-sns`) made no difference.

## Typical errors (base.en, no prompt)

- "Hey Ark" → "As you know"
- "Kathmandu" → "Cartman do", "Cartman"
- "Keshab's" → "Keshev's"
- "Rohan" → "Rowan" (all models)

## Choice

small.en with a vocabulary prompt (ADR-032).
