// 2026-10-16 (security review): a rule for the web fetches Claude Code makes for ATOM (WebFetch), on the main thread and in
// research agents. A page, a file or an agent report can name an address. Two ways that goes wrong, both closed here:
//  - SSRF: a fetch of a service on this Mac or on the home network (a router's admin page, a cloud metadata address, a local server).
//  - Data out: an address like https://evil.test/?d=<secret> sends what it carries to whoever runs that site.
// The check is on the address as written. A public name that resolves to a private address (DNS rebinding) is not caught: WebFetch
// is Claude Code's own tool, and ATOM sees only the address.

/** The most characters of query and fragment a fetched address may carry. Longer than open_url's 300: a fetch of an article may keep tracking parameters. */
export const MAX_FETCH_URL_DATA = 500;
/** The longest whole address a fetch may have: the path and host carry data out as well as the query (code check, 2026-10-16). */
export const MAX_FETCH_URL_LENGTH = 1200;

const PRIVATE_SUFFIXES = [".localhost", ".local", ".lan", ".internal", ".home.arpa", ".corp", ".intranet"];

/** Is this dotted IPv4 address in a loopback, private, link-local, shared (carrier-grade NAT), "this network" or multicast range? */
function isPrivateIPv4(host: string): boolean {
  const p = host.split(".").map(Number);
  const [a = 0, b = 0] = p;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** Why this WebFetch address must not be fetched, in words for the model, or undefined when it is fine. Never throws. */
export function webFetchProblem(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return "WebFetch needs the full web address of a page.";
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "That is not a web address. WebFetch needs the full address of a page, starting with https://.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "WebFetch reads only http and https pages.";
  if (url.href.length > MAX_FETCH_URL_LENGTH) return `That address is ${url.href.length} characters long. Skip it and say so in the report.`;
  if (url.username || url.password) return "An address with a login in it is not fetched. Skip that page and say so in the report.";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const notPublic = "That address is a local or private one, not a public page. Skip it and say so in the report.";
  if (host.startsWith("[")) return notPublic; // an IPv6 address written out: loopback, mapped, link-local and unique-local all live here
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPrivateIPv4(host) ? notPublic : dataProblem(url);
  if (!host.includes(".") || host === "localhost" || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return notPublic;
  return dataProblem(url);
}

function dataProblem(url: URL): string | undefined {
  const data = url.search.length + url.hash.length;
  return data > MAX_FETCH_URL_DATA
    ? `That address carries ${data} characters of data after the page name. Fetch the page without that data, or skip it and say so in the report.`
    : undefined;
}
