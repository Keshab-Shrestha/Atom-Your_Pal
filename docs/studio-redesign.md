# Orbit identity and Studio Board — 23 October 2026

Keshab requested a new logo, new character style and new floor-style Board. Title-bar double-click should fill the desktop while retaining the menu bar and Dock, rather than enter a separate full-screen Space.

## Window behavior

AppKit owns the main window's size; the SwiftUI hosting view no longer supplies implicit sizing constraints. The custom title-bar background owns drag and double-click handling instead of also asking AppKit to move the window implicitly. Double-click calls native zoom once; ordinary dragging still calls native window dragging. The green full-screen control remains native.

The previous build maximized/restored under automated input, so the reported physical snap-back was not conclusively reproduced before the change. In the rebuilt app, two live automated cycles maximized to 1920 × 1050 and restored to 961 × 1050. Agent navigation, Studio and Tasks reflow retained the maximized dimensions without snapping back. This verifies automated interaction; the original physical gesture was not independently reproduced.

## Visual identity

Orbit is an original vector character family: a ceramic shell, dark inset visor, colored eyes, short arms/boots and one signal light. One shared drawing supplies the desktop companion, portraits, sidebar, app icon and floor actors. Worker colors, IDs and names remain distinct. Existing animations, reactions and motion state continue to supply poses; the new portrait interprets gaze, tilt, blink and eye openness in the new style.

The app icon uses the new character on a deep teal tile with an orbital line. Built-in avatar definitions opt into the optional `orbit` style; older/custom definitions without that field retain their earlier rendering. Recoloring preserves the drawing family. No user avatar preference or agent definition stored outside the repository is replaced.

## Studio

The floor becomes a restrained studio with workstations, ATOM's area, collaboration table, recharge lounge and attention display. Workstation anchors, seat limits, pathfinding, overflow signs, task selection and the approval model remain authoritative. Lounge positions are spread into three rows inside its bounds, with a smaller coffee table and compact visual names to avoid overlapping or clipped agents; accessible names remain complete. Character clicks open the existing task or agent page. The attention display opens Needs you. Accessible buttons expose the same actions without requiring canvas coordinates. Reduced motion shows a stationary scene that still responds to state changes.

Board tabs read Studio, Needs you, Tasks and Activity. The large repeated agent grid is tucked into Agent directory; Agents opens the existing searchable roster. The studio's status row links to all attention items, including global approvals. These are presentation changes, with no new execution, permission, retry, scheduling or deletion behavior. Chat history and task archives remain intact.

## Verification

The full Swift suite passes: 798 tests in 147 suites, including legacy character decoding, style-preserving recoloring, lounge bounds/nonoverlap and existing paths to all seats. Release compilation passes. The release gallery renders 120 scenes without fixture errors. All 50 visual references pass at the unchanged 1% threshold after reviewing one intentional Board reference update and adding four Studio/icon references. The packaged app passes strict deep signature verification and is running Ready with Studio open. Live checks covered the 11-agent floor, accessible agent navigation, searchable roster and Tasks (29 completed items). The final binary passed another native title-bar maximize/navigation/restore cycle at the dimensions above. No approval or real model request was submitted. Existing compiler isolation/capture warnings remain. No TypeScript execution path or database schema changed.
