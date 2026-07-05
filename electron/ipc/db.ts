import Database from 'better-sqlite3';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

let db: Database.Database;
let dbPath = '';

export function getDbPath(): string { return dbPath; }

/**
 * Initialise the SQLite database and create the full job_finder_v2 schema
 * (see PLAN.md §8). All tables use CREATE TABLE IF NOT EXISTS so this is safe
 * to run on every boot; additive column changes go through migrate().
 */
export function initDb() {
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  dbPath = path.join(dir, 'jobfinder.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- ── Experience engine (§6.17) ──────────────────────────────────────
    CREATE TABLE IF NOT EXISTS experience_items (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      kind            TEXT NOT NULL,            -- accomplishment|skill|tool|domain|education
      text            TEXT NOT NULL,
      source_ref      TEXT,                     -- which resume/url/qa it came from
      role            TEXT,
      employer        TEXT,
      start_date      TEXT,
      end_date        TEXT,
      metrics         TEXT,                     -- json
      seniority_signal TEXT,
      embedding       BLOB,
      dedup_group     TEXT,
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT,
      skills        TEXT,                       -- json
      domains       TEXT,                       -- json
      seniority     TEXT,
      total_yoe     REAL,
      narrative     TEXT,
      scoring_weights TEXT,                     -- json
      pay_target    INTEGER,
      pay_min       INTEGER,
      work_mode_prefs TEXT,                     -- json ["remote","hybrid","onsite"]
      locations     TEXT,                       -- json [{label,lat,lng,radius_mi}]
      facts         TEXT,                       -- json (work auth, visa, EEO prefs, contact)
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_fits (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      role_family TEXT NOT NULL,
      industry    TEXT,
      taxonomy_code TEXT,                       -- O*NET/ESCO anchor if any
      confidence  REAL,
      rationale   TEXT,
      refreshed_at INTEGER NOT NULL
    );

    -- ── Jobs & applications (§6.1, §6.4) ───────────────────────────────
    CREATE TABLE IF NOT EXISTS jobs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source          TEXT,
      board_id        INTEGER,
      url             TEXT UNIQUE,
      company         TEXT,
      title           TEXT,
      description     TEXT,
      location_raw    TEXT,
      geo_lat         REAL,
      geo_lng         REAL,
      work_mode       TEXT,                     -- onsite|hybrid|remote
      salary_listed   TEXT,
      salary_estimate TEXT,                     -- json {value,source,confidence}
      glassdoor_score REAL,
      fit_score       TEXT,                     -- A-F
      fit_rationale   TEXT,
      supporting_item_ids TEXT,                 -- json [experience_item ids]
      surfaced        INTEGER DEFAULT 0,        -- discovery surfaced (unasked) fit
      starred         INTEGER DEFAULT 0,
      embedding       BLOB,
      dupe_group      TEXT,                     -- cross-board collapse key (§6.20)
      first_seen      INTEGER NOT NULL,
      status          TEXT DEFAULT 'discovered',
      legitimacy      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_dupe ON jobs(dupe_group);

    CREATE TABLE IF NOT EXISTS applications (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id           INTEGER NOT NULL,
      state            TEXT NOT NULL DEFAULT 'evaluated',
      route            TEXT,                    -- easyapply|ats|external
      tailored_cv_path TEXT,
      cover_letter_path TEXT,
      doc_versions     TEXT,                    -- json
      form_answers     TEXT,                    -- json
      submitted_at     INTEGER,
      confirmation_url TEXT,
      screenshots      TEXT,                    -- json
      trigger          TEXT,                    -- manual|bulk|agent|LLM-Requested
      created_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_job ON applications(job_id);

    -- ── Search, boards, adapters (§6.3, §6.6) ──────────────────────────
    CREATE TABLE IF NOT EXISTS saved_searches (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      tags        TEXT,                         -- json comma-separated tags
      role_family TEXT,
      work_mode   TEXT,                         -- json
      location    TEXT,
      pay_min     INTEGER,
      boards      TEXT,                         -- json [board ids]
      schedule    TEXT,                         -- cron-ish / minutes
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS boards (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL,
      type      TEXT,                           -- ats|board|company
      url       TEXT,
      enabled   INTEGER DEFAULT 1,
      ingress   TEXT,                           -- api|structured|dom
      status    TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_adapters (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      domain        TEXT NOT NULL,
      scope         TEXT,                       -- list|detail|apply
      extract       TEXT,                       -- json selectors/config
      learned_by    TEXT,                       -- manual|agentic
      confidence    REAL,
      last_verified INTEGER
    );

    -- ── Rules, memory, autofill (§6.7, §6.11, §6.16) ───────────────────
    CREATE TABLE IF NOT EXISTS user_rules (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scope      TEXT,                          -- resume|search|scoring|apply
      text       TEXT NOT NULL,
      source     TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS field_memory (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_label TEXT NOT NULL,
      value            TEXT,
      last_used        INTEGER,
      source           TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_field_label ON field_memory(normalized_label);

    CREATE TABLE IF NOT EXISTS agent_memory (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT,                          -- rule|pref|fact|decision
      key        TEXT,
      value      TEXT,
      created_at INTEGER NOT NULL,
      last_used  INTEGER
    );

    -- ── Blocklist & intel (§6.5, §6.13) ────────────────────────────────
    CREATE TABLE IF NOT EXISTS company_blocklist (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_name TEXT NOT NULL UNIQUE,
      reason          TEXT
    );

    CREATE TABLE IF NOT EXISTS company_intel (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      company         TEXT NOT NULL,
      glassdoor_score REAL,
      salary_data     TEXT,                     -- json
      cached_at       INTEGER
    );

    CREATE TABLE IF NOT EXISTS cert_advice (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      field_role    TEXT,
      certificate   TEXT,
      lift_estimate TEXT,
      rationale     TEXT,
      cached_at     INTEGER
    );

    -- ── Email ingest (§6.10) ───────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS email_messages (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id     TEXT UNIQUE,
      application_id INTEGER,
      sender         TEXT,
      subject        TEXT,
      classification TEXT,
      received_at    INTEGER,
      raw_ref        TEXT
    );

    -- ── Agent permissions, audit, self-extension (§6.12, §6.15) ────────
    CREATE TABLE IF NOT EXISTS capability_permissions (
      capability TEXT PRIMARY KEY,
      mode       TEXT NOT NULL DEFAULT 'auto'   -- auto|confirm|off
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      ts        INTEGER NOT NULL,
      actor     TEXT,                           -- user|agent
      action    TEXT NOT NULL,
      payload   TEXT,
      prev_hash TEXT,
      hash      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS patch_proposals (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      rationale      TEXT,
      files          TEXT,                      -- json PatchSet
      scan_result    TEXT,                      -- json
      sandbox_result TEXT,                      -- json
      status         TEXT NOT NULL DEFAULT 'proposed', -- proposed|approved|applied|rolled_back
      created_at     INTEGER NOT NULL
    );

    -- ── Notifications, ledgers (§6.19) ─────────────────────────────────
    CREATE TABLE IF NOT EXISTS notifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT,
      payload    TEXT,
      seen       INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scan_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      url        TEXT,
      first_seen INTEGER,
      portal     TEXT,
      title      TEXT,
      company    TEXT,
      status     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scan_url ON scan_history(url);

    CREATE TABLE IF NOT EXISTS runs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         INTEGER NOT NULL,
      kind       TEXT,
      trigger    TEXT,
      summary    TEXT,
      result     TEXT
    );

    -- ── Saved-search history + company watchlist (enhancements) ────────
    CREATE TABLE IF NOT EXISTS search_log (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      params TEXT,
      ts     INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS company_watch (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_name TEXT NOT NULL UNIQUE,
      label           TEXT,
      created_at      INTEGER NOT NULL
    );

    -- ── ATS auto-discovery cache (Indeed→ATS bridge) ───────────────────
    CREATE TABLE IF NOT EXISTS ats_probe_cache (
      normalized_name TEXT PRIMARY KEY,
      found           TEXT,              -- ats type ('' = probed, none found)
      checked_at      INTEGER
    );

    -- ── BLS OEWS wage cache (salary grounding) ─────────────────────────
    CREATE TABLE IF NOT EXISTS bls_wage_cache (
      soc           TEXT PRIMARY KEY,    -- e.g. '15-1252'
      annual_median INTEGER,             -- null = lookup failed / no data
      year          TEXT,
      cached_at     INTEGER
    );

    -- ── Geocode cache (§6.3) ───────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS geo_cache (
      query     TEXT PRIMARY KEY,   -- normalized location string
      lat       REAL,
      lng       REAL,
      label     TEXT,
      source    TEXT,               -- areacode|nominatim|none
      cached_at INTEGER
    );
  `);

  migrate('saved_searches', 'params', 'TEXT');
  migrate('boards', 'adapter_stale', 'INTEGER');
  seedCapabilityDefaults();
}

/** Additive column migration — safe to run every boot. */
function migrate(table: string, col: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
}

/** Seed the per-capability permission matrix: all auto except applying;
 *  self_extension always confirm. (PLAN.md §2 / §6.12) */
function seedCapabilityDefaults() {
  const defaults: Record<string, string> = {
    search: 'auto', harvest: 'auto', learn_boards: 'auto', digest_experience: 'auto',
    score: 'auto', tailor_doc: 'auto', pull_intel: 'auto', set_rules: 'auto',
    edit_profile: 'auto', send_email: 'auto', create_accounts: 'auto',
    apply: 'off', self_extension: 'confirm'
  };
  const stmt = db.prepare(
    'INSERT INTO capability_permissions(capability, mode) VALUES(?, ?) ON CONFLICT(capability) DO NOTHING'
  );
  const tx = db.transaction(() => {
    for (const [cap, mode] of Object.entries(defaults)) stmt.run(cap, mode);
  });
  tx();
}

export function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialised');
  return db;
}

/** Checkpoint + close the database for a clean shutdown. */
export function closeDb(): void {
  if (!db) return;
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* */ }
  try { db.close(); } catch { /* */ }
}
