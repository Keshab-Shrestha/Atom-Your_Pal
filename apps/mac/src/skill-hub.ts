// B3.5, ADR-102: the only network code of the skills hub. It reads from a pinned list of public repos on two GitHub
// hosts, with no account and no token. It fetches ONE file per skill (SKILL.md at a pinned commit), never a script, and
// never runs anything. The text is checked, previewed and approved by the store (@atom/helpers skill-hub).

import { HUB_PATH, SKILL_DRAFT_NAME, parseSkillFile } from "@atom/helpers";

/** Adding a source needs a code change. */
export const HUB_SOURCES: readonly { repo: string }[] = [{ repo: "anthropics/skills" }];
export const HUB_HOSTS: readonly string[] = ["api.github.com", "raw.githubusercontent.com"];

export const HUB_QUERY_MAX = 60;
export const HUB_RESULTS = 10;
export const HUB_TIMEOUT_MS = 10_000;
export const HUB_FILE_BYTES = 64 * 1024;
/** A repo's file list is larger than a skill; it is read once and kept. */
export const HUB_TREE_BYTES = 2 * 1024 * 1024;
export const HUB_FETCHES_PER_MINUTE = 20;
export const HUB_CACHE_MS = 10 * 60_000;
const SHA = /^[0-9a-f]{40}$/;

/** A refusal or failure with words for Keshab. */
export class HubError extends Error {}

export interface HubHit {
  name: string;
  description: string;
  repo: string;
  path: string;
  sha: string;
  source: number;
}

export interface HubFileResult {
  repo: string;
  path: string;
  sha: string;
  text: string;
}

export interface HubClientOptions {
  /** Injected in tests: no real network there. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export function createHubClient(options: HubClientOptions = {}) {
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? HUB_TIMEOUT_MS;
  const stamps: number[] = [];
  const trees = new Map<number, { at: number; sha: string; paths: string[] }>();

  /** One GET: host allowlist, https only, no redirect, a time limit, text only, a byte cap, valid UTF-8, a rate limit. */
  async function get(url: string, maxBytes: number): Promise<string> {
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), timeoutMs); // covers the answer and its body
    try {
      return await getWithin(url, maxBytes, control.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  async function getWithin(url: string, maxBytes: number, signal: AbortSignal): Promise<string> {
    const u = new URL(url);
    if (u.protocol !== "https:" || !HUB_HOSTS.includes(u.hostname) || u.username || u.password) throw new HubError("ATOM only reads from api.github.com and raw.githubusercontent.com.");
    const t = now();
    while (stamps.length && t - stamps[0]! >= 60_000) stamps.shift();
    if (stamps.length >= HUB_FETCHES_PER_MINUTE) throw new HubError("ATOM already made many requests this minute. Try again in a minute.");
    stamps.push(t);
    let res: Response;
    try {
      res = await doFetch(u.href, { redirect: "error", signal, headers: { accept: "application/vnd.github+json, text/plain", "user-agent": "zeno-skills-hub" } });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new HubError("GitHub did not answer in time.");
      throw new HubError("GitHub could not be reached, or it redirected the request.");
    }
    if (res.status >= 300 && res.status < 400) throw new HubError("GitHub redirected the request, so ATOM stopped.");
    if (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) throw new HubError("GitHub's limit for requests without an account is reached. Try again later.");
    if (res.status === 404) throw new HubError("GitHub has no such file.");
    if (!res.ok) throw new HubError(`GitHub answered with an error (${res.status}).`);
    const type = res.headers.get("content-type") ?? "";
    if (!/^(text\/|application\/json)/i.test(type)) throw new HubError("GitHub sent something that is not text.");
    if (Number(res.headers.get("content-length") ?? 0) > maxBytes) throw new HubError("That file is too big for ATOM.");
    const reader = res.body?.getReader();
    if (!reader) throw new HubError("GitHub sent an empty answer.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          void reader.cancel().catch(() => undefined);
          throw new HubError("That file is too big for ATOM.");
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof HubError) throw error;
      throw new HubError(signal.aborted ? "GitHub did not answer in time." : "GitHub did not finish its answer.");
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    } catch {
      throw new HubError("That file is not valid UTF-8 text.");
    }
  }

  const json = async (url: string, maxBytes: number): Promise<Record<string, unknown>> => {
    try {
      const value: unknown = JSON.parse(await get(url, maxBytes));
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch (error) {
      if (error instanceof HubError) throw error;
    }
    throw new HubError("GitHub sent an answer ATOM cannot read.");
  };

  const source = (index: number) => {
    const s = Number.isInteger(index) ? HUB_SOURCES[index] : undefined;
    if (!s) throw new HubError("That source is not in ATOM's list.");
    return s.repo;
  };

  async function headSha(repo: string): Promise<string> {
    const sha = (await json(`https://api.github.com/repos/${repo}/commits/HEAD`, HUB_FILE_BYTES)).sha;
    if (typeof sha !== "string" || !SHA.test(sha)) throw new HubError("GitHub sent an answer ATOM cannot read.");
    return sha;
  }

  /** The repo's skill files at its newest commit; read once, kept for 10 minutes. */
  async function listing(index: number, fresh = false): Promise<{ sha: string; paths: string[] }> {
    const hit = trees.get(index);
    if (hit && !fresh && now() - hit.at < HUB_CACHE_MS) return hit;
    const repo = source(index);
    const sha = await headSha(repo);
    const tree = await json(`https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`, HUB_TREE_BYTES);
    if (tree.truncated === true) throw new HubError("That repository is too big for ATOM to search.");
    const entries = Array.isArray(tree.tree) ? (tree.tree as { path?: unknown; type?: unknown }[]) : [];
    const paths = entries
      .filter((e) => e.type === "blob" && typeof e.path === "string" && HUB_PATH.test(e.path) && SKILL_DRAFT_NAME.test(HUB_PATH.exec(e.path)![1]!))
      .map((e) => e.path as string);
    const value = { at: now(), sha, paths };
    trees.set(index, value);
    return value;
  }

  const rawUrl = (repo: string, sha: string, path: string) => `https://raw.githubusercontent.com/${repo}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const folder = (path: string) => HUB_PATH.exec(path)![1]!;

  return {
    /** The one door to the network (exposed for tests): every other call goes through it. */
    read: get,

    /** Skills whose folder name has the query in it (at most 10), with the description from each one's front matter. */
    async searchHub(query: string): Promise<HubHit[]> {
      const q = query.trim().toLowerCase();
      if (!q || q.length > HUB_QUERY_MAX) throw new HubError(`Search with 1 to ${HUB_QUERY_MAX} characters.`);
      const hits: HubHit[] = [];
      for (let index = 0; index < HUB_SOURCES.length; index += 1) {
        const { sha, paths } = await listing(index);
        const matches = paths
          .filter((p) => folder(p).includes(q))
          .sort((a, b) => Number(folder(b) === q) - Number(folder(a) === q) || Number(folder(b).startsWith(q)) - Number(folder(a).startsWith(q)) || folder(a).localeCompare(folder(b)));
        for (const path of matches.slice(0, HUB_RESULTS - hits.length)) {
          const repo = HUB_SOURCES[index]!.repo;
          const description = await get(rawUrl(repo, sha, path), HUB_FILE_BYTES).then((t) => parseSkillFile(t).description, () => "");
          hits.push({ name: folder(path), description: description.replace(/\s+/g, " ").trim().slice(0, 300), repo, path, sha, source: index });
        }
      }
      return hits;
    },

    /** One skill's SKILL.md at the newest commit (a fresh look when `fresh`, as for an update). Nothing else is read. */
    async fetchSkill(index: number, path: string, fresh = false): Promise<HubFileResult> {
      const repo = source(index);
      if (!HUB_PATH.test(path) || path.includes("..") || path.includes("\\") || !SKILL_DRAFT_NAME.test(folder(path))) throw new HubError("That is not a skill ATOM can take.");
      const sha = fresh ? await headSha(repo) : (await listing(index)).sha;
      return { repo, path, sha, text: await get(rawUrl(repo, sha, path), HUB_FILE_BYTES) };
    },
  };
}

export type HubClient = ReturnType<typeof createHubClient>;
