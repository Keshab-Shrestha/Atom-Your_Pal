// The test cases part of the helper store: save a done task as a test case for a soul or a skill, run them against a proposal (split out of store.ts, 2026-10-16).

import { HelperError } from "./jobs.ts";
import { instructionsFor } from "./jobs.ts";
import { MAX_TEST_CASES, TEST_CASES_RUN, skillInstructions, type TestKind } from "./test-cases.ts";
import { toSoul } from "./store-schema.ts";
import type { StoreContext } from "./store-context.ts";
import type { HelperStore } from "./store-types.ts";

export function testCaseMethods(ctx: StoreContext): Pick<HelperStore, "saveTestCase" | "deleteTestCase" | "testCases" | "testInputs" | "startTestRun" | "finishTestCase" | "testResults" | "tinkerTaskOf"> {
  const { emit, mustGet, mustHelper, current, report, tests, skills, proposals, tinkerOf } = ctx;
  return {
    saveTestCase(jobId, kind, raw) {
      const job = mustGet(jobId);
      const target = raw.trim();
      if (job.helper === "tinker") throw new HelperError("Only an agent's own task can be a test case.");
      if (job.state !== "done") throw new HelperError("Only a done task can be a test case.");
      const taskReport = report(jobId);
      if (!taskReport) throw new HelperError("That task has no report to compare with.");
      if (kind === "soul" && target !== job.helper) throw new HelperError("A task is a test case for the agent that did it.");
      if (kind === "skill" && (!skills.skillsUsed(jobId).includes(target) || !skills.isZenoSkill(target))) {
        throw new HelperError("A task is a test case only for a ATOM-made skill its run used.");
      }
      const saved = tests.of(kind, target);
      const name = kind === "soul" ? current(target).name : `the ${target} skill`;
      if (saved.some((c) => c.jobId === jobId)) throw new HelperError(`This task is already a test case for ${name}.`);
      if (saved.length >= MAX_TEST_CASES) throw new HelperError(`${name} has ${MAX_TEST_CASES} test cases, the most it keeps. Delete one first.`);
      const id = tests.add(kind, target, jobId, job.task, `${taskReport.title}\n${taskReport.summary}\n\n${taskReport.body}`);
      emit({ action: "testCase", kind, target, testCase: id, change: "saved" });
      return tests.get(id)!;
    },

    deleteTestCase(id) {
      const c = tests.get(id);
      if (!c) throw new HelperError("There is no such test case.");
      tests.remove(id);
      emit({ action: "testCase", kind: c.kind, target: c.target, testCase: id, change: "deleted" });
    },

    testCases: () => tests.all(),

    testInputs(kind, id) {
      if (kind === "soul") {
        const p = proposals.get(id);
        if (!p || p.state !== "pending") throw new HelperError("No proposal waits for an answer there.");
        const role = mustHelper(p.helper).role;
        const soul = toSoul(current(p.helper));
        return {
          kind,
          id,
          target: p.helper,
          oldInstructions: instructionsFor(soul, role),
          newInstructions: instructionsFor({ ...soul, [p.field]: p.text }, role),
          cases: tests.of("soul", p.helper).slice(0, TEST_CASES_RUN),
        };
      }
      const e = skills.skillEdit(id);
      if (!e || e.state !== "pending") throw new HelperError("No skill edit waits for an answer there.");
      return {
        kind,
        id,
        target: e.skill,
        oldInstructions: skillInstructions(e.oldBody),
        newInstructions: skillInstructions(e.newBody),
        cases: tests.of("skill", e.skill).slice(0, TEST_CASES_RUN),
      };
    },

    startTestRun(kind, id, cases) {
      tests.start(kind, id, cases);
      emit({ action: "testRun", kind, item: id, state: "started" });
    },

    finishTestCase(kind, id, testCase, outcome) {
      tests.finish(kind, id, testCase, outcome);
      emit({ action: "testRun", kind, item: id, case: testCase.id, state: outcome.state });
    },

    testResults: (kind: TestKind, id: number) => tests.results(kind, id),

    tinkerTaskOf(kind, id) {
      const p = kind === "soul" ? proposals.get(id) : undefined;
      const e = kind === "skill" ? skills.skillEdit(id) : undefined;
      const row = p ? tinkerOf.get(p.jobId, "", "") : e ? tinkerOf.get(e.jobId, "edit", e.skill) : undefined;
      return (row as { id: number } | undefined)?.id;
    },
  };
}
