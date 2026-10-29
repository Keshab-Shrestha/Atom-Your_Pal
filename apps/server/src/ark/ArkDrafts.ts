import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import { ArkFeatureError, type ArkDraftInput, type ArkDraftContextItem } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as ArkFeatures from "./ArkFeatures.ts";
import * as ProviderInstances from "../provider/ProviderInstanceRegistry.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";

export class ArkDrafts extends Context.Service<
  ArkDrafts,
  {
    readonly lookup: (
      query: string,
    ) => Effect.Effect<{ items: readonly ArkDraftContextItem[] }, ArkFeatureError>;
    readonly generate: (
      input: ArkDraftInput,
    ) => Effect.Effect<
      { text: string; modelSelection: ArkDraftInput["modelSelection"] },
      ArkFeatureError
    >;
    readonly cancel: (requestId: string) => Effect.Effect<void>;
  }
>()("t3/ark/ArkDrafts") {}

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const make = Effect.gen(function* () {
  const features = yield* ArkFeatures.ArkFeatures;
  const providers = yield* ProviderInstances.ProviderInstanceRegistry;
  const writer = yield* TextGeneration.TextGeneration;
  const fs = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const makeItem = Effect.fn("ArkDrafts.contextItem")(function* (
    id: string,
    title: string,
    body: string,
    version: string,
    source?: string,
  ) {
    const digest = yield* crypto
      .digest(
        "SHA-256",
        new TextEncoder().encode(encodeJson([id, title, body, version, source ?? null])),
      )
      .pipe(
        Effect.mapError(
          () => new ArkFeatureError({ message: "Draft context could not be checked." }),
        ),
      );
    return {
      id,
      title,
      text: body.slice(0, 3500),
      truncated: body.length > 3500,
      revision: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      ...(source ? { source } : {}),
    } satisfies ArkDraftContextItem;
  });
  const active = yield* Ref.make<ReadonlyMap<string, Deferred.Deferred<void>>>(new Map());
  const cancelled = yield* Ref.make<ReadonlySet<string>>(new Set());
  const lookup = Effect.fn("ArkDrafts.lookup")(function* (query: string) {
    if (!query.trim()) return { items: [] };
    const found = yield* features.readKnowledge({ kind: "search", query });
    if (found.kind !== "search")
      return yield* new ArkFeatureError({
        message: "The workspace returned an invalid context search.",
      });
    const items = yield* Effect.forEach(found.facts.slice(0, 6), (fact) =>
      makeItem(`memory:${fact.id}`, "Saved fact", fact.text, ""),
    );
    for (const hit of found.notes.slice(0, 6)) {
      const note = yield* features.readKnowledge({ kind: "note", id: hit.id });
      if (note.kind === "note")
        items.push(
          yield* makeItem(
            `note:${note.id}`,
            note.title,
            note.body,
            note.revision,
            note.source ? `${note.source.relativePath} (${note.source.state})` : undefined,
          ),
        );
    }
    return { items };
  });
  const currentItem = Effect.fn("ArkDrafts.currentItem")(function* (id: string) {
    const match = /^(memory|note):([1-9][0-9]*)$/.exec(id);
    if (!match || !Number.isSafeInteger(Number(match[2])))
      return yield* new ArkFeatureError({ message: "Invalid draft context selection." });
    if (match[1] === "memory") {
      const fact = yield* features.readKnowledge({ kind: "memory", id: Number(match[2]) });
      if (fact.kind === "memory") return yield* makeItem(id, "Saved fact", fact.text, "");
    } else {
      const note = yield* features.readKnowledge({ kind: "note", id: Number(match[2]) });
      if (note.kind === "note")
        return yield* makeItem(
          id,
          note.title,
          note.body,
          note.revision,
          note.source ? `${note.source.relativePath} (${note.source.state})` : undefined,
        );
    }
    return yield* new ArkFeatureError({
      message: "A selected context item was removed. Search and review it again.",
    });
  });
  const generate = Effect.fn("ArkDrafts.generate")(function* (input: ArkDraftInput) {
    if (!input.conversation.trim())
      return yield* new ArkFeatureError({
        message: "Add the message or conversation to reply to.",
      });
    if (
      input.context.length > 12 ||
      new Set(input.context.map((item) => item.id)).size !== input.context.length
    )
      return yield* new ArkFeatureError({
        message: "Choose at most twelve distinct context items.",
      });
    const provider = yield* providers.getInstance(input.modelSelection.instanceId);
    if (!provider?.enabled || !provider.textGeneration.generateReplyDraft)
      return yield* new ArkFeatureError({
        message:
          "This provider cannot guarantee tool-free reply drafting. Choose an enabled Claude or Codex model.",
      });
    const done = yield* Deferred.make<void>();
    const accepted = yield* Ref.modify(active, (current) =>
      current.size ? [false, current] : [true, new Map(current).set(input.requestId, done)],
    );
    if (!accepted)
      return yield* new ArkFeatureError({
        message: "Another reply draft is still running. Stop it or wait for it to finish.",
      });
    const run = Effect.gen(function* () {
      const wasCancelled = yield* Ref.modify(cancelled, (current) => {
        const next = new Set(current);
        const found = next.delete(input.requestId);
        return [found, next];
      });
      if (wasCancelled)
        return yield* new ArkFeatureError({ message: "Draft stopped before generation started." });
      const sources: ArkDraftContextItem[] = [];
      for (const pick of input.context) {
        const item = yield* currentItem(pick.id);
        if (item.revision !== pick.revision)
          return yield* new ArkFeatureError({
            message:
              "A selected fact or note changed. Search and review its current preview before drafting.",
          });
        sources.push(item);
      }
      const payload = encodeJson({
        intent: input.intent || "Draft a short, appropriate reply.",
        conversation: input.conversation,
        background: input.background,
        sources,
        writingExamples: input.examples,
      });
      if (Buffer.byteLength(payload) > 64000)
        return yield* new ArkFeatureError({
          message:
            "The selected context exceeds the draft's 64 KiB request budget. Remove some material before generating; nothing was sent.",
        });
      if (!writer.generateReplyDraft)
        return yield* new ArkFeatureError({ message: "Reply drafting is unavailable." });
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "ark-draft-" }).pipe(
        Effect.mapError(
          () =>
            new ArkFeatureError({
              message: "The isolated draft workspace could not be prepared.",
            }),
        ),
      );
      const result = yield* writer
        .generateReplyDraft({
          cwd,
          prompt: payload,
          modelSelection: input.modelSelection,
        })
        .pipe(
          Effect.mapError(
            () =>
              new ArkFeatureError({
                message:
                  "The selected provider could not finish an isolated draft. No fallback model was used. Your source text is kept.",
              }),
          ),
        );
      const text = result.text.trim();
      if (!text || Buffer.byteLength(text) > 32000)
        return yield* new ArkFeatureError({
          message: "The draft was empty or exceeded its output budget. Request a shorter reply.",
        });
      return { text, modelSelection: input.modelSelection };
    });
    return yield* Effect.raceFirst(
      run,
      Deferred.await(done).pipe(
        Effect.andThen(
          Effect.fail(new ArkFeatureError({ message: "Draft stopped. Your source text is kept." })),
        ),
      ),
    ).pipe(
      Effect.scoped,
      Effect.ensuring(
        Ref.update(active, (current) => {
          const next = new Map(current);
          next.delete(input.requestId);
          return next;
        }),
      ),
    );
  });
  const cancel = Effect.fn("ArkDrafts.cancel")(function* (requestId: string) {
    const done = (yield* Ref.get(active)).get(requestId);
    if (done) yield* Deferred.succeed(done, undefined);
    else yield* Ref.update(cancelled, (current) => new Set([...current, requestId].slice(-128)));
  });
  return ArkDrafts.of({ lookup, generate, cancel });
});
export const layer = Layer.effect(ArkDrafts, make);
