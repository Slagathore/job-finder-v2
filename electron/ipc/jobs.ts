import { ipcMain } from 'electron';
import { getDb } from './db';

/**
 * Minimal jobs read API for the dashboard. The harvesting/scan pipeline that
 * populates this table arrives in phase 2 (career-ops scan.mjs → DB).
 */
export function registerJobHandlers() {
  ipcMain.handle('jobs:list', (_e, q: { status?: string; limit?: number } = {}) => {
    const db = getDb();
    const limit = Math.min(q.limit ?? 200, 1000);
    if (q.status) {
      return db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY first_seen DESC LIMIT ?')
        .all(q.status, limit);
    }
    return db.prepare('SELECT * FROM jobs ORDER BY first_seen DESC LIMIT ?').all(limit);
  });

  ipcMain.handle('jobs:setStar', (_e, p: { id: number; starred: boolean }) => {
    getDb().prepare('UPDATE jobs SET starred = ? WHERE id = ?').run(p.starred ? 1 : 0, p.id);
    return { ok: true };
  });

  ipcMain.handle('jobs:counts', () => {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) n FROM jobs').get() as { n: number }).n;
    const byStatus = db.prepare('SELECT status, COUNT(*) n FROM jobs GROUP BY status').all();
    return { total, byStatus };
  });
}
