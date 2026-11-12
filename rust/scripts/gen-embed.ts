// ADR-278: the fixture of the native embedder (rust/crates/ark-runtime/src/embedder.rs): the vectors that the TypeScript embedder
// (@huggingface/transformers, q8) gives for a few strings. Needs the model files in models/huggingface (set ARK_EMBED_CACHE to their parent).
// From the repository root: node rust/scripts/gen-embed.ts
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmbedder } from "../../apps/mac/src/embedder.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures", "embed.json");
const texts = ["The cat sat on the mat.", "Keshab likes green tea, and 3 cats!", "Café déjà vu: naïve résumé", "Run the weekly report on Friday at 5pm.", "你好，世界", "a ".repeat(300)];
const log = { info: () => undefined, warn: (e: string, f: unknown) => console.error(e, f) };
const embedder = createEmbedder({ log, cacheDir: process.env.ARK_EMBED_CACHE ?? "models/huggingface" });
const vectors = await embedder.embed(texts);
writeFileSync(out, JSON.stringify({ texts, vectors: vectors.map((v) => Array.from(v, (x) => Math.round(x * 1e7) / 1e7)) }));
console.log("wrote", out, vectors.length, vectors[0]!.length);
