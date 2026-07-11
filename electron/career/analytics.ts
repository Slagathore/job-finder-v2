/**
 * Rejection-pattern / response-rate analytics — ported from career-ops
 * analyze-patterns.mjs onto the SQLite pipeline. The compute half is pure
 * (no db/electron imports) so it's directly testable.
 */

/** One row per job that entered the applied+ part of the pipeline. */
export interface OutcomeRow {
  status: string;               // pipeline column: applied|responded|interview|offer|rejected
  fit_score: string | null;     // A-F or null
  work_mode: string | null;     // onsite|hybrid|remote
  source: string | null;        // indeed|linkedin|greenhouse|extension|...
  first_seen: number;
}

export interface InsightBucket {
  label: string;
  applied: number;
  responded: number;            // responded | interview | offer
  interviews: number;           // interview | offer
  rate: number;                 // responded / applied, 0..1
}

export interface Insights {
  applied: number;
  responded: number;
  interviews: number;
  offers: number;
  rejected: number;
  pending: number;              // applied but no outcome yet
  byFit: InsightBucket[];
  byWorkMode: InsightBucket[];
  bySource: InsightBucket[];
  notes: string[];              // auto-surfaced patterns, human-readable
}

const RESPONDED = new Set(['responded', 'interview', 'offer']);
const INTERVIEW = new Set(['interview', 'offer']);

function bucketize(rows: OutcomeRow[], key: (r: OutcomeRow) => string): InsightBucket[] {
  const map = new Map<string, InsightBucket>();
  for (const r of rows) {
    const label = key(r);
    let b = map.get(label);
    if (!b) { b = { label, applied: 0, responded: 0, interviews: 0, rate: 0 }; map.set(label, b); }
    b.applied++;
    if (RESPONDED.has(r.status)) b.responded++;
    if (INTERVIEW.has(r.status)) b.interviews++;
  }
  const out = [...map.values()];
  for (const b of out) b.rate = b.applied ? b.responded / b.applied : 0;
  return out.sort((a, b) => b.applied - a.applied);
}

/** Surface the strongest contrasts as plain-english notes (min sample size 3 per side). */
function contrastNotes(buckets: InsightBucket[], dim: string): string[] {
  const eligible = buckets.filter(b => b.applied >= 3 && b.label !== '—');
  if (eligible.length < 2) return [];
  const sorted = [...eligible].sort((a, b) => b.rate - a.rate);
  const best = sorted[0], worst = sorted[sorted.length - 1];
  if (best.rate <= 0 || best.rate - worst.rate < 0.15) return [];
  const ratio = worst.rate > 0 ? ` (${(best.rate / worst.rate).toFixed(1)}× better)` : '';
  return [`${dim} "${best.label}" gets responses ${Math.round(best.rate * 100)}% of the time vs ${Math.round(worst.rate * 100)}% for "${worst.label}"${ratio} — lean into ${best.label}.`];
}

export function computeInsights(rows: OutcomeRow[]): Insights {
  const applied = rows.length;
  const responded = rows.filter(r => RESPONDED.has(r.status)).length;
  const interviews = rows.filter(r => INTERVIEW.has(r.status)).length;
  const offers = rows.filter(r => r.status === 'offer').length;
  const rejected = rows.filter(r => r.status === 'rejected').length;
  const pending = rows.filter(r => r.status === 'applied').length;

  const byFit = bucketize(rows, r => (r.fit_score || '—').toUpperCase().slice(0, 1));
  const byWorkMode = bucketize(rows, r => r.work_mode || '—');
  const bySource = bucketize(rows, r => r.source || '—');

  const notes: string[] = [];
  if (applied === 0) {
    notes.push('No applications yet — apply to a few jobs and patterns will show up here.');
  } else {
    notes.push(...contrastNotes(byFit, 'Fit grade'));
    notes.push(...contrastNotes(byWorkMode, 'Work mode'));
    notes.push(...contrastNotes(bySource, 'Source'));
    if (responded === 0 && applied >= 5) {
      notes.push(`${applied} applications with zero responses — consider tailoring more aggressively, targeting higher fit grades, or following up (see the Today queue).`);
    }
    if (rejected >= 3 && interviews === 0) {
      const rejFit = byFit.find(b => b.applied >= 3 && b.responded === 0);
      if (rejFit) notes.push(`All "${rejFit.label}"-grade applications have gone nowhere — your time is probably better spent on higher grades.`);
    }
  }
  return { applied, responded, interviews, offers, rejected, pending, byFit, byWorkMode, bySource, notes };
}
