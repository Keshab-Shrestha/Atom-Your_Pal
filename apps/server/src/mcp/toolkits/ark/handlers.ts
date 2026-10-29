import * as ArkComputer from "../../../ark/ArkComputer.ts";
import { ArkFeatureError, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as ArkFeatures from "../../../ark/ArkFeatures.ts";
import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { ArkComputerToolkit, ArkToolkit } from "./tools.ts";

const access = Effect.gen(function* () {
  const caller = yield* readCaller();
  const environment = yield* Environment.ServerEnvironment;
  if ((yield* environment.getDescriptor).environmentId !== caller.scope.environmentId)
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "This knowledge belongs to another environment.",
    });
  return yield* ArkFeatures.ArkFeatures;
});

export const layer = McpToolAccess.toLayer(ArkToolkit, {
  ark_agent_policy: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const ark = yield* access;
      if (input.agent === undefined) {
        const snapshot = yield* ark.snapshot;
        if (snapshot.status !== "ready")
          return yield* new ArkFeatureError({ message: "The agent library is not connected." });
        return {
          agents: snapshot.agents.map(({ id, name, kit, available, paused }) => ({
            id,
            name,
            kit,
            available,
            paused,
          })),
        };
      }
      const result = yield* ark.readKnowledge({ kind: "agent", agent: input.agent });
      if (result.kind !== "agent")
        return yield* new ArkFeatureError({ message: "The agent policy could not be checked." });
      return result;
    }),
  ),
  ark_knowledge_search: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const ark = yield* access;
      const result = yield* ark.readKnowledge({ kind: "search", query: input.query });
      if (result.kind !== "search")
        return yield* new ArkFeatureError({
          message: "The knowledge search returned an invalid result.",
        });
      return result;
    }),
  ),
  ark_note_read: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const ark = yield* access;
      const result = yield* ark.readKnowledge({ kind: "note", id: input.id });
      if (result.kind !== "note")
        return yield* new ArkFeatureError({ message: "The note returned an invalid result." });
      return result;
    }),
  ),
  ark_skill_list: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const ark = yield* access;
      const snapshot = yield* ark.snapshot;
      if (snapshot.status !== "ready")
        return yield* new ArkFeatureError({ message: "The skill library is not connected." });
      const source = input.source ?? "ark";
      const query = (input.query ?? "").trim().toLocaleLowerCase();
      const skills = snapshot.skills.filter(
        (skill) =>
          (source === "ark" ? skill.source === "zeno" : skill.source === "yours") &&
          (!query || `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query)),
      );
      const offset = input.offset ?? 0;
      return {
        source,
        skills: skills
          .slice(offset, offset + 50)
          .map(({ name, description }) => ({ name, description })),
        nextOffset: offset + 50 < skills.length ? offset + 50 : null,
      };
    }),
  ),
  ark_skill_read: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const ark = yield* access;
      const result = yield* ark.readKnowledge({
        kind: "skill",
        name: input.name,
        source: input.source ?? "ark",
        file: input.file ?? "SKILL.md",
        offset: input.offset ?? 0,
      });
      if (result.kind !== "skill")
        return yield* new ArkFeatureError({ message: "The skill returned an invalid result." });
      return result;
    }),
  ),
});

export const layerComputer = McpToolAccess.toLayer(ArkComputerToolkit, {
  ark_computer: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const caller = yield* readCaller();
      const environment = yield* Environment.ServerEnvironment;
      const scope = caller.scope.thread;
      if (
        !scope ||
        scope.subagent ||
        caller.scope.client?.linked ||
        (yield* environment.getDescriptor).environmentId !== caller.scope.environmentId
      )
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Computer use requires a live top-level chat on this environment.",
        });
      const computer = yield* ArkComputer.ArkComputer;
      return yield* computer.execute(
        {
          threadId: scope.threadId,
          providerSessionId: scope.providerSessionId,
          providerInstanceId: scope.providerInstanceId,
        },
        input,
      );
    }),
  ),
});
