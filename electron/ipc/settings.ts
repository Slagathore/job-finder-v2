import { ipcMain, safeStorage } from 'electron';
import { getDb } from './db';

// Secrets encrypted at rest via the OS keychain (PLAN.md §2). Applied across all
// write paths (settings:set, ensureHubToken, gmail.saveSetting) + migrated on boot.
const SECRET_KEYS = new Set(['anthropicApiKey', 'gmailClientSecret', 'gmailRefreshToken']);

function encryptionReady(): boolean {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

/** Serialize a setting value for storage; encrypts secret keys when possible. */
function encodeValue(key: string, value: any): string {
  if (SECRET_KEYS.has(key) && value != null && value !== '' && encryptionReady()) {
    try { return JSON.stringify({ __enc: safeStorage.encryptString(String(value)).toString('base64') }); }
    catch { /* fall back to plaintext */ }
  }
  return JSON.stringify(value);
}

/** Decode a stored value; transparently decrypts the `{__enc}` envelope. */
function decodeValue(raw: string): any {
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return raw; }
  if (parsed && typeof parsed === 'object' && typeof parsed.__enc === 'string') {
    try { return safeStorage.decryptString(Buffer.from(parsed.__enc, 'base64')); } catch { return ''; }
  }
  return parsed;
}

/** Single write path for settings (encrypts secrets). Used by every caller. */
export function writeSetting(key: string, value: any): void {
  getDb().prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, encodeValue(key, value));
}

/** Re-encrypt any previously-plaintext secrets once encryption is available. */
export function migrateSecrets(): void {
  if (!encryptionReady()) return;
  const db = getDb();
  for (const key of SECRET_KEYS) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) continue;
    let parsed: any; try { parsed = JSON.parse(row.value); } catch { continue; }
    if (parsed && typeof parsed === 'object' && parsed.__enc) continue;  // already encrypted
    if (parsed === '' || parsed == null) continue;
    writeSetting(key, parsed);
  }
}

/**
 * App settings with defaults. LLM defaults follow PLAN.md §5.4: Ollama Cloud
 * gemini-3-flash-preview:cloud through the OpenAI-compatible /v1 path, with an
 * Anthropic → local-model fallback chain.
 */
export const DEFAULTS = {
  // ── LLM provider (§5.4) ─────────────────────────────────────────────
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  openaiCompatUrl: 'http://127.0.0.1:11434/v1',
  openaiCompatKey: 'ollama',
  primaryModel: 'gemini-3-flash-preview:cloud',
  fallbackLocalModel: 'llama3.2',
  anthropicApiKey: '',
  anthropicModel: 'claude-sonnet-4-6',
  embeddingModel: 'nomic-embed-text',

  // ── App behaviour ───────────────────────────────────────────────────
  theme: 'dark',
  closeToTray: true,
  scanIntervalMinutes: 0,            // 0 = scheduled scans off (§6.19)
  notifyOnNewJobs: true,
  notifyOnEmail: true,

  // ── Discovery / ranking (§6.4) ──────────────────────────────────────
  payWeight: 1.0,                    // soft booster
  wfhWeight: 1.0,
  payMin: 0,                         // 0 = no minimum filter
  payMinHides: false,                // false = grey-out, true = hide

  // ── ATS scan title filter (§6.6) — empty = keep everything ──────────
  titleFilterPositive: [] as string[],
  titleFilterNegative: [] as string[],

  // ── Geo / location (§6.3) ───────────────────────────────────────────
  homeLocations: [] as { label: string; lat: number; lng: number }[],
  searchRadiusMi: 50,

  // ── Maintenance / retention (§4) ────────────────────────────────────
  pruneAfterDays: 90,        // auto-remove UNTOUCHED 'discovered' jobs older than this; 0 = off
  notifKeep: 500,            // cap on the notifications log

  // ── Update notifications ────────────────────────────────────────────
  updateSilence: '',         // '' = notify | 'until:<sha>' | 'forever' (emergencies override)

  // ── Browser-extension ingress (§5.1 / phase 6) ──────────────────────
  hubPort: 17893,
  hubToken: '',            // generated on first boot if empty

  // ── Gmail mailbox (§6.10 / phase 13) ────────────────────────────────
  gmailClientId: '',
  gmailClientSecret: '',
  gmailRefreshToken: '',     // set after OAuth
  gmailEmail: '',

  // ── Applying (§6.1) ─────────────────────────────────────────────────
  autoSubmitWhenComplete: false,  // click Submit only if no required field is left empty

  // ── Candidate contact details for generated resumes (§6.8) ──────────
  candidateName: '',
  candidateEmail: '',
  candidatePhone: '',
  candidateLocation: '',
  candidateLinks: '',      // e.g. "github.com/you, linkedin.com/in/you"
};

export type Settings = typeof DEFAULTS & Record<string, any>;

/** Read merged settings (defaults + stored overrides) directly from the DB. */
export function readSettings(): Settings {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const stored: Record<string, any> = {};
  for (const r of rows) stored[r.key] = decodeValue(r.value);
  return { ...DEFAULTS, ...stored };
}

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get', () => readSettings());

  ipcMain.handle('settings:set', (_e, patch: Record<string, any>) => {
    const tx = getDb().transaction((entries: [string, any][]) => {
      for (const [k, v] of entries) writeSetting(k, v);
    });
    tx(Object.entries(patch));
    return readSettings();
  });
}
