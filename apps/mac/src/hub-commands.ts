// B3.5, ADR-102: what the six `skill.hub.*` commands do, and the `skillHub` part of the helpers list. The network is in
// skill-hub.ts and the checks and writes are in the store; this joins them. Logs: ids, names, repo and sha only, never
// a skill's text, a URL found in one, or a search.

import type { HelperStore } from "@zeno/helpers";
import type { Logger } from "@zeno/shared";
import type { SkillHubItem } from "./island-protocol.ts";
import { HUB_SOURCES, HubError, createHubClient, type HubClient, type HubHit } from "./skill-hub.ts";

export interface HubCommands {
  /** The `skillHub` part of the helpers list; undefined when nothing is to show. */
  payload(): SkillHubItem | undefined;
  search(query: string): Promise<void>;
  preview(source: number, path: string): Promise<void>;
  approve(id: number): void;
  reject(id: number): void;
  uninstall(name: string, force?: boolean): void;
  update(name: string): Promise<void>;
}

export interface HubCommandsOptions {
  store: HelperStore;
  log: Pick<Logger, "info">;
  client?: HubClient;
}

export function createHubCommands({ store, log, client = createHubClient() }: HubCommandsOptions): HubCommands {
  let results: HubHit[] = [];
  let message: string | undefined;

  /** A network refusal becomes a plain message in the window; a store refusal (a HelperError) is thrown to the caller. */
  async function guarded(work: () => Promise<void>) {
    message = undefined;
    try {
      await work();
    } catch (error) {
      if (!(error instanceof HubError)) throw error;
      message = error.message;
    }
  }

  return {
    payload() {
      const pending = store.skillHubPending().map((p) => ({ id: p.id, kind: p.kind, name: p.name, description: p.description, repo: p.repo, path: p.path, sha: p.sha, text: p.text, flags: p.flags }));
      const installed = store.skillHubInstalled().map((i) => ({ name: i.name, repo: i.repo, path: i.path, sha: i.sha }));
      if (!results.length && !pending.length && !installed.length && !message) return undefined;
      return { results, pending, installed, ...(message ? { message } : {}) };
    },

    search: (query) =>
      guarded(async () => {
        results = [];
        results = await client.searchHub(query);
        log.info("hub.search", { count: results.length });
        if (!results.length) message = "No skill has that in its name.";
      }),

    preview: (source, path) =>
      guarded(async () => {
        const file = await client.fetchSkill(source, path);
        const pending = store.previewSkillHub(file);
        log.info("hub.preview", { id: pending.id, name: pending.name, repo: pending.repo, sha: pending.sha });
      }),

    approve(id) {
      message = undefined;
      store.approveSkillHub(id);
      log.info("hub.approve", { id });
    },

    reject(id) {
      message = undefined;
      store.rejectSkillHub(id);
      log.info("hub.reject", { id });
    },

    uninstall(name, force) {
      message = undefined;
      store.uninstallSkillHub(name, force ?? false);
      log.info("hub.uninstall", { name });
    },

    update: (name) =>
      guarded(async () => {
        const row = store.skillHubInstalled().find((i) => i.name === name);
        if (!row) throw new HubError(`"${name.slice(0, 40)}" is not a skill from the hub.`);
        const source = HUB_SOURCES.findIndex((s) => s.repo === row.repo);
        if (source < 0) throw new HubError("That skill's source is not in ZENO's list any more.");
        const file = await client.fetchSkill(source, row.path, true);
        const pending = store.updateSkillHub(name, { sha: file.sha, text: file.text });
        if (!pending) message = `${name} is up to date.`;
        log.info("hub.update", { name, repo: row.repo, sha: file.sha, changed: Boolean(pending) });
      }),
  };
}
