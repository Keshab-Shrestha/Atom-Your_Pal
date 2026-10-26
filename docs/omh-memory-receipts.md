# Native memory context receipts

Fifth bounded OMH-inspired slice, 26 October 2026. Add explanations to the existing memory paths rather than importing another memory runtime or changing recall policy.

## User-visible behavior

Chat options → **What this chat remembers** now includes **Latest recorded request**. A short summary says whether the recorded request completed, failed, stopped or was interrupted. **Memory context details** expands selected fact IDs/reasons, context inclusion/budget omissions, replay counts and request/attempt identity. Existing history, summary controls and separate Chat access remain available.

No receipt is invented for old replies. The view labels the latest *recorded* request, shows its preparation timestamp in Details, and only displays it for the matching saved chat. Requests failing before context composition have no record; a first failed unsaved chat does not gain a transcript solely for diagnostics. Refresh retrieves the latest record through the existing read-only chat inspection command. Receipts are not supplied as model instructions or exposed through a new model-facing tool.

## Selection and composition

`memoryContextSelection` preserves the prior saved-fact algorithm and rendered text: matching facts first, then recent facts, normally up to 12, rendered by ID. It adds total-at-selection and IDs with `match`/`recent` reasons. The existing `memoryContext` API delegates to the same implementation. An empty selection is recorded explicitly; an unobserved/failed legacy context callback is not mistaken for zero stored facts.

Host-only provenance travels beside the facts part. It is never rendered into the prompt or inserted into a session prefix. The existing budget compiler supplies full/fallback/omitted selections and byte counts for these observed groups:

- Saved facts.
- Saved-chat search results.
- Recent conversation notes.
- This chat's project digest.
- Chat brief block.
- Older-message continuity summary or its paused/stale status notice.

Only saved facts have per-item IDs/reasons in this slice. Other sources have group-level composition records, not per-note/page/reference attribution. A group absent from a receipt may not have been searched or observed; absence does not diagnose missing storage, wrong scope or retrieval failure. Empty brief/status blocks are described as blocks/notices, not claimed to contain useful memories. The selected fact IDs are historical; the receipt does not claim those facts remain saved after a later Forget.

Fresh replay records the earlier messages supplied and those outside that replay window. Warm/resumed Claude sessions record provider-session use and any catch-up messages instead of asserting that fresh replay counts describe the SDK's retained context. Session compaction/full retained contents remain unobservable. Codex/plain paths record the replay submitted by native core, not a guarantee about every downstream provider transformation or cache.

Chat only disables new personal facts/cross-chat background. It does not prove old copies have disappeared from an existing provider session. Current-chat brief/continuity and original history remain governed by their existing behavior.

## Delivery and persistence

Each actual native-core model-adapter invocation has a fresh host attempt UUID tied to its request/chat. Preparing a request creates `atom.recall/v1` metadata; adapter completion marks it completed. Errors/stops are distinct, and Stop immediately finalizes the receipt even if an adapter is slow to return. Cleanup runs once; a late completion cannot rewrite cancellation or another attempt. Existing resume recovery creates a separate receipt, rather than promoting the failed attempt.

“Completed” means the adapter returned the foreground reply. It does **not** establish provider network delivery for each item, model attention, use, factual correctness, task completion or archive-save success. Tool-driven recall/search, worker memory, source intake, per-memory eligibility diagnosis and independent answer-use verification are outside this collector. No new inference, retry, provider switch or memory admission is introduced.

The existing memory SQLite database holds bounded metadata in `chat_recall_receipts`: eight recent attempts per chat and 1,000 per owner. No fact/query text, prompt, model reply, content hash, source filename or credential is stored. Version/type/range/source checks project events onto the known metadata shape; invalid latest records show unavailable, never silently substitute older proof. Startup marks prepared rows interrupted without replay. Finishes update only the matching prepared attempt, so pruned/deleted records cannot be recreated by late finishes.

Deleting/pruning a saved chat removes its receipts through a trigger. Runtime deletion also clears unsaved receipts and rejects late callbacks for that chat. Historical fact IDs retain no forgotten fact text. Receipt retention never prunes original history, memories, grants or drafts. There is no model-facing receipt writer, and metadata cannot authorize any tool or file operation. Persistence failures during a request are logged with stage only and do not alter the reply.

## Validation

- `pnpm typecheck` and `git diff --check`: pass.
- Native release compilation with `swift build --build-system native -c release --product AtomIsland --package-path apps/mac/island`: pass, 66.68 seconds. Existing IslandSettings/main warnings remain. The initial default build-system attempt failed on SwiftTerm's optional Metal compiler; the repository's native build-system setting succeeded.
- Source review covered both chat paths, resume recovery, cancellation, same-chat UI/inspection, bounded retention and deletion.
- No test suite, model call, benchmark, installation, running-app restart, commit or push. Live behavior remains pending the agreed end-stage verification.

Deferred acceptance: selected/missing/recent facts and exact rendered-text preservation; zero versus unavailable facts; budget omission and required overruns; paused/stale summaries and warm/resumed/catch-up sessions; Chat only and inherited provider copies; stop/late result/recovery identities; close/reopen; invalid records; retention; deletion/pruning/unsaved deletion during an active call; permission continuity and original history/drafts unchanged. Verify the native popover in both themes and app text sizes. No token/latency improvement is claimed.

Next bounded capability: curated workflow definitions/routing using existing workers and selected providers. Broader per-source memory diagnosis, actual-write enforcement, repair and descendant cancellation remain separate.
