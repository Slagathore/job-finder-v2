# job_finder_v2 — Architecture & Plan

> Status: **DRAFT / living document.** Decisions locked where noted; everything
> else is open for refinement. Last updated: 2026-06-07.

A personal job-finding app for Cole. Successor to `../career-ops` (job logic),
built on `../claw-deck`'s app scaffolding (Electron stack + agent + self-coding
sandbox). Centered on an **experience engine** that digests everything Cole has
done into reusable line items, infers what roles/industries he can win, and
**discovers** high-pay/remote opportunities he wouldn't have thought to search
for — plus far better hostile-board reach (Indeed/CareerBuilder) and a
conversational agent that can drive and extend the whole app.

---

## 1. Goals

1. **Experience-digest profile** — ingest many resumes / Q&A into reusable
   experience **line items**; infer which roles & industries Cole can target.
2. **Cross-industry opportunity discovery** — semantically match jobs to Cole's
   *full* qualifications and **surface high-fit roles he didn't know to look
   for**, even outside industries he asked about. Default ranking favors **good
   pay + work-from-home**.
3. **Be a LOT better at Indeed / CareerBuilder** and similar anti-bot boards.
4. **Strong local / "home area" search** — flexible location + radius, plus
   onsite/hybrid/remote selectable; tag-based + role-family semantic search.
5. **Self-extending discovery** — add boards & company sites by click or by
   asking the agent; they auto-configure via the easiest ingress.
6. **Browser extension** in Cole's real session as the hostile-board unlock,
   working in concert with the agentic layer.
7. **Automated gathering**; **applying stays user-triggered** with a review queue
   (§6.1). No autonomous submit, no cap.
8. **Tailored resume/cover per job** assembled from line items; full history.
9. **System mailbox (Gmail)** — ingest replies, auto-update status.
10. **Graphic pipeline** + **background tray/scheduled scans + notifications**.
11. **Career intelligence** — Glassdoor scores, salary lookup/estimation,
    industry-fit/lateral-move, and a **credential leg-up advisor**.
12. **Conversational agent console** — does any app task, pushes to the right
    tab, captures rules, asks about gaps, persistent memory, and **extends the
    app by writing its own code in a sandbox**.

---

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Hub packaging | **Electron** desktop app (fork claw-deck scaffold) |
| Background | **System tray + scheduled scans (even window-closed) + desktop notifications** (new high-fit jobs, email responses) |
| Data storage | **SQLite** (`better-sqlite3`); markdown export for agentic-mode compat |
| Profile model | **Experience line-item library** (digested from many resumes + Q&A) → derived profile + **inferred role/industry fits**. Not a single static CV. |
| Discovery ranking | Semantic match over full qualifications; **default weights: pay + WFH high**; surfaces unexpected cross-industry fits. |
| Extension target | **Chromium** (Chrome + Opera + Edge) — single MV3 build |
| LLM provider | Provider-agnostic. **Default Ollama Cloud `gemini-3-flash-preview:cloud` via OpenAI `/v1`** (§5.4). |
| LLM fallback chain | Ollama cloud → **Anthropic API (if key set)** → **smaller local/other Ollama model**. Health-warning banner on any fallback. |
| Embeddings | Local embedding model via Ollama; vectors in SQLite (sqlite-vec or cosine over stored blobs). |
| Fit score | **Visible, informational only — gates NOTHING** |
| Applying | **Never autonomous.** Star recs → user bulk-selects → **review queue (preview/edit/skip each) before submit**. Company blocklist = hard gate. |
| Mailbox | **Gmail** (API + OAuth) |
| Personal data | Per-user; new users onboard fresh. Cole's data opt-in, NOT bundled. |
| Agent autonomy | **Full rein, per-capability toggles in Settings. Default all-ON except applying.** |
| Self-extension scope | **No file denylist — agent may rewrite anything**, incl. its own guardrails. **Every patch requires explicit user approval.** Scan+sandbox run with trusted pre-patch tooling; scan advisory; backup + rollback. |
| Rule vs UI-setting conflict | **Agent asks** which to honor. |
| Agent memory | **Persistent** (SQLite). |
| Credential encryption | Electron **`safeStorage`** (OS keychain) for the vault + Gmail/API tokens. |

Open / still to refine: see §11.

---

## 3. Reuse sources (the "bones")

### 3a. From `../claw-deck` (app skeleton + agent + self-coding) — SAME STACK
| Piece | Role | v2 plan |
|---|---|---|
| Electron + React + TS + Vite + Node main + `better-sqlite3` scaffold | App shell, IPC, persistence, history, settings, Ollama health badge, tray-able | **Fork as the skeleton.** |
| `src/lib/planner.ts` | Plan-and-execute agent: typed JSON step registry, parse/validate/repair, `openTab`, destructive-gating | **Port → agent console (§6.12).** Extend registry. |
| `electron/selfUpgrade/*` + `electron/lib/scanner.ts` | Self-coding: inventory → LLM PatchSet → temp-dir sandbox + isolated test run → scan → backup/rollback + hash-chained audit | **Port → self-extension (§6.15).** |
| OpenAI-compat + Ollama backends | LLM transport matching §5.4 | **Reuse pattern.** |

### 3b. From `../career-ops` (job-search domain logic)
| Piece | Role | v2 plan |
|---|---|---|
| `scan.mjs` | ATS API scanner (Greenhouse/Ashby/Lever) | **Keep & extend → SQLite.** |
| `search.mjs` | Playwright scraper (Indeed/LinkedIn/Glassdoor/Zip) + DFW location filter | **Keep concepts, demote** (extension supersedes); generalize geo. |
| `apply-engine/` | Form auto-fill adapters + login + vault + gmail-verifier + field-mapper + per-domain profiles | **Keep.** Drives user-triggered apply; field-fill learning (§6.7). |
| `customize-cv.mjs` + `generate-pdf.mjs` + `generate-latex.mjs` + templates | Tailored CV/cover output | **Keep as the renderer**, fed by the line-item library (§6.8). |
| `modes/*.md` | A–F scoring, archetypes, interview prep, negotiation, follow-up, patterns | **Port to prompt templates.** |
| Tracker `.mjs` (merge/dedup/normalize/liveness) | Pipeline integrity | **Port logic → SQLite**; keep markdown export. |

`../career-ops/search.mjs` already encodes Cole's DFW cities + target roles
(Field Apps Scientist, TAM, AI/Solutions Engineer, DevRel, CSE) — a seed only.

**Gaps we fix:** no CareerBuilder; brittle scraping; hardcoded DFW; no
experience-digest/discovery; no self-extending boards; no email ingestion; no
agent surface; bundled personal data.

---

## 4. Core strategic insight — tier discovery by hostility

The extension runs inside Cole's real, logged-in browser session, so
Indeed/CareerBuilder can't tell it from a human. Playwright can't win that
reliably; the extension sidesteps it.

```
FRIENDLY  (free, bulk, server-side)        → scan.mjs ATS APIs
SEMI      (server-side, low anti-bot)      → Playwright headless, plain company pages
HOSTILE   (Indeed, CareerBuilder, LinkedIn)→ BROWSER EXTENSION in Cole's real session
```

---

## 5. System architecture — 3 tiers (in concert)

```
┌──────────────────────────────────────────────────────────────┐
│  HUB APP  (Electron: Node main + React UI, claw-deck base)    │
│  • SQLite: experience_items(+embeddings), role_fits, jobs,    │
│       applications, profiles, boards, adapters, blocklist,    │
│       intel, email, rules, field_memory, agent_memory,        │
│       permissions, audit_log, patch_proposals, saved_searches │
│  • Experience engine: ingest → line items → infer role fits   │
│  • Discovery: semantic match (pay+WFH weighted) → surface     │
│  • Local REST + SSE API (extension transport)                 │
│  • career-ops .mjs workers: scan, apply-engine, CV gen, eval  │
│  • Pipeline + kanban + star recs + bulk-apply review queue    │
│  • Tray: scheduled scans + desktop notifications              │
│  • Gmail ingestor → status updates                            │
│  • Agent console + self-extension sandbox                     │
└──▲────────────▲───────────────────────────────▲─────────────┘
   │ localhost   │ tool/plan steps (openTab=push)│ /v1 chat + embeddings
   │ fetch/SSE   │                               │ (OpenAI-compat, tool-safe)
┌──┴──────────┐  │   ┌──────────────────────────┴───────────────┐
│ BROWSER     │◄─┼──►│ AGENTIC LAYER                             │
│ EXTENSION   │  │   │ • Digest resumes/Q&A → line items         │
│ (MV3, real  │  │   │ • Infer role/industry fits                │
│  session)   │  │   │ • Semantic fit scoring + discovery        │
│ harvest,    │  │   │ • Build CV/cover from line items          │
│ paginate,   │  │   │ • Form answers + gap questions            │
│ field-fill  │  │   │ • Learn-this-site, salary, certs, careers │
│ capture, GD │  │   │ • Drives extension + app; memory; self-ext│
└─────────────┘  └── Agent console & UI call the SAME tools.
```

### 5.1 Hub (Electron, fork of claw-deck)
Main: SQLite, experience engine, discovery, career-ops `.mjs` workers, local API,
orchestrator, tray scheduler, Gmail ingestor, agent dispatcher, self-extension.
Renderer: dashboard, kanban, job detail, search builder (tags/role-family),
experience manager, profile/settings (capability toggles, schedule), application
history, agent console, career-intel, audit view.

### 5.2 Browser extension (MV3, Chromium)
Content scripts: Indeed, CareerBuilder, LinkedIn, Glassdoor, ZipRecruiter +
generic detector. Commands: harvest page / next-N (bulk) / run saved search /
learn site / pull Glassdoor. Field-fill capture (§6.7). Background worker queues
+ pushes to hub. Human-like delays/throttle to respect rate limits.

### 5.3 Agentic layer
Ports `modes/*.md`; fast model for bulk scoring, capable model for deep work;
local embeddings for semantic match. In concert with the extension via SQLite.

### 5.4 LLM provider abstraction
Default **Ollama Cloud `gemini-3-flash-preview:cloud` via OpenAI `/v1`**
(`POST {base}/v1/chat/completions`, base `http://127.0.0.1:11434`, auth
`Bearer ollama`; Node `openai` SDK `baseURL:'…/v1'`, `apiKey:'ollama'`).
**Tool calls** use `/v1` and round-trip assistant turns verbatim
(thought_signature; Ollama #14567). **Fallback chain:** Ollama cloud → Anthropic
(if key) → smaller local/other Ollama model; health-warning on fallback. Refs:
`Ai_ccountabilibuddy/modules/brain/openai_compat.py`, `DungeonMaster/.../llm_ollama_openai_compat.py`, claw-deck reflector backends.

---

## 6. Feature designs

### 6.1 Automation scope & applying
Automated: ingest, infer, discover, score, intel, tailor. **Manual gate =
applying.** Agent stars recs; user bulk-selects via checkboxes; it tailors
CV+cover for the set, then a **review queue** lets the user preview/edit/skip each
before submit; apply-engine then submits the approved ones. **Apply routing** per
job: LinkedIn Easy-Apply (in-session via extension) / ATS form (apply-engine
Playwright) / external site (extension or manual handoff). No score gate, no cap;
blocklist is the hard gate. **Liveness re-check** right before submit.

### 6.2 Work mode (onsite/hybrid/remote)
Multi-select; search params AND live filters. Per-search + global default.

### 6.3 Flexible location + tag/role-family search
Free-text location (state / city / any country / area code / full address) →
geocoded (default OSM/Nominatim) + radius (miles); "Remote" bypasses radius.
**Search modes:** (a) auto-derived **role-family filter buttons** (from inferred
fits, e.g. "computer sector", "scientist", "research"); (b) free **comma-
separated tags** → **semantic search** over jobs; (c) plain keyword. All combine
with work-mode + location + pay filters.

### 6.4 Fit score & discovery (informational, semantic)
Every job is semantically matched against the **full experience corpus** (not a
single role), producing a visible A–F fit + rationale + which line items support
it. **Default ranking weights pay + WFH heavily.** The engine deliberately
**surfaces strong fits outside requested industries** ("you didn't search for
this, but you'd likely land it"). Score gates nothing; drives the star; sortable.
Pay is a **soft ranking booster** (never auto-hides) with an **optional user-set
minimum** filter that can hide/grey sub-minimum jobs only when enabled.

### 6.5 Company blocklist
Never-show / never-apply, normalized matching. The one hard apply gate.

### 6.6 Board registry — addable & auto-configuring
Built-ins + filterable enable-by-click. Add a URL (or ask the agent) → probe
easiest ingress: ATS API → structured data (JSON-LD/sitemap/RSS/XHR) → DOM
learn-site adapter. Adapters in `site_adapters` w/ confidence + last-verified;
auto re-verify, flag on drift.

### 6.7 Form-field learning (autofill memory)
Manually-entered apply fields captured to `field_memory` (normalized label →
value) for future autofill. Agent can ask for these proactively. **Sensitive
screening Qs:** work-authorization/visa answered from stored profile facts;
**EEO/demographic questions default to "decline to self-identify"** unless the
user overrides.

### 6.8 Resume / cover tailoring + history
Per job, the agent **assembles a tailored CV + cover from the experience
line-item library (§6.17)**, selecting/ordering items by JD relevance, governed
by user rules (§6.11), then renders via `customize-cv.mjs` + templates. Every
artifact saved + linked in application history (versions, target JD).

### 6.9 Experience ingestion (filesystem OR website)
Onboarding ingests **many** sources: multiple resumes (PDF/DOCX/MD), pasted text,
**Q&A interview** with the agent, and URLs (LinkedIn/GitHub/portfolio). All are
**digested into line items** (§6.17). New users start empty; nothing pre-seeded.
For Cole specifically, the existing `../career-ops/cv.md` (if present) can be
imported as one initial line-item source, then enriched.

### 6.10 System mailbox (Gmail)
App's own Gmail (API + OAuth). **User creates the dedicated Gmail; app connects
via Google OAuth (tokens in `safeStorage`).** Ingest → match to applications →
classify (ack / reject / interview / offer / recruiter) → advance pipeline + log
+ **notify**. Used as the apply-form email. User can override classifications.

### 6.11 User rules / guidelines
Persisted rules for resume builds + search + scoring, authored conversationally;
consumed by tailoring/search/scoring. Conflict with explicit UI setting → **agent asks**.

### 6.12 Conversational agent console (port claw-deck planner)
Chat that performs any app task via a typed step/tool registry mapped to app
actions; extends claw-deck's registry with job-app steps (`search`, `harvest`,
`addBoard`/`learnSite`, `digestExperience`, `score`, `tailorDoc`, `applySelected`,
`setRule`, `pullIntel`, `openTab`, `note`). Plan-and-execute; `openTab` pushes
results to the right tab. **Per-capability permission matrix** in Settings —
every power (search, harvest, learn-boards, digest, score, tailor, intel,
set-rules, edit-profile, send-email, create-accounts) defaults to **full auto**;
only **applying** is manual (review queue) and **self-extension** always needs
approval. Each is individually toggleable. **"LLM Requested"** out-of-UI actions run + are labeled + audit-
logged, and may be proposed as permanent via self-extension (§6.15). **Gap
questions** before applying. **Persistent memory** (§6.16).

### 6.13 Career intelligence
Glassdoor company score (extension scrape, cached; LLM sanity-check → on
disagreement show **LLM value + confidence**). Salary: listed, else scrape
Glassdoor, else **LLM estimate + confidence** (shown when LLM differs). Career-
fit/lateral-move (core, powered by §6.17/§6.18). **Credential leg-up advisor:**
which cert/credential most boosts viability (esp. toward higher-pay/remote
fields the user qualifies for) — **LLM reasoning verified against live web
search** (current demand, cost, ROI).

### 6.14 Customization (kept from career-ops)
Archetypes, scoring weights, narrative/proof, negotiation, follow-up cadence —
user-editable, never overwritten by updates.

### 6.15 Self-extension (port claw-deck self-upgrade)
Agent adds abilities by **writing its own code in a sandbox**. **No file is
off-limits**; the single load-bearing safeguard is that **every patch requires
explicit user approval**. Flow: reflector inventory → LLM PatchSet → **advisory**
heuristics scan → temp-dir sandbox runs the **full test suite isolated** →
**mandatory review** (rationale + diff + flags + results) → apply with backup →
hash-chained audit → rollback. **Trusted-tooling rule:** scan/tests always run
with current trusted code, never the patched versions, so a patch can't
pre-disable its own review.

### 6.16 Persistent agent memory
Long-term memory across restarts (`agent_memory`): rules, prefs, decisions,
learned facts. Gets smarter over time.

### 6.17 Experience engine — line items & role inference
- **Digest:** parse all ingested sources into atomic **line items** — each a unit
  of accomplishment/skill/tool/domain with metadata (role, dates, metrics,
  seniority signal, embedding). De-dups overlapping items across resumes.
- **Profile:** derive a structured candidate profile (skills, domains, seniority,
  total YoE) from the corpus.
- **Role/industry inference:** from the corpus, infer **viable role families &
  industries** with confidence + rationale (`role_fits`), **anchored to a
  standard taxonomy (O*NET/ESCO) for clean role-family labels but extended with
  LLM-found adjacencies/niche fits** the user didn't name. Powers the role-family
  filter buttons (§6.3) and discovery (§6.18). Refreshable as the corpus grows.

### 6.18 Semantic discovery
- Embed jobs + line items + role taxonomy locally; match jobs to the **whole
  corpus** via vector similarity + LLM rerank.
- Rank by fit × **pay × WFH** priors (configurable weights).
- **Surface mode:** proactively flags high-fit jobs outside the user's stated
  searches ("opportunities you didn't ask for"), with the supporting line items.

### 6.19 Background, scheduling & notifications
System tray; **scheduled scans** (configurable cadence) run even when the window
is closed; **desktop notifications** for new high-fit/surfaced jobs and for email
responses (esp. interview invites). In-app activity feed mirrors notifications.

### 6.20 Cross-board deduplication
URL-exact dedup runs first; then the same posting across Indeed/LinkedIn/company
site is **fuzzy-matched (company + title + location) and collapsed into one job
card** listing all source links. The canonical/apply link defaults to the **best
apply route** (company/ATS over aggregator). Cuts list noise.

---

## 7. How each goal maps

Experience digest → §6.9/§6.17. Discovery → §6.18 + §6.4. Indeed/CB → §5.2.
Local/tags/role-family → §6.3. New boards → §6.6. Concert → §5. Apply-manual →
§6.1 (review queue). Tailoring+history → §6.8. Email → §6.10. Pipeline+background
→ §6.9-renderer + §6.19. Career intel+certs → §6.13. Talk-to-drive → §6.12.
Self-extend → §6.15. Rules → §6.11. Memory → §6.16.

---

## 8. Data model (initial SQLite sketch)

- `experience_items` — id, kind(accomplishment|skill|tool|domain|education),
  text, source_ref, role, employer, start/end, metrics, seniority_signal,
  embedding(blob), dedup_group.
- `profiles` — derived: skills, domains, seniority, total_yoe, narrative,
  scoring weights, pay_target, work_mode prefs, locations[]+radius. (Per-user.)
- `role_fits` — role_family, industry, confidence, rationale, refreshed_at.
- `jobs` — source/board_id, url(unique), company, title, description,
  location_raw, geo, work_mode, salary_listed, salary_estimate(+source+conf),
  glassdoor_score, fit_score, fit_rationale, supporting_item_ids(json),
  surfaced(bool), starred, embedding(blob), first_seen, status, legitimacy.
- `applications` — job_id, state, route(easyapply|ats|external), tailored_cv_path,
  cover_letter_path, doc_versions(json), form_answers(json), submitted_at,
  confirmation_url, screenshots(json), trigger(manual|bulk|agent / LLM-Requested).
- `saved_searches` — name, tags, role_family, work_mode, location, pay_min,
  boards[], schedule.
- `user_rules` — scope, text, source, created_at.
- `field_memory` — normalized_label, value, last_used, source.
- `boards` / `site_adapters` / `company_blocklist` / `company_intel` /
  `cert_advice` — as before (board registry, adapters, blocklist, intel, certs).
- `email_messages` — message_id, application_id, from, subject, classification,
  received_at, raw_ref.
- `agent_memory` / `capability_permissions` / `audit_log`(hash-chained) /
  `patch_proposals` — agent + self-extension state.
- `notifications` — kind, payload, seen, created_at.
- `credentials` — vault + Gmail/API tokens via `safeStorage`.
- `scan_history` / `runs` — dedup ledger + run log.

Markdown export keeps `applications.md` / `pipeline.md` in sync for agentic modes.

---

## 9. Build phases

**Progress: 15 / 15 complete. 🎉** Legend: ✅ done. Each phase ships with passing
Vitest coverage (101 tests) and a clean `npm run build`. The MVP plan is
delivered; remaining work is the enhancement backlog in §14-notes (auto-submit,
real Glassdoor/web-verify, LinkedIn/Glassdoor/Zip scrapers, CareerBuilder recon).

1. ✅ **Fork claw-deck skeleton** — Electron/React/Vite/SQLite shell, settings,
   tray, LLM provider + fallback chain (§5.4), health badge, dashboard.
2. ✅ **SQLite schema + career-ops ATS scanner** — full §8 schema; `scan.mjs`
   ported to TS (Greenhouse/Ashby/Lever) → `jobs` table; Dashboard scan + Boards tab.
3. ✅ **Experience engine** — ingest resumes (PDF/DOCX/MD) + paste + Q&A → atomic
   line items → derived profile + role/industry inference (§6.17). Experience tab.
4. ✅ **Semantic discovery + search** — local embeddings, cosine/top-k corpus
   match, pay+WFH-weighted ranking, A–F fit grade, surface mode (§6.18, §6.4). Search tab.
5. ✅ **Work mode + flexible location/geocoding** — Nominatim geocoder (city/state/
   country/area-code/address) + cache, haversine radius filter, distance sort (§6.3).
6. ✅ **Extension MVP** — Chromium MV3 extension (`extension/`) scrapes Indeed +
   CareerBuilder from the real session → posts to the hub's token-gated localhost
   HTTP ingress; auto-harvest paginates; apply-form field capture. LinkedIn/
   Glassdoor/Zip scrapers still to add. *(CareerBuilder selectors need live recon.)*
7. ✅ **Board registry + learn-this-site** — per-board ingress **probe** (ATS API →
   JSON-LD structured data → DOM), agentic **learn-this-site** (LLM infers CSS
   selectors → cheerio-applied → saved `site_adapters`); scan dispatches by ingress.
   *(JS-rendered pages still need the extension/Playwright.)*
8. ✅ **Tailoring from line items + history** — per-job LLM tailoring (CV + cover
   from best-fit line items, governed by user rules) → HTML + **Electron printToPDF**
   → saved to application history (doc_versions, state→tailored). Rules manager +
   candidate-contact settings. Tailor button in Search.
9. ✅ **Agent console** — plan-and-execute chat (claw-deck planner ported): tool
   registry mapped to app actions (no "apply" tool), per-capability permission
   matrix (auto/confirm/off), hash-chained audit per step, push-to-tab, persistent
   agent memory + rules in context. *(Granular confirm-step UI + gap-question flow are light; deepen later.)*
10. ✅ **Self-extension** — reflector (facts→LLM PatchSet) → advisory scan →
    sandbox (clone + junction node_modules + lint + tests, live tree untouched) →
    **mandatory approval** → apply w/ per-file backup + hash-chained audit →
    rollback. No feature denylist (path-safety only). Self-Extend tab.
    *(Applied patches need an app rebuild/restart to take effect.)*
11. ✅ **Bulk apply + review queue + routing** — checkbox-select → prepareBatch
    (blocklist gate + tailor + liveness + route easyapply/ats/external) → review
    queue → submit (marks Applied + opens posting). Blocklist manager in Settings.
    *(Assisted hand-off: automated form SUBMISSION via Playwright apply-engine/extension is the remaining piece.)*
12. ✅ **Kanban + background notifications** — drag-through Pipeline board
    (Discovered→Tailored→Applied→Responded→Interview→Offer/Rejected) backed by
    applications.state; scheduled scans fire desktop Notifications + a notification
    row + in-app activity feed. (Tray + scheduler from phases 1–2.)
13. ✅ **Gmail mailbox** — OAuth (loopback via hub `/oauth/callback`, no SDK) →
    ingest recent mail → LLM classify (ack/rejection/interview/offer/recruiter) →
    match to an open application → advance pipeline state + notify. Mailbox card in
    Settings; scheduled ingest on the scan cadence. **Needs Cole's Gmail + Google
    OAuth Desktop client (§13).**
14. ✅ **Career intelligence** — salary estimate (+confidence, stored on job),
    company intel (rating/pros/cons, cached), lateral/cross-industry move
    suggestions, credential leg-up advisor (cached). Career tab + per-row $est in
    Search. *(LLM estimates w/ confidence labels; real Glassdoor/web-verify via the extension or a search API is future.)*
15. ✅ **Polish** — follow-up cadence (overdue-nudge by state, Dashboard card),
    interview prep (LLM STAR stories + questions → HTML, "prep" on Pipeline cards),
    packaging (electron-builder config + `npm run dist` → NSIS + portable Windows).

---

## 10. Resolved decisions log

Experience-digest line-item profile + role inference ✔ · Cross-industry semantic
discovery, pay+WFH-weighted, surfaces unasked fits ✔ · tag/role-family semantic
search ✔ · Background tray + scheduled + notifications ✔ · Bulk apply = review
queue before submit ✔ · LLM fallback: Ollama cloud → Anthropic(key) → local
model, health-warning ✔ · local embeddings in SQLite ✔ · credential encryption =
safeStorage ✔ · apply routing (easyapply/ats/external) + liveness re-check ✔ ·
pay = soft booster + optional min filter ✔ · sensitive Qs auto-from-facts, EEO
declined ✔ · role taxonomy hybrid O*NET/ESCO + LLM ✔ · cross-board dedup =
collapse into one card, prefer direct apply route ✔ · capability matrix = full
auto except apply (manual) + self-extension (approval), all toggleable ✔ · Gmail
= user-created, OAuth-connected ✔ · cert advice = LLM + live web verify ✔ ·
profile seeded from career-ops cv.md as one source ✔ · defaults (pending veto):
nomic-embed-text + sqlite-vec, Nominatim, HTML→PDF+LaTeX, localhost+token, Vitest ·
[prior: stack/agent/self-extension forked from claw-deck; Ollama-cloud `/v1`
default tool-safe; Gmail; salary Glassdoor+LLM-verify; per-user profile; fit
score non-gating; blocklist hard gate; agent full-rein-except-apply w/ toggles;
self-extension no-denylist + mandatory approval + trusted-tooling; persistent
memory] ✔.

---

## 11. Open questions / to refine

Still genuinely open:
- [ ] **CareerBuilder recon:** login wall / account needs (hands-on, do during phase 6).

Recommended defaults (confirm or veto):
- [~] **Embedding model:** `nomic-embed-text` (or `embeddinggemma`) via Ollama + `sqlite-vec`.
- [~] **Geocoder:** OSM/Nominatim (free, self-throttled).
- [~] **Resume format:** keep HTML→PDF (Playwright) + LaTeX templates.
- [~] **Transport:** localhost fetch with a per-session token; native-messaging fallback.
- [~] **Test strategy:** adopt claw-deck Vitest from day one (needed for the sandbox gate).

---

## 12. Notes / context

- `../claw-deck` — Cole's own Electron app; source of skeleton, planner
  (`src/lib/planner.ts`), self-coding sandbox (`electron/selfUpgrade/*`,
  `electron/lib/scanner.ts`). SAME stack as v2.
- `../career-ops` — MIT, by Santiago Fernández de Valderrama. Domain logic.
- LLM refs: `Ai_ccountabilibuddy/modules/brain/openai_compat.py`,
  `DungeonMaster/.../llm_ollama_openai_compat.py`.
- **ToS reality:** scraping Indeed/CareerBuilder/Glassdoor and automated
  account creation/apply breach those sites' terms; accepted risk for personal,
  single-user use. Not a public/multi-tenant product.
- Ethics: career-ops was "quality over quantity, never submit without review";
  v2 preserves the review step (applying is user-triggered with a review queue).

---

## 13. Action items for Cole (what I need from you)

These are things the app needs from you that I can't do from here. Nothing
blocks continued building — but the features won't *work end-to-end* until done.

**To make the app actually run / use LLM features (any time):**
- [ ] **Install Ollama** and run it (`ollama serve`). The app defaults to it.
- [ ] **Sign in to Ollama** for cloud models so `gemini-3-flash-preview:cloud`
      works (`ollama signin`), OR set an **Anthropic API key** in Settings as fallback.
- [ ] **Pull the embedding model:** `ollama pull nomic-embed-text` (needed for
      semantic search / discovery in phase 4).
- [ ] *(Optional)* pull a small local fallback model, e.g. `ollama pull llama3.2`.
- [ ] **Run it:** `cd job_finder_v2 && npm run dev`. Try: Dashboard → Scan;
      Experience → import a resume → Analyze; Search → Embed → Discover.

**Decisions / inputs I still need (see §11):**
- [ ] **Veto or confirm the recommended defaults** in §11 (embedding model,
      geocoder, transport, etc.) — silence = I proceed with them.
- [x] **Gmail (phase 13) — flow BUILT, needs your credentials:** (1) create the
      dedicated Gmail; (2) in Google Cloud Console make an **OAuth client of type
      "Desktop app"**, enable the **Gmail API**, add your Gmail as a test user;
      (3) add redirect URI `http://127.0.0.1:17893/oauth/callback`; (4) paste the
      client ID + secret into Settings → Mailbox → Connect Gmail. (gmail.readonly scope.)
- [ ] **CareerBuilder (phase 6):** confirm whether you have/want a CareerBuilder
      account — affects whether the extension scrapes logged-in vs public pages.

**Heads-up / FYI:**
- The browser **extension (phase 6)** will need to be loaded unpacked in
  Chrome/Opera (Developer Mode → Load unpacked) once built — I'll provide it.
- **Self-extension (phase 10)** will ask for your approval on every code patch;
  that approval is the only safeguard (by your design) — read the diffs.
- **ToS:** scraping Indeed/CareerBuilder/Glassdoor + auto-apply breaches their
  terms; fine for personal single-user use, your call to run it.

*(Last status sync: ALL 15 phases complete, 101 tests passing. Updated 2026-06-08.)*
