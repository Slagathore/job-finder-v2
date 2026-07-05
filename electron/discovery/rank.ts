/**
 * Pure ranking helpers (PLAN.md §6.4). Similarity is the primary signal; pay and
 * WFH are SOFT boosters (never hide; never dominate). Fit score is informational.
 */

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface RankWeights { payWeight: number; wfhWeight: number; }

export function wfhScore(workMode: string | null | undefined): number {
  if (workMode === 'remote') return 1;
  if (workMode === 'hybrid') return 0.5;
  return 0;
}

/** Parse an annual USD-ish figure from a free-text salary string. */
export function parsePay(salary: string | null | undefined): number | null {
  if (!salary) return null;
  const s = salary.toLowerCase().replace(/,/g, '');
  const hourly = /\$?\s*(\d{2,3}(?:\.\d+)?)\s*(?:\/|\s)?(?:hr|hour|hourly|\/h)\b/.exec(s);
  if (hourly) return Math.round(parseFloat(hourly[1]) * 2080);
  // Collect $amounts, supporting "120k" / "120000" / "$120,000".
  const nums: number[] = [];
  const re = /\$?\s*(\d{2,3}(?:\.\d+)?)\s*k\b|\$\s*(\d{4,7})\b|\b(\d{5,7})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1] != null) nums.push(parseFloat(m[1]) * 1000);
    else if (m[2] != null) nums.push(parseFloat(m[2]));
    else if (m[3] != null) nums.push(parseFloat(m[3]));
  }
  if (!nums.length) return null;
  // Use the midpoint of the range when two+ figures appear.
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return Math.round((lo + hi) / 2);
}

/** Normalise pay to 0..1 against a soft cap; null pay → 0 (neutral, no penalty). */
export function payNorm(value: number | null, cap = 250_000): number {
  if (value == null || value <= 0) return 0;
  return Math.max(0, Math.min(1, value / cap));
}

/**
 * Combine similarity with soft pay/WFH boosters. Similarity stays dominant:
 * boosters contribute at most ~0.15 each at weight 1.
 */
export function combineScore(
  sim: number,
  opts: { pay: number | null; workMode: string | null | undefined },
  w: RankWeights
): number {
  const boost = 0.15 * w.wfhWeight * wfhScore(opts.workMode)
              + 0.15 * w.payWeight * payNorm(opts.pay);
  return sim + boost;
}

/** Map a cosine similarity to an A–F fit grade (thresholds tunable). */
export function simToGrade(sim: number): Grade {
  if (sim >= 0.60) return 'A';
  if (sim >= 0.52) return 'B';
  if (sim >= 0.45) return 'C';
  if (sim >= 0.38) return 'D';
  return 'F';
}

export function matchesWorkModes(workMode: string | null, modes: string[]): boolean {
  if (!modes || modes.length === 0) return true;
  // Unknown work mode passes only if the user didn't restrict to a specific set.
  if (!workMode) return modes.includes('any') || modes.length === 0;
  return modes.includes(workMode);
}

export function matchesKeyword(job: { title?: string | null; company?: string | null; description?: string | null }, kw: string): boolean {
  if (!kw || !kw.trim()) return true;
  const hay = `${job.title ?? ''} ${job.company ?? ''} ${job.description ?? ''}`.toLowerCase();
  return kw.toLowerCase().split(/\s+/).filter(Boolean).every(tok => hay.includes(tok));
}
