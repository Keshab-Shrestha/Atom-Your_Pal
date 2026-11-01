#!/bin/sh
# Builds ARK.app from the Swift package: a background app (no Dock icon) that runs the ARK runtime.
#
#   apps/mac/island/build-app.sh            → apps/mac/island/build/ARK.app
#   apps/mac/island/build-app.sh --open     → build, then launch it
#
# The app records this project folder and the Node.js it found, so it can start the runtime when
# opened from Finder. Rebuild after moving the project. It is signed ad hoc (for this Mac only).
set -eu

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
app="$here/build/ARK.app"
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$root/package.json" | head -1)
version=${version:-0.5.0}

# Prefer a system-wide Node (Homebrew) over one inside another tool's folder, which can move on update.
node=${ARK_NODE:-${ATOM_NODE:-${ZENO_NODE:-}}} # the old names still work
if [ -z "$node" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node || true)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then node=$candidate; break; fi
  done
fi
if [ -z "$node" ]; then
  echo "Node.js not found. Install it with: brew install node" >&2
  exit 1
fi
node=$(cd "$(dirname "$node")" && pwd)/$(basename "$node")

echo "Building ArkIsland (release)…"
# Copy SwiftTerm's optional shader source without requiring the separately installed Metal compiler.
(cd "$here" && swift build --build-system native -c release --product ArkIsland 2>&1 | grep -v "search path '/Library/Developer/CommandLineTools" || true)
(cd "$here" && swift build --build-system native -c release --product ArkCalendar 2>&1 | grep -v "search path '/Library/Developer/CommandLineTools" || true)
(cd "$here" && swift build --build-system native -c release --product ArkDocuments)
binary="$here/.build/release/ArkIsland"
[ -x "$binary" ] || { echo "Build failed: $binary not found" >&2; exit 1; }
# Fail if the binary is older than any source file (the build above failed but left an old one).
if [ -n "$(find "$here/Sources" "$here/Package.swift" -newer "$binary" 2>/dev/null | head -1)" ]; then
  echo "Build failed: the binary is older than the sources." >&2
  exit 1
fi

# Quit a running ARK first. Without this, `open` only brings the old process forward, and its files are about to go.
# The build above worked, so a failed build never closes the app that runs. It asks the app to quit, waits up to
# five seconds (an unsaved edit can ask first), then ends it.
if pgrep -x ARK >/dev/null 2>&1; then
  echo "Quitting the running ARK…"
  osascript -e 'tell application id "dev.ark.island" to quit' >/dev/null 2>&1 || true
  waited=0
  while pgrep -x ARK >/dev/null 2>&1 && [ "$waited" -lt 20 ]; do
    sleep 0.25
    waited=$((waited + 1))
  done
  if pgrep -x ARK >/dev/null 2>&1; then pkill -x ARK >/dev/null 2>&1 || true; sleep 0.5; fi
fi

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
# T3 Code chat design adaptation (MIT): include its notice with the distributed app.
cp "$root/reference/licenses/t3code-MIT.txt" "$app/Contents/Resources/ThirdParty-T3Code.txt"
cp "$root/reference/licenses/SwiftTerm-MIT.txt" "$app/Contents/Resources/ThirdParty-SwiftTerm.txt"
# Settings > Appearance > Typeface: Inter and Geist (SIL Open Font License 1.1), with their licences.
mkdir -p "$app/Contents/Resources/fonts"
cp "$root"/assets/fonts/*.ttf "$app/Contents/Resources/fonts/"
# Flaticon UIcons, when this Mac downloaded its own copy (scripts/setup.sh; not in git: its licence is per person). Glyph falls back to SF Symbols.
if [ -d "$root/assets/fonts/vendor" ]; then mkdir -p "$app/Contents/Resources/fonts/vendor" && cp "$root"/assets/fonts/vendor/*.woff "$app/Contents/Resources/fonts/vendor/" 2>/dev/null || true; fi
cp "$root/reference/licenses/Inter-OFL.txt" "$app/Contents/Resources/ThirdParty-Inter-OFL.txt"
cp "$root/reference/licenses/Geist-OFL.txt" "$app/Contents/Resources/ThirdParty-Geist-OFL.txt"
cp "$root/assets/skills/omh/LICENSE" "$app/Contents/Resources/ThirdParty-OhMyHermes.txt"
mkdir -p "$app/Contents/Resources/skills"
cp -R "$root/assets/skills/omh" "$app/Contents/Resources/skills/omh"
cp -R "$here/.build/release/SwiftTerm_SwiftTerm.bundle" "$app/Contents/Resources/"
# Web panels (ADR-211): apps/mac/island/Web/<panel>/ -> Resources/web/<panel>/. Bundled files only; no network.
cp -R "$here/Web" "$app/Contents/Resources/web"
cp "$binary" "$app/Contents/MacOS/ARK"
# Calendar and Reminders helper (ADR-060). Inside the app so macOS attributes its permission to ARK.
helper="$here/.build/release/ArkCalendar"
[ -x "$helper" ] && cp "$helper" "$app/Contents/MacOS/ark-calendar" || echo "warning: calendar helper not built" >&2
# Bounded PDF/Word text extraction; no file paths or network access are passed to the helper.
cp "$here/.build/release/ArkDocuments" "$app/Contents/MacOS/ark-documents"
# The app's icon (ADR-091): assets/icon/ARK.icns (scripts/make-icon.sh makes it).
icon=""
if [ -f "$root/assets/icon/ARK.icns" ]; then
  cp "$root/assets/icon/ARK.icns" "$app/Contents/Resources/ARK.icns"
  icon="<key>CFBundleIconFile</key><string>ARK</string>"
fi

# Pal characters (ADR-089): assets/pals/<id>.json → Resources/pals/.
pals=0
if [ -d "$root/assets/pals" ]; then
  mkdir -p "$app/Contents/Resources/pals"
  for json in "$root"/assets/pals/*.json; do
    [ -f "$json" ] || continue
    cp "$json" "$app/Contents/Resources/pals/"
    pals=$((pals + 1))
  done
fi

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>ARK</string>
  <key>CFBundleDisplayName</key><string>ARK</string>
  <key>CFBundleIdentifier</key><string>dev.ark.island</string>
  <key>CFBundleExecutable</key><string>ARK</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$(date +%Y%m%d%H%M)</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  $icon
  <key>NSHighResolutionCapable</key><true/>
  <key>NSCalendarsFullAccessUsageDescription</key><string>ARK reads your calendar only when you ask about your schedule.</string>
  <key>NSCalendarsUsageDescription</key><string>ARK reads your calendar only when you ask about your schedule.</string>
  <key>NSRemindersFullAccessUsageDescription</key><string>ARK reads your reminders when you ask, and adds one when you ask it to.</string>
  <key>NSRemindersUsageDescription</key><string>ARK reads your reminders when you ask, and adds one when you ask it to.</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>NSMicrophoneUsageDescription</key><string>ARK listens only while you hold its talk or dictate key, to hear you. Speech is transcribed on this Mac and never recorded.</string>
  <key>NSAppleEventsUsageDescription</key><string>ARK controls Music or Spotify (play, pause, skip) and adds notes to Notes, only when you ask.</string>
  <key>ArkProjectRoot</key><string>$root</string>
  <key>ArkNodePath</key><string>$node</string>
</dict>
</plist>
PLIST

identity="ARK Local Signing"
keychain="$HOME/Library/Keychains/ark-signing.keychain-db"
secret="$HOME/.config/ark/signing-keychain-password"
if [ -f "$keychain" ] && [ -f "$secret" ]; then
  # Stable signature: permissions survive rebuilds (ADR-040).
  security unlock-keychain -p "$(cat "$secret")" "$keychain"
  codesign --force --sign "$identity" --keychain "$keychain" --identifier dev.ark.island "$app" \
    || { echo "Signing with \"$identity\" failed" >&2; exit 1; }
  signed="$identity"
else
  codesign --force --sign - --identifier dev.ark.island "$app" >/dev/null 2>&1 || echo "warning: ad hoc signing failed" >&2
  signed="ad hoc (permissions are asked for again after each rebuild; run make-signing-identity.sh once to fix)"
fi

echo "Built $app"
echo "  project: $root"
echo "  node:    $node ($("$node" --version))"
echo "  signed:  $signed"
echo "  pals:    $pals character(s)"
if [ -n "$icon" ]; then echo "  icon:    ARK.icns"; else echo "  icon:    none (run scripts/make-icon.sh)"; fi

if [ "${1:-}" = "--open" ]; then
  open "$app"
fi
