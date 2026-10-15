import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_FETCH_URL_DATA, webFetchProblem } from "./web-guard.ts";

// 2026-10-16 (security review): WebFetch had no checks. A page, a file or an agent report could make a fetch of a local service
// (SSRF) or of an address that carries data out in its query.

test("ordinary public pages are allowed, with and without a short query", () => {
  for (const url of ["https://en.wikipedia.org/wiki/Glacier", "http://example.com/a?b=c#d", "https://www.nature.com/articles/s41586-025-12345-6?error=cookies_not_supported", "https://sub.domain.co.uk:8443/x"]) {
    assert.equal(webFetchProblem(url), undefined, url);
  }
});

test("local and private-network addresses are refused, in every spelling the URL parser knows", () => {
  for (const url of [
    "http://localhost/", "http://localhost:3000/admin", "https://foo.localhost/", "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://0x7f.0.0.1/",
    "http://10.0.0.5/", "http://172.16.4.2/", "http://172.31.255.255/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/",
    "http://0.0.0.0/", "http://100.64.0.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fe80::1]/", "http://[2001:db8::1]/",
    "http://router/", "http://intranet/wiki", "https://printer.local/", "https://nas.lan/", "https://svc.internal/", "https://x.home.arpa/",
  ]) {
    assert.match(webFetchProblem(url) ?? "", /local or private|not a public/i, url);
  }
});

test("a public address next to the private ranges is not caught by mistake", () => {
  for (const url of ["http://172.15.0.1/", "http://172.32.0.1/", "http://11.0.0.1/", "http://192.169.0.1/", "http://100.63.0.1/", "http://100.128.0.1/"]) {
    assert.equal(webFetchProblem(url), undefined, url);
  }
});

test("only http and https; no login in the address; no long query or fragment", () => {
  assert.match(webFetchProblem("file:///etc/passwd") ?? "", /http/);
  assert.match(webFetchProblem("ftp://example.com/") ?? "", /http/);
  assert.match(webFetchProblem("javascript:alert(1)") ?? "", /http/);
  assert.match(webFetchProblem("https://user:pass@example.com/") ?? "", /login/);
  assert.match(webFetchProblem(`https://evil.test/?d=${"a".repeat(MAX_FETCH_URL_DATA + 10)}`) ?? "", /characters of data/);
  assert.match(webFetchProblem(`https://evil.test/#${"b".repeat(MAX_FETCH_URL_DATA + 10)}`) ?? "", /characters of data/);
  assert.equal(webFetchProblem(`https://ok.test/?d=${"a".repeat(MAX_FETCH_URL_DATA - 10)}`), undefined);
});

test("a missing or malformed address is a plain problem, never a throw", () => {
  for (const bad of [undefined, null, 42, "", "not a url", {}]) assert.match(webFetchProblem(bad) ?? "", /address/i);
});
