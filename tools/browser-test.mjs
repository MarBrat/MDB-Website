// Browser test of the app pages with Playwright (Chromium), and screenshots.
//
//   PLAYWRIGHT=<path to the playwright or @playwright/test package> node tools/browser-test.mjs <out-dir> [--live]
//
// The pages are served from the local files under their real address https://mdb-group.info, so the
// page's own Content-Security-Policy applies and the app sees the real origin. Every request is
// recorded; only https://mdb-group.info and https://b2b.mdb-group.info are allowed, and no cookie may be set.
// The error cases of the try-it form use recorded answers of the app (tools/fixtures/, built with the
// app's own code from its recorded source answers). The visitor limit is never triggered against the
// live app. With --live, two real calls go to the app: a valid number and a format error.
import { createRequire } from "node:module";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || join(ROOT, "tools", "shots");
const LIVE = process.argv.includes("--live");
const require = createRequire(join(ROOT, "tools", "browser-test.mjs"));
const pw = require(process.env.PLAYWRIGHT || "playwright");
const { chromium } = pw;
mkdirSync(OUT, { recursive: true });

const SITE = "https://mdb-group.info";
const APP = "https://b2b.mdb-group.info";
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".txt": "text/plain" };
const fixture = (n) => JSON.parse(readFileSync(join(ROOT, "tools", "fixtures", n), "utf8"));
const PAGES = ["/apps/", "/apps/b2b-check/", "/apps/b2b-check/connect/"];
const WIDTHS = [360, 768, 1280];
const LOAD_LIMIT_MS = 1500;
const errors = [];
const log = [];
const check = (ok, msg) => { if (!ok) errors.push(msg); };

const browser = await chromium.launch();
const context = await browser.newContext();
const requests = [];
context.on("request", (r) => requests.push(r.url()));
await context.route(`${SITE}/**`, (route) => {
  const u = new URL(route.request().url());
  let p = join(ROOT, decodeURIComponent(u.pathname));
  if (u.pathname.endsWith("/") || (existsSync(p) && statSync(p).isDirectory())) p = join(p, "index.html");
  if (!existsSync(p)) return route.fulfill({ status: 404, body: "not found" });
  route.fulfill({ status: 200, contentType: TYPES[extname(p)] || "application/octet-stream", body: readFileSync(p) });
});

// answer of the app for the next form call; null = let it go to the live app
let next = null;
await context.route(`${APP}/**`, async (route) => {
  if (route.request().method() === "OPTIONS" || next === null) return route.continue();
  const n = next;
  next = null;
  if (n.delayMs) await new Promise((r) => setTimeout(r, n.delayMs));
  route.fulfill({ status: n.status, contentType: n.type || "application/json", headers: { "access-control-allow-origin": SITE }, body: n.raw ?? JSON.stringify(n.body) });
});

async function open(path, lang, width) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((l) => { try { localStorage.setItem("lang", l); } catch (e) {} }, lang);
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  page.on("dialog", (d) => { errors.push(`${path}: a dialog opened (${d.message()})`); d.dismiss(); });
  await page.goto(SITE + path, { waitUntil: "load" });
  const ms = await page.evaluate(() => Math.round(performance.getEntriesByType("navigation")[0].loadEventEnd));
  return { page, consoleErrors, ms };
}

async function tryIt(page, lang, value, answer) {
  next = answer;
  const box = page.locator(`div[lang="${lang}"] .try`);
  await box.locator("input").fill(value);
  const button = box.locator("button");
  await button.click();
  const disabledDuring = answer && answer.delayMs ? await button.isDisabled() : null;
  await page.waitForFunction((l) => { const o = document.querySelector(`div[lang="${l}"] .try .out`); return o && o.textContent.trim().length > 0; }, lang, { timeout: 25000 });
  await page.waitForFunction((l) => !document.querySelector(`div[lang="${l}"] .try button`).disabled, lang, { timeout: 25000 });
  const text = (await box.locator(".out").innerText()).replace(/\s+/g, " ").trim();
  return { text, disabledDuring };
}

// ---------- pages in both languages and three widths: layout, console, load time
for (const path of PAGES) for (const lang of ["en", "de"]) for (const width of WIDTHS) {
  const { page, consoleErrors, ms } = await open(path, lang, width);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(!overflow, `${path} ${lang} ${width}px: horizontal scrolling`);
  check(consoleErrors.length === 0, `${path} ${lang} ${width}px: console errors: ${consoleErrors.join(" | ")}`);
  check(ms <= LOAD_LIMIT_MS, `${path} ${lang} ${width}px: load ${ms} ms > ${LOAD_LIMIT_MS} ms`);
  const shown = await page.evaluate((l) => getComputedStyle(document.querySelector(`main > div[lang="${l}"]`)).display !== "none", lang);
  check(shown, `${path}: language ${lang} not shown after switching`);
  const name = `${path.replace(/^\/|\/$/g, "").replace(/\//g, "-") || "home"}_${lang}_${width}.png`;
  await page.screenshot({ path: join(OUT, name), fullPage: true });
  log.push(`page ${path} ${lang} ${width}px: load ${ms} ms`);
  await page.close();
}

// ---------- the try-it form
{
  const { page } = await open("/apps/b2b-check/", "en", 1280);
  const cases = [
    ["cached", "SK2120577756", { status: 200, body: fixture("cached.json").body }, (t) => t.includes("Valid") && t.includes("(from cache)") && t.includes(fixture("cached.json").body.source.checked_at.replace("T", " ").replace(/\.\d+Z$/, "") + " UTC")],
    ["unavailable", "DE811569869", { status: 200, body: fixture("unavailable.json").body }, (t) => t.includes("Could not be checked") && t.includes("This says nothing about the number") && !t.includes("Not valid")],
    ["limit 429", "SK2120577756", { status: 429, body: { error: "Too many checks from your connection. Please wait 10 minutes." } }, (t) => t.includes("Please wait 10 minutes")],
    ["bad request 400", "SK2120577756", { status: 400, body: fixture("bad_request.json").body }, (t) => t.includes("Too big")],
    ["origin 403", "SK2120577756", { status: 403, body: { error: "Origin not allowed" } }, (t) => t.includes("does not accept requests from this page")],
    ["server 502 (Cloudflare page)", "SK2120577756", { status: 502, type: "text/html", raw: "<!DOCTYPE html><title>502 Bad gateway</title><h1>Error 502</h1>" }, (t) => t.includes("could not be reached")],
    ["200 but no JSON", "SK2120577756", { status: 200, type: "text/html", raw: "<html>maintenance</html>" }, (t) => t.includes("could not be reached")],
    ["no answer within 15 s", "SK2120577756", { status: 200, body: fixture("valid.json").body, delayMs: 17000 }, (t) => t.includes("could not be reached")],
    ["name with <", "SK2120577756", { status: 200, body: { ...fixture("valid.json").body, name: "Test <b>Bold</b> & <img src=x onerror=alert(1)> GmbH" } }, (t) => t.includes("Test <b>Bold</b> & <img src=x onerror=alert(1)> GmbH")],
  ];
  for (const [label, value, answer, ok] of cases) {
    const r = await tryIt(page, "en", value, answer);
    check(ok(r.text), `form ${label}: unexpected text: ${r.text.slice(0, 200)}`);
    if (answer.delayMs) check(r.disabledDuring === true, `form ${label}: button not disabled during the request`);
    log.push(`form ${label}: ${r.text.slice(0, 110)}`);
    if (label === "unavailable") await page.locator('div[lang="en"] .try').screenshot({ path: join(OUT, "form_unavailable_en.png") });
  }
  const injected = await page.evaluate(() => document.querySelectorAll('.try .out img, .try .out b, .try .out script').length);
  check(injected === 0, `form: HTML from the answer was inserted (${injected} elements)`);
  // empty field: no request
  const before = requests.filter((u) => u.startsWith(APP)).length;
  await page.locator('div[lang="en"] .try input').fill("");
  await page.locator('div[lang="en"] .try button').click();
  await page.waitForTimeout(300);
  check(requests.filter((u) => u.startsWith(APP)).length === before, "form: empty field sent a request");
  check((await page.locator('div[lang="en"] .try .out').innerText()).includes("Enter a VAT ID"), "form: no hint for an empty field");
  await page.close();
}

// German page: fixed texts German, app texts English with a hint
{
  const { page } = await open("/apps/b2b-check/", "de", 1280);
  const r = await tryIt(page, "de", "DE811569869", { status: 200, body: fixture("unavailable.json").body });
  check(r.text.includes("Nicht prüfbar") && r.text.includes("Das sagt nichts über die Nummer") && r.text.includes("Texte der App auf Englisch"), `form de: ${r.text.slice(0, 200)}`);
  log.push(`form de unavailable: ${r.text.slice(0, 110)}`);
  await page.close();
}

// ---------- real calls to the live app (valid, format error)
if (LIVE) {
  for (const [lang, value, want] of [["en", "SK2120577756", "Valid"], ["de", "SK2120577756", "Gültig"], ["en", "SK2120577757", "Format error"]]) {
    const { page } = await open("/apps/b2b-check/", lang, lang === "de" ? 360 : 1280);
    const t0 = new Date().toISOString();
    const r = await tryIt(page, lang, value, null);
    check(r.text.includes(want), `live ${lang} ${value}: ${r.text.slice(0, 200)}`);
    log.push(`live ${t0} ${lang} ${value}: ${r.text.slice(0, 160)}`);
    await page.locator(`div[lang="${lang}"] .try`).screenshot({ path: join(OUT, `form_live_${value}_${lang}.png`) });
    await page.close();
  }
}

// ---------- requests and cookies
const hosts = [...new Set(requests.map((u) => new URL(u).origin))];
check(hosts.every((h) => h === SITE || h === APP), `requests to other hosts: ${hosts.join(", ")}`);
const cookies = await context.cookies();
check(cookies.length === 0, `cookies set: ${cookies.map((c) => c.name).join(", ")}`);
log.push(`requests: ${requests.length} to ${hosts.join(", ")}; cookies: ${cookies.length}`);

await browser.close();
for (const l of log) console.log(l);
if (errors.length) { for (const e of errors) console.log("FAIL: " + e); process.exitCode = 1; }
else console.log(`browser test: all checks passed${LIVE ? " (with live calls)" : ""}`);
