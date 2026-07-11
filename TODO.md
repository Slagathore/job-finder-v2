# TODO

Living backlog. Items land here from QA audits, UX reviews, and feature-gap
analyses; delete lines as they ship.

## Design / UX debt (QA audit, 2026-07-10)

- [ ] **Tab state resets on every tab switch** — tabs are conditionally rendered, so an in-progress Agent conversation, scan summary, or search result set vanishes when the user briefly visits another tab. Keep tabs mounted (CSS hide) or lift hot state up.
- [ ] **AgentTab chat history is unbounded within a session** — cap the rendered message list (~200) so marathon sessions don't bloat the DOM.
- [ ] **Secrets fall back to plaintext when the OS keychain is unavailable** — irrelevant on Windows today, but must be fixed before any macOS/Linux build ships (refuse to store, or warn loudly).
- [ ] **DB close can race in-flight background writes at quit** — worst case is one lost batch and a logged error. A cancellation token for scan/ingest work before `closeDb()` would close the gap.
- [ ] **LinkedIn content script polls `location.href` every 1.5s on ALL LinkedIn pages** — needed for SPA navigation detection, but could early-exit outside `/jobs/` paths.

## Install / first-run UX

- [ ] **Code signing** — the unsigned exe triggers SmartScreen ("Windows protected your PC → More info → Run anyway") for every new user; unsigned + low reputation is the single biggest adoption killer. Options: OV/EV cert (~$100-400/yr), winget submission (builds reputation), or Microsoft Store.
- [ ] **`app.setAppUserModelId('com.cole.jobfinder')`** on Windows at boot — makes desktop notifications reliably attributable/actionable; without it toasts can misbehave outside the NSIS shortcut path (e.g. portable exe).
- [ ] **First close-to-tray needs a one-time hint** — default `closeToTray: true` means clicking ✕ "doesn't quit," which reads as a bug to a new user. Show a single tray balloon/notification the first time.
- [ ] **Seeded boards are AI/tech-industry-heavy** (Anthropic, Intercom, Hume AI, …) — fine as a demo, wrong for most users. Ask for target roles/industries on first run, or ship broader seeds.
- [ ] **Uninstall leaves `%APPDATA%\Job Finder` behind** — good data-safety default, but add an optional "also delete my data" checkbox (electron-builder `deleteAppDataOnUninstall` is all-or-nothing; a custom NSIS page can make it opt-in).
- [ ] **Consider a real first-run wizard** — the Dashboard checklist is decent, but name/email + role targets + Ollama-vs-API-key in one guided pass would cut time-to-first-value.

## Feature gaps vs career-ops (verified against both repos, 2026-07-10)

Missing entirely:
- [ ] **Outreach/contact pipeline** — career-ops tracks non-application contacts (recruiters, warm intros, investors) in a parallel pipeline (`dashboard/internal/*/investors.go`). v2 has no contact entity at all.
- [ ] **Recruiter/hiring-manager discovery** — Google site-search finds LinkedIn profiles of recruiters at pipeline companies (`enrich.mjs` ~line 616), no LinkedIn auth needed. Pairs with:
- [ ] **Cold-outreach message generator** — 3-sentence tailored outreach per contact type (`modes/contacto.md`). v2 generates cover letters only.
- [ ] **Portfolio-project evaluator** — scores project ideas on 6 dimensions → BUILD/SKIP/PIVOT verdict with an 80/20 plan (`modes/project.md`).
- [ ] **Gmail verification loop for automated signups** — polls inbox for account-verification emails and follows the link (`apply-engine/lib/gmail-verifier.mjs`). Only relevant if account creation (below) is ported.

Weaker in v2 than career-ops:
- [ ] **Rejection-pattern / response-rate analytics** — response rates by archetype, seniority, remote/onsite, comp band (`analyze-patterns.mjs`); v2 only has the activity heatmap. All the data is already in SQLite — this is a high-value, low-effort port.
- [ ] **Per-ATS apply adapters** — dedicated Greenhouse/Ashby/Lever/Workday/LinkedIn form-fill adapters + field mapper + dry-run report (`apply-engine/adapters/`); v2 has one generic label-matching autofill.
- [ ] **Portal account creation + login handling** — password vault, login-wall/OAuth detection (`apply-engine/lib/account-creator.mjs`, `credentials.mjs`).
- [ ] **LaTeX résumé output** — typeset .tex → PDF via tectonic (`generate-latex.mjs`); v2 renders HTML→PDF only.
- [ ] **Persistent STAR story bank** — curated, reusable interview stories (`interview-prep/story-bank.md`); v2 regenerates stories per job and forgets them.
- [ ] **Course/cert study-plan evaluator** — DO/DON'T verdict + weekly study plan for a user-named course (`modes/training.md`); v2's cert advisor only suggests which credential helps.
- [ ] **Deep-research prompt generator** — exportable 6-axis company research prompt for external tools (`modes/deep.md`).
- [ ] **Setup doctor / pipeline integrity check** — one-command "is everything wired correctly" diagnostics (`doctor.mjs`, `cv-sync-check.mjs`, `verify-pipeline.mjs`); v2 has only the LLM health badge.
- [ ] **Batch/parallel headless evaluation** — fan-out eval workers with tracker merge (`batch/batch-runner.sh`, `merge-tracker.mjs`).
