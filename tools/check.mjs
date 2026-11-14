// Checks for the MDB Group website, without dependencies: node tools/check.mjs
// Exit code 1 if a check fails. Network checks (tool list and example numbers against the app)
// are skipped with a warning when the app cannot be reached.
//
//  1. every page has English and German content and the menu item "Apps"
//  2. internal links and anchors point to existing files and ids
//  3. the Content-Security-Policy of each page matches its inline and external scripts and styles;
//     the page with the try-it form may connect to https://b2b.mdb-group.info, no other page may connect anywhere
//  4. every example number on the app pages passes its check digit (rules below), and every number
//     that looks like a VAT ID, Swiss UID, NIP, Finnish Business ID or IBAN is on the list
//  5. the list "What is checked" covers every tool of the app (tool list from the app when online)
//  6. size limits per page

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = "https://b2b.mdb-group.info";
const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

const pages = [];
(function walk(dir) {
  for (const n of readdirSync(dir)) {
    if (n.startsWith(".") || n === "tools" || n === "node_modules") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith(".html")) pages.push(p);
  }
})(ROOT);
const rel = (p) => relative(ROOT, p).split(sep).join("/");
// GitHub serves the files with LF; a Windows checkout can have CRLF. Hashes and sizes use LF.
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const appPages = pages.filter((p) => rel(p).startsWith("apps/"));

// ---------- 1. languages and menu
for (const p of pages) {
  const s = read(p);
  if (!/lang="en"/.test(s.replace(/<html lang="en">/, "")) || !/lang="de"/.test(s)) fail(`${rel(p)}: English or German content missing`);
  const nav = s.match(/<nav aria-label="Main">([\s\S]*?)<\/nav>/);
  if (!nav || !/href="\/apps\/"/.test(nav[1])) fail(`${rel(p)}: menu item "Apps" missing`);
}

// ---------- 2. internal links and anchors
const idsOf = (file) => new Set([...read(file).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
for (const p of pages) {
  const s = read(p);
  for (const m of s.matchAll(/\shref="([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|tel:|data:)/.test(href)) continue;
    const [path, anchor] = href.split("#");
    let target;
    if (path === "") target = p;
    else {
      const base = path.startsWith("/") ? join(ROOT, path) : join(dirname(p), path);
      target = base.endsWith("/") || (existsSync(base) && statSync(base).isDirectory()) ? join(base, "index.html") : base;
    }
    if (!existsSync(target)) { fail(`${rel(p)}: link ${href} points to a missing file`); continue; }
    if (anchor && target.endsWith(".html") && !idsOf(target).has(anchor)) fail(`${rel(p)}: anchor #${anchor} missing in ${rel(target)}`);
  }
}

// ---------- 3. Content-Security-Policy
const sha = (text) => "'sha256-" + createHash("sha256").update(text, "utf8").digest("base64") + "'";
for (const p of pages) {
  const s = read(p);
  const m = s.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  if (!m) { fail(`${rel(p)}: no Content-Security-Policy`); continue; }
  const dir = Object.fromEntries(m[1].split(";").map((x) => x.trim()).filter(Boolean).map((x) => { const [k, ...v] = x.split(/\s+/); return [k, v]; }));
  for (const k of ["default-src", "base-uri", "form-action"]) if (!dir[k]) fail(`${rel(p)}: CSP without ${k}`);
  if (dir["default-src"] && dir["default-src"].join(" ") !== "'none'") fail(`${rel(p)}: default-src must be 'none'`);
  for (const [tag, key] of [["script", "script-src"], ["style", "style-src"]]) {
    for (const im of s.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))) {
      if (!(dir[key] || []).includes(sha(im[1]))) fail(`${rel(p)}: inline <${tag}> not allowed by ${key} (hash ${sha(im[1])})`);
    }
  }
  if (/<script src="\//.test(s) && !(dir["script-src"] || []).includes("'self'")) fail(`${rel(p)}: external script needs script-src 'self'`);
  if (/<link rel="stylesheet" href="\//.test(s) && !(dir["style-src"] || []).includes("'self'")) fail(`${rel(p)}: external stylesheet needs style-src 'self'`);
  if (/\sstyle="/.test(s)) fail(`${rel(p)}: style attribute (blocked by the CSP)`);
  const usesTry = /src="\/assets\/try\.js"/.test(s);
  const connect = (dir["connect-src"] || []).join(" ");
  if (usesTry && connect !== APP) fail(`${rel(p)}: connect-src must be exactly ${APP}`);
  if (!usesTry && connect) fail(`${rel(p)}: connect-src set although the page has no form`);
}
// the try-it script talks to the app only
const tryJs = read(join(ROOT, "assets/try.js"));
const urls = [...tryJs.matchAll(/https?:\/\/[^\s"'\\)]+/g)].map((m) => m[0]).filter((u) => !u.startsWith(APP));
if (urls.length) fail(`assets/try.js: addresses other than ${APP}: ${urls.join(", ")}`);
if (/innerHTML|insertAdjacentHTML|document\.write/.test(tryJs)) fail("assets/try.js: must build the result with textContent only");

// ---------- 4. example numbers
const digits = (s) => s.replace(/\D/g, "");
const mod97 = (str) => { let r = 0; for (const c of str) r = (r * 10 + Number(c)) % 97; return r; };
const RULES = {
  SK: (n) => n.length === 10 && BigInt(n) % 11n === 0n,
  AT: (n) => { // ATU + 8 digits, weights 1,2,1,2,1,2,1
    if (!/^\d{8}$/.test(n)) return false;
    let sum = 0;
    for (let i = 0; i < 7; i++) { let x = Number(n[i]) * (i % 2 ? 2 : 1); sum += x > 9 ? Math.floor(x / 10) + (x % 10) : x; }
    return (10 - ((sum + 4) % 10)) % 10 === Number(n[7]);
  },
  IT: (n) => { // Luhn over 11 digits
    if (!/^\d{11}$/.test(n)) return false;
    let sum = 0;
    for (let i = 0; i < 11; i++) { let x = Number(n[i]); if (i % 2) { x *= 2; if (x > 9) x -= 9; } sum += x; }
    return sum % 10 === 0;
  },
  BE: (n) => n.length === 10 && 97 - (Number(n.slice(0, 8)) % 97) === Number(n.slice(8)),
  CHE: (n) => { // UID: 9 digits, weights 5,4,3,2,7,6,5,4
    if (!/^\d{9}$/.test(n)) return false;
    const w = [5, 4, 3, 2, 7, 6, 5, 4];
    const r = 11 - (w.reduce((a, x, i) => a + x * Number(n[i]), 0) % 11);
    return (r === 11 ? 0 : r) === Number(n[8]);
  },
  FI: (n) => { // Y-tunnus 7 digits + check digit
    if (!/^\d{8}$/.test(n)) return false;
    const w = [7, 9, 10, 5, 8, 4, 2];
    const r = w.reduce((a, x, i) => a + x * Number(n[i]), 0) % 11;
    return r !== 1 && (r === 0 ? 0 : 11 - r) === Number(n[7]);
  },
  NIP: (n) => {
    if (!/^\d{10}$/.test(n)) return false;
    const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
    return w.reduce((a, x, i) => a + x * Number(n[i]), 0) % 11 === Number(n[9]);
  },
  IBAN: (s) => { const t = s.replace(/\s/g, ""); const r = t.slice(4) + t.slice(0, 4); return mod97(r.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))) === 1; },
};
// Every example number used on the app pages. A new example must be added here with its rule.
const EXAMPLES = [
  ["SK2120577756", "SK", "2120577756"],
  ["ATU33864707", "AT", "33864707"],
  ["IT00743110157", "IT", "00743110157"],
  ["CHE-113.690.319", "CHE", "113690319"],
  ["BE0202239951", "BE", "0202239951"],
  ["0112038-9", "FI", "01120389"],
  ["774-000-14-54", "NIP", "7740001454"],
  ["PL30 1020 1026 0000 1402 0355 0589", "IBAN", "PL30 1020 1026 0000 1402 0355 0589"],
];
const appText = appPages.map(read).join("\n");
for (const [shown, rule, value] of EXAMPLES) {
  if (!RULES[rule](value)) fail(`example ${shown}: check digit wrong (${rule})`);
  if (!appText.includes(shown)) warn(`example ${shown} is no longer used on the app pages; remove it from the list`);
}
const PATTERNS = [/\b(?:AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)U?\d{8,12}\b/g, /\bCHE-\d{3}\.\d{3}\.\d{3}\b/g, /\b\d{3}-\d{3}-\d{2}-\d{2}\b/g, /\b\d{7}-\d\b/g, /\b[A-Z]{2}\d{2}(?: \d{4}){3,7}(?: \d{1,4})?\b/g];
const listed = new Set(EXAMPLES.map((e) => e[0]));
const textOnly = appText.replace(/<[^>]+>/g, " ");
for (const re of PATTERNS) for (const m of textOnly.matchAll(re)) if (!listed.has(m[0])) fail(`number ${m[0]} on the app pages is not on the example list (check digit not checked)`);

// ---------- 5. tools covered by "What is checked"
// Tool name -> words that must appear in the English list on the product page. A new tool of the app
// fails here until it is either described on the page or deliberately left out (OMIT).
const COVER = {
  check_vat_id: "EU VAT IDs", check_vat_ids: "EU VAT IDs", validate_vat_format: "check digit", vies_status: "VIES",
  find_swiss_company: "by company name", check_eori: "EORI", find_peppol_participant: "Peppol", find_lei: "LEI",
  check_business_partner: "Full partner check", check_iban: "IBAN", get_exchange_rate: "ECB reference rates",
  check_payment_details: "BIC", calculate_late_interest: "late-payment interest", validate_tax_id_format: "Tax ID formats",
  check_company_register: "Company registers", check_registered_bank_account: "Bank account at the tax authority",
  verify_receipt: "Signed receipts",
};
const OMIT = new Set([]);
const product = read(join(ROOT, "apps/b2b-check/index.html"));
const productEn = product.slice(product.indexOf('<div lang="en">'), product.indexOf('<div lang="de">'));
for (const [tool, word] of Object.entries(COVER)) if (!productEn.includes(word)) fail(`product page: "${word}" (for ${tool}) missing`);

async function online() {
  let tools;
  try {
    const r = await fetch(`${APP}/api/v1/`, { signal: AbortSignal.timeout(15000) });
    tools = (await r.json()).tools.map((t) => t.name);
  } catch (e) {
    warn(`app not reachable (${e.name}): tool list and example numbers not checked against the app`);
    return;
  }
  for (const t of tools) if (!COVER[t] && !OMIT.has(t)) fail(`tool ${t} of the app is neither on the product page (COVER) nor deliberately left out (OMIT)`);
  for (const t of Object.keys(COVER)) if (!tools.includes(t)) fail(`COVER names ${t}, which the app no longer has`);
  // VAT IDs and UIDs: the app's offline format check (asks no register)
  const vat = EXAMPLES.filter((e) => ["SK", "AT", "IT", "BE", "CHE"].includes(e[1])).map((e) => e[0]);
  try {
    const r = await fetch(`${APP}/api/v1/validate_vat_format`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vat_ids: vat }), signal: AbortSignal.timeout(15000) });
    const body = await r.json();
    for (const x of body.results) if (!(x.format_ok && x.checksum_ok === true)) fail(`app: ${x.input} does not pass format and check digit`);
  } catch (e) {
    warn(`validate_vat_format not reachable (${e.name}); example numbers checked locally only`);
  }
  console.log(`check: app has ${tools.length} tools; ${vat.length} example VAT IDs confirmed by validate_vat_format`);
}

// ---------- 6. size limits (bytes): page HTML, and page plus its own CSS and scripts
const LIMIT_HTML = 40_000;
const LIMIT_TOTAL = 80_000;
for (const p of appPages) {
  const s = read(p);
  const html = Buffer.byteLength(s);
  let total = html;
  for (const m of s.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) total += statSync(join(ROOT, m[1])).size;
  if (html > LIMIT_HTML) fail(`${rel(p)}: ${html} bytes HTML, limit ${LIMIT_HTML}`);
  if (total > LIMIT_TOTAL) fail(`${rel(p)}: ${total} bytes with CSS and scripts, limit ${LIMIT_TOTAL}`);
  console.log(`size ${rel(p)}: ${html} bytes HTML, ${total} with CSS and scripts (fonts not counted, shared with the whole site)`);
}

await online();
for (const w of warnings) console.log("warning: " + w);
if (errors.length) {
  for (const e of errors) console.log("FAIL: " + e);
  process.exitCode = 1;
} else console.log(`check: all checks passed (${pages.length} pages)`);
