import { getDb } from '../ipc/db';
import { readSettings } from '../ipc/settings';
import { PRUNE_WHERE } from './prune-rule';

const DAY = 24 * 60 * 60 * 1000;

export interface PruneResult { jobsDeleted: number; notificationsDeleted: number; skipped?: string; }

export function countPrunable(days: number): number {
  if (days <= 0) return 0;
  const cutoff = Date.now() - days * DAY;
  return (getDb().prepare(`SELECT COUNT(*) n FROM jobs WHERE ${PRUNE_WHERE}`).get({ cutoff }) as { n: number }).n;
}

/** Delete untouched old `discovered` jobs + cap the notifications log. Safe by
 *  construction — see prune-rule.ts. Returns counts; never throws. */
export function runPrune(days = Number(readSettings().pruneAfterDays) || 0): PruneResult {
  const db = getDb();
  let jobsDeleted = 0, notificationsDeleted = 0;
  try {
    if (days > 0) {
      const cutoff = Date.now() - days * DAY;
      jobsDeleted = db.prepare(`DELETE FROM jobs WHERE ${PRUNE_WHERE}`).run({ cutoff }).changes;
    }
    const keep = Number(readSettings().notifKeep) || 500;
    notificationsDeleted = db.prepare(
      'DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT ?)'
    ).run(keep).changes;
    // Cap the append-only operational logs. scan_history doubles as the dedup
    // set and is read fully into memory on every scan/harvest, so it must stay
    // bounded; 50k newest rows is months of history.
    db.prepare('DELETE FROM scan_history WHERE id NOT IN (SELECT id FROM scan_history ORDER BY id DESC LIMIT 50000)').run();
    db.prepare('DELETE FROM runs WHERE id NOT IN (SELECT id FROM runs ORDER BY id DESC LIMIT 500)').run();
    db.prepare('DELETE FROM search_log WHERE id NOT IN (SELECT id FROM search_log ORDER BY id DESC LIMIT 500)').run();
  } catch (e: any) {
    return { jobsDeleted, notificationsDeleted, skipped: e?.message ?? String(e) };
  }
  return { jobsDeleted, notificationsDeleted };
}

export function dbStats() {
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    jobs: one('SELECT COUNT(*) n FROM jobs'),
    applications: one('SELECT COUNT(*) n FROM applications'),
    starred: one('SELECT COUNT(*) n FROM jobs WHERE starred = 1'),
    notifications: one('SELECT COUNT(*) n FROM notifications'),
    prunable: countPrunable(Number(readSettings().pruneAfterDays) || 0),
  };
}
