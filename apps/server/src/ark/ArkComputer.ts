import {
  ArkComputerConfig,
  ArkComputerState,
  ArkFeatureError,
  type ArkComputerInput,
  type ArkComputerResult,
  type ArkComputerSettingsInput,
  type ProviderInstanceId,
  type ThreadId,
  type RunId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Features from "./ArkFeatures.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Secrets from "../auth/ServerSecretStore.ts";
import { chooseJev } from "./ArkComputerJev.ts";

export interface ComputerCaller {
  readonly threadId: ThreadId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly providerSessionId: string;
}
const Prefs = Schema.Struct({
  config: ArkComputerConfig,
  allowedThreads: Schema.Array(Schema.String),
});
const decodePrefs = Schema.decodeEffect(Schema.fromJsonString(Prefs));
const encodePrefs = Schema.encodeEffect(Schema.fromJsonString(Prefs));
const defaults: ArkComputerConfig = {
  enabled: false,
  mode: "background",
  provider: "off",
  backup: false,
};
const readonlyActions = new Set(["status", "list_apps", "windows", "look"]);
export class ArkComputer extends Context.Service<
  ArkComputer,
  {
    readonly changes: Stream.Stream<ArkComputerState>;
    readonly configure: (
      input: ArkComputerSettingsInput,
    ) => Effect.Effect<ArkComputerState, ArkFeatureError>;
    readonly execute: (
      caller: ComputerCaller,
      input: ArkComputerInput,
    ) => Effect.Effect<ArkComputerResult, ArkFeatureError>;
    readonly answer: (input: {
      request: string;
      id: string;
      approved: boolean;
    }) => Effect.Effect<void, ArkFeatureError>;
    readonly stop: (request: string) => Effect.Effect<void>;
  }
>()("t3/ark/ArkComputer") {}

const make = Effect.gen(function* () {
  const features = yield* Features.ArkFeatures;
  const threads = yield* Threads.ThreadManagementService;
  const secrets = yield* Secrets.ServerSecretStore;
  const crypto = yield* Crypto.Crypto;
  const saved: typeof Prefs.Type = yield* secrets.get("ark-computer-config").pipe(
    Effect.flatMap((value) =>
      Option.isSome(value)
        ? decodePrefs(new TextDecoder().decode(value.value)).pipe(
            Effect.orElseSucceed(() => ({ config: defaults, allowedThreads: [] })),
          )
        : Effect.succeed({ config: defaults, allowedThreads: [] }),
    ),
    Effect.orElseSucceed(() => ({ config: defaults, allowedThreads: [] })),
  );
  const prefs = yield* Ref.make(saved);
  const key = yield* secrets.get("ark-jev-key").pipe(Effect.orElseSucceed(() => Option.none()));
  const state = yield* SubscriptionRef.make<ArkComputerState>({
    config: saved.config,
    hasJevKey: Option.isSome(key),
    message: "Computer use starts only when requested. No idle capture.",
    active: null,
  });
  const lock = yield* Semaphore.make(1);
  const deniedTurns = yield* Ref.make<ReadonlySet<string>>(new Set());
  const turnKey = (caller: ComputerCaller, runId: RunId) =>
    `${caller.threadId}/${caller.providerSessionId}/${runId}`;
  const sessions = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
  const active = yield* Ref.make<{
    caller: ComputerCaller;
    runId: RunId;
    request: string;
    stop: Deferred.Deferred<void>;
    grant?: { id: string; done: Deferred.Deferred<boolean> };
  } | null>(null);
  const persist = Effect.fn("ArkComputer.persist")(function* (next: typeof saved) {
    const text = yield* encodePrefs(next).pipe(Effect.orDie);
    yield* secrets.set("ark-computer-config", new TextEncoder().encode(text)).pipe(
      Effect.mapError(
        () =>
          new ArkFeatureError({
            message: "Computer settings could not be saved. No new access was granted.",
          }),
      ),
    );
    yield* Ref.set(prefs, next);
  });
  const stillActive = Effect.fn("ArkComputer.stillActive")(function* (
    caller: ComputerCaller,
    runId: RunId,
    action: string,
  ) {
    const shell = yield* threads
      .getThreadShell(caller.threadId)
      .pipe(
        Effect.mapError(
          () => new ArkFeatureError({ message: "The calling chat could not be checked." }),
        ),
      );
    const records = yield* threads
      .getThreadRecords(caller.threadId, ["providerThreads"])
      .pipe(
        Effect.mapError(
          () => new ArkFeatureError({ message: "The provider session could not be checked." }),
        ),
      );
    const currentProvider = records.providerThreads.find(
      (value) => value.id === shell?.activeProviderThreadId,
    );
    return (
      currentProvider?.providerSessionId === caller.providerSessionId &&
      shell !== null &&
      shell.deletedAt === null &&
      shell.archivedAt === null &&
      shell.activeRunId === runId &&
      shell.providerInstanceId === caller.providerInstanceId &&
      shell.latestRunStopRequested !== true &&
      (shell.interactionMode !== "plan" || readonlyActions.has(action))
    );
  });
  const stop = Effect.fn("ArkComputer.stop")(function* (request: string) {
    const current = yield* Ref.get(active);
    if (current?.request !== request) return;
    yield* SubscriptionRef.update(state, (value) => ({
      ...value,
      message: "Stopping computer input…",
      active: value.active ? { ...value.active, phase: "stopping" as const, approval: null } : null,
    }));
    yield* Deferred.succeed(current.stop, undefined);
  });
  const answer = Effect.fn("ArkComputer.answer")(function* (input: {
    request: string;
    id: string;
    approved: boolean;
  }) {
    const current = yield* Ref.get(active);
    if (!current || current.request !== input.request)
      return yield* new ArkFeatureError({ message: "This computer request has already ended." });
    if (!input.approved)
      yield* Ref.update(
        deniedTurns,
        (value) => new Set([...value, turnKey(current.caller, current.runId)].slice(-256)),
      );
    const allowed =
      input.approved &&
      (yield* stillActive(
        current.caller,
        current.runId,
        (yield* SubscriptionRef.get(state)).active?.action ?? "",
      ));
    if (current.grant?.id === input.id) yield* Deferred.succeed(current.grant.done, allowed);
    else {
      const shown = (yield* SubscriptionRef.get(state)).active?.approval;
      if (!shown || shown.id !== input.id || shown.kind !== "action")
        return yield* new ArkFeatureError({ message: "This approval is no longer pending." });
      yield* features.signalComputer({
        type: "ark.computer.answer",
        request: current.request,
        id: input.id,
        approved: allowed,
      });
    }
    yield* SubscriptionRef.update(state, (value) => ({
      ...value,
      active: value.active ? { ...value.active, phase: "running" as const, approval: null } : null,
    }));
  });
  const configure = Effect.fn("ArkComputer.configure")(function* (input: ArkComputerSettingsInput) {
    if ((yield* Ref.get(active)) !== null)
      return yield* new ArkFeatureError({
        message: "Stop the current computer action before changing its settings.",
      });
    if (input.removeKey && input.jevKey)
      return yield* new ArkFeatureError({ message: "Choose either saving or removing a Jev key." });
    if (
      input.jevKey !== undefined &&
      (!input.jevKey.trim() || /[\r\n]/.test(input.jevKey) || input.jevKey.length > 4096)
    )
      return yield* new ArkFeatureError({ message: "Enter a valid Jev key." });
    let hasJevKey = input.removeKey
      ? false
      : input.jevKey !== undefined || (yield* SubscriptionRef.get(state)).hasJevKey;
    if (input.config.provider === "jev" && !hasJevKey)
      return yield* new ArkFeatureError({
        message: "Add a Jev key, or choose another decision provider.",
      });
    if (input.jevKey !== undefined) {
      yield* secrets
        .set("ark-jev-key", new TextEncoder().encode(input.jevKey.trim()))
        .pipe(
          Effect.mapError(
            () => new ArkFeatureError({ message: "The Jev key could not be saved." }),
          ),
        );
      hasJevKey = true;
    }
    if (input.removeKey) {
      yield* secrets
        .remove("ark-jev-key")
        .pipe(
          Effect.mapError(
            () => new ArkFeatureError({ message: "The Jev key could not be removed." }),
          ),
        );
      hasJevKey = false;
    }

    yield* persist({
      config: input.config,
      allowedThreads: input.forgetGrants ? [] : (yield* Ref.get(prefs)).allowedThreads,
    });
    yield* SubscriptionRef.update(state, (value) => ({
      ...value,
      config: input.config,
      hasJevKey,
      message: "Computer settings saved.",
    }));
    return yield* SubscriptionRef.get(state);
  }, lock.withPermits(1));
  const execute = Effect.fn("ArkComputer.execute")(function* (
    caller: ComputerCaller,
    input: ArkComputerInput,
  ) {
    if (!(yield* Ref.get(prefs)).config.enabled)
      return yield* new ArkFeatureError({
        message: "Computer use is off. The user can enable it in Workspace → Computer.",
      });
    if (yield* features.computerBlocked)
      return yield* new ArkFeatureError({
        message: "The last computer Stop was not confirmed. Restart ARK before sending more input.",
      });
    const sequence = yield* threads
      .getThreadEventSequence(caller.threadId)
      .pipe(
        Effect.mapError(
          () => new ArkFeatureError({ message: "The calling chat could not be checked." }),
        ),
      );
    const shell = yield* threads
      .getThreadShell(caller.threadId)
      .pipe(
        Effect.mapError(
          () => new ArkFeatureError({ message: "The calling chat could not be checked." }),
        ),
      );
    if (!shell?.activeRunId || !(yield* stillActive(caller, shell.activeRunId, input.action)))
      return yield* new ArkFeatureError({
        message:
          "Computer use requires this chat's current live turn; planning mode cannot send input.",
      });
    if (
      input.action !== "status" &&
      (yield* Ref.get(deniedTurns)).has(turnKey(caller, shell.activeRunId))
    )
      return yield* new ArkFeatureError({
        message:
          "The user declined computer access or an action in this turn. Stop computer work and wait for a new user request.",
      });
    const request = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
    const stopped = yield* Deferred.make<void>();
    const accepted = yield* lock.withPermits(1)(
      Effect.gen(function* () {
        if (!(yield* Ref.get(prefs)).config.enabled)
          return yield* new ArkFeatureError({
            message: "Computer use was turned off before this action started.",
          });
        return yield* Ref.modify(active, (current) =>
          current
            ? [false, current]
            : [true, { caller, runId: shell.activeRunId!, request, stop: stopped }],
        );
      }),
    );
    if (!accepted)
      return yield* new ArkFeatureError({
        message:
          "Another computer action is still running. Wait for its result; do not replay input.",
      });
    yield* SubscriptionRef.update(state, (value) => ({
      ...value,
      message: "Computer action requested",
      active: {
        request,
        threadId: caller.threadId,
        title: shell.title,
        action: input.action,
        phase: "running" as const,
        approval: null,
      },
    }));
    const sessionKey = turnKey(caller, shell.activeRunId);
    const work = Effect.gen(function* () {
      if (
        input.action !== "status" &&
        !(yield* Ref.get(prefs)).allowedThreads.includes(caller.threadId)
      ) {
        const id = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
        const done = yield* Deferred.make<boolean>();
        yield* Ref.update(active, (value) => (value ? { ...value, grant: { id, done } } : null));
        yield* SubscriptionRef.update(state, (value) => ({
          ...value,
          active: value.active
            ? {
                ...value.active,
                phase: "approval" as const,
                approval: {
                  id,
                  kind: "grant" as const,
                  summary: "Allow this chat to read and control apps?",
                  reason:
                    "Window observations may include private content. Access is remembered for this chat; sensitive actions still require approval. Revoke remembered access in Computer settings.",
                },
              }
            : null,
        }));
        const granted = yield* Deferred.await(done).pipe(
          Effect.timeoutOrElse({ duration: "60 seconds", orElse: () => Effect.succeed(false) }),
        );
        if (!granted) {
          yield* Ref.update(deniedTurns, (value) => new Set([...value, sessionKey].slice(-256)));
          return yield* new ArkFeatureError({
            message: "Computer access was declined or timed out. No desktop action was performed.",
          });
        }
        yield* lock.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* Ref.get(prefs);
            yield* persist({
              ...current,
              allowedThreads: [...new Set([...current.allowedThreads, caller.threadId])],
            });
          }),
        );
        yield* Ref.update(active, (value) =>
          value
            ? { caller: value.caller, runId: value.runId, request: value.request, stop: value.stop }
            : null,
        );
      }
      if (!(yield* stillActive(caller, shell.activeRunId!, input.action)))
        return yield* new ArkFeatureError({
          message: "The calling turn stopped before its computer action started.",
        });
      let session = (yield* Ref.get(sessions)).get(sessionKey);
      if (!session) {
        session = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
        yield* Ref.update(
          sessions,
          (current) => new Map([...current, [sessionKey, session!] as const].slice(-128)),
        );
      }
      return yield* features.runComputer({
        request,
        session,
        input,
        config: (yield* Ref.get(prefs)).config,
      });
    });
    const watch = threads
      .streamStoredEventsFrom({ threadId: caller.threadId, afterSequence: sequence })
      .pipe(
        Stream.mapEffect(() => stillActive(caller, shell.activeRunId!, input.action)),
        Stream.filter((valid) => !valid),
        Stream.runHead,
        Effect.flatMap(() =>
          Effect.fail(
            new ArkFeatureError({
              message:
                "The calling chat stopped or changed. Computer input was cancelled; observe the window before continuing.",
            }),
          ),
        ),
        Effect.mapError(
          () =>
            new ArkFeatureError({
              message:
                "The calling chat stopped or its state could not be checked. Computer input was cancelled.",
            }),
        ),
      );
    return yield* Effect.raceFirst(
      work,
      Effect.raceFirst(
        watch,
        Deferred.await(stopped).pipe(
          Effect.andThen(
            Effect.fail(
              new ArkFeatureError({
                message:
                  "Computer action stopped. Its last input may already have happened; look again before continuing.",
              }),
            ),
          ),
        ),
      ),
    ).pipe(
      Effect.timeoutOrElse({
        duration: "180 seconds",
        orElse: () =>
          Effect.fail(
            new ArkFeatureError({
              message:
                "Computer action timed out. Its last input may already have happened; do not replay it automatically.",
            }),
          ),
      }),
      Effect.onError(() =>
        Ref.update(sessions, (current) => {
          const next = new Map(current);
          next.delete(sessionKey);
          return next;
        }),
      ),
      Effect.ensuring(
        Effect.gen(function* () {
          const blocked = yield* features.computerBlocked;
          yield* SubscriptionRef.update(state, (value) => ({
            ...value,
            message: blocked
              ? "Stop was not confirmed. Restart ARK before using the computer again."
              : "Action ended. Review its returned observation; a changed screen alone does not prove success.",
            active:
              blocked && value.active
                ? { ...value.active, phase: "blocked" as const, approval: null }
                : null,
          }));
          yield* Ref.set(active, null);
        }),
      ),
      Effect.scoped,
    );
  });
  yield* features.computerEvents.pipe(
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(active);
        if (!current || current.request !== event.request) return;
        if (event.type === "ark.computer.progress")
          yield* SubscriptionRef.update(state, (value) => ({
            ...value,
            message: event.app ? `${event.action} · ${event.app}` : event.action,
          }));
        if (event.type === "ark.computer.approval")
          yield* SubscriptionRef.update(state, (value) => ({
            ...value,
            active: value.active
              ? {
                  ...value.active,
                  phase: "approval" as const,
                  approval: {
                    id: event.id,
                    kind: "action" as const,
                    summary: event.summary,
                    reason: event.reason,
                  },
                }
              : null,
          }));
        if (event.type === "ark.computer.decision") {
          const config = (yield* Ref.get(prefs)).config;
          const answer =
            config.provider === "jev"
              ? yield* chooseJev(event.state, event.criteria).pipe(
                  Effect.provideService(Secrets.ServerSecretStore, secrets),
                )
              : undefined;
          if ((yield* Ref.get(active))?.request === current.request)
            yield* features.signalComputer({
              type: "ark.computer.decision.answer",
              request: event.request,
              id: event.id,
              ...(answer ? { answer } : {}),
            });
        }
      }),
    ),
    Effect.forkScoped,
  );
  return ArkComputer.of({
    changes: SubscriptionRef.changes(state),
    configure,
    execute,
    answer,
    stop,
  });
});
export const layer = Layer.effect(ArkComputer, make);
