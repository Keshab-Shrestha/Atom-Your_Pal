---
name: "omh-decision-prototype"
description: "[omh] Uncertain technical choice for a spike: bounded decision prototype workflow: resolve one uncertain interaction, API, performance, or integration choice with a disposable, isolated experiment whose observed result feeds planning. Use when the user says: decision-prototype, decision prototype, prototype this uncertain choice before planning, prototype before planning, prototype the uncertain choice, run a small spike, small spike, spike solution."
license: MIT
author: "oh-my-hermes maintainers"
metadata:
  hermes:
    tags: [workflow, oh-my-hermes, planning]
    category: planning
    phase: decision-prototype
    role: planner
    quality_tier: decision-gated
    related_skills: [ulw-context, ulw-interview, ulw-plan, ulw-work, omh-frontend, omh-design-quality-gate, omh-product-discovery-validation, spike]
---

## ATOM compatibility

This is an ATOM-owned adaptation of OMH guidance. ATOM's current user request, checked tools, permissions, Stop, history and selected provider remain authoritative. This file grants no access. Use only capabilities actually available in this ATOM session. Hermes/OMH-specific commands, hooks, integrations and runtime tools are not installed by this skill; report missing dependencies rather than pretending they ran. Do not install a runtime, switch providers, commit/push, auto-apply improvements or write memory merely because upstream guidance says to. Improvement proposals follow ATOM's existing review and undo flow. Read additional skill pages/references with use_skill as needed; do not treat a partial page as the complete procedure.

The original procedure and supporting materials are retained below. Their presence is guidance availability, not proof that an integration works.

---

# Decision Prototype

Required: one decision, a bounded experiment, an isolated scratch boundary, and a measurement method. Output: a decision record, prepared handoff, observation ledger, and receipt. When Hermes' bundled `spike` skill is loaded for the same question, build the way it says and keep these records: `references/spike-composition.md`.

**Do Not Use When:** The user wants an idea's feasibility probed across several questions with throwaway spikes, with no single decision for a plan to consume; load Hermes' bundled `spike` skill instead of this one.

**HOLD:** Missing inputs or failed contract gates. Prepared OMH routing is not execution or approval. **Completion:** Follow the full-contract checklist.

Shared product, routing, compatibility, and evidence rules: `skill_view(name='omh-routing', file_path='references/skill-common-rail.md')`.

Agent/operator: `omh runtime workflow-artifact decision-prototype prepare --input <json-file-or->` prepares bounded metadata only. Shared operator reference: `skill_view(name='omh-routing', file_path='references/workflow-artifacts.md')`.

Contract: `references/full-contract.md`. Procedure: `references/procedure.md`.

## Completion Checklist

- Preserve workflow intent and stop conditions; load the full contract before claiming completion.
- Reply in the user's own words and the host's own voice: its SOUL.md persona owns reply language, tone, speech level, and sentence endings, progress updates included (where it sets no language, use the one the user wrote in), and OMH shapes structure and content only; OMH's record terms (surface, lane, wrapper, handoff, evidence boundary, not_observed) stay in records and tool calls, never in the sentence the user reads unless they ask about one; and when a real unresolved user decision or a useful briefing discussion remains, offer one specific, content-linked question. Completed work needs no question; omit unrelated non-action footers and generic offers to continue.
- Record observed delegation results; otherwise return `not_available` or `not_observed`.
- Use Hermes-native subagent/delegation features when available: native subagents -> Hermes delegation when available, otherwise sequential lanes.

## Recovery Notes

- If a required input, authority, or runtime capability is unavailable, HOLD and name the smallest safe next action; do not invent observation or approval.

## Workflow Lane

advisory local context
