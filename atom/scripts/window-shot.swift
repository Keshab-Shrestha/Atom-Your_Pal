// Finds ATOM's main window with the window list (needs Screen Recording for window names) and prints its window id, or exits 1 when no ATOM window is on
// screen. scripts/window-shot.sh uses it to capture just that window. Read-only.
import CoreGraphics
import Foundation

let windows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
// The main window: owned by ATOM, a normal layer, and big (the strip and Pal's window are small).
let candidates = windows.filter { w in
    guard (w[kCGWindowOwnerName as String] as? String) == "ATOM", (w[kCGWindowLayer as String] as? Int) == 0,
          let bounds = w[kCGWindowBounds as String] as? [String: Double] else { return false }
    return (bounds["Width"] ?? 0) >= 600 && (bounds["Height"] ?? 0) >= 400
}
guard let id = candidates.first?[kCGWindowNumber as String] as? Int else { exit(1) }
print(id)
