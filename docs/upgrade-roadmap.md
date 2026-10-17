# ATOM combined upgrade roadmap

Saved: 2026-10-17, at Keshab's request. Base: `main` after the merge of `next` (`9c414ce`).

This joins the original upgrades, the continuity work and the T3 Code research. It is a planning index. A proposal is not an instruction to build it. Work stays one capability at a time. The fresh T3 Code review may correct the research and add candidates; it must not mark them built or silently approve deferred work.

## Status terms

- **Built, live checked:** the named behavior was tried in the app.
- **Built, needs live checks:** implementation exists and relevant local checks pass; the full user workflow has not passed.
- **Proposed:** research or a candidate, not implemented by this plan.
- **Deferred / needs decision:** earlier deferral or an unresolved product/cost choice still applies.

## Combined plan

| Area | Included upgrades | Status and source |
| --- | --- | --- |
| Conversation continuity | Full saved chat/project history across restarts and provider changes; explicit continuing permission for one file in one chat; inspect/revoke grants | Built, needs live checks. ADR-135/136; [current evidence](everyday-workflows.md) |
| Codex integration | Persistent signed-in sessions, checked ATOM tools, real file-agent reports, Stop, checkpoints/worktrees; editing follows the active provider with no fallback | Built, needs live checks. ADR-137. Codex worker shell/web/browser/external MCP, assigned Claude skills, model pins and nested workers remain unsupported |
| Sidebar and diff foundation | Hide/show sidebar; text diff, accept/deny review and Undo | Sidebar built and live checked. Diff/review built and locally tested. Original items 1/2 |
| AI editing | Ask ATOM in Second brain notes; Tinker's suggestions as a diff; selection/clipboard quick actions | Built, needs live checks. Original items 4/5/6, delivered without the shared editor |
| Search, memory and brief | Search across the app; suggestions to remember facts; daily brief | Built, needs live checks. Original items 7/8/9 |
| Chat reading and copying | Copy individual code blocks/tables; reply copy formats; keyboard/VoiceOver access; richer Markdown; collapse long messages; scroll only while following the end | Proposed; the saved chat plan remains deferred until work is started. Chat C1–C5, R1 |
| Chat box | Drafts saved across restarts; attachment previews; individual queued messages; hidden-character paste handling; long paste as attachment; clearer send/queue controls | Proposed. Chat B1–B6 |
| Conversation controls | Edit/retry earlier messages; fork; pin/archive with Undo; context meter and possible Compact; show usage reset and offer later retry; paging for long chats | Proposed. General ideas 24–28/40; Compact support needs verification |
| Shared editor | Selection-aware Cmd+K; designed caret; typing animation; inline review across editors; chat-box migration | Deferred at Keshab's earlier request. Original items 3/10 and the remaining selection-aware portion of item 4. Preserve Japanese input and Undo |
| Reading and work visibility | Find within a chat; quote/reply to a selection; clickable project paths; project-file search in @; elapsed work time and a folded tool log; question cards and an access indicator | Proposed. Chat R2–R5 and later runtime ideas; some need new protocol data |
| Project workspace | Files/Changes side panel, Open in editor/Finder, read-only files with Add to chat, optional auto-open Changes | Proposed. General ideas 6/21/22/36 |
| Git | Safer command defaults; verify/fix branch discovery; save base and behind count; useful commit subjects; PR links/status; per-file diffs and whitespace toggle; conflict preview; confirmed branch cleanup | Proposed. General ideas 1–4/7/10/29–31. The branch-discovery issue is still a source-based suspicion, not a live-confirmed defect |
| Providers and settings | Account/sign-in/plan health; capability table; model favourites/hiding; settings search; command table and palette; shortcut customisation; per-row reset and settings validation; Keychain for non-model secrets; Needs you Dock badge | Proposed. General ideas 9/11–19/32/33/37. Chat depth/plan SDK support needs verification |
| Phone connections | Easier Tailscale setup; named devices and per-device revoke; pairing code and QR | Proposed; device-token changes need a decision. General ideas 5/34/35 |
| Image generation | Generate images from ATOM | Needs provider and cost decisions. Original item 11 |
| Cloud workers | Remote execution for suitable file-agent tasks, with file approval, budgets, result patches and teardown | Deferred; start with a feasibility/cost study only after a decision. Original item 12 |
| Optional provider behavior | Automatic subscription-provider switching; optional billed API/custom-endpoint providers | Needs separate decisions. Neither is enabled by this roadmap. General ideas 20/23 |

## Verification to finish first

1. Same chat: approve an existing file for the chat, complete intervening messages, ask a new worker task to rewrite it, restart/reopen, and verify the exact-file grant still applies. Revoke it and verify a later edit asks again.
2. A Codex note edit, review and save in the real UI.
3. A physical quick-action shortcut, Codex edit and replacement in TextEdit; include the password-field refusal.
4. Check search, memory suggestions and the daily brief in their real flows.

The signed-in Codex first fixture edit and next-turn recall passed. The final repeated edit was blocked by account usage after an earlier host-tool/sandbox prompt correction. It is not marked passed. Full archive replay still has provider context-window limits and cannot recover messages discarded by the old code.

Current local baseline: 1,033 TypeScript tests passed, seven opt-in live tests skipped; 731 Swift tests passed; typecheck, signed release build and all 12 visual comparisons passed. See [STATUS](../STATUS.md) for detail.

## Recommended order, not a new approval

Finish the current live checks → chat copying/accessibility and reading comfort → durable drafts and clearer send/queue controls → conversation controls → project/Git workspace → provider/settings improvements → phone improvements.

Keep the shared editor, image generation, cloud workers and optional billing/fallback changes deferred until their decisions are revisited. The fresh review recommends the revision below before implementation.

## Source plans

- [Original twelve-item plan](../upgrades.md)
- [Saved chat plan](../reference/t3code-chat-plan.md)
- [Ranked T3 Code ideas](../reference/t3code-ideas-for-atom.md)
- [Current workflow evidence](everyday-workflows.md)

The older source plans contain historical status statements. Use current STATUS and the evidence above for what is built or verified; use the source plans for design detail.


## Second source review: proposed priority changes

Reviewed T3 Code at `f96aebeb4bbdaf2b3d05177bd115dad4b8b41a8b`. [Evidence and corrections](../reference/t3code-second-review-2026-10-17.md). This adds candidates and changes the recommendation, not the implementation status or existing approvals.

| Priority | Candidate | Small first outcome |
| --- | --- | --- |
| First | Finish the current live workflows | Repeat the approved-file edit across tasks/restart, verify revoke, then note editing and physical quick-action replacement |
| Next | Bounded long-chat context and own-chat retrieval | Preserve the archive; select context within a provider budget; expose paged earlier messages with stable ids. A fact omitted from initial context can still be retrieved |
| Then | Work state and interruption/limit recovery | Show what finished, what needs an answer and what is limited. Save operation identities; offer explicit retry without duplicate edits or answers |
| Then | Durable input | Save drafts, retain attachment recovery state and keep queued messages separate |
| Then | Reading/copying, provider health, workspace/Git and settings | Continue the existing small-feature proposals with their own acceptance checks |

Additional candidates to retain: a prompt stash; files in structured question answers; visible goal progress and context chips; separate turn-versus-branch diffs. These need scope checks against existing ATOM capabilities. Interactive HTML/MCP apps, a new capture flow and external-agent control remain exploratory, without implementation approval.

Clarifications: ATOM already retrieves context from user-kept chats; the new proposal is a dedicated own-chat history recovery path for provider/session handoffs. T3 supports API-key configurations as well as subscriptions, so its billing defaults are not ATOM's policy. T3's remembered session approval is not the same scope as ATOM's exact-file/chat grant.
