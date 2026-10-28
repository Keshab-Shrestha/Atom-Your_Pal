# Foreground request and answer recovery

Implemented 2026-10-18, ADR-157, continuing the requested one-area-per-batch upgrades. TypeScript checking and Swift release compilation pass. Tests, gallery, app launch, runtime migration, provider calls and live/crash acceptance were skipped by request. Changes remain local/uncommitted on `main`; the installed app is unchanged.

## What is retained

Typed submissions keep a local copy of their text, original file/note references and delivery UUID before the private-pipe command is sent. The composer and queued-message paths retain that copy until the host acknowledges durable acceptance. A dropped command, missing receipt or app restart leaves input held for review, never automatically resent. Local storage failure refuses a new dispatch and shows a notice. The existing 100-chat/20-held-messages-per-chat, 128 KiB draft and 8 MiB input-file limits still apply.

The host commits an identified attempt before attachment preparation or model dispatch. It stores the original prompt/references, source chat, selected provider/model at acceptance, timestamps and delivery identity. Transcribed voice and legacy foreground requests get a host-generated identity at the Core boundary; microphone audio and speech rejected before that boundary are not journaled. The selected model label is acceptance metadata, not proof of the provider that eventually completed every action.

Question answers have a separate local intent copy saved before sending. The host saves an accepted answer before handing it to the model or acknowledging it in the work snapshot. If storage fails, the card remains pending with a visible error and can be retried or skipped. A newer local answer is not cleared by an older receipt: startup reconciliation checks card id plus SHA-256 of the accepted answer text. Local copies never replay into an old card automatically.

Normal successful chat saving atomically records foreground completion with the full saved exchange. The journal keeps a checked pointer (message sequence plus reply hash) into that archive. A completed reply whose archive save failed can instead be retained in the recovery record, up to 4 MiB. This fallback is not falsely labeled as saved chat history. Failure to retain the reply produces a visible warning; the original uncertain request remains available when its storage is intact.

Normal clients acknowledge archived completion and scrub redundant journal content. A lost completion acknowledgement leaves a record for review. Startup changes prepared/running attempts to Interrupted; it does not execute them. Question answers in failed or cancelled turns are now recoverable from the host journal, addressing ADR-156's earlier transient-answer limitation. Native copies awaiting host confirmation are also shown separately.

## Review and explicit retry

The chat toolbar's Recovery view lists retained attempts and unconfirmed local answers. Review shows the prompt, original references, saved clarification answers, state and source/provider metadata. Completed replies can be read/copied in bounded parts with First/Next controls. Source-chat navigation remains separate from restoring input.

Restore to current empty draft requires a writable, idle chat and an input that fits local draft storage. It includes saved clarifications as labeled historical data and restores file/note references. It neither sends the draft nor retries tools. Review the current chat's project, provider and permissions and explicitly press Send. The normal 4,000-character send limit still applies; larger input needs editing/attachment. Files/notes may have changed, and current attachment/project/protected-file checks run again. References and historical answers are not permission grants, original file bytes or a guarantee of their earlier contents.

A first-turn failure may have no saved source chat; its journal still contains the request, so it can be restored into a chosen empty chat. That action deliberately uses the current chat's configuration. It does not invent the missing chat's provider session, project folder or grants.

Dismiss recovery copy asks explicitly before clearing its prompt/answers/reply; a running/prepared attempt cannot be dismissed until settled or recovered as interrupted. Dismiss does not undo external effects or delete saved chat history. Local unconfirmed answers have a separate confirmed dismissal. Delivery ids, signatures and answer fingerprints remain as tombstones so old transport requests cannot create a second dispatch or revive dismissed content. Metadata tombstones have no automatic pruning in this capability.

## Storage and protocol

The existing SQLite memory file gains foreground_attempts and foreground_answers, with additive compatibility for earlier development columns. A request identity is bound to a fingerprint of its source chat, prompt, references and source type. Repeated identical delivery returns its receipt without copying attachments, calling a model or creating another attempt; conflicting reuse refuses. Source-chat binding is checked again at dispatch after waiting for a cancelled turn to unwind. These are local host admission guarantees, not provider/external-operation exactly-once execution.

Up to 100 undismissed records are retained. A 64 MiB payload admission budget refuses new records/answers when full; unarchived reply fallback is capped at 4 MiB. Saved archive content follows existing chat storage limits rather than being duplicated under that reply cap. Users free recovery capacity by reviewing/dismissing records. Unreviewed records protect their saved source chats from ordinary retention pruning. Explicit chat deletion scrubs associated journal payloads; project deletion cleanup includes retained attempts associated with pending unsaved project chats. Tombstone ids/hashes remain without plaintext payloads.

ChatInput's owner-only atomic local JSON snapshot advances to version 3, loading versions 1/2. It gains pending question intents, while in-transit typed input uses existing held message records. A newer input file is not guaranteed readable by an older app; failed loads remain untouched. Files are plaintext within the existing local private-storage boundaries, not newly encrypted or synced. No file contents or typed data are added to application logs.

Identified text.send adds request UUID and source chat. Internal ZenoInput carries this identity through the foreground Core; composed API/Telegram/routine turns keep their existing behavior. foreground.receipt confirms durable host acceptance/state, not model success or file effects. foreground.list reconciles local pending ids and answer fingerprints and returns bounded summaries; foreground.read returns prompt/references/answers plus a JSON-bounded reply chunk; foreground.dismiss is explicit, and foreground.ack may scrub only completion already linked to the saved archive. All use the existing private native pipe, with strict UUID/field/cursor bounds. There is no new HTTP endpoint or model recovery tool.

## Limits and verification

This is recovery and explicit review, not automatic continuation. A crash after external effects but before recording the result remains uncertain. Partial streamed text, per-operation effect journals, provider-native request deduplication, generic exactly-once edits, scheduled rate-limit retry, cross-process ownership leases and durable worker telemetry are not implemented. Existing helper-attempt recovery remains separate.

There is a small interval between provider completion and the local archive/journal commit; a crash there may leave an Interrupted record even if an external effect or reply already exists elsewhere. Review history/files before any retry. Disk/SQLite failures can prevent acknowledgement or retention, and those paths warn/preserve uncertainty rather than claiming success. Completed replies and accepted answer data are protected only by the successfully committed local stores and their normal filesystem guarantees, not a new hardware power-loss guarantee.

`pnpm typecheck`, Swift release compilation and static diff review pass. Two existing Swift warnings remain in IslandSettings/main. No tests were added/run; no production database was opened for verification, no app installed/launched and no provider, migration, restart, duplicate-delivery, keyboard/VoiceOver or disk-failure workflow was executed. Compilation is not live acceptance.

Next proposed broader area: Codex capability parity, scoped separately. Reliability still has the explicit limits above; workspace/Git, provider settings and phone improvements remain on the roadmap.
