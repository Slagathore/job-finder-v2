# TODO

Living backlog. Items land here from QA audits, UX reviews, and feature-gap
analyses; delete lines as they ship.

## Post-launch (v1.0.0 shipped 2026-07-11 — Win signed + mac + linux)

- [ ] **Nobody has ever run the macOS or Linux build.** They compile, package, and pass all tests on CI, but zero real-world mileage. First-launch smoke test on each is the highest-value next action.
- [ ] **macOS is unsigned** — Gatekeeper shows "damaged" on first open (README documents the right-click → Open workaround). Proper fix = Apple Developer Program ($99/yr) + notarization. The Azure cert does nothing on macOS.
- [ ] **winget submission** — now that a signed exe ships in a GitHub Release, a winget manifest gets users a SmartScreen-free `winget install` and an update channel. Use the `winget-releaser` Action.
- [ ] **CI does not sign Windows** — the signed exes are built locally and uploaded by hand. To automate: create an Azure service principal, grant it "Artifact Signing Certificate Profile Signer", add AZURE_* secrets, drop `-ExcludeEnvironmentCredential` from `scripts/azure-sign.js`.
- [ ] **Chrome Web Store**: v0.2.1 in review; local manifest is already 0.2.2 (fetch timeouts, pagination stop). Upload 0.2.2 only AFTER 0.2.1 is approved — re-uploading restarts the review queue.

## Design / UX debt (QA audit, 2026-07-10)

- [ ] **DB close can race in-flight background writes at quit** — worst case is one lost batch and a logged error. A cancellation token for scan/ingest work before `closeDb()` would close the gap.
- [ ] **Kept-alive tabs no longer refetch on revisit** (trade-off from state persistence, 2026-07-11) — Pipeline listens for notify events, but Dashboard/others can go stale until manual refresh. Consider a lightweight refetch-on-activate signal.
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
