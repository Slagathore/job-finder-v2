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
3. **Load unpacked** → select this `extension/` folder.
4. Open the app → **Settings → Browser extension pairing**. Copy the **Hub URL**
   and **Pairing token**.
5. Click the extension's toolbar icon → paste both → **Save** → **Test connection**
   (should say ✓ Connected).

## Use

- Open an **Indeed** or **CareerBuilder** search results page.
- Click the extension → **Harvest this page** to send the visible jobs to the app.
- Or toggle **Auto-harvest results pages** — then just click through result pages
  and each one is harvested automatically (this is how pagination works).
- Toggle **Capture apply-form answers** to have fields you fill on application
  forms saved to the app's field memory for future autofill (never captures
  passwords / hidden / file inputs).

## Notes

- The hub only listens on `127.0.0.1` and requires the pairing token.
- CareerBuilder selectors are best-effort and may need tuning after a recon pass.
