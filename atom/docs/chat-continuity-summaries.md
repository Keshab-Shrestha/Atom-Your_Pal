# Automatic long-chat continuity

22 October 2026 · ADR-190 · compiled implementation; acceptance deferred

Extend the existing recent replay window and own-chat history tools with a derived summary of older messages. The original archive, user-written Chat brief, saved facts, access mode and exact-file grants remain separate records. A summary cannot grant permission or prove that an assistant actually performed an action.

## When it runs

After a successful ordinary chat save, wait two seconds before considering a background job. Short chats make no model request. Only messages older than the existing fresh replay window qualify. Resume from the previous valid summary and process at most 60 complete messages in a batch, with about 28,000 JSON-encoded UTF-8 bytes including the previous items. A very large individual message is left unsummarized rather than silently truncated; original-message paging remains available.

Use the chat's selected Claude/Codex model through an isolated Gateway job, at low effort or the model's supported default. Claude's structured job allows at most four SDK turns. No main-thread tools, project, settings, plugins/MCP, source reads, screen context or unrelated memory are inherited. Gemini does not start a summarizer because its current adapter cannot guarantee this isolation; ordinary replay remains unchanged. There is no automatic provider/model fallback or local model installation.

Only one summary job runs at once, with a 60-second cancellation deadline and an eight-chat pending bound. A foreground request clears pending work and cancels the active job before provider dispatch. There is no self-retry, catch-up loop or startup sweep. Another completed exchange can advance another batch. A delayed job rechecks the current chat/model, configuration version and original prefix before publication. Native chat removal cancels its pending/active work; every deletion path prevents late publication through saved-row and hash checks. Runtime close cancels owned work.

These are additional plan requests, not a promised token/latency saving. Usage is recorded with the background flag, selected model and chat identifier. Diagnostics contain only counts, sizes, coverage, provider/model and outcome, never transcript, summary or raw provider error text. Input/output byte checks are host budgets, not exact tokenizer limits or a guarantee about provider output before delivery.

## What gets kept and used

The model returns at most 24 short items with supporting original `mN` references. The host checks shape, hidden controls, reference ranges/available batch references and a 6,000-byte items budget, and rejects likely credentials using the existing heuristic. This is not semantic verification or a guarantee that no sensitive text can occur. Summaries may be inaccurate or lose detail; precise decisions should be checked against the originals.

An additive `chat_continuity` table in the existing local memory database stores enabled/version metadata and one derived copy: covered prefix count/hash, items, generating provider/model and update time. Publication/configuration use savepoints and optimistic versions. Appending messages keeps the prefix valid. Replacement, shortening or edits invalidate it; corrupt/stale derived data is ignored and can be rebuilt. Deleting or pruning the chat removes its summary/settings through a trigger. Forks receive no copied summary. Original messages and permission tables are never changed by this feature.

The summary accompanies a future request only when earlier messages are omitted from replay. Recent messages and the explicit Chat brief take precedence. Claude receives a changed summary once per live session, or on reopening, without a forced session reset. Codex/text replay receives the stable current derived copy as extra context. Existing archive tools remain scoped to exactly that chat; Chat only and providers without tools must ask for missing details. Composed worker/routine/API cores do not inherit a source chat's summary or create these jobs.

## Review and pause

Chat options → Saved context details shows current status, model/coverage and expandable derived items. Each item can open its first cited original message in Saved history. Refresh retrieves current status without calling a model.

Pause and clear removes the stored derived copy and stops pending/active work for that chat. Enable starts from no derived copy on a later eligible exchange. These commands require the current idle writable local chat and a matching version. Transport retries cannot overwrite a later publication/configuration. Earlier summary copies already sent may remain in a provider session; future requests carry a pause/invalidation notice. Original history, the user-kept brief and permissions are unchanged.

## Evidence and limits

TypeScript checking and Swift release compilation are the intermediate checks. No unit/integration/security/model/UI/gallery tests, live provider calls, app installation/restart or existing user-state edits were performed. Keshab explicitly deferred tests until the end of the adaptation plan. The [combined validation gate](sentient-adoption-validation.md) includes cancellation, archive/grant preservation, isolation, corruption, revision races and actual provider requests. This is not acceptance-certified delivery or a measured speed/cost improvement.
