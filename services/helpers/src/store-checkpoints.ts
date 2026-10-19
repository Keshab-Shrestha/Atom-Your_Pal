// The tool calls and undo checkpoints part of the helper store: what a task did, and putting its files back (split out of store.ts, 2026-10-16).

import { homedir } from "node:os";
import { HelperError } from "./jobs.ts";
import type { StoreContext } from "./store-context.ts";
import type { HelperStore } from "./store-types.ts";

export function checkpointMethods(ctx: StoreContext): Pick<HelperStore, "workspaceChanges" | "workspaceReview" | "workspaceUndo" | "recordToolCall" | "toolCalls" | "checkpoint" | "guardPreviewEdit" | "finishCheckpoints" | "checkpoints" | "undoCheckpoints" | "bashRan"> {
  const { emit, get, mustGet, toolCalls, checkpoints, grantsOf } = ctx;
  return {
    workspaceChanges: (root) => checkpoints.workspace(root),
    workspaceReview(jobId, root, path) {
      const job = mustGet(jobId);
      const review = checkpoints.workspaceReview(jobId, root, path);
      if (!["done", "failed", "stopped"].includes(job.state)) { delete review.token; review.note = "Finish or stop this task before undoing."; }
      return review;
    },
    workspaceUndo(jobId, root, path, token) {
      const job = mustGet(jobId);
      if (!["done", "failed", "stopped"].includes(job.state)) throw new HelperError("Finish or stop this task before undoing.");
      const result = checkpoints.workspaceUndo(jobId, root, path, token);
      if (result.length) emit({ action: "checkpoint", helper: job.helper, job: jobId, change: "undone", count: result.filter((r) => r.result === "restored").length });
      return result;
    },
    recordToolCall(jobId, event) {
      const job = get(jobId);
      // Start and end are both announced, so the last call of a run does not stay "started".
      if (job && toolCalls.record(jobId, event)) emit({ action: "toolCall", helper: job.helper, job: jobId });
    },

    toolCalls: (jobId) => toolCalls.of(jobId),

    checkpoint(jobId, roots, path) {
      const job = get(jobId);
      if (job && checkpoints.capture(jobId, roots, path)) emit({ action: "checkpoint", helper: job.helper, job: jobId, change: "kept" });
    },

    guardPreviewEdit(jobId, roots, path, before, expectedBefore, expectedAfter) {
      const job = get(jobId);
      if (!job || job.state !== "running" || job.nativeScope === "advisory") return false;
      const kept = checkpoints.guardEdit(jobId, roots, path, before, expectedBefore, expectedAfter);
      if (kept) emit({ action: "checkpoint", helper: job.helper, job: jobId, change: "kept" });
      return kept;
    },

    finishCheckpoints(jobId) {
      const job = get(jobId);
      if (!job || !checkpoints.has(jobId)) return;
      checkpoints.finish(jobId);
      emit({ action: "checkpoint", helper: job.helper, job: jobId, change: "finished" });
    },

    checkpoints: (jobId) => checkpoints.view(jobId),

    undoCheckpoints(jobId, options) {
      const job = mustGet(jobId);
      if (job.state === "running") throw new HelperError("The task is still running. Undo after it ends.");
      const grants = (grantsOf.all(job.helper) as unknown as { path: string }[]).map((g) => g.path);
      // ADR-122: agents write anywhere under home, so the undo may restore anywhere under home too (the old grants stay for older tasks).
      const results = checkpoints.undo(jobId, [...grants, homedir()], options);
      const count = results.filter((r) => r.result === "restored").length;
      if (results.length) emit({ action: "checkpoint", helper: job.helper, job: jobId, change: "undone", count });
      return results;
    },

    bashRan(jobId) {
      const job = get(jobId);
      if (!job || !toolCalls.of(jobId).some((c) => c.tool === "Bash")) return false;
      return checkpoints.has(jobId) || (grantsOf.all(job.helper) as unknown[]).length > 0;
    },
  };
}
