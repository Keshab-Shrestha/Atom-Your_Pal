# Long user-message collapse

ADR-146 / C5, implemented 2026-10-18. Compilation and static review only. Tests, gallery, app launch and actual copy/keyboard/VoiceOver workflows were skipped at the user's request. No tests were added or run. The installed app is unchanged; historical test/gallery totals do not validate ADR-141–146.

User messages beyond **600 Unicode characters or eight logical lines** start as a preview. **Show full message** expands that message; **Show less** restores the preview. ADR-174 moves these choices into the Message actions ellipsis and right-click menu, alongside the existing named accessibility actions. The available Show full message/Show less label identifies the display state. Assistant replies retain their full display.

`UserMessagePreview` in AtomIslandCore walks the bounded prefix using Swift Character indices, preserving extended grapheme clusters, Japanese text and line-ending characters including CRLF. When more text remains it appends an ellipsis. Collapsed bubbles also have an eight-visual-line cap, so wrapping cannot make a preview grow indefinitely. Logical lines determine eligibility; short messages that wrap onto many visual lines are not measured and automatically collapsed by width.

**Copy full message** always copies the exact original `turn.transcript`, in either display state. Its accessibility action uses the same original payload. Selection within the preview can copy only an excerpt; use Copy full message in Message actions for the complete text. Retry, saved chat history and provider input all continue using the original transcript.

Expansion is per-turn local SwiftUI state and is not saved to disk. Replaying/reopening/recreating a message view can start it collapsed again. Changing the transcript resets expansion. No backend, protocol, schema, dependency, provider request or permission change is included.

Verification is limited to `swift build --package-path apps/mac/island -c release` and static review including `git diff --check`. Visual layout, selection, keyboard focus and accessibility behavior remain unverified. No golden images or tests were changed for C5.

R1 was implemented separately in ADR-147: [conditional follow and Scroll to end](chat-scrolling.md). It is also compiled only; live acceptance remains outstanding.
