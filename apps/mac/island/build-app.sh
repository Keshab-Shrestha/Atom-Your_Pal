#!/bin/sh
# Builds ZENO.app from the Swift package: a background app (no Dock icon) that runs the ZENO runtime.
#
#   apps/mac/island/build-app.sh            → apps/mac/island/build/ZENO.app
#   apps/mac/island/build-app.sh --open     → build, then launch it
#
# The app records this project folder and the Node.js it found, so it can start the runtime when
# opened from Finder. Rebuild after moving the project. It is signed ad hoc (for this Mac only).
set -eu

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
app="$here/build/ZENO.app"
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$root/package.json" | head -1)
version=${version:-0.5.0}

# Prefer a system-wide Node (Homebrew) over one inside another tool's folder, which can move on update.
node=${ZENO_NODE:-}
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

echo "Building ZenoIsland (release)…"
(cd "$here" && swift build -c release --product ZenoIsland 2>&1 | grep -v "search path '/Library/Developer/CommandLineTools" || true)
(cd "$here" && swift build -c release --product ZenoCalendar 2>&1 | grep -v "search path '/Library/Developer/CommandLineTools" || true)
binary="$here/.build/release/ZenoIsland"
[ -x "$binary" ] || { echo "Build failed: $binary not found" >&2; exit 1; }
# Fail if the binary is older than any source file (the build above failed but left an old one).
if [ -n "$(find "$here/Sources" "$here/Package.swift" -newer "$binary" 2>/dev/null | head -1)" ]; then
  echo "Build failed: the binary is older than the sources." >&2
  exit 1
fi

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$binary" "$app/Contents/MacOS/ZENO"
# Calendar and Reminders helper (ADR-060). Inside the app so macOS attributes its permission to ZENO.
helper="$here/.build/release/ZenoCalendar"
[ -x "$helper" ] && cp "$helper" "$app/Contents/MacOS/zeno-calendar" || echo "warning: calendar helper not built" >&2
# Avatar images (ADR-085): assets/avatars/<character>/<expression>.png → Resources/avatars/…, PNGs only (no README).
# With none, nothing is copied and ZENO draws its own Pal and helper marks.
avatars=0
if [ -d "$root/assets/avatars" ]; then
  for png in $(cd "$root/assets" && find avatars -mindepth 2 -maxdepth 2 -type f -name '*.png' | sort); do
    mkdir -p "$app/Contents/Resources/$(dirname "$png")"
    cp "$root/assets/$png" "$app/Contents/Resources/$png"
    avatars=$((avatars + 1))
  done
fi

# The app's icon (ADR-091): assets/icon/ZENO.icns (scripts/make-icon.sh makes it).
icon=""
if [ -f "$root/assets/icon/ZENO.icns" ]; then
  cp "$root/assets/icon/ZENO.icns" "$app/Contents/Resources/ZENO.icns"
  icon="<key>CFBundleIconFile</key><string>ZENO</string>"
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
  <key>CFBundleName</key><string>ZENO</string>
  <key>CFBundleDisplayName</key><string>ZENO</string>
  <key>CFBundleIdentifier</key><string>dev.zeno.island</string>
  <key>CFBundleExecutable</key><string>ZENO</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$(date +%Y%m%d%H%M)</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  $icon
  <key>NSHighResolutionCapable</key><true/>
  <key>NSCalendarsFullAccessUsageDescription</key><string>ZENO reads your calendar only when you ask about your schedule.</string>
  <key>NSCalendarsUsageDescription</key><string>ZENO reads your calendar only when you ask about your schedule.</string>
  <key>NSRemindersFullAccessUsageDescription</key><string>ZENO reads your reminders when you ask, and adds one when you ask it to.</string>
  <key>NSRemindersUsageDescription</key><string>ZENO reads your reminders when you ask, and adds one when you ask it to.</string>
  <key>NSMicrophoneUsageDescription</key><string>ZENO listens only while you hold its talk or dictate key, to hear you. Speech is transcribed on this Mac and never recorded.</string>
  <key>NSAppleEventsUsageDescription</key><string>ZENO controls Music or Spotify (play, pause, skip) and adds notes to Notes, only when you ask.</string>
  <key>ZenoProjectRoot</key><string>$root</string>
  <key>ZenoNodePath</key><string>$node</string>
</dict>
</plist>
PLIST

identity="ZENO Local Signing"
keychain="$HOME/Library/Keychains/zeno-signing.keychain-db"
secret="$HOME/.config/zeno/signing-keychain-password"
if [ -f "$keychain" ] && [ -f "$secret" ]; then
  # Stable signature: permissions survive rebuilds (ADR-040).
  security unlock-keychain -p "$(cat "$secret")" "$keychain"
  codesign --force --sign "$identity" --keychain "$keychain" --identifier dev.zeno.island "$app" \
    || { echo "Signing with \"$identity\" failed" >&2; exit 1; }
  signed="$identity"
else
  codesign --force --sign - --identifier dev.zeno.island "$app" >/dev/null 2>&1 || echo "warning: ad hoc signing failed" >&2
  signed="ad hoc (permissions are asked for again after each rebuild; run make-signing-identity.sh once to fix)"
fi

echo "Built $app"
echo "  project: $root"
echo "  node:    $node ($("$node" --version))"
echo "  signed:  $signed"
echo "  avatars: $avatars image(s)"
echo "  pals:    $pals character(s)"
if [ -n "$icon" ]; then echo "  icon:    ZENO.icns"; else echo "  icon:    none (run scripts/make-icon.sh)"; fi

if [ "${1:-}" = "--open" ]; then
  open "$app"
fi
