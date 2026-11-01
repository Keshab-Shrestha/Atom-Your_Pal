#!/bin/sh
# Sets up ARK from source on a new Mac, then builds and opens the app (R4, docs/release-r4.md).
#
#   sh scripts/setup.sh            # check, install, build, open
#   sh scripts/setup.sh --no-open  # the same, without opening the app
#
# It checks what ARK needs and says how to get what is missing; it installs nothing outside this folder except the
# local signing identity (apps/mac/island/make-signing-identity.sh), which keeps macOS permissions across rebuilds.
# Run it again at any time: every step skips what is already done.
set -eu
cd "$(dirname "$0")/.."

missing=0
need() { echo "MISSING $1"; echo "        $2"; missing=1; }
ok() { echo "ok      $1"; }

major=$(sw_vers -productVersion | cut -d. -f1)
[ "$major" -ge 14 ] && ok "macOS $(sw_vers -productVersion)" || need "macOS 14 or later" "This Mac has $(sw_vers -productVersion)."

xcode-select -p >/dev/null 2>&1 && ok "Xcode Command Line Tools" || need "Xcode Command Line Tools" "Run: xcode-select --install"

if command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)'; then
  ok "Node.js $(node --version)"
else
  need "Node.js 22.18 or later" "Install it from https://nodejs.org or with: brew install node"
fi

if command -v pnpm >/dev/null 2>&1; then ok "pnpm $(pnpm --version)"
else need "pnpm" "Run: corepack enable   (it comes with Node.js), then run this script again"; fi

if command -v claude >/dev/null 2>&1; then ok "Claude Code"
else need "Claude Code" "Install it from https://claude.com/claude-code, then sign in with: claude auth login"; fi

# Optional: the speech-to-text fallback. ARK's own dictation (Parakeet) and voice (Kokoro) download on first use.
command -v whisper-cli >/dev/null 2>&1 && ok "whisper.cpp (optional)" || echo "note    whisper.cpp is optional (the fallback for speech to text): brew install ffmpeg whisper-cpp"

if [ "$missing" -ne 0 ]; then
  echo
  echo "Install what is missing above, then run: sh scripts/setup.sh"
  exit 1
fi

echo
echo "Installing packages..."
pnpm install --frozen-lockfile

echo
apps/mac/island/make-signing-identity.sh

echo
if [ "${1:-}" = "--no-open" ]; then pnpm island:build; else pnpm island:open; fi

echo
echo "Done. Sign in to Claude Code if you have not yet (claude auth login). macOS asks for each permission the first time ARK needs it."
