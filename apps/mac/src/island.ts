// Island mode (`main.ts --island`): ATOM Island drives the voice loop with JSON-line commands on
// stdin and receives JSON-line events on stdout. Specification: docs/island-protocol.md.

import type { HubCommands } from "./hub-commands.ts";
import { chatWriter, readOnlyMessage } from "./chat-owner.ts";
import { createInterface } from "node:readline";
import type { Message } from "@atom/contracts";
import { PROTOCOL_VERSION, createLevelThrottle, encodeEvent, parseCommand, planUsageEvent, type IslandCommand, type IslandEvent, type SearchHitItem } from "./island-protocol.ts";
import { spokenDuration } from "@atom/tool-engine";
import { createVoiceLoop, type LoopNotice, type VoiceLoop } from "./voice-loop.ts";
import type { IslandHelpers, IslandOptions, IslandProjects, ProjectResult } from "./island-types.ts";
export type * from "./island-types.ts";

const HELPERS_OFF = "Helpers are off: their file could not be opened.";

export interface IslandSession {
  readonly loop: VoiceLoop;
  /** Ends the session as if `quit` had been received (used for SIGTERM). */
  quit(): void;
}

/** Notice wording for the island's controls (hold Ctrl+Option to talk). */
export function islandNoticeText(notice: LoopNotice): string {
  switch (notice.kind) {
    case "too_short":
      return "Too short. Hold Ctrl+Option while you speak, then let go.";
    case "mic_starting":
      return `The microphone was still starting. Wait for "speak now", then talk.`;
    case "no_speech":
      return `No speech recognized (loudest sound ${notice.loudest}). Speak close to the microphone.`;
  }
}

function runProjectCommand(projects: IslandProjects, command: Extract<IslandCommand, { type: `project.${string}` }>): ProjectResult {
  switch (command.type) {
    case "project.add":
      return projects.add(command.name, command.path);
    case "project.rename":
      return projects.rename(command.id, command.name);
    case "project.remove":
      return projects.remove(command.id, command.deleteChats === true);
    case "project.archive":
      return projects.archive(command.id, command.archived);
    case "project.model":
      return projects.setModel(command.id, command.provider, command.model);
    case "project.web":
      return projects.setWeb(command.id, command.web);
  }
}

export function runIsland(options: IslandOptions): IslandSession {
  const { core, tts, describe } = options;
  const errorDetails = options.errorDetails ?? (() => ({}));
  const wrap = options.wrapEvents ?? ((events) => events);
  let quitting = false;

  const send = (event: IslandEvent) => {
    if (!quitting || event.type === "error") options.write(encodeEvent(event));
  };
  options.computer?.attach(send);
  const level = createLevelThrottle((peak) => send({ type: "mic.level", peak }), options.levelIntervalMs);

  const loop = createVoiceLoop({
    record: options.record,
    stt: options.stt,
    // ADR-098: a chat that Telegram or the local API writes is read-only here; its one writer keeps its history right.
    core: {
      handle: (input, signal, hooks) => {
        const writer = chatWriter(core.sessionId ?? "");
        return writer ? Promise.reject(new Error(readOnlyMessage(writer))) : core.handle(input, signal, hooks);
      },
    },
    tts,
    silenceWarnMs: options.silenceWarnMs,
    speakTyped: () => speech.reports || speech.updates, // ADR-106: a Quiet chat does not speak a typed turn
    events: wrap({
      onState: (state) => {
        if (state === "listening") level.reset();
        send({ type: "state", state });
      },
      onMicReady: () => send({ type: "mic.ready" }),
      onLevel: (peak) => level.push(peak),
      onMicSilent: () => void options.micName().then((microphone) => send({ type: "mic.silent", microphone })),
      onTranscript: (text) => send({ type: "transcript", text }),
      onReply: (text) => send({ type: "reply", text }),
      onTurnComplete: (t) =>
        send({
          type: "turn.complete",
          speechMs: t.speechMs,
          transcriptionMs: t.transcription,
          modelMs: t.model,
          firstSoundMs: t.firstSound,
        }),
      onNotice: (notice) => send({ type: "notice", kind: notice.kind, message: islandNoticeText(notice) }),
      onError: (stage, error) => send({ type: "error", stage, message: describe(error), ...errorDetails(error) }),
    }),
  });

  function handle(command: IslandCommand) {
    switch (command.type) {
      case "talk.start":
        options.computer?.cancelAll(); // a new request ends whatever was waiting for an answer
        // While listening this is a repeat (e.g. a key event delivered twice): keep the current recording.
        if (loop.state !== "listening") loop.press();
        return;
      case "talk.send":
        if (loop.state === "listening") loop.press();
        return;
      case "talk.cancel":
        options.computer?.cancelAll(); // Esc: anything waiting for the user is a no
        loop.cancel();
        return;
      case "text.send":
        options.computer?.cancelAll();
        loop.ask(command.text);
        return;
      case "approval.answer":
        options.computer?.answer(command.id, command.approved);
        return;
      case "conversation.reset":
        return newChat(undefined);
      case "chat.new": {
        // ADR-107: a new chat, in a project when asked. The project is checked first, so a refusal resets nothing.
        if (command.projectId) {
          const result = options.projects?.startChat(command.projectId) ?? { error: "Projects are off." };
          if ("error" in result) return send({ type: "error", stage: "settings", message: result.error });
        }
        return newChat(command.projectId);
      }
      case "chat.rename": {
        const writer = chatWriter(command.id);
        if (writer) return send({ type: "error", stage: "settings", message: readOnlyMessage(writer) });
        const result = options.chats?.rename?.(command.id, command.title) ?? { error: "Chats are off, so a chat cannot be renamed." };
        if ("error" in result) return send({ type: "error", stage: "settings", message: result.error });
        return sendChats();
      }
      case "project.add":
      case "project.rename":
      case "project.remove":
      case "project.archive":
      case "project.model":
      case "project.web": {
        const projects = options.projects;
        const result: ProjectResult = !projects ? { error: "Projects are off." } : runProjectCommand(projects, command);
        if ("error" in result) {
          options.log?.warn("project.refused", { command: command.type });
          return send({ type: "error", stage: "settings", message: result.error });
        }
        options.log?.info("project.change", { action: command.type });
        return sendChats();
      }
      case "git.list": {
        const git = options.git;
        if (!git) return send({ type: "git", branches: [] });
        void git.list().then((branches) => send({ type: "git", branches }), (error: unknown) => refuseHelpers(command.type, describe(error)));
        return;
      }
      case "git.push": {
        // ADR-091: Keshab clicked Push and confirmed. Logs the task branch's number only.
        const git = options.git;
        if (!git) return refuseHelpers(command.type, "Git is not available.");
        options.log?.info("git.push", { task: Number(command.branch.split("-").at(-1)) });
        void git.push(command.repo, command.branch).then(
          () => git.list().then((branches) => send({ type: "git", branches })),
          (error: unknown) => {
            options.log?.warn("git.push_failed", { task: Number(command.branch.split("-").at(-1)) });
            refuseHelpers(command.type, describe(error));
          },
        );
        return;
      }
      case "git.diff": {
        const git = options.git;
        if (!git) return;
        void git.diff(command.repo, command.branch).then(
          (d) => send({ type: "git.diff", repo: command.repo, branch: command.branch, ...d }),
          (error: unknown) => refuseHelpers(command.type, describe(error)),
        );
        return;
      }
      case "chats.list":
        chatsWatched = true;
        sendChats();
        return;
      case "chat.open": {
        // ADR-091: continue a saved chat; voice and typing go to it from now on.
        const chats = options.chats;
        if (!chats || !core.resume) return;
        const turns = chats.messages(command.id);
        if (!turns.length) {
          sendChats();
          return;
        }
        options.computer?.cancelAll();
        loop.cancel();
        options.screen?.clear();
        const replay = chats.replay?.(command.id, turns) ?? { turns, trimmed: false }; // ADR-107: a long project chat is replayed capped
        core.resume(command.id, replay.turns);
        sendOpened(command.id, turns, replay.trimmed);
        sendChats();
        return;
      }
      case "chat.delete": {
        options.chats?.remove(command.id);
        if (command.id === core.sessionId) {
          loop.cancel();
          core.reset();
          send({ type: "conversation.reset" });
        }
        sendChats();
        return;
      }
      case "context.window": {
        const app = command.name;
        const pointed = options.screen?.point(command.bundleId, app) ?? Promise.resolve({ ok: false as const, message: "Reading the screen is turned off." });
        void pointed.then(
          (result) => send({ type: "context.ready", app, ...result }),
          (error: unknown) => send({ type: "context.ready", app, ok: false, message: describe(error) }),
        );
        return;
      }
      case "model.refresh":
        // ADR-097: the Claude plan's live model list again; `info` follows either way.
        void (options.settings?.refreshModels?.() ?? Promise.resolve()).then(sendInfo, (error: unknown) => options.log?.warn("models.refresh_failed", { message: describe(error) }));
        return;
      case "chat.model": {
        // ADR-097: this chat's own model, from the chat's top bar. Voice and new chats keep the default.
        const id = command.id || core.sessionId || "";
        const result = options.chats?.setModel?.(id, command.provider, command.model) ?? { error: "Chats are off, so a chat cannot have its own model." };
        if ("error" in result) {
          options.log?.warn("chat.model_refused", { reason: result.error });
          send({ type: "error", stage: "settings", message: result.error });
          return;
        }
        sendChats();
        return;
      }
      case "model.set": {
        // Applies to the next request; a turn in progress finishes with the old model.
        if (!options.settings) {
          send({ type: "error", stage: "settings", message: "This runtime cannot switch models." });
          return;
        }
        const result = options.settings.setModel(command.provider, command.model);
        if ("error" in result) {
          options.log?.warn("model.set_refused", { reason: result.error });
          send({ type: "error", stage: "settings", message: result.error });
          return;
        }
        sendInfo();
        return;
      }
      case "brain.get":
        brainWatched = true; // from now on, changes are sent too
        sendBrain();
        return;
      case "brain.note": {
        const note = options.brain?.note(command.id);
        if (note) send({ type: "brain.note", note });
        else send({ type: "error", stage: "settings", message: "That note is gone." });
        return;
      }
      case "brain.save":
        try {
          const note = options.brain?.save({ ...(command.id !== undefined ? { id: command.id } : {}), title: command.title, body: command.body });
          if (!note) throw new Error("The second brain is off.");
          send({ type: "brain.note", note });
          sendBrain();
        } catch (error) {
          send({ type: "error", stage: "settings", message: describe(error) });
        }
        return;
      case "brain.delete":
        if (!options.brain?.remove(command.id)) send({ type: "error", stage: "settings", message: "That note is gone." });
        sendBrain();
        return;
      case "brain.search":
        send({ type: "brain.hits", query: command.query, hits: options.brain?.search(command.query) ?? [] });
        return;
      case "memory.list":
        memoryWatched = true; // from now on, changes ATOM makes by itself are sent too
        sendMemory();
        return;
      case "memory.forget":
        if (options.memory?.forget(command.id)) options.log?.info("memory.change", { action: "forget", id: command.id, by: "settings" });
        sendMemory();
        return;
      case "memory.clear": {
        const removed = options.memory?.clear() ?? 0;
        if (removed) options.log?.info("memory.change", { action: "clear", removed, by: "settings" });
        sendMemory();
        return;
      }
      case "memory.keepChat":
      case "memory.dropChat": {
        const done = command.type === "memory.keepChat" ? options.memory?.keepChat?.(command.id) : options.memory?.dropChat?.(command.id);
        if (done) options.log?.info("memory.change", { action: command.type === "memory.keepChat" ? "keepChat" : "dropChat", by: "settings" });
        else send({ type: "error", stage: "settings", message: command.type === "memory.keepChat" ? "That chat is gone, or memory is off." : "That chat is not kept." });
        sendMemory();
        return;
      }
      case "episode.forget":
        if (options.memory?.forgetEpisode(command.id)) options.log?.info("episode.change", { action: "forget", id: command.id, by: "settings" });
        sendMemory();
        return;
      case "episode.clear": {
        const removed = options.memory?.clearEpisodes() ?? 0;
        if (removed) options.log?.info("episode.change", { action: "clear", removed, by: "settings" });
        sendMemory();
        return;
      }
      case "tools.scan":
        // ADR-093: look for the AI tools on this Mac again, then send the choices.
        void options.settings?.scanTools?.().then(sendInfo, (error: unknown) => options.log?.warn("tools.scan_failed", { message: describe(error) }));
        return;
      case "telegram.set":
        options.telegram?.setPush(command.push);
        return;
      case "api.set":
        if (!options.api) return send({ type: "api", on: false, port: 0, tokenFile: "", error: "The local API is not available in this mode." });
        void options.api.set(command.on).then((status) => send({ type: "api", ...status }));
        return;
      case "speech.set":
        // ADR-091: muted kinds still show (the island card, Pal's line); they are not said or chimed.
        speech = { reports: command.reports, updates: command.updates, chime: command.chime ?? true };
        return;
      case "helpers.list":
        helpersWatched = true; // from now on, every job change is sent too
        sendHelpers();
        return;
      case "helper.set":
        void setHelperApp(command.helper, command.app);
        return;
      case "job.add":
        changeHelpers(command.type, (helpers) => helpers.addJob(command.helper, command.task, command.blockedBy, command.planFirst));
        return;
      case "plan.approve":
        changeHelpers(command.type, (helpers) => helpers.approvePlan(command.id));
        return;
      case "plan.reject":
        changeHelpers(command.type, (helpers) => helpers.rejectPlan(command.id));
        return;
      case "agent.create":
        changeHelpers(command.type, (helpers) =>
          helpers.createAgent({ name: command.name, role: command.role, kit: command.kit, personality: command.personality, howItWorks: command.howItWorks, rules: command.rules }),
        );
        return;
      case "agent.remove":
        changeHelpers(command.type, (helpers) => helpers.removeAgent(command.id));
        return;
      case "job.open": {
        const helpers = options.helpers;
        if (!helpers?.openReport) return refuseHelpers(command.type, HELPERS_OFF);
        // Done by code in the worker's app; a problem ("no app chosen", "no web sources") comes back as words.
        void helpers.openReport(command.id).then(
          () => sendHelpers(),
          (error: unknown) => refuseHelpers(command.type, describe(error)),
        );
        return;
      }
      case "mcp.add":
        changeHelpers(command.type, (helpers) => helpers.addMcp(command));
        return;
      case "mcp.remove":
        options.helpers?.removeMcp(command.id); // unknown: ignored
        sendHelpers();
        return;
      case "mcp.set":
        changeHelpers(command.type, (helpers) => helpers.setMcp(command.id, command));
        return;
      case "mcp.test": {
        const helpers = options.helpers;
        if (!helpers?.testMcp) return refuseHelpers(command.type, HELPERS_OFF);
        void helpers.testMcp(command.id).then(
          () => sendHelpers(),
          (error: unknown) => refuseHelpers(command.type, describe(error)),
        );
        return;
      }
      case "job.retry":
        changeHelpers(command.type, (helpers) => helpers.retry(command.id));
        return;
      case "job.rate":
        changeHelpers(command.type, (helpers) => helpers.rate(command.id, command.good, command.comment));
        return;
      case "proposal.accept":
        changeHelpers(command.type, (helpers) => helpers.acceptProposal(command.id));
        return;
      case "proposal.reject":
        changeHelpers(command.type, (helpers) => helpers.rejectProposal(command.id));
        return;
      case "proposal.undo":
        changeHelpers(command.type, (helpers) => helpers.undoProposal(command.id));
        return;
      case "helper.skills":
        changeHelpers(command.type, (helpers) => helpers.setSkills(command.helper, command.skills));
        return;
      case "skill.make":
        changeHelpers(command.type, (helpers) => helpers.makeSkill(command.id));
        return;
      case "skill.hub.search":
        void runHub(command.type, (hub) => hub.search(command.query));
        return;
      case "skill.hub.preview":
        void runHub(command.type, (hub) => hub.preview(command.source, command.path));
        return;
      case "skill.hub.update":
        void runHub(command.type, (hub) => hub.update(command.name));
        return;
      case "skill.hub.approve":
        changeHelpers(command.type, (helpers) => hubOf(helpers).approve(command.id));
        return;
      case "skill.hub.reject":
        changeHelpers(command.type, (helpers) => hubOf(helpers).reject(command.id));
        return;
      case "skill.hub.uninstall":
        changeHelpers(command.type, (helpers) => hubOf(helpers).uninstall(command.name, command.force));
        return;
      case "skill.approve":
        changeHelpers(command.type, (helpers) => helpers.approveSkillDraft(command.id));
        return;
      case "skill.reject":
        changeHelpers(command.type, (helpers) => helpers.rejectSkillDraft(command.id));
        return;
      case "skill.edit.accept":
        changeHelpers(command.type, (helpers) => helpers.acceptSkillEdit(command.id));
        return;
      case "skill.edit.reject":
        changeHelpers(command.type, (helpers) => helpers.rejectSkillEdit(command.id));
        return;
      case "skill.edit.undo":
        changeHelpers(command.type, (helpers) => helpers.undoSkillEdit(command.id));
        return;
      case "testcase.save":
        changeHelpers(command.type, (helpers) => helpers.saveTestCase(command.jobId, command.kind, command.target));
        return;
      case "testcase.delete":
        changeHelpers(command.type, (helpers) => helpers.deleteTestCase(command.id));
        return;
      case "testcase.run": {
        const helpers = options.helpers;
        if (!helpers?.runTests) return refuseHelpers(command.type, HELPERS_OFF);
        // The results arrive with each case (the store's changes); a refusal says why.
        void helpers.runTests(command.proposalKind, command.id).then(
          () => sendHelpers(),
          (error: unknown) => refuseHelpers(command.type, describe(error)),
        );
        return;
      }
      case "grant.add":
        changeHelpers(command.type, (helpers) => helpers.addGrant(command.helper, command.path));
        return;
      case "grant.remove":
        options.helpers?.removeGrant(command.helper, command.path); // unknown: ignored
        sendHelpers();
        return;
      case "routine.delete":
        options.helpers?.removeRoutine(command.id); // unknown: ignored
        sendHelpers();
        return;
      case "routine.pause":
        changeHelpers(command.type, (helpers) => helpers.pauseRoutine(command.id, command.paused));
        return;
      case "routine.add": {
        const { type, ...input } = command;
        changeHelpers(type, (helpers) => helpers.addRoutine(input));
        return;
      }
      case "routine.update": {
        const { type, id, ...input } = command;
        changeHelpers(type, (helpers) => helpers.updateRoutine(id, input));
        return;
      }
      case "helper.planFirst":
        changeHelpers(command.type, (helpers) => helpers.setPlanFirst(command.helper, command.on));
        return;
      case "helper.browser":
        changeHelpers(command.type, (helpers) => helpers.setBrowser(command.helper, command.on));
        return;
      case "job.stop":
        options.helpers?.stop(command.id); // unknown or finished: ignored
        sendHelpers();
        return;
      case "job.delete":
        options.helpers?.remove(command.id);
        sendHelpers();
        return;
      case "helper.pin":
        changeHelpers(command.type, (helpers) => helpers.pin(command.helper, command.model));
        return;
      case "helpers.settings":
        changeHelpers(command.type, (helpers) => {
          if (command.allowLarge !== undefined) helpers.setAllowLarge(command.allowLarge);
        });
        return;
      case "job.block":
        changeHelpers(command.type, (helpers) => helpers.setBlockers(command.id, command.blockedBy));
        return;
      case "comment.add":
        changeHelpers(command.type, (helpers) => helpers.addComment(command.id, command.text));
        return;
      case "job.steer":
        changeHelpers(command.type, (helpers) => {
          if (!helpers.steer) throw new Error("Steering is off.");
          helpers.steer(command.id, command.text);
        });
        return;
      case "job.interrupt": {
        const interrupt = options.helpers?.interrupt;
        if (!interrupt) return refuseHelpers(command.type, HELPERS_OFF);
        interrupt(command.id).then(sendHelpers, (error: unknown) => refuseHelpers(command.type, describe(error)));
        return;
      }
      case "job.undo": {
        const undo = options.helpers?.undo;
        if (!undo) return refuseHelpers(command.type, HELPERS_OFF);
        const { id, path, force } = command;
        changeHelpers(command.type, () => undo(id, { ...(path !== undefined ? { path } : {}), ...(force !== undefined ? { force } : {}) }));
        return;
      }
      case "job.label.add":
        changeHelpers(command.type, (helpers) => helpers.addLabel(command.id, command.label));
        return;
      case "job.label.remove":
        changeHelpers(command.type, (helpers) => helpers.removeLabel(command.id, command.label));
        return;
      case "search":
        search(command.query);
        return;
      case "job.fresh":
        changeHelpers(command.type, (helpers) => helpers.startFresh(command.id));
        return;
      case "thread.get": {
        const thread = options.helpers?.thread(command.id);
        if (thread) {
          openThread = command.id;
          send({ type: "thread", ...thread });
        } else refuseHelpers(command.type, options.helpers ? "That task is gone." : HELPERS_OFF);
        return;
      }
      case "soul.set":
        changeHelpers(command.type, (helpers) => helpers.saveSoul(command.helper, command.soul));
        return;
      case "soul.restore":
        changeHelpers(command.type, (helpers) => helpers.restoreSoul(command.helper, command.version));
        return;
      case "quit":
        quit();
        return;
    }
  }

  // ADR-081: helpers. Store changes are logged by the runtime (ids and states only); refusals log the command only.
  let helpersWatched = false;
  let helpersQueued = false;
  /** Sends `helpers` once for any number of changes in the same moment (a command and the change it causes). */
  function sendHelpers() {
    if (helpersQueued) return;
    helpersQueued = true;
    void appNames().then((apps) => {
      helpersQueued = false;
      const helpers = options.helpers;
      const agentProblems = helpers?.agentProblems() ?? [];
      send({ type: "helpers", helpers: helpers?.list() ?? [], apps, ...(helpers ? { allowLarge: helpers.allowLarge(), models: helpers.models(), skills: helpers.skills(), skillDrafts: helpers.skillDrafts(), skillEdits: helpers.skillEdits(), ...(helpers.hub?.payload() ? { skillHub: helpers.hub.payload() } : {}), testCases: helpers.testCases(), mcp: helpers.mcp(), ...(helpers.usage ? { usage: helpers.usage() } : {}), ...(helpers.paperclip ? { paperclip: helpers.paperclip() } : {}), ...(helpers.plans?.().length ? { plans: helpers.plans() } : {}) } : {}), ...(agentProblems.length ? { agentProblems } : {}), });
    });
  }
  function appNames(): Promise<string[]> {
    if (!options.helpers) return Promise.resolve([]);
    return options.helpers.apps().catch((error: unknown) => {
      options.log?.warn("helpers.apps_failed", { message: describe(error) });
      return [];
    });
  }
  function refuseHelpers(command: string, message: string) {
    options.log?.warn("helpers.refused", { command });
    send({ type: "error", stage: "settings", message });
  }
  function changeHelpers(command: string, change: (helpers: IslandHelpers) => void) {
    if (!options.helpers) return refuseHelpers(command, HELPERS_OFF);
    try {
      change(options.helpers);
    } catch (error) {
      return refuseHelpers(command, describe(error));
    }
    sendHelpers();
  }
  /** B3.5: a hub command that uses the network: a store refusal is an error for the window; a network one is a message in the list. */
  async function runHub(command: string, run: (hub: HubCommands) => Promise<void>) {
    const hub = options.helpers?.hub;
    if (!hub) return refuseHelpers(command, HELPERS_OFF);
    try {
      await run(hub);
    } catch (error) {
      refuseHelpers(command, describe(error));
    }
    sendHelpers();
  }
  function hubOf(helpers: IslandHelpers): HubCommands {
    if (!helpers.hub) throw new Error(HELPERS_OFF);
    return helpers.hub;
  }
  async function setHelperApp(helper: string, app: string) {
    if (!options.helpers) return refuseHelpers("helper.set", HELPERS_OFF);
    if (app && !(await appNames()).includes(app)) return refuseHelpers("helper.set", "That app is not installed.");
    changeHelpers("helper.set", (helpers) => helpers.setApp(helper, app));
  }
  // B3.1: the thread the window asked for last is sent again after each change (new tool calls reach its timeline).
  let openThread: number | undefined;
  const stopHelperUpdates = options.helpers?.onChange(() => {
    if (helpersWatched) sendHelpers();
    if (openThread === undefined) return;
    const thread = options.helpers?.thread(openThread);
    if (thread) send({ type: "thread", ...thread });
    else openThread = undefined;
  });

  /** ADR-098: one search over chats, tasks and reports. Logs the counts only, never the query. */
  function search(query: string) {
    const empty = { tasks: [], reports: [] };
    let found: { chats: SearchHitItem<string>[]; tasks: SearchHitItem<number>[]; reports: SearchHitItem<number>[] };
    try {
      found = query.trim() ? { chats: options.chats?.search?.(query) ?? [], ...(options.helpers?.search?.(query) ?? empty) } : { chats: [], ...empty };
    } catch (error) {
      options.log?.warn("search.failed", { error: error instanceof Error ? error.name : typeof error });
      return send({ type: "error", stage: "settings", message: "The search did not work. Try other words." });
    }
    options.log?.info("search", { chats: found.chats.length, tasks: found.tasks.length, reports: found.reports.length });
    send({ type: "search.results", query, ...found });
  }

  function sendMemory() {
    const memory = options.memory;
    send(
      memory
        ? { type: "memory", enabled: true, count: memory.count(), memories: memory.list(), episodes: memory.episodes(), ...(memory.chats ? { chats: memory.chats() } : {}) }
        : { type: "memory", enabled: false, count: 0, memories: [], episodes: [] },
    );
  }
  let memoryWatched = false;
  let brainWatched = false;
  function sendBrain() {
    if (!options.brain) return;
    send({ type: "brain", ...options.brain.graph() });
  }
  const stopBrainUpdates = options.brain?.onChange(() => {
    if (brainWatched) sendBrain();
  });

  // ADR-091: the chats, sent once asked for and again after each saved exchange.
  let chatsWatched = false;
  function sendChats() {
    const current = core.sessionId ?? "";
    const own = current ? options.chats?.modelOf?.(current) : undefined; // ADR-097
    const currentProjectId = current ? options.chats?.projectOf?.(current) : undefined; // ADR-107
    send({
      type: "chats",
      chats: (options.chats?.list() ?? []).map((c) => (chatWriter(c.id) ? { ...c, readOnly: true as const } : c)),
      current,
      ...(own ? { currentProvider: own.provider, currentModel: own.model } : {}),
      ...(options.projects ? { projects: options.projects.list() } : {}),
      ...(currentProjectId ? { currentProjectId } : {}),
    });
  }
  /** `conversation.reset` and `chat.new`: forget the conversation; a project chat starts inside its project. */
  function newChat(projectId: string | undefined) {
    options.computer?.cancelAll();
    loop.cancel();
    core.reset();
    options.screen?.clear();
    if (projectId && core.sessionId) options.projects?.assign(core.sessionId, projectId);
    send({ type: "conversation.reset", ...(projectId ? { projectId } : {}) });
    if (chatsWatched) sendChats(); // ADR-091: a new chat is now the current one
  }
  const stopChatUpdates = options.chats?.onChange(() => {
    if (chatsWatched) sendChats();
  });
  /** ADR-091: shows a saved chat's turns in the window. */
  function sendOpened(id: string, turns: readonly Message[], trimmed: boolean) {
    const projectId = options.chats?.projectOf?.(id);
    send({
      type: "chat.opened",
      id,
      messages: turns.map((m) => ({ role: m.role as "user" | "assistant", text: m.content })),
      ...(projectId ? { projectId } : {}),
      ...(trimmed ? { trimmed: true as const } : {}),
    });
  }
  // ADR-109: a goal's result was posted into a chat. If that chat is open, show it now (the Core already has the turn).
  const stopPosted = options.chats?.onPosted?.((chatId) => {
    if (chatId !== core.sessionId) return;
    const turns = options.chats?.messages(chatId) ?? [];
    sendOpened(chatId, turns, options.chats?.replay?.(chatId, [...turns]).trimmed ?? false);
  });

  // ADR-061: a timer ended. Shown at once; spoken now if ATOM is idle, else as soon as it is. Task 3.5: a goal's line
  // waits its turn the same way.
  const timerQueue: { message: string; timer?: { id: number; label: string; message: string }; after?: () => void }[] = [];
  let announcing = false;
  let speech = { reports: true, updates: true, chime: true };
  async function announce() {
    if (announcing || quitting) return;
    announcing = true;
    try {
      while (timerQueue.length && !quitting) {
        if (loop.state !== "idle") {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        const { message, timer, after } = timerQueue.shift()!;
        const spoken = timer ? speech.updates : speech.reports;
        if (spoken && speech.chime) await options.chime?.();
        // Task 3.15: Pal flies over with the line while ATOM says it.
        if (!timer) send({ type: "worker.line", line: message });
        if (spoken) {
          send({ type: "state", state: "speaking" });
          try {
            await tts.speak(message);
          } catch (error) {
            options.log?.warn(timer ? "timer.speak_failed" : "goal.speak_failed", { message: describe(error) });
          }
          if (loop.state === "idle") send({ type: "state", state: "idle" });
        }
        // Last, so the island's "Timer done" stays up after the speaking ends.
        if (timer) send({ type: "timer", ...timer });
        after?.();
      }
    } finally {
      announcing = false;
    }
  }
  const stopTimers = options.onTimer?.((timer) => {
    const message = timer.label ? `Your ${timer.label} timer is done.` : `Your ${spokenDuration(timer.seconds)} timer is done.`;
    timerQueue.push({ message, timer: { id: timer.id, label: timer.label, message } });
    void announce();
  });
  const stopGoalLines = options.onGoalLine?.((line, after) => {
    timerQueue.push({ message: line, ...(after ? { after } : {}) });
    void announce();
  });
  const stopMemoryUpdates = options.memory?.onChange(() => {
    if (memoryWatched) sendMemory();
  });
  const stopPlanUsage = options.onPlanUsage?.((usage) => {
    const event = planUsageEvent(usage);
    if (event) send(event);
  });

  /** The model in use, then what can be asked of it. */
  function sendInfo() {
    if (options.settings) send({ type: "info", ...options.settings.info() });
    if (options.capabilities) send({ type: "capabilities", items: options.capabilities() });
  }

  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (quitting) return;
    const parsed = parseCommand(line);
    if ("blank" in parsed) return;
    if ("error" in parsed) {
      options.log?.warn("island.bad_command", { reason: parsed.error });
      send({ type: "error", stage: "protocol", message: parsed.error });
      return;
    }
    handle(parsed.command);
  });
  // The island closing our stdin means it has gone away: leave too.
  lines.on("close", () => quit());

  function quit() {
    if (quitting) return;
    quitting = true;
    stopMemoryUpdates?.();
    stopBrainUpdates?.();
    stopChatUpdates?.();
    stopPosted?.();
    stopHelperUpdates?.();
    stopPlanUsage?.();
    stopTimers?.();
    stopGoalLines?.();
    options.log?.info("app.quit");
    options.computer?.cancelAll();
    loop.cancel();
    tts.close();
    lines.close();
    options.onQuit();
  }

  // Load the voice now so the first reply is not delayed; report readiness either way.
  const started = Date.now();
  tts
    .warmUp()
    .then(
      () => {
        options.log?.info("tts.ready", { ms: Date.now() - started });
        return true;
      },
      (error: unknown) => {
        options.log?.error("tts.load_failed", { message: describe(error) });
        send({ type: "error", stage: "speech", message: describe(error) });
        return false;
      },
    )
    .then((voice) => {
      // The model may have been switched before the voice finished loading: report the one in use.
      const model = options.settings?.info();
      const llm = model ? { provider: model.provider, model: model.model } : {};
      send({ type: "ready", protocol: PROTOCOL_VERSION, ...options.info, ...llm, voice });
      sendInfo();
      // ADR-093: find the AI tools on this Mac, then send the choices again with them.
      void options.settings?.scanTools?.().then(sendInfo, (error: unknown) => options.log?.warn("tools.scan_failed", { message: describe(error) }));
      // ADR-097: the Claude plan's live model list, then the choices again with it.
      void options.settings?.refreshModels?.().then(sendInfo, (error: unknown) => options.log?.warn("models.refresh_failed", { message: describe(error) }));
    });

  return { loop, quit };
}
