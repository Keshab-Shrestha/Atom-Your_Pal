import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileTokenStore, signIn, signOut, status, upload, type YouTubeTokenStore } from "./studio-youtube.ts";

// Fake Google: token endpoint, channels.list, and the resumable upload init. The session URI points at a
// real local server so the streamed PUT body and Content-Length go through Node's real fetch.

const client = { clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret" };
const tempDir = () => mkdtempSync(join(tmpdir(), "ark-yt-"));
const memoryStore = (refreshToken?: string): YouTubeTokenStore & { value?: { refreshToken: string } } => {
  const store = {
    value: refreshToken ? { refreshToken } : undefined,
    read: () => store.value,
    write: (t: { refreshToken: string }) => { store.value = t; },
    clear: () => { store.value = undefined; },
  };
  return store;
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

interface Google { challenge?: string; init?: { headers: Headers; body: Record<string, any> }; refreshFails?: boolean; sessionUrl?: string }

const fakeFetch = (google: Google): typeof fetch => async (input, init) => {
  const url = String(input);
  if (url === "https://oauth2.googleapis.com/token") {
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get("client_id"), client.clientId);
    if (form.get("grant_type") === "authorization_code") {
      assert.equal(form.get("code"), "the-code");
      assert.equal(createHash("sha256").update(form.get("code_verifier")!).digest("base64url"), google.challenge);
      assert.match(form.get("redirect_uri")!, /^http:\/\/127\.0\.0\.1:\d+$/);
      return json({ access_token: "at-1", expires_in: 3599, refresh_token: "rt-1", token_type: "Bearer" });
    }
    assert.equal(form.get("grant_type"), "refresh_token");
    if (google.refreshFails) return json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
    return json({ access_token: "at-2", expires_in: 3599 });
  }
  if (url.startsWith("https://www.googleapis.com/youtube/v3/channels")) {
    assert.match(new Headers(init?.headers).get("authorization")!, /^Bearer at-/);
    assert.match(url, /mine=true/);
    return json({ items: [{ snippet: { title: "Keshab Studio" } }] });
  }
  if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable")) {
    google.init = { headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
    return new Response(null, { status: 200, headers: { Location: google.sessionUrl! } });
  }
  return fetch(input, init); // the local session server
};

test("file token store: round trip, 0700 dir, 0600 file, clear", () => {
  const dir = tempDir();
  try {
    const path = join(dir, "youtube", "token.json");
    const store = fileTokenStore(path);
    assert.equal(store.read(), undefined);
    store.write({ refreshToken: "rt-a" });
    store.write({ refreshToken: "rt-b" });
    assert.deepEqual(store.read(), { refreshToken: "rt-b" });
    assert.equal(statSync(join(dir, "youtube")).mode & 0o777, 0o700);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    store.clear();
    assert.equal(store.read(), undefined);
    writeFileSync(path, "{not json");
    assert.throws(() => store.read(), /damaged/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const simulatedBrowser = (google: Google, opts: { wrongStateFirst?: boolean; error?: string } = {}) => {
  const seen: { url?: URL; wrongStatus?: number; page?: string } = {};
  const openUrl = async (raw: string) => {
    const url = new URL(raw);
    seen.url = url;
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    const p = url.searchParams;
    assert.equal(p.get("client_id"), client.clientId);
    assert.equal(p.get("response_type"), "code");
    assert.equal(p.get("code_challenge_method"), "S256");
    assert.match(p.get("code_challenge")!, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(p.get("scope")!.split(" ").sort(), ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/youtube.upload"]);
    assert.ok(p.get("state")!.length >= 16);
    assert.equal(p.get("client_secret"), null);
    google.challenge = p.get("code_challenge")!;
    const redirect = p.get("redirect_uri")!;
    assert.match(redirect, /^http:\/\/127\.0\.0\.1:\d+$/);
    // The browser follows Google's redirect in its own time, after openUrl returns.
    setImmediate(async () => {
      if (opts.wrongStateFirst) seen.wrongStatus = (await fetch(`${redirect}/?state=forged&code=evil`)).status;
      const query = opts.error ? `error=${opts.error}` : "code=the-code&scope=x";
      seen.page = await (await fetch(`${redirect}/?state=${p.get("state")}&${query}`)).text();
    });
  };
  return { openUrl, seen };
};

test("signIn: PKCE + state loopback flow stores the refresh token and returns the channel", async () => {
  const google: Google = {};
  const tokens = memoryStore();
  const browser = simulatedBrowser(google, { wrongStateFirst: true });
  const logs: string[] = [];
  const result = await signIn({ client, tokens, fetch: fakeFetch(google), openUrl: browser.openUrl, log: (e, f) => logs.push(`${e} ${JSON.stringify(f)}`) });
  assert.deepEqual(result, { channel: "Keshab Studio" });
  assert.deepEqual(tokens.value, { refreshToken: "rt-1" });
  assert.equal(browser.seen.wrongStatus, 400);
  await new Promise((r) => setTimeout(r, 20));
  assert.match(browser.seen.page!, /You can close this tab/);
  assert.ok(!logs.join().match(/rt-1|at-1|the-code|csecret/), "logs never carry secrets");
});

test("signIn: an error from Google is refused with its message", async () => {
  const google: Google = {};
  const tokens = memoryStore();
  const browser = simulatedBrowser(google, { error: "access_denied" });
  await assert.rejects(signIn({ client, tokens, fetch: fakeFetch(google), openUrl: browser.openUrl }), /Google refused sign-in: access_denied/);
  assert.equal(tokens.value, undefined);
});

test("signIn: times out with a clear error and closes the loopback server", async () => {
  let redirect = "";
  await assert.rejects(signIn({ client, tokens: memoryStore(), fetch: fakeFetch({}), openUrl: (u) => { redirect = new URL(u).searchParams.get("redirect_uri")!; } }, { timeoutMs: 50 }), /timed out/);
  await assert.rejects(fetch(redirect), "server is closed");
});

test("status: disconnected without a token, connected with the channel title", async () => {
  assert.deepEqual(await status({ client, tokens: memoryStore(), fetch: fakeFetch({}) }), { connected: false });
  assert.deepEqual(await status({ client, tokens: memoryStore("rt-1"), fetch: fakeFetch({}) }), { connected: true, channel: "Keshab Studio" });
  const tokens = memoryStore("rt-1");
  signOut({ tokens });
  assert.equal(tokens.value, undefined);
});

test("refresh failure tells the user to sign in again and clears nothing", async () => {
  const dir = tempDir();
  try {
    const file = join(dir, "clip.mp4");
    writeFileSync(file, Buffer.alloc(10));
    const tokens = memoryStore("rt-old");
    const deps = { client, tokens, fetch: fakeFetch({ refreshFails: true }) };
    await assert.rejects(upload({ file, title: "t", description: "", privacy: "private" }, deps), { message: "Sign in to YouTube again in ARK's Studio card." });
    await assert.rejects(status(deps), /Sign in to YouTube again/);
    assert.deepEqual(tokens.value, { refreshToken: "rt-old" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Local upload session: records each PUT; `failFirst` answers the first PUT with 503 after 100 bytes.
const sessionServer = async (video: Buffer, opts: { failFirst?: boolean } = {}) => {
  const puts: { headers: Record<string, string | string[] | undefined>; bytes: Buffer }[] = [];
  let received = Buffer.alloc(0);
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bytes = Buffer.concat(chunks);
      puts.push({ headers: req.headers, bytes });
      if (req.headers["content-range"] === `bytes */${video.length}`) {
        res.writeHead(308, { Range: `bytes=0-${received.length - 1}` }).end();
        return;
      }
      if (opts.failFirst && puts.length === 1) {
        received = bytes.subarray(0, 100);
        res.writeHead(503).end();
        return;
      }
      received = Buffer.concat([received, bytes]);
      res.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify({ id: "vid123", status: { privacyStatus: "private", uploadStatus: "uploaded" } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/upload/session-1`;
  return { url, puts, received: () => received, close: () => new Promise((r) => server.close(r)) };
};

test("upload: resumable protocol, streamed bytes, #Shorts in title, reported privacy and shorts URL", async () => {
  const dir = tempDir();
  const video = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
  const session = await sessionServer(video);
  try {
    const file = join(dir, "clip.MP4");
    writeFileSync(file, video);
    const google: Google = { sessionUrl: session.url };
    const result = await upload(
      { file, title: "Cat jumps", description: "Watch", tags: ["cats", "funny cat"], privacy: "public", short: true },
      { client, tokens: memoryStore("rt-1"), fetch: fakeFetch(google) },
    );
    assert.deepEqual(result, { videoId: "vid123", privacy: "private", url: "https://youtube.com/shorts/vid123" });
    assert.deepEqual(google.init!.body, {
      snippet: { title: "Cat jumps #Shorts", description: "Watch", tags: ["cats", "funny cat"] },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
    });
    assert.equal(google.init!.headers.get("x-upload-content-length"), "1000");
    assert.equal(google.init!.headers.get("x-upload-content-type"), "video/mp4");
    assert.equal(google.init!.headers.get("authorization"), "Bearer at-2");
    assert.equal(session.puts.length, 1);
    assert.equal(session.puts[0].headers["content-length"], "1000");
    assert.equal(session.puts[0].headers["content-type"], "video/mp4");
    assert.deepEqual(session.received(), video);
    assert.equal(readFileSync(file).length, 1000);
  } finally { await session.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("upload: a 503 is resumed from the Range the server reports; long title moves #Shorts to the description", async () => {
  const dir = tempDir();
  const video = Buffer.from(Array.from({ length: 1000 }, (_, i) => (i * 7) % 256));
  const session = await sessionServer(video, { failFirst: true });
  try {
    const file = join(dir, "clip.mp4");
    writeFileSync(file, video);
    const google: Google = { sessionUrl: session.url };
    const title = "x".repeat(95);
    const result = await upload({ file, title, description: "Hi", privacy: "unlisted", short: true }, { client, tokens: memoryStore("rt-1"), fetch: fakeFetch(google) });
    assert.equal(result.url, "https://youtube.com/shorts/vid123");
    assert.equal(google.init!.body.snippet.title, title);
    assert.equal(google.init!.body.snippet.description, "Hi\n#Shorts");
    assert.equal(session.puts.length, 3);
    assert.equal(session.puts[1].headers["content-range"], "bytes */1000");
    assert.equal(session.puts[2].headers["content-range"], "bytes 100-999/1000");
    assert.equal(session.puts[2].headers["content-length"], "900");
    assert.deepEqual(session.received(), video);
  } finally { await session.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("upload: not a short returns youtu.be and keeps the title", async () => {
  const dir = tempDir();
  const session = await sessionServer(Buffer.alloc(5));
  try {
    const file = join(dir, "a.mp4");
    writeFileSync(file, Buffer.alloc(5));
    const google: Google = { sessionUrl: session.url };
    const result = await upload({ file, title: "Plain", description: "", privacy: "private" }, { client, tokens: memoryStore("rt-1"), fetch: fakeFetch(google) });
    assert.equal(result.url, "https://youtu.be/vid123");
    assert.equal(google.init!.body.snippet.title, "Plain");
    assert.equal("tags" in google.init!.body.snippet, false);
  } finally { await session.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("upload: validation errors before any network call", async () => {
  const dir = tempDir();
  try {
    const mp4 = join(dir, "ok.mp4");
    writeFileSync(mp4, Buffer.alloc(10));
    const big = join(dir, "big.mp4");
    writeFileSync(big, "");
    truncateSync(big, 256 * 1024 * 1024 + 1); // sparse, no real disk use
    const mov = join(dir, "clip.mov");
    writeFileSync(mov, Buffer.alloc(10));
    const deps = { client, tokens: memoryStore("rt-1"), fetch: (() => { throw new Error("network used"); }) as typeof fetch };
    const base = { file: mp4, title: "t", description: "", privacy: "private" as const };
    const cases: [object, RegExp][] = [
      [{ file: join(dir, "missing.mp4") }, /does not exist/],
      [{ file: mov }, /Only \.mp4/],
      [{ file: big }, /larger than 256 MB/],
      [{ title: "  " }, /title must be 1 to 100/],
      [{ title: "x".repeat(101) }, /title must be 1 to 100/],
      [{ description: "é".repeat(2501) }, /description must be at most 5000 bytes/],
      [{ tags: ["a".repeat(250), "b".repeat(250)] }, /tags must be at most 500/],
      [{ tags: [`${"a b".repeat(166)}c`] }, /tags must be at most 500/], // 499 chars + 2 quotes YouTube adds
    ];
    for (const [change, error] of cases) await assert.rejects(upload({ ...base, ...change }, deps), error);
    await assert.rejects(upload(base, { ...deps, tokens: memoryStore() }), /YouTube is not connected/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
