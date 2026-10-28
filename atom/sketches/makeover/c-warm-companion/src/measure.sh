#!/bin/bash
# usage: measure.sh <html> "<js expression returning a value>"  -> prints JSON
B="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
T="$TMPDIR/measure_$$.html"
cat "$1" > "$T"
printf '<script>window.addEventListener("load",()=>{const v=(()=>{%s})();const p=document.createElement("pre");p.id="__m";p.textContent="@@"+JSON.stringify(v)+"@@";document.body.appendChild(p);});</script>' "$2" >> "$T"
"$B" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=${3:-1440},${4:-900} --virtual-time-budget=2000 --dump-dom "file://$T" 2>/dev/null | grep -o '@@.*@@' | sed 's/@@//g'
rm -f "$T"
