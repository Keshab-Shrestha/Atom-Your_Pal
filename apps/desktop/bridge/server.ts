// The local web server in front of the runtime. It does three things: serves the window's files, streams the runtime's events
// (GET /events) and takes the window's commands (POST /command). It is the equivalent of the Swift app's private pipe, so whoever holds
// the token has the window's full authority, including answering approvals. Hence: loopback only, a random token per run that is
// sent in a header and never in a URL, a Host check against DNS rebinding, a same-origin check on writes, and no CORS at all.

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { Hub } from "./hub.ts";
import type { SupervisorStatus } from "./supervisor.ts";

/** Commands carry typed text and attachments' paths, not files; 16 MiB is far above any real message. */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
};

export interface BridgeServerOptions {
  hub: Hub;
  token: string;
  /** The built window (ui/dist). When absent or missing, only the API answers. */
  uiDir?: string;
  send: (command: object) => boolean;
  status: () => SupervisorStatus;
}

export interface BridgeServer {
  listen(port: number): Promise<{ port: number }>;
  close(): Promise<void>;
  readonly server: Server;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

export function createBridgeServer(options: BridgeServerOptions): BridgeServer {
  const tokenDigest = digest(options.token);
  const uiRoot = options.uiDir ? resolve(options.uiDir) : undefined;
  let port = 0;

  const reply = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(status, {
      "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...SECURITY_HEADERS,
      ...extra,
    });
    res.end(text);
  };

  /** The name in the Host header, lower case, without its port. Empty when it is not a plain name. */
  const hostOf = (req: IncomingMessage) => /^(\[::1\]|[a-z0-9.-]+)(:\d+)?$/i.exec(String(req.headers.host ?? "").trim())?.[1]?.toLowerCase() ?? "";
  const allowedHost = (req: IncomingMessage) => ["127.0.0.1", "localhost", "[::1]"].includes(hostOf(req));

  const authorized = (req: IncomingMessage) => {
    const header = String(req.headers.authorization ?? "");
    if (!header.toLowerCase().startsWith("bearer ")) return false;
    return timingSafeEqual(digest(header.slice(7).trim()), tokenDigest);
  };

  /** A write from a page on another origin (any web page can aim a form at 127.0.0.1) carries a different Origin. */
  const sameOrigin = (req: IncomingMessage) => {
    const origin = req.headers.origin;
    if (origin === undefined) return true; // not a browser page: curl, tests, the native shell
    return origin === `http://${req.headers.host}`;
  };

  async function readBody(req: IncomingMessage): Promise<string | undefined> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) return undefined;
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  async function serveFile(req: IncomingMessage, res: ServerResponse, pathname: string) {
    if (!uiRoot) return reply(res, 404, "No window files are built. Run the UI build first.");
    let relative: string;
    try {
      relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
    } catch {
      return reply(res, 400, "Bad address.");
    }
    const file = resolve(join(uiRoot, normalize(relative)));
    if (file !== uiRoot && !file.startsWith(uiRoot + sep)) return reply(res, 404, "Not found.");
    try {
      if (!(await stat(file)).isFile()) return reply(res, 404, "Not found.");
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
        "cache-control": relative.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-store",
        ...SECURITY_HEADERS,
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      reply(res, 404, "Not found.");
    }
  }

  const server = createServer((req, res) => {
    void (async () => {
      try {
        // An address the URL parser rejects must not throw before any check.
        let pathname: string;
        try {
          pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
        } catch {
          return reply(res, 400, "Bad address.");
        }
        // 127.0.0.1 under another name (DNS rebinding) sends that name as Host.
        if (!allowedHost(req)) return reply(res, 403, "Use http://127.0.0.1 or http://localhost.");

        if (pathname === "/events" || pathname === "/status" || pathname === "/command") {
          if (!authorized(req)) return reply(res, 401, { error: "A valid token is needed: Authorization: Bearer <token>." }, { "www-authenticate": "Bearer" });
          if (pathname === "/events") {
            if (req.method !== "GET") return reply(res, 405, { error: "GET only." });
            return options.hub.attach(res);
          }
          if (pathname === "/status") {
            if (req.method !== "GET") return reply(res, 405, { error: "GET only." });
            return reply(res, 200, options.status());
          }
          if (req.method !== "POST") return reply(res, 405, { error: "POST only." });
          if (!sameOrigin(req)) return reply(res, 403, { error: "Cross-origin writes are refused." });
          const body = await readBody(req);
          if (body === undefined) return reply(res, 413, { error: "That command is too large." });
          let command: unknown;
          try {
            command = JSON.parse(body);
          } catch {
            return reply(res, 400, { error: "The command is not JSON." });
          }
          if (typeof command !== "object" || command === null || Array.isArray(command) || typeof (command as { type?: unknown }).type !== "string") {
            return reply(res, 400, { error: 'A command is a JSON object with a string "type".' });
          }
          if ((command as { type: string }).type === "quit") return reply(res, 403, { error: "The bridge owns the runtime's lifetime; a window cannot quit it." });
          if (!options.send(command)) return reply(res, 503, { error: "ATOM's runtime is not running. Wait for it to restart, or start it again.", status: options.status() });
          return reply(res, 202, { ok: true });
        }

        if (req.method !== "GET" && req.method !== "HEAD") return reply(res, 405, "GET only.");
        return await serveFile(req, res, pathname);
      } catch (error) {
        if (!res.headersSent) reply(res, 500, { error: "The bridge failed on this request." });
        else res.destroy();
        process.stderr.write(`bridge: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    })();
  });

  return {
    server,
    listen: (wanted) =>
      new Promise((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(wanted, "127.0.0.1", () => {
          port = (server.address() as { port: number }).port;
          resolveListen({ port });
        });
      }),
    close: () =>
      new Promise((resolveClose) => {
        options.hub.closeAll();
        server.close(() => resolveClose());
        server.closeAllConnections();
      }),
  };
}
