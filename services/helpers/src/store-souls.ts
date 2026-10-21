// The souls and feedback part of the helper store: a worker's soul and its versions, a task's rating, and Tinker's proposals to change a soul (split out of
// store.ts, 2026-10-16).

import { cleanSoul, HelperError } from "./jobs.ts";
import { SOUL_FIELDS } from "./feedback.ts";
import { sameSoul, toSoul, type JobRow, type SoulRow } from "./store-schema.ts";
import { type StoreContext } from "./store-context.ts";
import type { HelperStore } from "./store-types.ts";

export function soulMethods(ctx: StoreContext): Pick<HelperStore, "soul" | "saveSoul" | "restoreSoul" | "rate" | "reviewTarget" | "addProposal" | "acceptProposal" | "rejectProposal" | "undoProposal" | "makeSkill"> {
  const { now, emit, roster, current, mustHelper, mustGet, get, report, skills, proposals, askTinker, newSoulVersion, writeBack, soulRow, putRating, jobById } = ctx;
  const self: Pick<HelperStore, "soul" | "saveSoul" | "restoreSoul" | "rate" | "reviewTarget" | "addProposal" | "acceptProposal" | "rejectProposal" | "undoProposal" | "makeSkill"> = {
    soul(helper) {
      const id = roster().find((m) => m.id === helper)?.id;
      if (!id) throw new HelperError(`There is no helper called "${helper.slice(0, 40)}".`);
      return toSoul(current(id));
    },

    saveSoul(helper, input) {
      const known = mustHelper(helper);
      const others = roster().filter((h) => h.id !== known.id).map((h) => current(h.id).name);
      const soul = cleanSoul(input, others);
      if (!sameSoul(soul, toSoul(current(known.id)))) newSoulVersion(known.id, soul);
      writeBack(known);
    },

    restoreSoul(helper, version) {
      const known = mustHelper(helper);
      const row = soulRow.get(known.id, version) as SoulRow | undefined;
      if (!row) throw new HelperError(`${current(known.id).name} has no version ${version}.`);
      if (row.version === current(known.id).version) return;
      // The old name may have been taken by another worker since.
      const others = roster().filter((h) => h.id !== known.id).map((h) => current(h.id).name);
      newSoulVersion(known.id, cleanSoul(toSoul(row), others));
      writeBack(known);
    },

    rate(id, good, raw) {
      const job = mustGet(id);
      if (job.state !== "done" && job.state !== "failed") throw new HelperError("Only a finished task can be rated.");
      if (job.helper === "tinker") throw new HelperError("Tinker's reviews are answered by accepting or rejecting its proposal.");
      const comment = raw?.trim() || null;
      putRating.run(good ? "good" : "bad", comment, id);
      emit({ action: "rating", helper: job.helper, job: id, good });
      // ADR-094: good work may become a skill (Tinker drafts it once per task; Keshab approves it).
      if (good) {
        if (job.state === "done") skills.askDraft(job);
        return;
      }
      // One review per task: Tinker's task waits in the queue like any other. ADR-094: and one edit
      // for each of ATOM's skills the task used.
      askTinker(id, `Review task ${id} (${current(job.helper).name})`, null);
      skills.askEdits(job);
    },

    reviewTarget(tinkerTaskId) {
      const reviewed = get(mustGet(tinkerTaskId).reviews ?? -1);
      if (!reviewed) return undefined;
      const row = jobById.get(reviewed.id) as unknown as JobRow & { rating_comment: string | null };
      const reviewedReport = report(reviewed.id);
      return {
        worker: current(reviewed.helper).name,
        role: mustHelper(reviewed.helper).role,
        task: reviewed.task,
        soul: toSoul(current(reviewed.helper)),
        ...(row.rating_comment ? { comment: row.rating_comment } : {}),
        ...(reviewed.error ? { error: reviewed.error } : {}),
        ...(reviewedReport ? { report: { title: reviewedReport.title, summary: reviewedReport.summary, body: reviewedReport.body } } : {}),
      };
    },

    addProposal(tinkerTaskId, proposal) {
      const reviewed = get(mustGet(tinkerTaskId).reviews ?? -1);
      if (!reviewed) throw new HelperError("The reviewed task is gone.");
      if (!SOUL_FIELDS.includes(proposal.field)) throw new HelperError("A proposal changes personality, howItWorks, rules or lessons.");
      // The changed soul must still be a valid soul (limits, no empty personality): checked now, and again on accept.
      cleanSoul({ ...toSoul(current(reviewed.helper)), [proposal.field]: proposal.text }, []);
      const id = proposals.add(reviewed.helper, proposal.field, proposal.text.trim(), proposal.reason.trim(), reviewed.id, now());
      emit({ action: "proposal", helper: reviewed.helper, proposal: id, state: "pending" });
      return proposals.get(id)!;
    },

    acceptProposal(id) {
      const p = proposals.get(id);
      if (!p || p.state !== "pending") throw new HelperError("No proposal waits for an answer there.");
      const before = current(p.helper).version;
      self.saveSoul(p.helper, { ...toSoul(current(p.helper)), [p.field]: p.text });
      proposals.set(id, "accepted", before);
      emit({ action: "proposal", helper: p.helper, proposal: id, state: "accepted" });
    },

    rejectProposal(id) {
      const p = proposals.get(id);
      if (!p || p.state !== "pending") throw new HelperError("No proposal waits for an answer there.");
      proposals.set(id, "rejected");
      emit({ action: "proposal", helper: p.helper, proposal: id, state: "rejected" });
    },

    undoProposal(id) {
      const p = proposals.get(id);
      if (!p || p.state !== "accepted" || p.previousVersion === undefined) throw new HelperError("Only an accepted proposal can be undone.");
      self.restoreSoul(p.helper, p.previousVersion);
      proposals.set(id, "undone");
      emit({ action: "proposal", helper: p.helper, proposal: id, state: "undone" });
    },

    makeSkill(id) {
      skills.makeSkill(id);
    },
  };
  return self;
}
