import * as fs from 'fs';
import * as path from 'path';
import { getDb, getDbPath } from '../ipc/db';

const KEEP = 7;

/**
 * Daily rotating backup of the SQLite DB (the entire job search lives in one
 * file). Uses better-sqlite3's online backup API, which is WAL-safe. At most
 * one backup per calendar day; keeps the newest KEEP copies.
 */
export async function runBackup(): Promise<{ ok: boolean; path?: string; skipped?: boolean; error?: string }> {
  try {
    const src = getDbPath();
    if (!src) return { ok: false, error: 'DB not initialised' };
    const dir = path.join(path.dirname(src), 'backups');
    fs.mkdirSync(dir, { recursive: true });

    const stamp = new Date().toISOString().slice(0, 10);
    const dest = path.join(dir, `jobfinder-${stamp}.db`);
    if (fs.existsSync(dest)) return { ok: true, path: dest, skipped: true };

    await getDb().backup(dest);

    // Rotate: newest KEEP stay, older copies go.
    const old = fs.readdirSync(dir)
      .filter(f => /^jobfinder-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort()
      .slice(0, -KEEP);
    for (const f of old) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* */ } }

    return { ok: true, path: dest };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
