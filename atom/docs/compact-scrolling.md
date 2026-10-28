# Compact scrolling and sidebar — 27 October 2026

Keshab supplied a screenshot of the chat sidebar's wide scrollbar/gutter and asked to reduce its wasted space and improve scrolling presentation throughout the app. This concerns scrollbar chrome and list spacing, not preference value sliders.

## Changes

- ATOM-owned SwiftUI scroll surfaces use a shared AtomScrollView, retaining native scroll views, axes, indicators, mouse/trackpad behavior and accessibility. A content-local AppKit probe applies small overlay scrollers with theme-appropriate light/dark knobs. The scrollbar no longer reserves a permanent content gutter.
- Shared vertical Scrollable content uses an explicit leading-aligned zero-gap stack, matching snapshot layout. The implicit live stack previously centered short headings and inserted gaps between chat rows.
- Sidebar side inset is 8 rather than 12 points. Chat rows use 8-point leading/trailing insets, 6-point vertical padding and a 30-point minimum height. The 30-point trailing delete-button reserve is used only when that control appears on hover; full titles remain accessible, and delete confirmation stays intact.
- The common chrome covers chat/history, navigation lists, settings, knowledge/agent pages, native sheets/popovers, model selection, attachments, code/table scrolling, and file/diff review. Content padding, scroll positions/following, selection, permissions and drafts retain their existing behavior. Embedded browser/terminal native controls are outside this styling primitive.

## Verification

Final native release compilation passed (47.37 seconds), packaging with ATOM Local Signing passed, and strict deep signature/diff checks passed. Added the direct AtomIslandCore import to eliminate the new theme-type warning; existing main.swift capture and build-system deprecation warnings remain.

Actual app review confirmed denser rows, a leading-aligned Chats heading, more title space, and slim theme-appropriate scrollbars. Sidebar scrolling moved from top (0) to bottom (1) and back without selecting a different chat. Scrolling the transcript away from its end exposed Scroll to end; activating it restored the end (1). Settings → General scrolled through its long content; no preference was changed. The final layout pass reapplies compact chrome at native layout changes and retiles only when scroller geometry changes, guarded against reentrancy. The final screenshot showed the compact sidebar and slim transcript scrollbar, and the original weather/T3/AWS conversation was restored.

A scrollbar-drag attempt overlapped app replacement and is not counted as a pass. On the later tool reconnection, only ATOM's pet window was exposed. Its native input returned AXError.notImplemented and the window shortcut did not expose the main window, so the final drag rerun remains unverified. No hidden-window workaround or system preference change was used.

No suites, model requests, commit or push. Existing uncommitted OMH library, chat presentation and stopped-summary work remains intact; unrelated graphify-out/ is untouched. Visual baselines have not been automatically updated.
