import { ipcMain } from 'electron';
import { getDb } from './db';

/** Insert a notification row (mirrors desktop toasts) — PLAN.md §6.19. */
export function addNotification(kind: string, payload: any): void {
  getDb().prepare('INSERT INTO notifications (kind, payload, seen, created_at) VALUES (?, ?, 0, ?)')
    .run(kind, JSON.stringify(payload ?? null), Date.now());
}

export function registerNotificationHandlers() {
  ipcMain.handle('notifications:list', () => {
    const rows = getDb().prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 50').all() as any[];
    return rows.map(r => { try { r.payload = JSON.parse(r.payload); } catch { /* keep raw */ } return r; });
  });
  ipcMain.handle('notifications:unseen', () =>
    (getDb().prepare('SELECT COUNT(*) n FROM notifications WHERE seen = 0').get() as { n: number }).n);
  ipcMain.handle('notifications:markSeen', (_e, id: number) => {
    getDb().prepare('UPDATE notifications SET seen = 1 WHERE id = ?').run(id); return { ok: true };
  });
  ipcMain.handle('notifications:markAllSeen', () => {
    getDb().prepare('UPDATE notifications SET seen = 1 WHERE seen = 0').run(); return { ok: true };
  });
}
