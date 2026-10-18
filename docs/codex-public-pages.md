# Codex public-page reading

Implemented 2026-10-18, ADR-159. This closes known-URL page reading for Codex research workers. Search remains a separate gap; it does not introduce a search service or turn on Codex's native web/browser tools.

## User behavior

When a chat's web access is enabled, a Codex research worker can read a known public HTTPS page through `atom_WebFetch` and return a report with the actual source URL. Main delegation and worker instructions describe this capability explicitly. Folders/think workers and the foreground model do not receive this tool. There is no automatic provider switch or Claude fallback.

Admission requires a host-only request flag, the current global `ATOM_WEB` configuration and the current project's web setting. Missing admission/configuration denies access. Deleted source chats deny it. The worker must still be available, have the research kit and have an active running task. Current configuration/task checks run before connections, on response headers/data and before returning text; disabling access withholds a pending result and prevents subsequent connections. A stalled connection may remain open until Stop, incoming data or timeout. Stop aborts the socket and prevents a late DNS result from connecting. Previously returned text cannot be recalled.

## Bounds and destination policy

- Two page-read attempts per task, including network/policy failures. Valid string calls reserve an attempt before awaiting, so parallel calls share the limit.
- A 15-second deadline covers DNS, connections, redirects and body transfer for one attempt. At most two redirects, or three HTTPS requests, per attempt. There are no retries or automatic address fallbacks.
- Existing URL/data/taint checks apply before DNS and again before connecting to each destination. Only HTTPS on port 443 is supported. Login-bearing URLs, local names and IPv6 literals are refused. Fragments are removed after validation.
- Resolve IPv4 addresses only; reject destinations with private, local, shared, documentation, benchmark, multicast or reserved results. Reject mixed public/private IPv4 answers. Pin the chosen validated address into the connection's lookup callback while retaining the original hostname for TLS identity and Host. Use a fresh direct HTTPS connection; do not re-resolve during connection setup.
- At most 16 KiB response headers and 512 KiB body. Only HTTP 200 HTML/plain-text/Markdown responses with UTF-8/ASCII or unspecified charset are read. Unsupported/compressed bodies and other file types are refused. Redirect responses are closed without consuming their bodies; the next target gets full policy and DNS checks.
- Return at most 12,000 text characters with the actual final URL and a visible truncation notice. Extraction omits comments and script/style/head/template-like regions, decodes a small entity subset and normalizes whitespace. It is a simple bounded text reader, not a DOM renderer; malformed markup may omit text. No JavaScript, subresources, link crawling, downloads, browser login or PDF/image parsing.

This deliberately refuses IPv6-only sites, HTTP-only sites, nonstandard ports, compressed-only responses and unsupported encodings. DNS rebinding protection covers the chosen IPv4 socket destination, not arbitrary network routing, transparent infrastructure or a server proxying other resources itself.

## Data and permission boundary

Requests contain a fixed user agent/Accept headers and the requested URL, with no supplied headers, cookies, credentials, request body, browser profile, local file or chat upload. Sites see the URL and the Mac's network connection; DNS resolution uses the host's configured resolver. URL/data bounds limit what an address carries but do not prove it contains no sensitive data. Nothing executes page instructions.

Successful page responses and redirects mark the worker as having read untrusted web data through the same native gate helper used by Claude's post-tool hook. Subsequent URLs receive the stricter tainted-data checks; finishing a worker propagates this state to the main chat for the rest of its answer. Existing restrictions on persistent/outgoing ATOM actions still apply. Existing worker Board entries keep tool/timing/generic outcome only, not URLs or page text. No new storage/schema/cache/logging is added; the worker's report and final reply retain existing provider/chat behavior.

## Verification and remaining work

`pnpm typecheck` and `git diff --check` pass. Static review covered default-deny admission, current config/kit/task checks, attempt reservation, redirect/DNS/socket binding, cancellation, response bounds, extraction and taint propagation. Tests, live network/model/app/security acceptance and migrations were not run by request. No Swift source changed or build was needed. Installed app unchanged; local/uncommitted on `main`. Historical checks do not validate ADR-159.

After ADR-160, separate Codex worker model pins are implemented ([scope](codex-worker-models.md)). Remaining gaps: web search, shell commands, browser, external MCP and nested workers. Search still needs a supported isolated route; until then the model must report that it can read supplied/known URLs but cannot search.

Implementation references: [Node HTTPS](https://nodejs.org/api/https.html), [HTTP request options](https://nodejs.org/api/http.html#httprequestoptions-callback), [DNS lookup](https://nodejs.org/api/dns.html#dnspromiseslookuphostname-options). These references are API documentation, not evidence that this implementation passed live acceptance.


Subsequent update (ADR-162): checked external MCP discovery/calls are implemented for tested, enabled server assignments on non-think Codex workers. [Current MCP behavior and verification limits](codex-external-mcp.md). Earlier remaining-work statements describe their original batch; the next independent adapter is browser access.
