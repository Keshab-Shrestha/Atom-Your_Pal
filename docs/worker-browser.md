# Worker browser: agent-browser on the installed Brave

Date: 2026-10-31. Status: built and checked on a local page. Not yet used by a real worker task.

## What changed

The worker browser no longer uses Playwright MCP (Node) and its own Chromium download. It uses agent-browser 0.41.0 (a Rust program that talks to the browser directly) on the Brave that is already installed. No browser is downloaded.

## How it works

1. `browserServer()` in `apps/mac/src/browser.ts` starts `apps/mac/src/browser-bridge-main.ts` as a stdio MCP server.
2. The bridge (`browser-bridge.ts`) offers 16 `browser_*` tools with fixed arguments. It turns each call into one agent-browser command.
3. The bridge prints results in the format that `browserCheck` and `codex-browser.ts` already read: a `- Page URL:` line and `[ref=eN]` markers.
4. `browserCheck` still decides everything: site approval, typing approval, password fields, uploads, the web-text taint rule. The bridge does not decide policy.

## What the bridge refuses

- Script evaluation, cookies, storage, network tools, state files and agent-browser's own extra arguments. The model never sees them.
- Selectors. A target must be a ref such as `e12`.
- Addresses that are not http or https.

## Settings

| Name | Effect |
|---|---|
| `ATOM_BROWSER_PATH` | Path to another Chromium browser. Default: Brave in `/Applications`. |
| `ATOM_BROWSER_HEADLESS=1` | No visible window. Default: a visible window, as before. |

## Profile and cleanup

- ATOM keeps its own profile for each agent in `data/browser-profile/<agent>`. It never uses the Brave profile of the user.
- Each bridge process uses its own agent-browser session and closes it when the process ends. A lost bridge ends the browser after 10 minutes.

## Known limits

- `file_upload` fills the first `input[type=file]` on the page. The old tool used the open file chooser.
- `drag`, `drop` and `find` are not offered.
- A snapshot can be slightly different from the Playwright one (extra `form` and `LabelText` rows).
- The package install script does not run under pnpm. The bridge marks the native file executable itself.
- Live checks so far used a local test page and Brave. No real site and no real task have run.

## Check

```bash
node --test apps/mac/src/browser-bridge.test.ts apps/mac/src/browser.test.ts
```
