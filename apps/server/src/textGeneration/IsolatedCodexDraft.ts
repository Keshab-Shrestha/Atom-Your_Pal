import { REPLY_DRAFT_INSTRUCTIONS } from "@t3tools/provider-core/server/replyDraftPrompt";
import { type CodexSettings, TextGenerationError } from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { withCodexAppServerClient } from "../provider/CodexProvider.ts";
import { resolveCodexLaunchArgs } from "../provider/codexLaunchArgs.ts";
import * as TextGenerationOperations from "@t3tools/provider-core/server/textGenerationOperations";
import { toJsonSchemaObject } from "@t3tools/provider-core/server/textGenerationUtils";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const isTextGenerationError = Schema.is(TextGenerationError);
const disabledFeatures = [
  "shell_tool",
  "unified_exec",
  "multi_agent",
  "multi_agent_v2",
  "apps",
  "plugins",
  "remote_plugin",
  "browser_use",
  "computer_use",
  "view_image",
  "image_generation",
  "code_mode",
  "js_repl",
];

export const runIsolatedCodexDraft = Effect.fn("IsolatedCodexDraft.run")(
  function* <S extends Schema.Top>(
    request: TextGenerationOperations.Request<S>,
    settings: CodexSettings,
    environment: NodeJS.ProcessEnv,
  ) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "ark-reply-" }).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: request.operation,
            detail: "Could not prepare the isolated draft session.",
            cause,
          }),
      ),
    );
    const config = {
      ...Object.fromEntries(disabledFeatures.map((feature) => [`features.${feature}`, false])),
      web_search: "disabled",
      project_doc_max_bytes: 0,
      developer_instructions: "",
      default_permissions: "ark_draft",
    };
    const filesystem = Object.entries({ "/": "deny", ":minimal": "read", [cwd]: "read" })
      .map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`)
      .join(",");
    const { client } = yield* withCodexAppServerClient({
      binaryPath: settings.binaryPath || "codex",
      homePath: settings.homePath,
      cwd,
      environment,
      launchArgs: resolveCodexLaunchArgs(settings.launchArgs, environment),
      configOverrides: [
        ...Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`),
        `permissions.ark_draft.filesystem={${filesystem}}`,
        "permissions.ark_draft.network.enabled=false",
        "mcp_servers={}",
      ],
    }).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: request.operation,
            detail: "Codex could not start an isolated draft session.",
            cause,
          }),
      ),
    );
    const fail = (detail: string) =>
      new TextGenerationError({ operation: request.operation, detail });
    const effective = record(
      record(yield* client.raw.request("config/read", { cwd, includeLayers: false })).config,
    );
    const disableEntries = (value: unknown) => {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).length > 1000
      )
        return undefined;
      return Object.fromEntries(Object.keys(value).map((name) => [name, { enabled: false }]));
    };
    const mcp = disableEntries(effective.mcp_servers),
      plugins = disableEntries(effective.plugins);
    if (!mcp || !plugins)
      return yield* fail(
        "Codex's inherited configuration could not be checked. Nothing was drafted.",
      );
    const found = record(yield* client.raw.request("skills/list", { cwds: [cwd] }));
    const groups = found.data;
    if (!Array.isArray(groups) || groups.length !== 1)
      return yield* fail("Codex's inherited skills could not be checked.");
    const group = record(groups[0]);
    if (
      !Array.isArray(group.skills) ||
      group.skills.length > 1000 ||
      (Array.isArray(group.errors) && group.errors.length)
    )
      return yield* fail("Codex's inherited skills could not be checked.");
    const skills: { path: string; enabled: boolean }[] = [];
    for (const value of group.skills) {
      const skill = record(value);
      if (typeof skill.path !== "string" || !path.isAbsolute(skill.path))
        return yield* fail("An inherited skill could not be isolated.");
      skills.push({ path: skill.path, enabled: false });
    }
    const started = record(
      yield* client.raw.request("thread/start", {
        model: request.modelSelection.model,
        cwd,
        ephemeral: true,
        approvalPolicy: "never",
        permissions: "ark_draft",
        config: { ...config, mcp_servers: mcp, plugins, skills: { config: skills } },
        baseInstructions: REPLY_DRAFT_INSTRUCTIONS,
        developerInstructions: "",
        dynamicTools: [],
      }),
    );
    const thread = record(started.thread);
    if (record(started.activePermissionProfile).id !== "ark_draft" || typeof thread.id !== "string")
      return yield* fail(
        "This Codex version cannot confirm the isolated permission profile. Update Codex before drafting.",
      );
    if (started.model !== request.modelSelection.model)
      return yield* fail(
        "Codex selected a different model. Choose an explicit available model before drafting.",
      );
    const servers = record(
      yield* client.raw.request("mcpServerStatus/list", {
        threadId: thread.id,
        detail: "toolsAndAuthOnly",
        limit: 100,
      }),
    );
    if (
      !Array.isArray(servers.data) ||
      servers.nextCursor ||
      servers.data.some((value) => {
        const server = record(value);
        return server.runtimeStatus !== "disabled" || Object.keys(record(server.tools)).length > 0;
      })
    )
      return yield* fail(
        "Codex loaded external tools. ARK refused the draft before sending its content.",
      );
    const done = yield* Deferred.make<string, TextGenerationError>();
    const answer = yield* Ref.make("");
    yield* client.handleServerNotification("item/completed", (event) => {
      const item = record(event.item);
      return event.threadId === thread.id &&
        item.type === "agentMessage" &&
        typeof item.text === "string"
        ? Ref.set(answer, item.text)
        : Effect.void;
    });
    yield* client.handleServerNotification("turn/completed", (event) => {
      if (event.threadId !== thread.id) return Effect.void;
      return event.turn.status === "completed"
        ? Ref.get(answer).pipe(
            Effect.flatMap((text) => Deferred.succeed(done, text)),
            Effect.asVoid,
          )
        : Deferred.fail(
            done,
            fail("Codex did not finish the draft. Your original text is kept."),
          ).pipe(Effect.asVoid);
    });
    yield* client.raw.request("turn/start", {
      threadId: thread.id,
      effort:
        getModelSelectionStringOptionValue(request.modelSelection, "reasoningEffort") ?? "low",
      input: [{ type: "text", text: request.prompt, text_elements: [] }],
      outputSchema: toJsonSchemaObject(request.outputSchema),
    });
    const text = yield* Effect.raceFirst(
      Deferred.await(done),
      client.awaitTermination.pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: request.operation,
              detail: "The isolated draft session disconnected.",
              cause,
            }),
        ),
      ),
    );
    return yield* TextGenerationOperations.decodeJsonReply(request, "Codex", text);
  },
  Effect.scoped,
  Effect.mapError((cause) =>
    isTextGenerationError(cause)
      ? cause
      : new TextGenerationError({
          operation: "generateReplyDraft",
          detail: "The isolated Codex draft could not finish. No fallback model was used.",
          cause,
        }),
  ),
  Effect.timeoutOrElse({
    duration: "180 seconds",
    orElse: () =>
      Effect.fail(
        new TextGenerationError({
          operation: "generateReplyDraft",
          detail: "The isolated draft timed out.",
        }),
      ),
  }),
);
