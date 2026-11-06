// YouTube sign-in and resumable video upload for the Studio card.
//
// Flows checked against Google's docs on 2026-11-06:
// - OAuth 2.0 for installed apps, loopback redirect http://127.0.0.1:<port> (no path), PKCE S256,
//   token endpoint, refresh, invalid_grant: https://developers.google.com/identity/protocols/oauth2/native-app
//   (same flow for YouTube: https://developers.google.com/youtube/v3/guides/auth/installed-apps)
// - Resumable upload (POST uploadType=resumable -> Location, PUT bytes -> 201, 308 + Range to resume,
//   retry 500/502/503/504, 404 = session expired):
//   https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
// - videos.insert scopes and limits: https://developers.google.com/youtube/v3/docs/videos/insert
//   https://developers.google.com/youtube/v3/docs/videos (title 100 chars, description 5000 bytes,
//   tags 500 chars with commas and quotes counted)
// - channels.list mine=true: https://developers.google.com/youtube/v3/docs/channels/list
// Unverified API projects: older policy forced uploads to private; the videos.insert page now says they
// are not restricted. Either way we return the privacy YouTube reports, never the one we asked for.
//
// Secrets: the refresh token lives only in the token store, access tokens only in memory. Nothing here
// logs or returns a token, code, verifier or client secret.

import { createHash, randomBytes } from "node:crypto";
import { createReadStream, chmodSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname } from "node:path";
import { Readable } from "node:stream";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
const SIGN_IN_AGAIN = "Sign in to YouTube again in ARK's Studio card.";
const NOT_CONNECTED = "YouTube is not connected. Sign in in ARK's Studio card.";
const DEFAULT_SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const EXPIRY_MARGIN_MS = 60_000;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_TITLE = 100;
const MAX_DESCRIPTION_BYTES = 5000;
const MAX_TAGS = 500;
const SHORTS_TAG = " #Shorts";
const VIDEO_TYPE = "video/mp4";
const MAX_UPLOAD_RETRIES = 4;
const RETRY_BASE_MS = 1000;
const RETRYABLE = new Set([500, 502, 503, 504]);

export interface YouTubeTokenStore { read(): { refreshToken: string } | undefined; write(t: { refreshToken: string }): void; clear(): void }
export interface YouTubeClient { clientId: string; clientSecret: string }
export interface YouTubeDeps { client: YouTubeClient; tokens: YouTubeTokenStore; fetch: typeof fetch; openUrl(url: string): Promise<void> | void; log?(event: string, fields: Record<string, unknown>): void }
export interface UploadInput { file: string; title: string; description: string; tags?: string[]; privacy: "private" | "unlisted" | "public"; short?: boolean }
type ApiDeps = Omit<YouTubeDeps, "openUrl">;

export function fileTokenStore(path: string): YouTubeTokenStore {
  return {
    read() {
      let text: string;
      try { text = readFileSync(path, "utf8"); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new Error(`The YouTube token file is damaged: ${path}. ${SIGN_IN_AGAIN}`); }
      const refreshToken = (parsed as { refreshToken?: unknown } | null)?.refreshToken;
      if (typeof refreshToken !== "string" || refreshToken === "") throw new Error(`The YouTube token file is damaged: ${path}. ${SIGN_IN_AGAIN}`);
      return { refreshToken };
    },
    write(t) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const temp = `${path}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify({ refreshToken: t.refreshToken })}\n`, { mode: 0o600 });
      chmodSync(temp, 0o600); // mode applies only on create; an old temp file keeps its mode otherwise
      renameSync(temp, path);
    },
    clear() { rmSync(path, { force: true }); },
  };
}

// Access tokens, in memory only, per token store.
const accessTokens = new WeakMap<YouTubeTokenStore, { refreshToken: string; accessToken: string; expiresAt: number }>();

export async function signIn(deps: YouTubeDeps, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<{ channel: string }> {
  if (!deps.client.clientId) throw new Error("YouTube sign-in is not set up: no Google client ID.");
  const verifier = randomBytes(32).toString("base64url"); // 43 chars, allowed set
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const code = waitForCode(server, state, options.timeoutMs ?? DEFAULT_SIGN_IN_TIMEOUT_MS, options.signal);
    code.catch(() => {}); // still awaited below; avoids an unhandled rejection if openUrl throws first
    const url = new URL(AUTH_URL);
    for (const [key, value] of Object.entries({
      client_id: deps.client.clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(" "),
      code_challenge: challenge, code_challenge_method: "S256", state,
      // Always ask again, so a sign-in after a sign-out still returns a refresh token (security review, 2026-11-06).
      prompt: "consent",
    })) url.searchParams.set(key, value);
    deps.log?.("youtube.signin.start", { redirectUri });
    await deps.openUrl(url.toString());
    const token = await tokenRequest(deps, {
      client_id: deps.client.clientId, client_secret: deps.client.clientSecret, code: await code,
      code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri,
    }, options.signal);
    if (!token.refresh_token) throw new Error("Google did not return a refresh token. Start sign-in again.");
    const accessToken = remember(deps.tokens, token.refresh_token, token);
    const channel = await channelTitle(deps, accessToken, options.signal);
    deps.tokens.write({ refreshToken: token.refresh_token });
    deps.log?.("youtube.signin.done", {});
    return { channel };
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

export async function status(deps: ApiDeps): Promise<{ connected: false } | { connected: true; channel: string }> {
  if (!deps.tokens.read()) return { connected: false };
  return { connected: true, channel: await channelTitle(deps, await accessToken(deps)) };
}

export function signOut(deps: Pick<YouTubeDeps, "tokens"> & { fetch?: typeof fetch }): void {
  const stored = deps.tokens.read();
  accessTokens.delete(deps.tokens);
  deps.tokens.clear();
  // Revoke it at Google too (best effort: the local copy is gone either way).
  if (stored && deps.fetch) {
    void deps.fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: stored.refreshToken }).toString() }).catch(() => {});
  }
}

export async function upload(input: UploadInput, deps: ApiDeps, signal?: AbortSignal): Promise<{ videoId: string; url: string; privacy: string }> {
  const { size, title, description, tags } = checkUpload(input);
  deps.log?.("youtube.upload.start", { bytes: size, privacy: input.privacy, short: input.short === true });
  const init = await authed(deps, (token) => deps.fetch(UPLOAD_URL, {
    method: "POST", signal,
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(size), "X-Upload-Content-Type": VIDEO_TYPE,
    },
    body: JSON.stringify({
      snippet: { title, description, ...(tags.length ? { tags } : {}) },
      status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: false },
    }),
  }));
  const session = init.headers.get("location");
  if (!init.ok || !session) throw await apiError("YouTube did not start the upload", init);
  const video = await sendBytes(input.file, size, session, deps, signal);
  const videoId = video.id;
  if (typeof videoId !== "string" || !videoId) throw new Error("YouTube finished the upload but returned no video ID.");
  const privacy = video.status?.privacyStatus ?? input.privacy;
  deps.log?.("youtube.upload.done", { videoId, privacy });
  return { videoId, privacy, url: input.short ? `https://youtube.com/shorts/${videoId}` : `https://youtu.be/${videoId}` };
}

function checkUpload(input: UploadInput): { size: number; title: string; description: string; tags: string[] } {
  if (extname(input.file).toLowerCase() !== ".mp4") throw new Error("Only .mp4 videos can be uploaded to YouTube.");
  let stat;
  try { stat = statSync(input.file); } catch { throw new Error(`The video file does not exist: ${input.file}`); }
  if (!stat.isFile()) throw new Error(`The video path is not a file: ${input.file}`);
  if (stat.size === 0) throw new Error("The video file is empty.");
  if (stat.size > MAX_FILE_BYTES) throw new Error("The video is larger than 256 MB.");
  let title = input.title.trim();
  let description = input.description;
  const tags = input.tags ?? [];
  if (input.short && !/#shorts\b/i.test(`${title} ${description}`)) {
    if (title.length + SHORTS_TAG.length <= MAX_TITLE) title += SHORTS_TAG;
    else description = description ? `${description}\n${SHORTS_TAG.trim()}` : SHORTS_TAG.trim();
  }
  if (title.length < 1 || title.length > MAX_TITLE) throw new Error(`The title must be 1 to ${MAX_TITLE} characters.`);
  if (Buffer.byteLength(description) > MAX_DESCRIPTION_BYTES) throw new Error(`The description must be at most ${MAX_DESCRIPTION_BYTES} bytes.`);
  // YouTube counts the commas between tags and the quotes it adds around a tag with a space.
  const tagLength = tags.reduce((sum, tag) => sum + tag.length + (tag.includes(" ") ? 2 : 0), Math.max(0, tags.length - 1));
  if (tagLength > MAX_TAGS) throw new Error(`The tags must be at most ${MAX_TAGS} characters in total.`);
  return { size: stat.size, title, description, tags };
}

type Video = { id?: unknown; status?: { privacyStatus?: string } };

// PUT the bytes; on a lost connection, 5xx or expired access token, ask how much arrived (308 + Range) and resume.
async function sendBytes(file: string, size: number, session: string, deps: ApiDeps, signal?: AbortSignal): Promise<Video> {
  let start = 0;
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken(deps, signal);
    let res: Response | undefined;
    try {
      res = await deps.fetch(session, {
        method: "PUT", signal, duplex: "half",
        headers: {
          Authorization: `Bearer ${token}`, "Content-Type": VIDEO_TYPE, "Content-Length": String(size - start),
          ...(start > 0 ? { "Content-Range": `bytes ${start}-${size - 1}/${size}` } : {}),
        },
        body: Readable.toWeb(createReadStream(file, { start })) as ReadableStream,
      } as RequestInit);
    } catch (error) {
      if (signal?.aborted || attempt >= MAX_UPLOAD_RETRIES) throw error;
    }
    if (res?.ok) return await res.json() as Video;
    if (res?.status === 404) throw new Error("The YouTube upload session expired. Start the upload again.");
    if (res && res.status !== 401 && !RETRYABLE.has(res.status)) throw await apiError("YouTube refused the upload", res);
    if (res?.status === 401) accessTokens.delete(deps.tokens);
    if (attempt >= MAX_UPLOAD_RETRIES) throw await apiError("YouTube upload failed after retries", res!);
    await res?.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * 2 ** attempt));
    const check = await deps.fetch(session, {
      method: "PUT", signal,
      headers: { Authorization: `Bearer ${await accessToken(deps, signal)}`, "Content-Length": "0", "Content-Range": `bytes */${size}` },
    });
    if (check.ok) return await check.json() as Video;
    if (check.status === 404) throw new Error("The YouTube upload session expired. Start the upload again.");
    if (check.status !== 308) throw await apiError("YouTube could not report the upload progress", check);
    await check.body?.cancel();
    const range = /bytes=0-(\d+)/.exec(check.headers.get("range") ?? "");
    start = range ? Number(range[1]) + 1 : 0;
    deps.log?.("youtube.upload.resume", { from: start, bytes: size });
  }
}

async function channelTitle(deps: ApiDeps, token: string, signal?: AbortSignal): Promise<string> {
  const res = await authedWith(deps, token, (t) => deps.fetch(CHANNELS_URL, { headers: { Authorization: `Bearer ${t}` }, signal }));
  if (!res.ok) throw await apiError("YouTube did not return the channel", res);
  const body = await res.json() as { items?: { snippet?: { title?: string } }[] };
  const title = body.items?.[0]?.snippet?.title;
  if (!title) throw new Error("This Google account has no YouTube channel. Create one on youtube.com, then sign in again.");
  return title;
}

// Runs a request with the current access token; on 401 it refreshes once and tries again.
async function authed(deps: ApiDeps, request: (token: string) => Promise<Response>): Promise<Response> {
  return authedWith(deps, await accessToken(deps), request);
}

async function authedWith(deps: ApiDeps, token: string, request: (token: string) => Promise<Response>): Promise<Response> {
  const res = await request(token);
  if (res.status !== 401 || !deps.tokens.read()) return res;
  await res.body?.cancel();
  accessTokens.delete(deps.tokens);
  return request(await accessToken(deps));
}

async function accessToken(deps: ApiDeps, signal?: AbortSignal): Promise<string> {
  const stored = deps.tokens.read();
  if (!stored) throw new Error(NOT_CONNECTED);
  const cached = accessTokens.get(deps.tokens);
  if (cached && cached.refreshToken === stored.refreshToken && cached.expiresAt > Date.now()) return cached.accessToken;
  const token = await tokenRequest(deps, {
    client_id: deps.client.clientId, client_secret: deps.client.clientSecret,
    refresh_token: stored.refreshToken, grant_type: "refresh_token",
  }, signal, true);
  return remember(deps.tokens, stored.refreshToken, token);
}

type TokenResponse = { access_token?: string; expires_in?: number; refresh_token?: string; error?: string; error_description?: string };

async function tokenRequest(deps: ApiDeps, form: Record<string, string>, signal?: AbortSignal, refresh = false): Promise<TokenResponse> {
  const res = await deps.fetch(TOKEN_URL, {
    method: "POST", signal,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const body = await res.json().catch(() => ({})) as TokenResponse;
  if (refresh && (res.status === 401 || body.error === "invalid_grant")) {
    deps.log?.("youtube.refresh.refused", { status: res.status, error: body.error });
    throw new Error(SIGN_IN_AGAIN);
  }
  if (!res.ok || !body.access_token) {
    const reason = [body.error, body.error_description].filter(Boolean).join(": ") || `HTTP ${res.status}`;
    throw new Error(`Google ${refresh ? "token refresh" : "sign-in"} failed (${reason}).`);
  }
  return body;
}

function remember(store: YouTubeTokenStore, refreshToken: string, token: TokenResponse): string {
  const accessToken = token.access_token!;
  accessTokens.set(store, { refreshToken, accessToken, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 - EXPIRY_MARGIN_MS });
  return accessToken;
}

async function apiError(what: string, res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
  return new Error(`${what} (HTTP ${res.status}${body.error?.message ? `: ${body.error.message}` : ""}).`);
}

// Accepts one GET with the matching state, answers the browser, and settles. Other requests get 400.
function waitForCode(server: Server, state: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | undefined, code?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve(code!);
    };
    const timer = setTimeout(() => finish(new Error("YouTube sign-in timed out. Start sign-in again in ARK's Studio card.")), timeoutMs);
    const onAbort = () => finish(new Error("YouTube sign-in was cancelled."));
    if (signal?.aborted) onAbort(); else signal?.addEventListener("abort", onAbort, { once: true });
    server.on("close", () => finish(new Error("YouTube sign-in stopped.")));
    server.on("request", (req, res) => {
      const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
      const page = (status: number, text: string) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", Connection: "close" });
        res.end(`<!doctype html><meta charset="utf-8"><title>ARK</title><p>${text}</p>`);
      };
      if (settled || req.method !== "GET" || params.get("state") !== state) return page(400, "This sign-in link is not valid.");
      const error = params.get("error");
      const code = params.get("code");
      if (error || !code) {
        page(400, "Sign-in was not completed. You can close this tab.");
        return finish(new Error(`Google refused sign-in: ${error ?? "no code returned"}${params.get("error_description") ? ` (${params.get("error_description")})` : ""}.`));
      }
      page(200, "Signed in to YouTube. You can close this tab.");
      finish(undefined, code);
    });
  });
}
