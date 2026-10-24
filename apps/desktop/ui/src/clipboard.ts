// Writes one prepared item to the system clipboard. Rich content carries both flavours so the destination picks; nothing is read back,
// logged or announced beyond "Copied" / "Copy failed". The old contents are never read.

import type { ClipContent } from "./copy.ts";

export async function writeClipboard(content: ClipContent): Promise<boolean> {
  try {
    if (content.html !== undefined && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([content.text], { type: "text/plain" }),
          "text/html": new Blob([content.html], { type: "text/html" }),
        }),
      ]);
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content.text);
      return true;
    }
  } catch {
    // fall through to the older route, which works without the permission prompt in some webviews
  }
  return legacyCopy(content.text);
}

function legacyCopy(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:-1000px;opacity:0";
  const before = document.activeElement as HTMLElement | null;
  document.body.append(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    before?.focus?.();
  }
}
