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
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>ZENO listens only while you hold its talk key, to hear your question. Speech is transcribed on this Mac.</string>
  <key>ZenoProjectRoot</key><string>$root</string>
  <key>ZenoNodePath</key><string>$node</string>
</dict>
</plist>
PLIST

codesign --force --sign - --identifier dev.zeno.island "$app" >/dev/null 2>&1 || echo "warning: ad hoc signing failed" >&2

echo "Built $app"
echo "  project: $root"
echo "  node:    $node ($("$node" --version))"

if [ "${1:-}" = "--open" ]; then
  open "$app"
fi
