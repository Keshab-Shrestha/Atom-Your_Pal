// Helper for the ark-spike checks (CHECKLIST.md). Build: swiftc -O probe.swift -o /tmp/ark-probe
//   windows NAME   list the on-screen windows of the process NAME: id, layer, x, y, w, h, title
//   mouse          print the pointer position (global points, top-left origin)
//   move X Y       move the pointer to X Y (posts a mouse-moved event)
//   click X Y      click at X Y (posts mouse-down and mouse-up)
//   front          print the frontmost app
// Posting events needs the Accessibility grant for the program that runs this tool.
import AppKit
import CoreGraphics

let args = CommandLine.arguments
func point(_ i: Int) -> CGPoint { CGPoint(x: Double(args[i])!, y: Double(args[i + 1])!) }
func post(_ type: CGEventType, _ p: CGPoint) {
    CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
}

switch args.count > 1 ? args[1] : "" {
case "windows":
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
    for w in list where (w[kCGWindowOwnerName as String] as? String) == args[2] {
        let b = w[kCGWindowBounds as String] as? [String: Double] ?? [:]
        print(w[kCGWindowNumber as String]!, w[kCGWindowLayer as String]!, b["X"]!, b["Y"]!, b["Width"]!, b["Height"]!,
              w[kCGWindowName as String] as? String ?? "")
    }
case "mouse":
    let p = CGEvent(source: nil)!.location
    print(p.x, p.y)
case "move":
    post(.mouseMoved, point(2))
case "click":
    post(.leftMouseDown, point(2))
    usleep(60_000)
    post(.leftMouseUp, point(2))
case "front":
    print(NSWorkspace.shared.frontmostApplication?.localizedName ?? "none")
default:
    print("usage: probe windows NAME | mouse | move X Y | click X Y | front")
    exit(2)
}
