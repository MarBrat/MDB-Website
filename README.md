# MDB Group website

Static website of MDB Group s.r.o. on GitHub Pages (`main` is live at https://mdb-group.info). No build step: every page is an HTML file.

## Pages

- `index.html`, `imprint.html`, `privacy.html`, `terms.html`, `404.html`: company pages with inline style and script (allowed by hash in their Content-Security-Policy).
- `apps/`: catalogue of the apps; `apps/<app>/`: product page; `apps/<app>/connect/`: how to connect. These pages use the shared files `assets/site.css` (copied from `index.html`, plus the app components) and `assets/lang.js` (language switch EN/DE). The product page of MDB B2B Check also loads `assets/try.js` for the form "Try it now", which calls `https://b2b.mdb-group.info/api/v1/check_vat_id` directly from the browser; only that page allows `connect-src https://b2b.mdb-group.info`.

## Adding an app

1. Copy `apps/b2b-check/` to `apps/<new-app>/` and change the texts (English and German in the same page). Leave out `assets/try.js` and `connect-src` if the app has no form.
2. Add a tile (`<a class="card tile" …>`) in both languages to `apps/index.html`.
3. Add the pages to `sitemap.xml`.
4. Name only functions that are live, and use only example numbers that pass their check digit (add them to the list in `tools/check.mjs`).

## Checks

- `node tools/check.mjs`: languages, menu, links and anchors, Content-Security-Policy against inline and external scripts and styles, check digits of all example numbers, the tool list of MDB B2B Check against the product page and, when the app can be reached, against the app; size limits.
- `PLAYWRIGHT=<path to playwright> node tools/browser-test.mjs <out-dir> [--live]`: serves the pages under their real address, checks three widths (360, 768, 1280 px) in both languages, the error cases of the form with recorded answers of the app (`tools/fixtures/`), that the page only talks to its own domain and the app and sets no cookie, and saves screenshots. `--live` adds two real calls to the app.
