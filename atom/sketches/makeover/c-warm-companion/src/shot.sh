#!/bin/bash
# usage: shot.sh <html> <png> <w> <h>
B="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
"$B" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=$3,$4 --screenshot="$2" "file://$1" 2>/dev/null >/dev/null
