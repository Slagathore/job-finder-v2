import { ipcMain } from 'electron';
import { getDb } from './db';

/** Saved searches + recent search history. */
export function registerSearchHandlers() {
  ipcMain.handle('searches:save', (_e, p: { name: string; params: any }) => {
    if (!p.name?.trim()) return { error: 'Name required.' };
    getDb().prepare('INSERT INTO saved_searches (name, params, created_at) VALUES (?, ?, ?)')
      .run(p.name.trim(), JSON.stringify(p.params ?? {}), Date.now());
    return { ok: true };
  });
  ipcMain.handle('searches:list', () =>
    (getDb().prepare('SELECT id, name, params, created_at FROM saved_searches ORDER BY id DESC').all() as any[])
      .map(r => { try { r.params = JSON.parse(r.params || '{}'); } catch { r.params = {}; } return r; }));
  ipcMain.handle('searches:delete', (_e, id: number) => { getDb().prepare('DELETE FROM saved_searches WHERE id = ?').run(id); return { ok: true }; });

  ipcMain.handle('searches:log', (_e, params: any) => {
    const db = getDb();
    db.prepare('INSERT INTO search_log (params, ts) VALUES (?, ?)').run(JSON.stringify(params ?? {}), Date.now());
    db.prepare('DELETE FROM search_log WHERE id NOT IN (SELECT id FROM search_log ORDER BY id DESC LIMIT 50)').run();
    return { ok: true };
  });
  ipcMain.handle('searches:history', () =>
    (getDb().prepare('SELECT id, params, ts FROM search_log ORDER BY id DESC LIMIT 20').all() as any[])
      .map(r => { try { r.params = JSON.parse(r.params || '{}'); } catch { r.params = {}; } return r; }));
}
