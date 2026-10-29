import {
  ArkFeatureError,
  type ArkFeatureSnapshot,
  type ArkSetAgentPaused,
  ArkKnowledgeResult,
  type ArkKnowledgeQuery,
  type ArkMutation,
  type ArkMutationResult,
  type ArkSourceRequest,
  ArkSourceResult,
  ArkComputerResult,
  ArkVoiceResult,
  ArkAgentAccessResult,
  type ArkAgentAccessInput,
  type ArkVoiceInput,
  type ArkComputerInput,
  type ArkComputerConfig,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Deferred from "effect/Deferred";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as Crypto from "effect/Crypto";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

const ComputerNativeEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("ark.computer.progress"),
    request: Schema.String,
    action: Schema.String,
    app: Schema.optionalKey(Schema.String),
    current: Schema.optionalKey(Schema.Number),
    total: Schema.optionalKey(Schema.Number),
  }),
  Schema.Struct({
    type: Schema.Literal("ark.computer.approval"),
    request: Schema.String,
    id: Schema.String,
    summary: Schema.String,
    reason: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("ark.computer.decision"),
    request: Schema.String,
    id: Schema.String,
    state: Schema.String,
    criteria: Schema.Record(Schema.String, Schema.String),
  }),
]);
export type ArkComputerNativeEvent = typeof ComputerNativeEvent.Type;
const decodeComputerEvent = Schema.decodeUnknownEffect(ComputerNativeEvent);
const decodeAgentAccessResult = Schema.decodeUnknownEffect(ArkAgentAccessResult);
const decodeVoiceResult = Schema.decodeUnknownEffect(ArkVoiceResult);
const decodeComputerResult = Schema.decodeUnknownEffect(ArkComputerResult);

export class ArkFeatures extends Context.Service<
  ArkFeatures,
  {
    readonly agentAccess: (
      input: ArkAgentAccessInput,
    ) => Effect.Effect<ArkAgentAccessResult, ArkFeatureError>;
    readonly voice: (input: ArkVoiceInput) => Effect.Effect<ArkVoiceResult, ArkFeatureError>;
    readonly cancelVoice: (requestId: string) => Effect.Effect<void>;
    readonly computerEvents: Stream.Stream<ArkComputerNativeEvent>;
    readonly computerBlocked: Effect.Effect<boolean>;
    readonly runComputer: (input: {
      request: string;
      session: string;
      input: ArkComputerInput;
      config: ArkComputerConfig;
    }) => Effect.Effect<ArkComputerResult, ArkFeatureError>;
    readonly signalComputer: (command: object) => Effect.Effect<void>;
    readonly changes: Stream.Stream<ArkFeatureSnapshot>;
    readonly setAgentPaused: (
      input: ArkSetAgentPaused,
    ) => Effect.Effect<ArkFeatureSnapshot, ArkFeatureError>;
    readonly snapshot: Effect.Effect<ArkFeatureSnapshot>;
    readonly readKnowledge: (
      query: ArkKnowledgeQuery,
    ) => Effect.Effect<ArkKnowledgeResult, ArkFeatureError>;
    readonly source: (input: ArkSourceRequest) => Effect.Effect<ArkSourceResult, ArkFeatureError>;
    readonly mutate: (input: ArkMutation) => Effect.Effect<ArkMutationResult, ArkFeatureError>;
  }
>()("t3/ark/ArkFeatures") {}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const rows = (value: unknown) => (Array.isArray(value) ? value.map(record) : []);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const projectAgents = (value: unknown): ArkFeatureSnapshot["agents"] =>
  rows(value).map((agent) => {
    const soul = record(agent.soul);
    return {
      id: text(agent.id),
      name: text(agent.name),
      role: text(agent.role),
      available: agent.available !== false,
      paused: agent.paused === true,
      kit: agent.kit === "folders" || agent.kit === "research" ? agent.kit : "think",
      custom: agent.custom === true,
      soul: {
        name: text(soul.name),
        personality: text(soul.personality),
        howItWorks: text(soul.howItWorks),
        rules: text(soul.rules),
        lessons: text(soul.lessons),
      },
      soulVersion: number(agent.soulVersion),
      skills: strings(agent.skills),
      grants: strings(agent.grants),
      jobs: rows(agent.jobs).map((job) => ({
        id: number(job.id),
        title: text(job.title) || text(job.task),
        state: text(job.state),
      })),
    };
  });
const projectNotes = (value: unknown) =>
  rows(value)
    .filter((note) => note.ghost !== true)
    .map((note) => ({ id: number(note.id), title: text(note.title) }));

const decodeEvent = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeKnowledge = Schema.decodeUnknownEffect(ArkKnowledgeResult);
const decodeSource = Schema.decodeUnknownEffect(ArkSourceResult);

const make = Effect.gen(function* () {
  const env = yield* HostProcess.Environment;
  const executable = env.ARK_NODE_PATH ?? (yield* HostProcess.ExecutablePath);
  const root = env.ARK_BACKEND_ROOT?.trim();
  const initial: ArkFeatureSnapshot = {
    status: root ? "starting" : "disabled",
    message: root
      ? "Starting ARK features…"
      : "Start this checkout with pnpm ark:dev to connect its ATOM features.",
    agents: [],
    memories: [],
    notes: [],
    skills: [],
    briefs: [],
  };
  const state = yield* SubscriptionRef.make(initial);
  const input = yield* Queue.unbounded<Uint8Array>();
  const crypto = yield* Crypto.Crypto;
  const knowledgeRequests = yield* Ref.make(
    new Map<string, Deferred.Deferred<unknown, ArkFeatureError>>(),
  );
  const computerEvents = yield* PubSub.unbounded<ArkComputerNativeEvent>();
  const voiceRequests = yield* Ref.make<ReadonlySet<string>>(new Set());
  const computerRequests = yield* Ref.make<ReadonlySet<string>>(new Set());
  const computerBlocked = yield* Ref.make(false);
  const actionLock = yield* Semaphore.make(1);
  const pending = yield* Ref.make<{
    agent: string;
    paused: boolean;
    done: Deferred.Deferred<ArkFeatureSnapshot, ArkFeatureError>;
  } | null>(null);
  const send = (command: object) =>
    Queue.offer(input, new TextEncoder().encode(`${JSON.stringify(command)}\n`));
  const failRequests = Effect.fn("ArkFeatures.failRequests")(function* () {
    if ((yield* Ref.get(computerRequests)).size) yield* Ref.set(computerBlocked, true);
    const error = new ArkFeatureError({
      message:
        "The feature runtime disconnected. Reopen the workspace to check saved state before retrying.",
    });
    for (const waiting of (yield* Ref.get(knowledgeRequests)).values())
      yield* Deferred.fail(waiting, error);
    const action = yield* Ref.get(pending);
    if (action) yield* Deferred.fail(action.done, error);
  });
  yield* Effect.addFinalizer(() => failRequests());
  if (root) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const program = Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make(
          executable,
          [
            "--env-file-if-exists=.env",
            "--disable-warning=ExperimentalWarning",
            "apps/mac/src/main.ts",
            "--features",
          ],
          {
            cwd: root,
            env: {
              ...env,
              ELECTRON_RUN_AS_NODE: "1",
              ATOM_MEMORY_FILE: "data/memory.db",
              ATOM_HELPERS_FILE: "data/helpers.db",
              ATOM_ISLAND_SETTINGS: "config/ark-features.json",
            },
            stdin: Stream.fromQueue(input),
            stdout: "pipe",
            stderr: "pipe",
            forceKillAfter: "15 seconds",
          },
        ),
      );
      const consume = Effect.fn("ArkFeatures.consume")(function* (line: string) {
        const value = yield* decodeEvent(line).pipe(Effect.orElseSucceed(() => undefined));
        const event = record(value);
        if (
          typeof event.type === "string" &&
          event.type.startsWith("ark.computer.") &&
          event.type !== "ark.computer.result"
        ) {
          yield* decodeComputerEvent(event).pipe(
            Effect.matchEffect({
              onFailure: () => Effect.void,
              onSuccess: (event) => PubSub.publish(computerEvents, event).pipe(Effect.asVoid),
            }),
          );
          return;
        }
        if (
          (event.type === "ark.knowledge.result" ||
            event.type === "ark.mutation.result" ||
            event.type === "ark.computer.result" ||
            event.type === "ark.voice.result" ||
            event.type === "ark.agent.access.result" ||
            event.type === "brain.source") &&
          typeof event.request === "string"
        ) {
          const waiting = (yield* Ref.get(knowledgeRequests)).get(event.request);
          if (!waiting) return;
          if (event.type === "brain.source") yield* Deferred.succeed(waiting, event);
          else if (typeof event.error === "string")
            yield* Deferred.fail(waiting, new ArkFeatureError({ message: event.error }));
          else yield* Deferred.succeed(waiting, event.value);
          return;
        }
        if (event.type === "ready") {
          for (const command of ["helpers.list", "memory.list", "brain.get", "brief.get"])
            yield* send({ type: command });
          return;
        }
        if (event.type === "helpers")
          yield* SubscriptionRef.update(state, (current) => ({
            ...current,
            status: "ready" as const,
            message: "Workspace connected",
            agents: projectAgents(event.helpers),
            skills: rows(event.skills).map((skill) => ({
              name: text(skill.name),
              description: text(skill.description),
              source: text(skill.source),
            })),
          }));
        if (event.type === "helpers") {
          const waiting = yield* Ref.get(pending);
          const current = yield* SubscriptionRef.get(state);
          if (
            waiting &&
            current.agents.some(
              (agent) => agent.id === waiting.agent && agent.paused === waiting.paused,
            )
          )
            yield* Deferred.succeed(waiting.done, current);
        }
        if (event.type === "memory")
          yield* SubscriptionRef.update(state, (current) => ({
            ...current,
            memories: rows(event.memories).map((memory) => ({
              id: number(memory.id),
              text: text(memory.text),
            })),
          }));
        if (event.type === "brain")
          yield* SubscriptionRef.update(state, (current) => ({
            ...current,
            notes: projectNotes(event.nodes),
          }));
        if (event.type === "brief")
          yield* SubscriptionRef.update(state, (current) => ({
            ...current,
            briefs: rows(event.history).map((brief) => ({
              id: number(brief.id),
              day: text(brief.day),
              lines: Array.isArray(brief.lines)
                ? brief.lines.filter((line): line is string => typeof line === "string")
                : [],
            })),
          }));
        if (event.type === "error")
          yield* SubscriptionRef.update(state, (current) => ({
            ...current,
            message: text(event.message) || "An ARK feature reported an error.",
          }));
        if (event.type === "error") {
          const waiting = yield* Ref.get(pending);
          if (waiting)
            yield* Deferred.fail(
              waiting.done,
              new ArkFeatureError({ message: text(event.message) || "The agent change failed." }),
            );
        }
      });
      yield* child.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runForEach(consume),
        Effect.forkScoped,
      );
      yield* child.stderr.pipe(Stream.runDrain, Effect.forkScoped);
      const exit = yield* child.exitCode;
      yield* failRequests();
      yield* SubscriptionRef.update(state, (current) => ({
        ...current,
        status: "unavailable" as const,
        message: `ARK's feature runtime stopped (exit ${exit}). Chat remains available. Restart ARK to reconnect features.`,
      }));
    });
    yield* program.pipe(
      Effect.catch(() =>
        failRequests().pipe(
          Effect.andThen(
            SubscriptionRef.update(state, (current) => ({
              ...current,
              status: "unavailable" as const,
              message:
                "ARK could not start its feature runtime. Check the backend dependencies and data ownership, then restart.",
            })),
          ),
        ),
      ),
      Effect.forkScoped,
    );
  }
  const setAgentPaused = Effect.fn("ArkFeatures.setAgentPaused")(function* (
    change: ArkSetAgentPaused,
  ) {
    const current = yield* SubscriptionRef.get(state);
    const agent = current.agents.find((agent) => agent.id === change.agent);
    if (current.status !== "ready" || !agent)
      return yield* new ArkFeatureError({
        message: "This agent is unavailable. Reconnect the workspace before changing it.",
      });
    if (agent.paused === change.paused) return current;
    const done = yield* Deferred.make<ArkFeatureSnapshot, ArkFeatureError>();
    yield* Ref.set(pending, { ...change, done });
    yield* send({ type: "agent.pause", id: change.agent, paused: change.paused });
    return yield* Deferred.await(done).pipe(
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () =>
          Effect.fail(
            new ArkFeatureError({
              message:
                "The change was sent, but its saved state was not confirmed. Check the Board before trying again.",
            }),
          ),
      }),
      Effect.ensuring(Ref.set(pending, null)),
    );
  }, actionLock.withPermits(1));
  const requestFeature = Effect.fn("ArkFeatures.requestFeature")(function* (
    type: "ark.knowledge" | "ark.mutate" | "brain.source" | "ark.agent.access",
    input: ArkKnowledgeQuery | ArkMutation | ArkSourceRequest | ArkAgentAccessInput,
  ) {
    if ((yield* SubscriptionRef.get(state)).status !== "ready")
      return yield* new ArkFeatureError({ message: "Workspace features are not connected." });
    const request = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
    const done = yield* Deferred.make<unknown, ArkFeatureError>();
    yield* Ref.update(knowledgeRequests, (current) => new Map(current).set(request, done));
    yield* send(type === "brain.source" ? { type, request, ...input } : { type, request, input });
    return yield* Deferred.await(done).pipe(
      Effect.timeoutOrElse({
        duration: type === "brain.source" ? "60 seconds" : "10 seconds",
        orElse: () =>
          Effect.fail(
            new ArkFeatureError({
              message:
                type !== "ark.knowledge"
                  ? "The change was sent but its saved state was not confirmed. Reopen the editor before retrying."
                  : "Workspace knowledge did not respond. Try again after reconnecting.",
            }),
          ),
      }),
      Effect.ensuring(
        Ref.update(knowledgeRequests, (current) => {
          const next = new Map(current);
          next.delete(request);
          return next;
        }),
      ),
    );
  });
  const readKnowledge = Effect.fn("ArkFeatures.readKnowledge")(function* (
    query: ArkKnowledgeQuery,
  ) {
    const value = yield* requestFeature("ark.knowledge", query);
    return yield* decodeKnowledge(value).pipe(
      Effect.mapError(
        () =>
          new ArkFeatureError({ message: "The workspace returned an invalid knowledge response." }),
      ),
    );
  });
  const mutate = Effect.fn("ArkFeatures.mutate")(function* (input: ArkMutation) {
    const value = record(yield* requestFeature("ark.mutate", input));
    if (typeof value.entityId !== "string")
      return yield* new ArkFeatureError({
        message: "The saved change could not be confirmed. Reopen the editor before retrying.",
      });
    yield* SubscriptionRef.update(state, (current) => ({
      ...current,
      ...(Array.isArray(value.agents) ? { agents: projectAgents(value.agents) } : {}),
      ...(Array.isArray(value.notes) ? { notes: projectNotes(value.notes) } : {}),
    }));
    return { snapshot: yield* SubscriptionRef.get(state), entityId: value.entityId };
  }, actionLock.withPermits(1));
  const source = Effect.fn("ArkFeatures.source")(function* (input: ArkSourceRequest) {
    const value = yield* requestFeature("brain.source", input);
    return yield* decodeSource(value).pipe(
      Effect.mapError(
        () =>
          new ArkFeatureError({
            message:
              "The source operation returned an invalid response. Check its current state before retrying.",
          }),
      ),
    );
  }, actionLock.withPermits(1));
  const stopComputer = Effect.fn("ArkFeatures.stopComputer")(function* (
    request: string,
    done: Deferred.Deferred<unknown, ArkFeatureError>,
  ) {
    yield* send({ type: "ark.computer.cancel", request });
    const confirmed = yield* Deferred.await(done).pipe(
      Effect.match({ onFailure: () => true, onSuccess: () => true }),
      Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => Effect.succeed(false) }),
    );
    if (!confirmed) yield* Ref.set(computerBlocked, true);
  });
  const runComputer = Effect.fn("ArkFeatures.runComputer")(function* (command: {
    request: string;
    session: string;
    input: ArkComputerInput;
    config: ArkComputerConfig;
  }) {
    if ((yield* SubscriptionRef.get(state)).status !== "ready" || (yield* Ref.get(computerBlocked)))
      return yield* new ArkFeatureError({
        message:
          "Computer control is disconnected or its last Stop was not confirmed. Restart ARK before continuing.",
      });
    const done = yield* Deferred.make<unknown, ArkFeatureError>();
    yield* Ref.update(knowledgeRequests, (current) => new Map(current).set(command.request, done));
    yield* Ref.update(computerRequests, (current) => new Set([...current, command.request]));
    yield* send({
      type: "ark.computer.run",
      request: command.request,
      session: command.session,
      input: command.input,
      mode: command.config.mode,
      provider: command.config.provider,
      backup: command.config.backup,
    });
    return yield* Deferred.await(done).pipe(
      Effect.flatMap((value) =>
        decodeComputerResult(value).pipe(
          Effect.mapError(
            () =>
              new ArkFeatureError({
                message:
                  "The computer returned an invalid result. Observe the window before continuing.",
              }),
          ),
        ),
      ),
      Effect.onInterrupt(() => stopComputer(command.request, done)),
      Effect.ensuring(
        Effect.all([
          Ref.update(knowledgeRequests, (current) => {
            const next = new Map(current);
            next.delete(command.request);
            return next;
          }),
          Ref.update(computerRequests, (current) => {
            const next = new Set(current);
            next.delete(command.request);
            return next;
          }),
        ]).pipe(Effect.asVoid),
      ),
    );
  });
  const agentAccess = Effect.fn("ArkFeatures.agentAccess")(function* (input: ArkAgentAccessInput) {
    const value = record(yield* requestFeature("ark.agent.access", input));
    const result = yield* decodeAgentAccessResult(value).pipe(
      Effect.mapError(
        () =>
          new ArkFeatureError({
            message: "The access change could not be confirmed. Reload access before trying again.",
          }),
      ),
    );
    if (Array.isArray(value.agents))
      yield* SubscriptionRef.update(state, (current) => ({
        ...current,
        agents: projectAgents(value.agents),
      }));
    return result;
  }, actionLock.withPermits(1));
  const cancelVoice = Effect.fn("ArkFeatures.cancelVoice")((requestId: string) =>
    send({ type: "ark.voice.cancel", request: requestId }).pipe(Effect.asVoid),
  );
  const voice = Effect.fn("ArkFeatures.voice")(function* (input: ArkVoiceInput) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if ((yield* SubscriptionRef.get(state)).status !== "ready")
          return yield* new ArkFeatureError({
            message: "Local voice is unavailable while workspace features are disconnected.",
          });
        const accepted = yield* Ref.modify(voiceRequests, (current) =>
          current.has(input.requestId) || current.size >= 2
            ? [false, current]
            : [true, new Set([...current, input.requestId])],
        );
        if (!accepted)
          return yield* new ArkFeatureError({
            message: "Voice is already processing. Stop it or wait for it to finish.",
          });
        const done = yield* Deferred.make<unknown, ArkFeatureError>();
        yield* Ref.update(knowledgeRequests, (current) =>
          new Map(current).set(input.requestId, done),
        );
        yield* send({ type: "ark.voice.run", request: input.requestId, input });
        return yield* restore(
          Deferred.await(done).pipe(
            Effect.flatMap((value) =>
              decodeVoiceResult(value).pipe(
                Effect.mapError(
                  () =>
                    new ArkFeatureError({ message: "Local voice returned an invalid response." }),
                ),
              ),
            ),
            Effect.timeoutOrElse({
              duration: "125 seconds",
              orElse: () =>
                Effect.fail(
                  new ArkFeatureError({
                    message:
                      "Local voice reached its processing deadline. Nothing was sent to chat.",
                  }),
                ),
            }),
          ),
        ).pipe(
          Effect.ensuring(
            Effect.all([
              cancelVoice(input.requestId),
              Ref.update(voiceRequests, (current) => {
                const next = new Set(current);
                next.delete(input.requestId);
                return next;
              }),
              Ref.update(knowledgeRequests, (current) => {
                const next = new Map(current);
                next.delete(input.requestId);
                return next;
              }),
            ]).pipe(Effect.asVoid),
          ),
        );
      }),
    );
  });
  return ArkFeatures.of({
    agentAccess,
    voice,
    cancelVoice,
    computerEvents: Stream.fromPubSub(computerEvents),
    computerBlocked: Ref.get(computerBlocked),
    runComputer,
    signalComputer: Effect.fn("ArkFeatures.signalComputer")((command: object) =>
      send(command).pipe(Effect.asVoid),
    ),
    changes: SubscriptionRef.changes(state),
    setAgentPaused,
    snapshot: SubscriptionRef.get(state),
    readKnowledge,
    mutate,
    source,
  });
});

export const layer = Layer.effect(ArkFeatures, make);
