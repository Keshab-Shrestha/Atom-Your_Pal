# Sentient-inspired ATOM upgrades

Keshab authorized this direction on 21 October 2026, following the [source inquiry](sentient-os-feature-inquiry.md). Improve existing equivalents before adding another system. Implement one capability at a time, as required by CLAUDE.md. Preserve full chat archives, drafts, per-chat settings and deterministic permission continuity.

Remote models through ATOM's Gateway remain primary. A general local model is an optional fallback/backup, never a required installation or a silent change of provider. Do not repeat an uncertain external action on a backup model.

| Order | Capability | Reuse or add | First useful outcome |
| --- | --- | --- | --- |
| 1 | Computer readiness and recovery | Improve existing Cua transport/tool | Explicit content-free readiness probe, cold/warm stage timings, bounded owned-process recovery, fresh observation after failure; no automatic action replay |
| 2 | Personal-source knowledge | Extend Second brain | One explicitly selected ordinary notes folder; source provenance, edit-aware freshness, correction/removal and useful retrieval into existing notes; no parallel knowledge store |
| 3 | Contextual unsent replies | Improve Quick actions' existing Draft a reply | Preview selected conversation, chosen relevant facts and editable writing examples; one tool-free Gateway request and editable draft; explicit copy/insert, no automatic send |
| 4 | Long-chat continuity | Extend existing bounded replay, Chat brief and archive retrieval | Asynchronous derived summary with original-message references; keep archive and explicit brief; summaries never create grants or claim authority |
| 5 | Proactive preparation | Extend daily brief and explicit routines | Small read-only discovery run produces sourced editable cards; execution remains a separate user action; visible budget and pause controls |
| 6 | Background analysis and recovery | Extend routines/checkpoints | Resumable source jobs, visible failures/freshness and ordinary app-running scheduling first |
| 7 | Local backup inference | Extend Gateway, after the above contexts are bounded | Optional user-configured compatible endpoint, capability/readiness checks and explicit provider attribution; cloud stays default; no model download in the current capability |

Graph visuals, worker/team controls, local API/MCP, Telegram, projects, files, Browser and Terminal already exist. Improve their specific gaps when evidence calls for it; do not add duplicate surfaces because Sentient has a differently named feature. PR/Device expansion remains separate from this adoption sequence.

## Coverage of the source inquiry

The seven capabilities above group the inquiry's 33 features; a group is not a claim that all its stages have shipped.

| Inquiry features | ATOM treatment |
| --- | --- |
| 1–5, 8: notch/voice, screen handoff, app/browser control and continuing conversation/activity | Improve existing assistant entry points, current-chat routing and checked computer use. Preserve ATOM's multiple chats/projects; do not collapse them into a new single global conversation. |
| 6–7: compaction and editable standing memory | Sequence 4 extends replay/archive retrieval, explicit Chat brief and existing memory. Derived summaries are separate from editable standing facts and grants. |
| 9–11: unsent reply, writing examples, independent drafting model | Sequence 3 extends Quick actions. Editable opt-in examples and a Gateway model choice can be scoped there; no second direct provider client or default sending. |
| 12, 26–27: local reader, provider choices and all-local option | Existing primary model/reasoning choices remain. Sequence 7 adds optional backup capability; evaluate text/vision/tool support separately. A local reader is not evidence of a local computer agent. |
| 13–18: documents, messages, Notes/SiYuan, mail/calendar, hosted connectors and OAuth MCP | Sequence 2 begins with ordinary text/Markdown. Later add document formats and selected app/account adapters against the same provenance/freshness contract. Audit existing calendar/MCP paths first. Protected readers and new account scopes need the decisions below. |
| 19–21: linked portable Markdown knowledge, reader and graph | Extend existing Second brain links/search/graph. Scope a user-selected portable Markdown folder with conflict-aware publication and correction/deletion, rather than a second knowledge database. |
| 22–23, 33: discovery, prepared work and personal briefing | Sequence 5 extends brief/routines with sourced reviewable suggestions; a one-time useful knowledge briefing is a later presentation of the same grounded context. Keep preparation separate from authorized execution. |
| 24–25: overnight analysis and checkpoints | Sequence 6 adds resumable source jobs using existing scheduling/task recovery. System wake is a separate decision. |
| 28: cloud knowledge MCP mirror | Decision-dependent extension of existing local API/MCP, not enabled by default; recommend local access first. |
| 29–30: health/repair and dependency preparation | Sequence 1 starts with protocol readiness/timings/recovery. Full app-owned permission/read/input fixtures and any new native transport are later checks, not certified by the protocol probe. |
| 31–32: updates/lifecycle and privacy/observability | Compare existing setup/login/reset/credential controls before adding missing lifecycle settings. Signed update distribution and optional repair reports need their own scope. Source selection, removal and content-free diagnostics accompany each ingestion upgrade; no imported telemetry defaults. |

## Decisions to bring to Keshab when the relevant capability is scoped

- **Protected personal sources:** recommend explicit per-source opt-in, a preview and deletion controls. Ask before adding Mail/Messages databases, Full Disk Access or broad background screen collection; an ordinary selected-folder pilot does not require those.
- **Native computer transport:** recommend keeping ATOM's checked wrapper while evaluating a different transport. Do not copy Sentient's competing-helper termination or approval-bypass behavior. Ask if a desired backend cannot preserve the current controls.
- **Sleep/wake:** recommend ordinary app-running schedules first. Ask before installing a privileged wake helper or changing system power settings.
- **Hosted memory or paid endpoints:** recommend local storage and existing signed-in Gateway providers first. Ask before cloud mirroring, new billing or raw writing-example uploads outside an explicitly requested draft.
- **Implementation reuse:** independently implement the concepts. Sentient's AGPL/commercial source is not imported; direct source/assets reuse would need a separate licensing decision.

These are future decision boundaries, not requests to approve unspecified work now. No automatic messages, extra telemetry, downloads or permission widening are part of this plan.

## Current acceptance: computer readiness and recovery

- `computer` gains an explicit `status` action that initializes the driver and checks its advertised methods without enumerating apps, reading windows, capturing screenshots or injecting input.
- Report startup versus probe duration and reuse; distinguish transport availability from untested macOS permissions. Keep normal calls lazy and reuse the helper within its existing idle lifetime.
- Instrument initialization, probe and actual driver-call durations without arguments, typed text or desktop content.
- Timeout/cancellation/crash cannot silently retry an action. Retire only ATOM's owned helper, bound termination and require fresh observation before further input. Old session tokens cannot cross a restart.
- Verify with controlled protocol/process fixtures and existing computer policy/screenshot/host bridge checks. No real desktop capture or model request is required for the content-free probe.
