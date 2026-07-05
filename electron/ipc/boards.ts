import { ipcMain } from 'electron';
import { getDb } from './db';
import { detectApi } from '../scan/ats';
import { SEED_COMPANIES } from '../scan/seed-companies';
import { probeIngress } from '../boards/probe';
import { learnSite } from '../boards/learn';
import { saveAdapter } from '../boards/store';
import { readSettings } from './settings';

/** Seed the boards table from the starter company list if it's empty. */
export function seedBoardsIfEmpty() {
  const db = getDb();
  const n = (db.prepare('SELECT COUNT(*) c FROM boards').get() as { c: number }).c;
  if (n > 0) return;
  const now = Date.now();
  const stmt = db.prepare(
    'INSERT INTO boards (name, type, url, enabled, ingress, status, created_at) VALUES (?, ?, ?, 1, ?, ?, ?)'
  );
  const tx = db.transaction(() => {
    for (const c of SEED_COMPANIES) {
      const api = detectApi({ name: c.name, url: c.url });
      stmt.run(c.name, c.type, c.url, api ? 'api' : 'unknown', api ? api.type : 'no-api', now);
    }
  });
  tx();
}

export function registerBoardHandlers() {
  ipcMain.handle('boards:list', () => {
    return getDb().prepare('SELECT * FROM boards ORDER BY name COLLATE NOCASE').all();
  });

  ipcMain.handle('boards:add', (_e, b: { name: string; url: string }) => {
    const db = getDb();
    const api = detectApi({ name: b.name, url: b.url });
    db.prepare(
      'INSERT INTO boards (name, type, url, enabled, ingress, status, created_at) VALUES (?, ?, ?, 1, ?, ?, ?)'
    ).run(b.name, 'ats', b.url, api ? 'api' : 'unknown', api ? api.type : 'no-api', Date.now());
    return { ok: true, detected: api?.type ?? null };
  });

  ipcMain.handle('boards:setEnabled', (_e, p: { id: number; enabled: boolean }) => {
    getDb().prepare('UPDATE boards SET enabled = ? WHERE id = ?').run(p.enabled ? 1 : 0, p.id);
    return { ok: true };
  });

  ipcMain.handle('boards:delete', (_e, id: number) => {
    getDb().prepare('DELETE FROM boards WHERE id = ?').run(id);
    return { ok: true };
  });

  ipcMain.handle('boards:reseed', () => {
    seedBoardsIfEmpty();
    return getDb().prepare('SELECT COUNT(*) c FROM boards').get();
  });

  ipcMain.handle('boards:probe', async (_e, p: { id?: number; url: string }) => {
    try {
      const result = await probeIngress(p.url);
      if (p.id) getDb().prepare('UPDATE boards SET ingress = ?, status = ? WHERE id = ?')
        .run(result.ingress, result.method, p.id);
      return result;
    } catch (e: any) { return { error: e?.message ?? String(e) }; }
  });

  ipcMain.handle('boards:learn', async (_e, p: { id?: number; url: string }) => {
    try {
      const r = await learnSite(readSettings(), p.url);
      if ('error' in r) return r;
      saveAdapter(p.url, r.adapter, r.count);
      if (p.id) getDb().prepare("UPDATE boards SET ingress = 'dom', status = 'dom-adapter' WHERE id = ?").run(p.id);
      return r;
    } catch (e: any) { return { error: e?.message ?? String(e) }; }
  });
}
