import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkIssues, createPaperclip, createPaperclipTools, issueTracker, paperclipBase } from "./paperclip.ts";

// ADR-087, Task 3.16: the optional Paperclip connection, against a fake Paperclip.

test("only a loopback http(s) address turns it on; anything else sends nothing", () => {
  assert.equal(paperclipBase("http://localhost:3100"), "http://localhost:3100/api");
  assert.equal(paperclipBase("http://127.0.0.1:3100/"), "http://127.0.0.1:3100/api");
  assert.equal(paperclipBase("http://[::1]:3100"), "http://[::1]:3100/api");
  for (const bad of [undefined, "", "  ", "paperclip.example.com", "http://192.168.1.5:3100", "https://paperclip.ai", "http://localhost.evil.com", "file:///etc", "http://user:pw@localhost:3100", "ftp://localhost"]) {
    assert.equal(paperclipBase(bad), undefined, String(bad));
  }
});

function fakePaperclip() {
  const calls: { method: string; url: string; body?: unknown; redirect: string }[] = [];
  const issues = new Map<string, { status: string }>();
  const comments: Record<string, { body: string }[]> = {};
  const fetch = async (url: string, init: { method: string; body?: string; redirect: string }) => {
    calls.push({ method: init.method, url, ...(init.body ? { body: JSON.parse(init.body) } : {}), redirect: init.redirect });
    const path = url.replace("http://localhost:3100/api", "");
    const reply = (status: number, data: unknown) => ({ ok: status < 400, status, json: async () => data });
    if (path === "/companies?scope=accessible") return reply(200, [{ id: "co1" }]);
    if (path === "/companies/co1/agents") return reply(200, [{ id: "ag1", name: "CTO", role: "cto" }, { id: "ag2", name: "Designer" }]);
    if (path === "/companies/co1/issues" && init.method === "POST") {
      issues.set("is1", { status: "todo" });
      return reply(201, { id: "is1", identifier: "PAP-1", title: JSON.parse(init.body!).title, status: "todo" });
    }
    if (path === "/issues/is1") return reply(200, { id: "is1", title: "Review", status: issues.get("is1")!.status });
    if (path === "/issues/is1/comments") return reply(200, comments.is1 ?? []);
    if (path === "/companies/co1/approvals?status=pending") return reply(200, [{ id: "ap1", type: "hire_agent", status: "pending", title: "Hire a designer" }]);
    if (path === "/approvals/ap1/approve" || path === "/approvals/ap1/reject") return reply(200, {});
    return reply(404, { error: "Not found" });
  };
  return { calls, issues, comments, client: createPaperclip("http://localhost:3100/api", { fetch }) };
}

test("Pal hands a task to a Paperclip agent; the board tracks it; its result comes back once, said in one line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-pc-"));
  try {
    const pc = fakePaperclip();
    const tracker = issueTracker(join(dir, "paperclip.json"));
    let changes = 0;
    const [hand, check] = createPaperclipTools({ client: pc.client, tracker, confirm: async () => true, onChange: () => changes++ });
    assert.equal(await hand!.run({ agent: "cto", title: "Review", description: "Review the landing page" }), "Handed to Paperclip's CTO as PAP-1. ATOM will say when it is done.");
    assert.deepEqual(pc.calls.find((c) => c.method === "POST")!.body, { title: "Review", description: "Review the landing page", status: "todo", assigneeAgentId: "ag1" });
    assert.ok(pc.calls.every((c) => c.redirect === "error"), "never redirected anywhere");
    assert.deepEqual(tracker.list().map((i) => [i.identifier, i.agent, i.status]), [["PAP-1", "CTO", "todo"]]);
    assert.equal(changes, 1);
    assert.deepEqual(await checkIssues(pc.client, tracker), []);
    pc.issues.set("is1", { status: "done" });
    pc.comments.is1 = [{ body: "Looks fine." }, { body: "Done: three fixes." }];
    assert.deepEqual(await checkIssues(pc.client, tracker), ['Paperclip\'s CTO finished "Review".']);
    assert.deepEqual(await checkIssues(pc.client, tracker), [], "said once");
    assert.equal(tracker.list()[0]!.result, "Done: three fixes.");
    assert.match(await check!.run({}), /PAP-1: "Review" with CTO, done\. Result: Done: three fixes\.[\s\S]*ap1: Hire a designer/);
    await assert.rejects(Promise.resolve(hand!.run({ agent: "Bob", title: "x", description: "y" })), /no agent called "Bob". Its agents: CTO, Designer/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an approval is answered only after Keshab's OK on the card", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-pc-"));
  try {
    const pc = fakePaperclip();
    let ok = false;
    const asked: string[] = [];
    const [, , decide] = createPaperclipTools({ client: pc.client, tracker: issueTracker(join(dir, "p.json")), confirm: async (r) => (asked.push(r.summary), ok) });
    assert.equal(await decide!.run({ approval: "ap1", approve: true }), "Keshab did not confirm, so nothing was sent to Paperclip.");
    assert.ok(!pc.calls.some((c) => c.url.endsWith("/approve")));
    ok = true;
    assert.equal(await decide!.run({ approval: "ap1", approve: false, note: "Not now" }), "Rejected in Paperclip.");
    assert.deepEqual(pc.calls.at(-1), { method: "POST", url: "http://localhost:3100/api/approvals/ap1/reject", body: { decisionNote: "Not now" }, redirect: "error" });
    assert.deepEqual(asked, ["Approve in Paperclip: Hire a designer", "Reject in Paperclip: Hire a designer"]);
    await assert.rejects(Promise.resolve(decide!.run({ approval: "../companies", approve: true })), /No such approval/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Paperclip that is down or refuses comes back as words", async () => {
  const down = createPaperclip("http://localhost:3100/api", { fetch: async () => Promise.reject(new Error("ECONNREFUSED")) });
  await assert.rejects(down.agents(), /not answering. Is it running on this Mac\?/);
  const refusing = createPaperclip("http://localhost:3100/api", { company: "co1", fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) }) });
  await assert.rejects(refusing.agents(), /refused that \(403: Forbidden\)/);
  await assert.rejects(refusing.issue("../../x"), /not a Paperclip id/);
});
