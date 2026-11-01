# R4: release candidate audit (2026-11-01)

This file records the R4 gate from `docs/sentient-parity-release-plan.md`. The goal is one signed build that a friend can install and open on their own Mac. The audit found four blockers. Two of them need a decision from Keshab.

## Checks that pass

- `pnpm typecheck` passes.
- `pnpm test` passes: 1,325 tests, 0 failures.
- `pnpm island:test` passes: all Swift tests.
- `LIVE=0 sh scripts/ui-check.sh` passes on committed code. The golden shots were made again from a clean checkout of HEAD.
- `pnpm check` runs all three test suites with one command.
- CI runs on every push, not only on `main`.
- `pnpm island:build` makes `ATOM.app` and signs it with the local identity "ATOM Local Signing".

## Blockers

### B1. No Developer ID certificate (decision)

`security find-identity -v -p codesigning` finds 0 valid identities. "ATOM Local Signing" is a self-signed certificate. Only this Mac trusts it.

On another Mac, Gatekeeper stops an app that is not signed with a Developer ID and notarized by Apple. The friend must then open System Settings → Privacy & Security → Open Anyway. Microphone, Accessibility and Screen Recording permissions also attach to the code signature.

To remove this blocker:

1. Keshab joins the Apple Developer Program (paid, yearly).
2. Keshab makes a "Developer ID Application" certificate in Xcode or on developer.apple.com.
3. `build-app.sh` signs with that certificate, with the hardened runtime and entitlements for the microphone and Apple events.
4. `xcrun notarytool submit` sends the zip to Apple. `xcrun stapler staple` attaches the ticket.

Keshab must do steps 1 and 2. An agent must not enter Apple ID passwords or app-specific passwords.

### B2. The app is not self-contained (decision)

`build-app.sh` writes two paths from this Mac into the app's `Info.plist`:

- `AtomProjectPath`: this repository folder. The runtime starts from it with `node apps/mac/src/main.ts`.
- `AtomNodePath`: Homebrew's Node.js (`/opt/homebrew/bin/node`).

The runtime also uses paths relative to the repository: `data/memory.db`, `data/helpers.db`, `config/island.json` and `.env`. `node_modules` is 818 MB.

A self-contained app needs:

1. A Node.js runtime inside `ATOM.app/Contents/Resources`.
2. The runtime source and only its production dependencies inside the app.
3. A data folder outside the app, for example `~/Library/Application Support/ATOM`. Keshab decides this place. A move of the existing `data/` folder needs a migration step and a backup.
4. Settings without `.env`. Keys go to the Keychain, not to a file.

### B3. The friend needs their own Claude sign-in

ATOM uses the Agent SDK with the user's own signed-in `claude` program (`~/.local/bin/claude` on this Mac). The friend must install Claude Code and sign in with their own account. ATOM must never carry Keshab's sign-in. The first-run setup must check for `claude` and explain how to sign in.

### B4. Models download on first use

Parakeet (FluidAudio), Kokoro and the Whisper fallback are not in the app. The first run downloads them. The first-run setup must show this download and its size.

## A path that works today

A friend who is comfortable with the Terminal can build ATOM on their own Mac. A local build does not get the quarantine flag, so Gatekeeper does not stop it.

1. Install Node.js 22 or later, pnpm and Claude Code. Sign in to Claude Code.
2. Clone the repository.
3. Run `pnpm install`.
4. Run `pnpm island:open`.

This is not R4. It is the fallback until B1 and B2 are done.

## Next step

Keshab decides B1 (join the Apple Developer Program or not) and B2 (the data folder place). Then the next task is B2 only: a self-contained `ATOM.app`, tested on a new macOS user account with no repository and no Homebrew.
