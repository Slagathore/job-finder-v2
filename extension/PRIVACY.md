# Privacy Policy — Job Finder Harvester

_Last updated: July 10, 2026_

Job Finder Harvester is a browser extension that collects job listings from job-board pages you visit (Indeed, LinkedIn, CareerBuilder, Glassdoor, ZipRecruiter) and sends them to the **Job Finder desktop app running on your own computer**. It exists to serve you, the user — it has no server, no analytics, and no third-party data sharing of any kind.

## What data the extension handles

1. **Job listing content (website content).** When you visit a supported job board, the extension reads the visible job cards on the page (title, company, location, salary text, link). This happens only on the job-board domains listed in the extension's manifest.
2. **Apply-form answers (personally identifiable information) — optional, off by default.** If you enable the "field capture" option, the extension remembers answers you type into job application forms (for example your name, email, or work-authorization answers) so the desktop app can suggest them next time. This feature is opt-in and can be turned off at any time in the extension popup.
3. **Extension settings.** Your hub URL, pairing token, and feature toggles are stored using Chrome's local extension storage.

## Where the data goes

All data is sent to **`http://127.0.0.1` (localhost) only** — that is, to the Job Finder desktop application running on the same computer. The data never leaves your machine, is never sent to the developer, and is never sent to any third party or remote server.

## What we do NOT do

- We do **not** sell or transfer your data to anyone.
- We do **not** use your data for advertising, analytics, or profiling.
- We do **not** use or transfer your data to determine creditworthiness or for lending purposes.
- We do **not** collect browsing history; content scripts run only on the job-board domains listed in the manifest.

## Data retention and deletion

All captured data lives in a local SQLite database owned by the Job Finder desktop app on your computer. You can delete it at any time by deleting records inside the app or removing the app's data directory. Uninstalling the extension removes its stored settings.

## Contact

Questions about this policy: **charcham7@gmail.com**
