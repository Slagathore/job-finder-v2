import { ipcMain } from 'electron';
import { getDb } from './db';
import { normalizeCompany } from '../lib/company';

export { normalizeCompany };

/** Hard apply gate (§6.5): is this company blocklisted? */
export function isBlocked(company: string): boolean {
  const norm = normalizeCompany(company);
  if (!norm) return false;
  const rows = getDb().prepare('SELECT normalized_name FROM company_blocklist').all() as { normalized_name: string }[];
  return rows.some(r => norm.includes(r.normalized_name) || r.normalized_name.includes(norm));
}

export function registerBlocklistHandlers() {
  ipcMain.handle('blocklist:list', () => getDb().prepare('SELECT * FROM company_blocklist ORDER BY normalized_name').all());
  ipcMain.handle('blocklist:add', (_e, p: { name: string; reason?: string }) => {
    const norm = normalizeCompany(p.name);
    if (!norm) return { error: 'Empty name.' };
    getDb().prepare('INSERT INTO company_blocklist (normalized_name, reason) VALUES (?, ?) ON CONFLICT(normalized_name) DO UPDATE SET reason=excluded.reason')
      .run(norm, p.reason ?? 'user');
    return { ok: true };
  });
  ipcMain.handle('blocklist:remove', (_e, id: number) => {
    getDb().prepare('DELETE FROM company_blocklist WHERE id = ?').run(id);
    return { ok: true };
  });
}
