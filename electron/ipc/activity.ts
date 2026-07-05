import { ipcMain } from 'electron';
import { getDb } from './db';

const DAY = 24 * 60 * 60 * 1000;
const localDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** GitHub-style application activity heat-map + a current streak. */
export function registerActivityHandlers() {
  ipcMain.handle('activity:heatmap', (_e, weeks = 16) => {
    const db = getDb();
    const days = weeks * 7;
    const start = localDay(Date.now()) - (days - 1) * DAY;
    const counts: Record<string, number> = {};
    for (const r of db.prepare('SELECT submitted_at FROM applications WHERE submitted_at IS NOT NULL').all() as any[]) {
      const k = iso(localDay(r.submitted_at));
      counts[k] = (counts[k] || 0) + 1;
    }
    const grid: { date: string; count: number }[] = [];
    for (let t = start; t <= localDay(Date.now()); t += DAY) { const k = iso(t); grid.push({ date: k, count: counts[k] || 0 }); }

    // Current streak (consecutive days up to today with ≥1 application).
    let streak = 0;
    for (let t = localDay(Date.now()); ; t -= DAY) { if ((counts[iso(t)] || 0) > 0) streak++; else break; }
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    return { grid, streak, total };
  });
}
