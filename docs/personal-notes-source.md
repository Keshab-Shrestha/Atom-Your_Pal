# Selected notes-folder source

22 October continuation: optional [resumable analysis](source-analysis-jobs.md), ADR-192, uses already imported copies through an explicit model job or opt-in schedule. Folder import/refresh stays deterministic and makes no model call; no background filesystem scan was added. Both capabilities still await the combined acceptance gate.

Implemented in source on 22 October 2026, ADR-188. This is the first personal-source pilot in the [Sentient adoption plan](sentient-adoption-plan.md), extending the existing Second brain. It has compiler checks only; Keshab deferred tests to the end of the adaptation plan.

## User flow

Second brain → Sources → Choose notes folder → review supported filenames/count → Import notes. Preview stays in memory, expires after five minutes and is revoked by Cancel. Connect rescans and rejects a changed preview. No file content is sent to a model during preview, import or refresh.

One connected folder is stored locally across restarts. Refresh explicitly reads new and edited Markdown/text files into existing notes, FTS search, tags, wikilinks and automatic links. It does not grant agent read/write access to the source folder or start a background watcher. The imported copies can be used through existing brain search/open and explicit note attachments; that selected content can reach the chosen remote model, as disclosed before import.

Sources displays its canonical folder, last checked time, imported/corrected/conflicting/missing/excluded counts and skipped entries. Each note shows its original relative path, scan time and state:

- **Current:** matches the last imported source version; freshness means the last explicit scan, not a live filesystem watch.
- **Corrected:** the saved ATOM copy changed locally while the file is unchanged. Refresh preserves the correction.
- **Conflict:** both the file and ATOM copy changed. Refresh preserves the correction; the user can explicitly choose Use file version after confirmation. Unsaved editor text must first be saved or discarded. Source title/body are used for that replacement, with collision-safe titles.
- **Missing:** the file was absent or skipped on the latest successful full scan. Its last copy is kept and labeled; model retrieval warns about stale/conflicting copies.

Deleting an imported note excludes that path from later refreshes while the folder stays connected. Remove source explicitly confirms removal of all imported copies, including saved local corrections; original files, unrelated notes, chats and permissions remain untouched. Existing incoming wikilinks can retain a title as an empty ghost, as with ordinary note deletion. Removal is not secure erasure of SQLite backups, already attached/sent content or model conversations. Reconnecting starts a new source and clears its old exclusions.

## Boundaries

The pilot reads UTF-8 `.md`, `.markdown` and `.txt` only. Imported content preserves whitespace; editor saves retain existing editor normalization. No PDF/Word/image extraction, protected application database, OAuth account, model summarization, portable two-way publication or automatic fact promotion is included yet.

Use the existing checked folder/path/secret rules: an ordinary folder inside home or an external volume, never the whole home, Library/hidden/protected personal paths or credential stores. Hidden entries, symlinks, hardlinks, unsupported/invalid text, probable credentials and files over 256 KiB are skipped. The heuristics can miss a secret or refuse an innocent note; folder selection and review remain essential.

A scan allows 500 notes, 8 MiB of text, 5,000 directory entries, eight nested levels and a cooperative ten-second deadline. These are filesystem scan budgets, not input-editor character limits. Oversized individual files are skipped visibly; aggregate/depth/read errors reject the entire scan and preserve earlier copies/freshness. Network/external-drive filesystem operations can block past the cooperative deadline; the UI reports an unknown outcome after 30 seconds and offers status reload instead of claiming cancellation or automatically retrying.

Canonical paths, directory/file identities, no-follow/nonblocking file opens, regular-file/hardlink checks and before/after mutation checks guard the read. Files are read through a bounded buffer. The connected root identity persists; replacing it requires removing/reviewing the intended source again. Failed scans do not mark everything missing. File content and metadata publication is atomic in SQLite; the graph's derived automatic links rebuild afterward, with a content-free warning on rebuild failure.

Metadata contains only folder/file identities, paths, hashes, exclusions and scan time. Existing brain notes remain the only content/link/search store. Title collisions never replace unrelated written notes. Native local edits are allowed; agent `brain_note` cannot append to a source-backed note. Imported brain outputs and note attachments carry host-authored provenance/data markers. Claude/Codex checked paths feed marked reads into the existing external-content action guard; note text cannot grant permission, opt into Full access or change a provider. This is not a claim of general prompt-injection immunity.

## Implementation and deferred validation

New additive SQLite metadata tables are created with the existing memory store. Brain writes use composable savepoints so a multi-note source publication rolls back as one operation. No archive, grant, access-mode or chat schema migration.

`brain.source` is a private native-window command/response with request matching and `get`, `preview`, `cancel`, `connect`, `refresh`, `restore`, `disconnect`. It is not a model tool, external API or worker endpoint. Native runtime-stop, dropped-command, timeout and stale-response paths clear waiting state. Old native clients ignore the additional optional note provenance.

TypeScript typecheck and the Swift release compiler pass. No unit/integration/security/migration/model/live UI/gallery tests were run, no real folder was connected and no app/account/model configuration was changed. The built binary was not copied over the running app or launched. Deferred acceptance is tracked in the [end-of-plan validation list](sentient-adoption-validation.md). This feature is implemented, not certified for release yet.
