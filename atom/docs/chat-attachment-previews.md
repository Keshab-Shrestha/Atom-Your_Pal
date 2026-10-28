# Composer attachment previews

ADR-148 / B3, implemented 2026-10-18. Release compilation/static review only. Tests, gallery, app launch and live preview/mouse/keyboard/VoiceOver checks were skipped at the user's request. No tests were added or run. The installed app is unchanged; historical totals do not validate ADR-141–148.

Local file chips in the composer show a 32-point thumbnail, or the file icon when a thumbnail is unavailable. Clicking the thumbnail/name opens Quick Look through a normal labelled Preview button. Remove is an independent button. The attachment row scrolls horizontally, so several files and long names remain reachable in a narrow composer. Existing Second brain note chips retain their remove-only behavior: a note id is not a local file URL.

Before generating a thumbnail or opening preview, the native view checks that the path resolves to a readable regular file. A failed preview check displays a missing/unreadable notice and retains the attachment for removal or reattachment. The system handles unsupported formats and preview rendering errors; a thumbnail failure retains the file icon. Preview does not prove that the runtime will accept sending the file.

QuickLookThumbnailing generates images asynchronously at the requested size, using the window display scale (default two). Requests cancel when chips disappear/change, and generation ids reject late completions. AppKit image/view updates happen on the main queue. ATOM does not decode full-resolution attachments into its own image pipeline or write thumbnail copies. macOS Quick Look may use its own caches and installed extensions. Snapshots use static document symbols and never request attachment thumbnails or preview file contents.

The selected preview URL is local view state. Removing the selected file clears it; navigating away dismisses it, and switching chats rebuilds the attachment row. Selection is not saved, queued or sent. Queued/held messages retain their existing compact summaries: Edit into the composer to preview their files. Delivered transcript attachments are outside this capability.

Files are still references, so they can change or disappear. Thumbnails are not watched for on-disk changes while a chip remains mounted; opening preview rechecks availability. This is not permanent screenshot retention, an attachment-byte snapshot, a provider upload or a file permission grant. Existing host type/size/secret/policy validation remains authoritative at send time. There is no draft/storage/wire/backend/dependency change.

Validation is limited to `swift build --package-path apps/mac/island -c release` and static review including `git diff --check`. Live preview dismissal, unsupported formats, cancellation, narrow-window scrolling and keyboard/VoiceOver focus remain unverified.

API references: Apple's [Quick Look preview binding](https://developer.apple.com/documentation/swiftui/view/quicklookpreview(_:)) and [thumbnail generation guidance](https://developer.apple.com/documentation/quicklookthumbnailing/creating-quick-look-thumbnails-to-preview-files-in-your-app), plus the installed SDK declarations. No new package is needed.
