import { getDb } from '../ipc/db';
import { checkLiveness } from './liveness';
import { rankLivenessCandidates, type LivenessRow } from './liveness-priority';

// Hard caps so this never turns into a crawler: a bounded number of URLs re-checked
// per sweep, throttled between requests (same spirit as geo/geocode.ts's Nominatim
// self-throttle). At 15 jobs * 1.5s a full sweep costs well under a minute.
const BATCH_SIZE = 15;
const REQUEST_DELAY_MS = 1500;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface LivenessSweepResult { checked: number; markedDead: number; }

/**
 * Background re-check of a bounded batch of job postings, replacing the pure posting-age
 * guess (jobs.expires_at) with a real signal where we have one. Conservative by design:
 * only classifyLiveness's confirmed "closed/expired" match marks a job dead. A fetch
 * failure or timeout (classifyLiveness's "unreachable") never does, so a flaky network or
 * a site that's briefly down can never hide a job that is actually still live.
 */
export async function sweepLiveness(now = Date.now()): Promise<LivenessSweepResult> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT j.id, j.url, j.starred, j.surfaced, j.first_seen, j.expires_at,
           j.liveness_checked_at, j.liveness_status,
           EXISTS(SELECT 1 FROM applications a WHERE a.job_id = j.id) AS has_application
    FROM jobs j
    WHERE j.url IS NOT NULL AND j.url != ''
  `).all() as (LivenessRow & { url: string })[];

  const candidates = rankLivenessCandidates(rows, now).slice(0, BATCH_SIZE);
  if (!candidates.length) return { checked: 0, markedDead: 0 };

  const byId = new Map(rows.map(r => [r.id, r as LivenessRow & { url: string }]));
  const upd = db.prepare('UPDATE jobs SET liveness_checked_at = ?, liveness_status = ? WHERE id = ?');

  let checked = 0, markedDead = 0;
  for (const c of candidates) {
    const row = byId.get(c.id);
    if (!row?.url) continue;
    try {
      const live = await checkLiveness(row.url);
      // classifyLiveness's 'unreachable' reason covers both a fetch failure and an empty
      // page. Neither is a confirmed closure, so it records the attempt without ever
      // marking the job dead.
      const status = live.live ? 'live' : live.reason === 'closed/expired' ? 'dead' : 'unreachable';
      upd.run(Date.now(), status, row.id);
      checked++;
      if (status === 'dead') markedDead++;
    } catch (e: any) {
      console.error('[liveness-sweep] check failed:', e?.message ?? e);
    }
    await sleep(REQUEST_DELAY_MS);
  }
  return { checked, markedDead };
}
