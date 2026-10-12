// ADR-097 item 3: a small local sentence-embedding model for the memory search's "meaning" half. It runs on this Mac
// (ONNX, through @huggingface/transformers, already used for Kokoro); it is not a general LLM (CLAUDE.md §11). The model
// file (about 23 MB, quantized) downloads once from Hugging Face into models/huggingface and is read from there after.

import { resolve } from "node:path";
import type { Logger } from "@zeno/shared";

export const EMBED_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
/** After a failed load (for example offline), wait this long before trying again. */
const RETRY_AFTER_MS = 10 * 60_000;

type Extractor = (texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;

export interface Embedder {
  /** Unit vectors for the texts. Loads the model first if needed; throws when it cannot. */
  embed(texts: string[]): Promise<Float32Array[]>;
  /** True once the model is loaded. */
  ready(): boolean;
  /** Starts loading the model in the background. Resolves true when it is ready. Never throws. */
  warm(): Promise<boolean>;
}

export function createEmbedder(options: { log: Pick<Logger, "info" | "warn">; cacheDir?: string }): Embedder {
  const { log, cacheDir = resolve("models/huggingface") } = options;
  let loading: Promise<Extractor> | undefined;
  let extractor: Extractor | undefined;
  let failedAt = -Infinity;

  const load = (): Promise<Extractor> => {
    if (extractor) return Promise.resolve(extractor);
    if (Date.now() - failedAt < RETRY_AFTER_MS) return Promise.reject(new Error("The embedding model is unavailable."));
    loading ??= (async () => {
      const started = Date.now();
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = cacheDir;
      // Cast: the library's pipeline() overloads are too big for the type checker.
      const make = pipeline as unknown as (task: string, model: string, options: { dtype: string }) => Promise<Extractor>;
      extractor = await make("feature-extraction", EMBED_MODEL_ID, { dtype: "q8" });
      log.info("memory.embedder_ready", { model: EMBED_MODEL_ID, ms: Date.now() - started });
      return extractor;
    })().catch((error: unknown) => {
      failedAt = Date.now();
      loading = undefined;
      log.warn("memory.embedder_unavailable", { model: EMBED_MODEL_ID, message: error instanceof Error ? error.message : String(error), fallback: "keywords" });
      throw error;
    });
    return loading;
  };

  return {
    async embed(texts) {
      if (!texts.length) return [];
      const run = await load();
      const out = await run(texts, { pooling: "mean", normalize: true });
      const size = out.dims.at(-1) ?? 0;
      return texts.map((_, i) => out.data.slice(i * size, (i + 1) * size));
    },
    ready: () => Boolean(extractor),
    warm: () => load().then(() => true, () => false),
  };
}
