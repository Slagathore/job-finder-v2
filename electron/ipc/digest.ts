import { ipcMain } from 'electron';
import { getDb } from './db';
import { computeFollowups, type FollowupInput } from '../followup/cadence';

/** Daily digest for the Dashboard landing page. */
export function registerDigestHandlers() {
  ipcMain.handle('digest:get', () => {
    const db = getDb();
    const d = new Date(); d.setHours(0, 0, 0, 0); const midnight = d.getTime();
    const one = (sql: string, ...a: any[]) => (db.prepare(sql).get(...a) as { n: number }).n;

    const fu = computeFollowups(db.prepare(`
      SELECT a.id AS appId, a.job_id AS jobId, j.company, j.title, j.url, a.state,
             COALESCE(a.submitted_at, a.created_at) AS since
      FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.state IN ('applied','responded','interview')`).all() as FollowupInput[], Date.now());

    const byState: Record<string, number> = {};
    for (const r of db.prepare('SELECT state, COUNT(*) n FROM applications GROUP BY state').all() as any[]) byState[r.state] = r.n;

    return {
      newToday: one('SELECT COUNT(*) n FROM jobs WHERE first_seen >= ?', midnight),
      jobsTotal: one('SELECT COUNT(*) n FROM jobs'),
      surfaced: one('SELECT COUNT(*) n FROM jobs WHERE surfaced = 1'),
      starred: one('SELECT COUNT(*) n FROM jobs WHERE starred = 1'),
      followupsDue: fu.length,
      unseenNotifs: one('SELECT COUNT(*) n FROM notifications WHERE seen = 0'),
      interviewsOffers: one("SELECT COUNT(*) n FROM applications WHERE state IN ('interview','offer')"),
      byState,
    };
  });

  // "Today" action queue: the 3 things worth doing right now, as concrete rows
  // (not counts) — follow-ups due, freshly surfaced fits, and applications
  // that have gone quiet.
  ipcMain.handle('digest:today', () => {
    const db = getDb();
    const now = Date.now();
    const DAY = 24 * 3600_000;

    const followups = computeFollowups(db.prepare(`
      SELECT a.id AS appId, a.job_id AS jobId, j.company, j.title, j.url, a.state,
             COALESCE(a.submitted_at, a.created_at) AS since
      FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.state IN ('applied','responded','interview')`).all() as FollowupInput[], now).slice(0, 5);

    const freshFits = db.prepare(`
      SELECT id, company, title, url, fit_score, work_mode FROM jobs
      WHERE surfaced = 1 AND status = 'discovered' AND first_seen >= ?
      ORDER BY first_seen DESC LIMIT 5
    `).all(now - 2 * DAY);

    const staleApps = db.prepare(`
      SELECT a.id AS appId, j.id AS jobId, j.company, j.title, j.url,
             CAST((? - COALESCE(a.submitted_at, a.created_at)) / ${DAY} AS INTEGER) AS daysSince
      FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.state = 'applied' AND COALESCE(a.submitted_at, a.created_at) < ?
      ORDER BY daysSince DESC LIMIT 5
    `).all(now, now - 10 * DAY);

    return { followups, freshFits, staleApps };
  });
}
