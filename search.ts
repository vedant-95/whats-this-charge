import Browserbase from "@browserbasehq/sdk";
import { chromium, type Page } from "playwright-core";
import { fetch as undiciFetch } from "undici";
import type { Parsed } from "./normalize";

export type Candidate = { title: string; url: string; host: string; snippet: string; source: string };

// spectrum-ts (via open-graph-scraper) installs npm undici's Agent as the global
// dispatcher. Node's built-in fetch then fails with "invalid content-length header",
// so use npm undici's own fetch to match it.
const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY!, fetch: undiciFetch as any });

function host(u: string) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// DuckDuckGo HTML results wrap links in a redirect; unwrap them.
function unwrap(u: string) {
  try {
    const x = new URL(u, "https://duckduckgo.com");
    return x.searchParams.get("uddg") ?? x.toString();
  } catch { return u; }
}

async function ddg(page: Page, q: string) {
  await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { waitUntil: "domcontentloaded", timeout: 20000 });
  const rows = await page.$$eval(".result:not(.result--ad)", (nodes) =>
    nodes.slice(0, 6).map((n) => {
      const a = n.querySelector(".result__a") as any;
      return {
        title: a?.textContent?.trim() ?? "",
        url: a?.getAttribute("href") ?? "",
        snippet: n.querySelector(".result__snippet")?.textContent?.trim() ?? "",
      };
    })
  );
  return rows.map((r) => ({ ...r, url: unwrap(r.url) }));
}

// Bing wraps links as bing.com/ck/a?...&u=a1<base64url>; decode the real URL.
function unwrapBing(u: string) {
  try {
    const x = new URL(u);
    const enc = x.searchParams.get("u");
    if (x.hostname.endsWith("bing.com") && enc?.startsWith("a1")) {
      return Buffer.from(enc.slice(2), "base64url").toString("utf8");
    }
    return u;
  } catch { return u; }
}

async function bing(page: Page, q: string) {
  await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(q)}`, { waitUntil: "domcontentloaded", timeout: 20000 });
  const rows = await page.$$eval("li.b_algo", (nodes) =>
    nodes.slice(0, 6).map((n) => {
      const a = n.querySelector("h2 a") as any;
      return {
        title: a?.textContent?.trim() ?? "",
        url: a?.getAttribute("href") ?? "",
        snippet: n.querySelector(".b_caption p, .b_lineclamp2, .b_lineclamp3")?.textContent?.trim() ?? "",
      };
    })
  );
  return rows.map((r) => ({ ...r, url: unwrapBing(r.url) }));
}

async function search(q: string, source: string): Promise<Candidate[]> {
  const t0 = Date.now();
  let browser;
  try {
    const session = await bb.sessions.create({ projectId: process.env.BROWSERBASE_PROJECT_ID! });
    browser = await chromium.connectOverCDP(session.connectUrl);
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    let rows = await ddg(page, q).catch(() => []);
    if (rows.length === 0) rows = await bing(page, q).catch(() => []);
    console.log(`[browserbase] ${source} "${q}" -> ${rows.length} results in ${Date.now() - t0}ms`);
    return rows
      .filter((r) => r.title && r.url.startsWith("http"))
      .map((r) => ({ ...r, host: host(r.url), source }));
  } catch (e) {
    console.error(`[browserbase] ${source} failed:`, (e as Error).message);
    return [];
  } finally {
    await browser?.close().catch(() => {});
  }
}

export async function findCandidates(p: Parsed): Promise<Candidate[]> {
  const queries: [string, string][] = [
    [`${p.name} ${p.state ?? ""}`.trim(), "name"],
    // Unquoted, phone stripped: lets the engine fuzzy-match truncations (BOTL -> Bottle).
    [`${p.raw.replace(/\d{7,}/g, "").replace(/\s+/g, " ").trim()} charge`, "raw"],
  ];
  if (p.phone) queries.push([`"${p.phone}"`, "phone"]);

  const results = (await Promise.all(queries.map(([q, s]) => search(q, s)))).flat();

  // Dedupe by domain, keep first, cap for Jev.
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of results) {
    if (!c.host || seen.has(c.host)) continue;
    seen.add(c.host);
    out.push(c);
    if (out.length >= 15) break;
  }
  return out;
}
