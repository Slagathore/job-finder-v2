# TODO

Living backlog. Items land here from QA audits, UX reviews, and feature-gap
analyses; delete lines as they ship.

## Design / UX debt (QA audit, 2026-07-10)

- [ ] **Secrets fall back to plaintext when the OS keychain is unavailable** — irrelevant on Windows today, but must be fixed before any macOS/Linux build ships (refuse to store, or warn loudly).
- [ ] **DB close can race in-flight background writes at quit** — worst case is one lost batch and a logged error. A cancellation token for scan/ingest work before `closeDb()` would close the gap.
- [ ] **Kept-alive tabs no longer refetch on revisit** (trade-off from state persistence, 2026-07-11) — Pipeline listens for notify events, but Dashboard/others can go stale until manual refresh. Consider a lightweight refetch-on-activate signal.

## Install / first-run UX

- [ ] **Code signing** — the unsigned exe triggers SmartScreen ("Windows protected your PC → More info → Run anyway") for every new user; unsigned + low reputation is the single biggest adoption killer. Options: OV/EV cert (~$100-400/yr), winget submission (builds reputation), or Microsoft Store.
- [ ] **Uninstall leaves `%APPDATA%\Job Finder` behind** — good data-safety default, but add an optional "also delete my data" checkbox (electron-builder `deleteAppDataOnUninstall` is all-or-nothing; a custom NSIS page can make it opt-in).

## Feature gaps vs career-ops (verified 2026-07-10; high-value set ported 2026-07-10)

Ported ✔: rejection-pattern analytics (Career → Application insights), contacts entity +
recruiter discovery + outreach generator (Career → Contacts & outreach), persistent STAR
story bank (Experience tab + prep reuse), setup doctor (Settings → Diagnostics), portfolio
project evaluator, course/cert evaluator, deep-research prompt generator (Career tab).

Deliberately skipped (revisit only with a reason):
- **Portal account creation + Gmail verification loop** — ToS/liability risk; contradicts the app's human-in-the-loop stance and the CWS positioning.
- **Per-ATS apply adapters** (`apply-engine/adapters/`) — maintenance treadmill; generic autofill + field memory covers most. Revisit if a specific ATS repeatedly fails.
- **LaTeX résumé output** — HTML→PDF is clean; requires a tectonic install.
- **Batch/parallel headless evaluation** — CLI-world concern; the app embeds/scores in-process.
- **Investor tracker** — scope creep; the contacts entity covers the useful core.
