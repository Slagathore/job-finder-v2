# Job Finder

**A free, local-first job search command center.** Scan job boards, discover roles that actually fit your experience, tailor applications, and track everything in a kanban pipeline — all in a desktop app where **your data never leaves your machine**.

![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-blue.svg)
![Tests](https://img.shields.io/badge/tests-135%20passing-brightgreen.svg)
![Electron](https://img.shields.io/badge/Electron-React%20%2B%20TypeScript-9feaf9.svg)

![Dashboard](store/screenshot-1-dashboard.png)

## Why this exists

Job hunting is a second job with worse tooling. Boards bury good listings, aggregators re-post ghosts, and "easy apply" pipelines are built for employers, not you. Job Finder flips that: it's built entirely for the applicant, runs entirely on your computer, and uses AI only where it genuinely helps — matching your real experience to real openings.

No account. No cloud. No telemetry. Your resume, applications, and search history live in a local SQLite file you can open, back up, or delete.

## What it does

- **Scans ATS boards directly** — Greenhouse, Ashby, and Lever public APIs, zero scraping, zero cost.
- **Harvests hostile boards via a companion browser extension** — Indeed, LinkedIn, CareerBuilder, Glassdoor, ZipRecruiter. One click sends the visible listings to your local app (and only there — the extension talks exclusively to `127.0.0.1`).
- **Digests your résumés into an experience engine** — reusable accomplishment line items, inferred role fits, cross-industry matches you didn't think to search for.
- **Semantic discovery** — embeddings-based matching weighted by pay and remote/hybrid preference, with A–F fit grades and rationale.
- **Grounded salary data** — BLS OEWS medians when a listing won't say.
- **Tailors documents** — CV and cover letter drafts tuned to each listing, from your own line items (no invented experience).
- **Kanban pipeline** — discovered → tailored → applied → responded → interview → offer, with follow-up nudges.
- **Gmail ingest (optional)** — replies auto-advance your pipeline; interview/offer emails get confetti.
- **A conversational agent** — drives the app ("find me remote analyst roles over $70k"), with per-capability permission gates and an audit log. Applying is always off by default.

![Pipeline](store/screenshot-2-pipeline.png)

## Quick start

```bash
git clone https://github.com/Slagathore/job-finder-v2.git
cd job-finder-v2
npm install
npm run dev      # development (Vite on 5177 + Electron)
npm run dist     # or: build a Windows installer → dist-installer/
```

**AI backend (pick one):**
- [Ollama](https://ollama.com) running locally — plus `ollama pull nomic-embed-text` for semantic search. Free and fully local.
- Or an Anthropic API key in **Settings** to use the cloud fallback chain.

The app works without either — scanning, harvesting, and the pipeline are plain code; AI powers matching, digesting, and tailoring.

## The browser extension

Some boards can't be scanned politely from outside the browser. The extension harvests what *you're already looking at*:

1. Build the zip: `npm run ext:pack` (or load `extension/` unpacked via `chrome://extensions` → Developer mode).
2. In the app: **Settings → Browser extension pairing** — copy the hub token.
3. Click the extension icon, paste the token, **Test** → ✓.
4. Browse Indeed/LinkedIn/etc. and click **Harvest** (or enable auto-harvest).

Everything it collects goes to your local app over `127.0.0.1` — see [its privacy policy](extension/PRIVACY.md). It requests a single Chrome permission (`storage`).

## Privacy, in one paragraph

There is no server. The app's own docs, database, backups, and exports all live in your user data folder. The extension ships listings to localhost. Gmail access (if you opt in) uses your own OAuth credentials and only labels/reads application-related threads. The agent's riskier capabilities (sending email, applying) are permission-gated per capability, individually, in Settings — and bulk apply is additionally gated by a blocklist and listing-liveness checks.

## Architecture

Electron + React + TypeScript + Vite, `better-sqlite3` for storage, provider-agnostic LLM layer (`electron/llm/provider.ts`), Vitest (135 tests). The full design doc — including the self-extension sandbox, permission matrix, and per-phase build history — is in **[PLAN.md](PLAN.md)**.

## Contributing

Issues and PRs welcome. Good first contributions: new board scrapers (`extension/content/`), new ATS integrations (`electron/scan/`), and non-Windows platform testing (it's Electron, so macOS/Linux should mostly work — it just hasn't been battle-tested there yet).

## Support

This is free and always will be. If it helped you land something — or just saved you an evening of copy-pasting — consider [buying me a coffee on Ko-fi](https://ko-fi.com/sparklemuffin) so I can keep making useful free apps. Thanks! ☕

## License

[MIT](LICENSE)
