/**
 * Pure prioritisation for the background liveness sweep (electron/apply/liveness-sweep.ts).
 * Decides WHICH jobs are worth spending a throttled network check on this run, favouring
 * the postings Cole actually cares about over untouched old rows. No db/electron imports,
 * so it stays unit-testable.
 */

export interface LivenessRow {
  id: number;
  starred: number | boolean;
  surfaced: number | boolean;
  first_seen: number;
  expires_at?: number | null;
  liveness_checked_at?: number | null;
  liveness_status?: string | null;
  has_application: number | boolean;
}

/** Don't re-check a job we already looked at within this window, keeps a sweep from
 *  burning its whole budget re-confirming the same handful of jobs run after run. */
export const RECHECK_COOLDOWN_DAYS = 3;
const DAY = 86_400_000;

function truthy(v: number | boolean | null | undefined): boolean {
  return v === true || v === 1;
}

/**
 * Priority score, higher first. Starred and applied-to jobs matter most: those are the
 * postings Cole actually acts on, and a confirmed-dead one there is a real problem, not
 * trivia. Past its soft (age-derived) expiry comes next, since that's the group most
 * likely to actually be dead. Recently surfaced comes after that, then everything else.
 */
function score(row: LivenessRow, now: number): number {
  let s = 0;
  if (truthy(row.starred)) s += 1000;
  if (truthy(row.has_application)) s += 500;
  if (row.expires_at != null && row.expires_at > 0 && row.expires_at < now) s += 200;
  if (truthy(row.surfaced)) s += 100;
  return s;
}

/**
 * Rank candidates for a sweep run. Drops jobs already confirmed dead (nothing to gain
 * re-checking those, they stay marked dead) and jobs checked within the cooldown window.
 * Ties broken by longest-since-checked, so a never-checked job always wins a tie.
 * Caller is responsible for slicing the result to its per-run batch cap.
 */
export function rankLivenessCandidates(rows: LivenessRow[], now = Date.now()): LivenessRow[] {
  const cooldownMs = RECHECK_COOLDOWN_DAYS * DAY;
  return rows
    .filter(r => r.liveness_status !== 'dead')
    .filter(r => r.liveness_checked_at == null || now - r.liveness_checked_at > cooldownMs)
    .sort((a, b) => {
      const d = score(b, now) - score(a, now);
      if (d !== 0) return d;
      return (a.liveness_checked_at ?? 0) - (b.liveness_checked_at ?? 0);
    });
}
