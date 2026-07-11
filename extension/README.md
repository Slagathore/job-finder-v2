# Job Finder Harvester (browser extension)

Harvests jobs from Indeed, CareerBuilder, LinkedIn, Glassdoor, and ZipRecruiter straight from your real, logged-in browser session, so there is no headless flag and no anti-bot wall, and pushes them to the Job Finder desktop app's local hub. It also remembers apply-form answers.

> Selectors for CareerBuilder, LinkedIn, Glassdoor, and ZipRecruiter are best-effort and may need tuning against the live pages. Indeed is solid.

## Install (Chrome / Opera / Edge, any Chromium browser)

1. Start the Job Finder desktop app (`npm run dev`).
2. Go to `chrome://extensions` (or `opera://extensions`) and turn on Developer mode.
3. Load unpacked, then select this `extension/` folder. (`npm run ext:pack` zips it to `dist-installer/job-finder-extension.zip` for distribution or a future Chrome Web Store submission. Store publishing is the only way around Developer Mode.)
4. Open the app, go to Settings, then Browser extension pairing. Copy the Hub URL and Pairing token.
5. Click the extension's toolbar icon, paste both, hit Save, then Test connection. It should report a connection.

## Use

The simple path (Indeed): in the app's Search tab, set your filters and hit Search Indeed. The browser opens the search. With Auto-harvest on, the extension harvests each results page, walks pagination itself (up to the max pages setting, default 5), and streams jobs into the app. Opening any Indeed job's detail page also captures its full description and salary, which enriches the job in the app and re-embeds it for better fit ranking.

Manual controls:

- Click the extension, then Harvest this page, to send the visible jobs to the app.
- Auto-harvest results pages: harvest every results page you land on.
- Auto-walk next pages (max N): after harvesting, click Indeed's next-page link automatically with a human-like delay. A new search in the tab resets the counter.
- Capture apply-form answers: fields you fill on application forms are saved to the app's field memory for future autofill. It never captures passwords, hidden inputs, or file inputs.

## Notes

- The hub only listens on `127.0.0.1` and requires the pairing token.
- If a results page yields zero job cards, the extension reports it to the app, which raises a "scraper may be stale" notification (at most one per site per 6 hours) instead of failing silently.
- CareerBuilder selectors are best-effort and may need tuning after a recon pass.
