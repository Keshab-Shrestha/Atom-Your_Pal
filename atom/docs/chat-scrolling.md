# Conditional chat scrolling

ADR-147 / R1, implemented 2026-10-18. Release compilation and static review only. Tests, gallery, app launch and live mouse/trackpad/keyboard/VoiceOver workflows were skipped at the user's request. No tests were added or run. The installed app is unchanged; historical test totals do not validate ADR-141–147.

The transcript starts at its end. While following, document or viewport size changes request a deferred scroll to the actual bottom, including message padding. This covers growing replies, message expansion and composer/queue height changes. Reading older messages pauses following, so ordinary turn updates no longer force a jump. Scrolling back to within two points of the bottom resumes following.

When paused, a native **Scroll to end** button sits below the transcript and above the composer. It does not cover message or copy controls. It jumps to the newest content and resumes following. It has a visible label and accessibility hint; focus, keyboard and VoiceOver behavior are not live verified.

`ChatScrollView` retains the existing SwiftUI scroll view and lazy message stack. A background AppKit probe attaches only to that transcript's enclosing NSScrollView. Document/clip frame notifications identify layout changes; bounds/live-scroll notifications identify movement. Guarded programmatic scrolls do not change the reader's follow latch. Deferred callbacks use weak references and teardown checks, and superseded follow-state reports are discarded. There is no global event/keyboard monitor or newer-than-macOS-14 scroll API dependency.

Switching chats rebuilds local scroll state. Replaying a completely replaced set of turn ids also resumes following; adding/trimming overlapping visible turns does not reset it. Scroll positions are not persisted per chat. The existing 50-turn visible limit still applies: this does not retain an anchor when an old visible turn is evicted, load archived pages, or add unread counts. Layout changes above the viewport and lazy-stack height estimation can still affect positioning; these need live acceptance. Snapshot rendering continues to lay content flat without native scroll observers.

No transcript, draft, queue, archive, provider input, permissions, runtime protocol or storage format changes. Other pages continue using the original `Scrollable` behavior. Validation is limited to release compilation and static diff review including `git diff --check`; this is not proof that interactive scrolling is correct.

ADR-152 adds Find in chat: while Find is open, native following is suspended so result jumps cannot be pulled back by incoming content. Closing Find keeps the current follow latch; Scroll to end remains available when away. Initial probe attachment now republishes its current follow state, including when Find was already active. These changes are compiled/static-reviewed only, with live scrolling acceptance still skipped.
