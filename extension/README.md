# Job Finder Harvester (browser extension)

Harvests jobs from **Indeed, CareerBuilder, LinkedIn, Glassdoor, and
ZipRecruiter** straight from your real, logged-in browser session (no headless
flag → no anti-bot wall) and pushes them to the Job Finder desktop app's local
hub. Also remembers apply-form answers.

> Selectors for CareerBuilder / LinkedIn / Glassdoor / ZipRecruiter are
> best-effort and may need tuning against the live pages; Indeed is solid.

## Install (Chrome / Opera / Edge — Chromium)

1. Start the Job Finder desktop app (`npm run dev`).
2. Go to `chrome://extensions` (or `opera://extensions`), enable **Developer mode**.
3. **Load unpacked** → select this `extension/` folder. (`npm run ext:pack` zips it
   to `dist-installer/job-finder-extension.zip` for distribution / a future
   Chrome Web Store submission — store publishing is the only way around
   Developer Mode.)
4. Open the app → **Settings → Browser extension pairing**. Copy the **Hub URL**
   and **Pairing token**.
5. Click the extension's toolbar icon → paste both → **Save** → **Test connection**
   (should say ✓ Connected).

## Use

The simple path (Indeed): in the app's **Search** tab, set your filters and hit
**Search Indeed ↗**. The browser opens the search; with **Auto-harvest** on, the
extension harvests each results page, **walks pagination itself** (up to the
"max pages" setting, default 5), and streams jobs into the app. Opening any
Indeed job's detail page also captures its **full description + salary**, which
enriches the job in the app (and re-embeds it for better fit ranking).

Manual controls:

- Click the extension → **Harvest this page** to send the visible jobs to the app.
- **Auto-harvest results pages** — harvest every results page you land on.
- **Auto-walk next pages (max N)** — after harvesting, click Indeed's next-page
  link automatically with a human-ish delay. New search in the tab = counter resets.
- **Capture apply-form answers** — fields you fill on application forms are saved
  to the app's field memory for future autofill (never captures passwords /
  hidden / file inputs).

## Notes

- The hub only listens on `127.0.0.1` and requires the pairing token.
- If a results page yields **0 job cards**, the extension reports it to the app,
  which raises a "scraper may be stale" notification (max one per site per 6 h)
  instead of failing silently.
- CareerBuilder selectors are best-effort and may need tuning after a recon pass.
