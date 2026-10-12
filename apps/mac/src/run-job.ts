// One helper job's run (ADR-081/082, Task 3.2): chooses the model, sets up folders, skills, MCP and browser, runs the
// research (or Codex, Tinker, a Manager, a plan) and records the result. Moved out of runtime.ts without changes.

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { GatewayError, runCodexJob, runPlan, runResearch, RunInterrupted, type PlanUsage, type TokenUsage } from "@zeno/llm-gateway";
import { CLAUDE_PLAN, type Logger, type ProviderKeys } from "@zeno/shared";
import {
  briefFor,
  chooseJobModel,
  followUpBrief,
  handOffTool,
  instructionsFor,
  JOB_TIME_LIMIT_MS,
  findHelper,
  tieredModels,
  wantsFiles,
  withRoleNotice,
  type HelperStore,
  type Job,
  type JobRun,
  type TestKind,
} from "@zeno/helpers";
import type { createLayaEngine } from "@zeno/decision-engine";
import type { ComputerBridge } from "./computer-bridge.ts";
import type { ModelSettings } from "./model-settings.ts";
import type { TaskSteering } from "./task-steering.ts";
import { askForFolder, checkpointBefore, denyRead, folderCheck } from "./folder-run.ts";
import { commitWork, prepareWorkdir, type Workdir } from "./worktree.ts";
import { SKILLS_PLUGIN, prepareSkills, userSkillsDir } from "./skills.ts";
import { runTinker } from "./tinker.ts";
import { runManager } from "./manager-run.ts";
import { mcpCheck, sdkConfig } from "./mcp-servers.ts";
import { BROWSER_SERVER, browserCheck, browserServer } from "./browser.ts";

export const CODEX_REASON = "Ran on Codex (Claude plan limit reached)";

/** What one job run reads from createRuntime (the values it closed over before the move). */
export interface RunOneContext {
  helpers: HelperStore | undefined;
  settings: ModelSettings;
  keys: ProviderKeys;
  decisions: ReturnType<typeof createLayaEngine>;
  planModels: () => ReturnType<typeof tieredModels>;
  reportUsage: (usage: PlanUsage) => void;
  steering: TaskSteering | undefined;
  computer: ComputerBridge;
  log: Logger;
  worktrees: string;
  skillsDir: string | undefined;
  skillPlugin: (job: Job) => string;
  /** Tasks the runner let start on Codex; the run takes each id out as it starts. */
  codexJobs: Set<number>;
  runTests: (kind: TestKind, id: number, signal: AbortSignal, tinkerJob?: number) => Promise<void>;
}

export function createRunOne(ctx: RunOneContext): JobRun {
  const { helpers, settings, keys, decisions, planModels, reportUsage, steering, computer, log, worktrees, skillsDir, skillPlugin, codexJobs, runTests } = ctx;
  return async (job, { signal, onStep }) => {
    const { provider, model: current } = settings.current();
    // ADR-088: a built-in worker or an agent Keshab added; its role and kit (what it may use) come from the team list.
    const member = helpers?.list().find((h) => h.id === job.helper);
    // ADR-082, Task 3.3: the soul is read when the job starts, so an edit applies from the next job.
    const soul = helpers?.soul(job.helper) ?? findHelper(job.helper)?.soul;
    const name = soul?.name ?? job.helper;
    const role = member?.role ?? findHelper(job.helper)?.role ?? "";
    const kit = member?.kit ?? "think";
    // ADR-098 item 7: the runner let this task start on Codex (held only by the Claude plan's limit).
    const onCodex = codexJobs.delete(job.id);
    if (provider !== CLAUDE_PLAN) throw new Error(`${name} needs the Claude plan for research.`);
    // ADR-083: pin, else Laya; then the role's floor and the large-model switch. Stored first so the window shows it.
    const pick = await chooseJobModel({
      engine: decisions,
      task: job.task,
      role,
      pinnedModel: helpers?.list().find((h) => h.id === job.helper)?.pinnedModel,
      allowLarge: helpers?.allowLarge() ?? true,
      models: planModels(),
      // ADR-098 item 9: Managers and Tinker run on Sonnet at most, unless pinned.
      ...(role === "improver" || helpers?.managers().some((m) => m.id === job.helper) ? { cap: "medium" as const } : {}),
    });
    const model = pick.model ?? current;
    helpers?.setModel(job.id, model, pick.reason);
    // Never the task text.
    log.info("job.model", {
      helper: job.helper,
      job: job.id,
      model,
      tier: pick.tier,
      ...(pick.score !== undefined ? { score: Math.round(pick.score * 100) / 100 } : {}),
      source: pick.source,
    });
    // ADR-095: a "plan" Manager splits its part, then reviews its Agents' reports: no tools, one answer each run.
    if (helpers?.managers().some((m) => m.id === job.helper)) {
      const store = helpers;
      return runManager({
        store,
        job,
        run: { claudePath: keys["claude-plan"] ?? "", model, signal, onStep, onUsage: reportUsage },
        count: (costUsd, tokens) => {
          if (costUsd) store.addSpend(job.id, costUsd); // the Manager's own budget
          if (tokens) store.addUsage({ source: "job", helper: job.helper, job: job.id, model, ...tokens, ...(tokens.costUsd ? { dollars: tokens.costUsd } : {}) });
        },
        onEvent: (e) => log.info("manager.run", e),
      });
    }
    if (!soul) throw new Error(`There is no worker called ${job.helper}.`);
    const instructions = instructionsFor(soul, role);
    // ADR-087: the task with its goal, Keshab's notes and the reports of the tasks it waited for.
    const fresh = () => briefFor(job.task, helpers?.context(job.id) ?? { comments: [], earlier: [] });
    // Task 3.11: the coder, designer and documenter work in the folders Keshab granted; the documenter without one
    // writes up with the research tools, the others cannot start.
    let grants = helpers?.list().find((h) => h.id === job.helper)?.grants ?? [];
    // ADR-090: a file worker with no folder asks on Pal's card for the one its task names (or ~/Documents/ZENO);
    // allowed, ZENO makes it and grants it. A write-up that saves nothing needs no folder.
    if (kit === "folders" && !grants.length && helpers && (role !== "documenter" || wantsFiles(job.task))) {
      const store = helpers;
      grants = await askForFolder({
        task: job.task,
        name,
        home: homedir(),
        approve: (request) => computer.approve(request),
        grant: (folder) => {
          store.addGrant(job.helper, folder);
          return store.list().find((h) => h.id === job.helper)?.grants ?? [];
        },
        onAnswer: (allowed) => log.info("job.folder", { helper: job.helper, job: job.id, allowed }),
      });
    }
    let work: Workdir | undefined;
    let files: Parameters<typeof runResearch>[0]["files"];
    if (kit === "folders" && grants.length) {
      const folder = grants.find((g) => job.task.toLowerCase().includes(g.split("/").at(-1)!.toLowerCase())) ?? grants[0]!;
      work = await prepareWorkdir(folder, job.id, worktrees);
      const roots = [work.dir, ...grants.filter((g) => g !== folder)];
      files = {
        cwd: work.dir,
        writable: roots,
        // Git's data (the worktree's .git file, any granted repository's .git) is ZENO's alone to write.
        denyWrite: [...(work.tree ? [join(work.tree, ".git")] : []), ...roots.map((r) => join(r, ".git"))],
        denyRead: denyRead(),
        check: folderCheck({
          roots,
          cwd: work.dir,
          name,
          approve: (request) => computer.approve(request),
          onCheck: (e) => log.info("job.tool", { helper: job.helper, job: job.id, ...e }),
          // B3.4, ADR-101: the original of a file is kept before its first edit (not in the git worktree: git covers it).
          ...(helpers
            ? {
                before: checkpointBefore({ roots, ...(work.tree ? { tree: work.tree } : {}), keep: (r, p) => helpers.checkpoint(job.id, r, p) }),
                onBeforeError: (e: { tool: string }) => log.warn("job.checkpoint_failed", { helper: job.helper, job: job.id, tool: e.tool }),
              }
            : {}),
        }),
      };
    } else if (kit === "folders" && role !== "documenter") {
      throw new Error(`${name} needs a folder to work in: grant one in the ZENO window.`);
    }
    // Task 3.10: a top-level task may hand sub-tasks to the workers its role allows; the store checks each one.
    const handOff = helpers && !files && handOffTool(helpers, job);
    // ADR-090: Keshab's MCP servers that are on and given to this worker; every call asks unless the server is trusted.
    const servers = (helpers?.mcpServers() ?? []).filter((s) => s.enabled && s.workers.includes(job.helper));
    const mcp = servers.length
      ? {
          servers: Object.fromEntries(servers.map((s) => [s.name, sdkConfig(s)])),
          check: mcpCheck({
            servers,
            worker: name,
            approve: (request) => computer.approve(request),
            onCheck: (e) => log.info("job.mcp", { helper: job.helper, job: job.id, ...e }),
          }),
        }
      : undefined;
    // ADR-098 item 4: an agent with the browser grant (not a "think" agent) gets ZENO's browser; each run has its own
    // answers (a site Keshab allowed stays allowed for that run only). Logs ids, tools and origins, never typed text.
    const browserOn = kit !== "think" && Boolean(member?.browser);
    const browser = () => ({
      name: BROWSER_SERVER,
      server: browserServer(dirname(worktrees), job.helper),
      ...browserCheck({
        name,
        helper: job.helper,
        grants,
        approve: (request) => computer.approve(request),
        onCheck: (e) => log.info("job.browser", { helper: job.helper, job: job.id, ...e }),
      }),
    });
    // Task 3.12: only the skills chosen for this worker, through its own small plugin.
    const chosen = helpers?.list().find((h) => h.id === job.helper)?.skills ?? [];
    const skills = chosen.length ? { ...prepareSkills(skillPlugin(job), chosen, userSkillsDir(), skillsDir), plugin: SKILLS_PLUGIN } : undefined;
    // ADR-094: which skills the run used, so a bad outcome can lead to an edit of one of ZENO's.
    const onSkill = (skill: string) => {
      helpers?.recordSkillUse(job.id, skill);
      log.info("job.skill", { helper: job.helper, job: job.id, skill });
    };
    const research = (task: string, resume?: string) =>
      runResearch({
        claudePath: keys["claude-plan"] ?? "",
        model,
        task,
        instructions,
        signal,
        onStep,
        onUsage: reportUsage,
        ...(resume ? { resume } : {}),
        ...(handOff ? { handOff } : {}),
        ...(files ? { files } : {}),
        ...(skills?.names.length ? { skills, onSkill } : {}),
        // ADR-095: the sub-agents it starts, for the task's thread (the store's change logs ids, names and states only).
        onSubAgent: (event) => helpers?.recordSubAgent(job.id, event),
        // B3.1: its tool calls as short redacted summaries, for the task's timeline (Codex and Manager runs record none).
        onToolCall: (event) => helpers?.recordToolCall(job.id, event),
        ...(steering ? { steering: steering.track(job.id) } : {}),
        ...(mcp ? { mcp } : {}),
        ...(browserOn ? { browser: browser() } : {}),
        // ADR-088: a "think" agent has no tools at all (the documenter without a folder still writes up from the web).
        ...(kit === "think" ? { thinkOnly: true } : {}),
      });
    // ADR-091: every run's tokens, for the Dashboard.
    const countTokens = (tokens: TokenUsage | undefined) => {
      if (tokens) helpers?.addUsage({ source: "job", helper: job.helper, job: job.id, model, ...tokens, ...(tokens.costUsd ? { dollars: tokens.costUsd } : {}) });
    };
    // Task 3.13, ADR-094: Tinker reviews a soul, drafts a skill or proposes a skill edit: no tools, one answer.
    if (role === "improver") {
      if (!helpers) throw new Error("Tinker needs the helpers file.");
      return runTinker({
        store: helpers,
        job,
        run: { claudePath: keys["claude-plan"] ?? "", model, instructions, signal, onStep, onUsage: reportUsage },
        count: (costUsd, tokens) => {
          if (costUsd) helpers.addSpend(job.id, costUsd);
          countTokens(tokens);
        },
        // ADR-098 item 8: the new proposal or edit is tested inside this task, so it counts on Tinker's budget.
        test: (testKind, id) => runTests(testKind, id, signal, job.id).catch(() => undefined),
      });
    }
    // Task 3.8: a plan-first task's first run only plans (no tools); the plan then waits for Keshab.
    if (job.planFirst && job.planStatus !== "approved") {
      const { plan, costUsd, tokens } = await runPlan({ claudePath: keys["claude-plan"] ?? "", model, task: fresh(), instructions, signal, onStep, onUsage: reportUsage });
      if (costUsd) helpers?.addSpend(job.id, costUsd);
      countTokens(tokens);
      return { plan };
    }
    // ADR-098 item 3: Keshab interrupted the run: its session is kept, and the task waits for his next message.
    const interrupted = (error: unknown) => {
      if (!(error instanceof RunInterrupted)) throw error;
      if (error.sessionId) helpers?.setSession(job.id, error.sessionId);
      return { interrupted: true };
    };
    // Task 3.6: asked again, the run continues its last session with only what is new. A session Claude Code no
    // longer has (or any other failure to resume, except the plan's limits) falls back to one fresh run.
    const resume = onCodex ? undefined : helpers?.resumeOf(job.id);
    let result: Awaited<ReturnType<typeof research>>;
    // ADR-098 item 7: on Codex, the same brief and report; its tokens count on the Dashboard as "codex", $0 to budgets.
    if (onCodex) {
      helpers?.setModel(job.id, "codex", CODEX_REASON);
      onStep(CODEX_REASON);
      log.info("job.codex", { helper: job.helper, job: job.id, kit, folder: Boolean(files) });
      const out = await runCodexJob({
        program: keys.codex ?? "",
        instructions,
        task: fresh(),
        web: kit !== "think",
        ...(files ? { files: { cwd: files.cwd, others: files.writable.filter((dir) => dir !== files!.cwd) } } : {}),
        timeoutMs: JOB_TIME_LIMIT_MS,
        signal,
      });
      if (out.tokens) helpers?.addUsage({ source: "job", helper: job.helper, job: job.id, model: "codex", ...out.tokens });
      result = { report: out.report, partial: false, pages: 0 };
    } else try {
      result = await research(resume ? followUpBrief(resume.notes, helpers?.handOffs(job.id)) : fresh(), resume?.sessionId);
    } catch (error) {
      if (error instanceof RunInterrupted) return interrupted(error);
      const kind = error instanceof GatewayError || (error instanceof Error && "kind" in error) ? (error as { kind?: string }).kind : undefined;
      if (!resume || signal.aborted || kind === "rate_limit" || kind === "auth" || kind === "cancelled") throw error;
      log.warn("job.resume_failed", { helper: job.helper, job: job.id, kind });
      try {
        result = await research(fresh());
      } catch (fresher) {
        return interrupted(fresher);
      }
    }
    if (result.sessionId) helpers?.setSession(job.id, result.sessionId);
    if (result.costUsd) helpers?.addSpend(job.id, result.costUsd); // Task 3.7: counts toward the day's budgets
    countTokens(result.tokens);
    // Task 3.11: in a repository, ZENO commits the work on the task's own branch. Never pushed.
    if (work?.branch) {
      const committed = await commitWork(work.dir, `ZENO task ${job.id}: ${result.report.title}`);
      const where = `${committed ? "The changes are committed" : "Nothing was changed"} on the branch ${work.branch} in ${work.repo}. Nothing was pushed.`;
      log.info("job.commit", { helper: job.helper, job: job.id, committed });
      return { ...result, report: withRoleNotice(role, { ...result.report, body: `${result.report.body}\n\n${where}` }) };
    }
    log.info("job.session", { helper: job.helper, job: job.id, resumed: Boolean(resume) });
    return { ...result, report: withRoleNotice(role, result.report) };
  };
}
