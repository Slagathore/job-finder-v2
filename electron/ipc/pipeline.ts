import { ipcMain } from 'electron';
import { getDb } from './db';
import { groupIntoColumns, PIPELINE_COLUMNS } from '../pipeline/columns';

export function registerPipelineHandlers() {
  ipcMain.handle('pipeline:board', () => {
    const rows = getDb().prepare(`
      SELECT j.id AS jobId, j.company, j.title, j.fit_score, j.work_mode, j.location_raw, j.url,
             a.state, a.route, a.submitted_at, a.tailored_cv_path AS cv, a.cover_letter_path AS cover
      FROM jobs j LEFT JOIN applications a ON a.job_id = j.id
      ORDER BY COALESCE(a.submitted_at, j.first_seen) DESC
      LIMIT 600
    `).all() as any[];
    const cols = groupIntoColumns(rows);
    const counts = Object.fromEntries(PIPELINE_COLUMNS.map(c => [c, cols[c].length]));
    // Cap rendered cards per column; counts stay accurate.
    for (const c of PIPELINE_COLUMNS) cols[c] = cols[c].slice(0, 60);
    return { columns: cols, counts, order: PIPELINE_COLUMNS };
  });

  ipcMain.handle('pipeline:move', (_e, p: { jobId: number; state: string }) => {
    const db = getDb();
    const now = Date.now();
    const existing = db.prepare('SELECT id FROM applications WHERE job_id = ?').get(p.jobId) as any;
    if (existing) {
      db.prepare('UPDATE applications SET state = ? WHERE job_id = ?').run(p.state, p.jobId);
    } else {
      db.prepare('INSERT INTO applications (job_id, state, created_at) VALUES (?, ?, ?)').run(p.jobId, p.state, now);
    }
    if (p.state === 'applied') {
      db.prepare("UPDATE applications SET submitted_at = COALESCE(submitted_at, ?) WHERE job_id = ?").run(now, p.jobId);
      db.prepare("UPDATE jobs SET status = 'applied' WHERE id = ?").run(p.jobId);
    }
    return { ok: true };
  });
}
