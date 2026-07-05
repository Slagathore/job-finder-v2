import { ipcMain } from 'electron';
import { getDb } from './db';
import { normalizeCompany } from '../lib/company';

/** Is this company on the watchlist? (cutting-edge: company-watch radar) */
export function isWatched(company: string): boolean {
  const norm = normalizeCompany(company);
  if (!norm) return false;
  const rows = getDb().prepare('SELECT normalized_name FROM company_watch').all() as { normalized_name: string }[];
  return rows.some(r => norm.includes(r.normalized_name) || r.normalized_name.includes(norm));
}

export function registerWatchHandlers() {
  ipcMain.handle('watch:list', () => getDb().prepare('SELECT * FROM company_watch ORDER BY label COLLATE NOCASE').all());
  ipcMain.handle('watch:add', (_e, p: { name: string }) => {
    const norm = normalizeCompany(p.name);
    if (!norm) return { error: 'Empty name.' };
    getDb().prepare('INSERT INTO company_watch (normalized_name, label, created_at) VALUES (?, ?, ?) ON CONFLICT(normalized_name) DO NOTHING')
      .run(norm, p.name.trim(), Date.now());
    return { ok: true };
  });
  ipcMain.handle('watch:remove', (_e, id: number) => { getDb().prepare('DELETE FROM company_watch WHERE id = ?').run(id); return { ok: true }; });
}
