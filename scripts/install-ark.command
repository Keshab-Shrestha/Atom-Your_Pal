#!/bin/bash
# Install ARK on this Mac with one file (2026-11-02). Double-click it in Finder (the first time: right-click → Open), or run:
#
#   curl -fsSL https://raw.githubusercontent.com/Keshab-Shrestha/Atom-Your_Pal/main/scripts/install-ark.command | bash
#
# It checks macOS and the Xcode Command Line Tools, installs what ARK needs with Homebrew (it asks first), downloads ARK to
# ~/ARK (or $ARK_DIR) or updates it, then runs scripts/setup.sh, which builds ARK, signs it on this Mac and opens it.
# Run it again at any time to update ARK. ARK_NO_OPEN=1 builds without opening the app.
set -euo pipefail

REPO="https://github.com/Keshab-Shrestha/Atom-Your_Pal.git"
DIR="${ARK_DIR:-$HOME/ARK}"

say() { printf '\n==> %s\n' "$1"; }
fail() { printf '\nERROR: %s\n' "$1" >&2; exit 1; }
# A question on the terminal, also when this script comes through a pipe. No terminal: the default is yes.
ask() {
  local answer=""
  if [ -r /dev/tty ]; then read -r -p "$1 [Y/n] " answer </dev/tty || true; fi
  [[ -z "$answer" || "$answer" =~ ^[Yy] ]]
}
node_ok() { command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)'; }

say "Checking this Mac"
[ "$(uname)" = "Darwin" ] || fail "ARK runs on macOS only."
major=$(sw_vers -productVersion | cut -d. -f1)
[ "$major" -ge 14 ] || fail "ARK needs macOS 14 or later. This Mac has $(sw_vers -productVersion)."
echo "ok  macOS $(sw_vers -productVersion)"

if ! xcode-select -p >/dev/null 2>&1; then
  say "Installing the Xcode Command Line Tools"
  xcode-select --install || true
  fail "Finish the Command Line Tools installer that just opened, then run this installer again."
fi
echo "ok  Xcode Command Line Tools"

if ! command -v brew >/dev/null 2>&1; then
  for prefix in /opt/homebrew /usr/local; do [ -x "$prefix/bin/brew" ] && eval "$("$prefix/bin/brew" shellenv)"; done
fi
if ! command -v brew >/dev/null 2>&1; then
  ask "Homebrew is not installed. Install it now? It asks for your Mac password." || fail "ARK needs Homebrew to install Node.js. See https://brew.sh"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  for prefix in /opt/homebrew /usr/local; do [ -x "$prefix/bin/brew" ] && eval "$("$prefix/bin/brew" shellenv)"; done
fi
echo "ok  Homebrew"

if ! node_ok; then
  ask "Node.js 22.18 or later is not installed. Install it with Homebrew?" || fail "ARK needs Node.js 22.18 or later."
  brew install node
fi
echo "ok  Node.js $(node --version)"

if ! command -v pnpm >/dev/null 2>&1; then
  ask "pnpm is not installed. Install it with Homebrew?" || fail "ARK needs pnpm."
  brew install pnpm
fi
echo "ok  pnpm $(pnpm --version)"

if ! command -v claude >/dev/null 2>&1; then
  if ask "Claude Code is not installed. ARK runs on your own Claude plan through it. Install it with Homebrew?"; then
    brew install --cask claude-code || echo "Could not install Claude Code with Homebrew. Install it from https://claude.com/claude-code"
  fi
fi
command -v claude >/dev/null 2>&1 && echo "ok  Claude Code" || echo "note  Claude Code is missing: ARK can open, but it cannot answer until you install it."

if ! command -v whisper-cli >/dev/null 2>&1; then
  if ask "Optional: install ffmpeg and whisper.cpp (the fallback for speech to text)?"; then brew install ffmpeg whisper-cpp || true; fi
fi

if [ -d "$DIR/.git" ]; then
  say "Updating ARK in $DIR"
  git -C "$DIR" pull --ff-only
else
  [ -e "$DIR" ] && fail "$DIR exists and is not an ARK folder. Move it, or set ARK_DIR to another folder."
  say "Downloading ARK to $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

say "Building ARK (the first time takes a few minutes)"
if [ "${ARK_NO_OPEN:-}" = "1" ]; then sh "$DIR/scripts/setup.sh" --no-open; else sh "$DIR/scripts/setup.sh"; fi

say "ARK is installed in $DIR"
cat <<'EOF'
Next:
  1. Sign in to Claude Code once, in Terminal:  claude auth login
  2. macOS asks for the microphone, Accessibility and other permissions the first time ARK needs each one.
  3. To update ARK later, run this installer again.
EOF
