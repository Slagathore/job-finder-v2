import { cosine, topKMeanSim } from './vector';
import { combineScore, simToGrade, matchesWorkModes, matchesKeyword, parsePay, type RankWeights } from './rank';
import { haversineMiles } from '../geo/distance';

export interface ScanJob {
  id: number; company: string; title: string; url: string; description?: string | null;
  work_mode: string | null; salary_listed: string | null; salary_estimate?: string | null;
  geo_lat: number | null; geo_lng: number | null; fit_score: string | null;
  starred: number; surfaced: number; first_seen: number; status: string;
  vec: ArrayLike<number> | null;
}

/** Midpoint of a stored LLM salary_estimate JSON, used as a pay fallback. */
function estimatedPay(json: string | null | undefined): number | null {
  if (!json) return null;
  try {
    const e = JSON.parse(json);
    const lo = typeof e?.min === 'number' ? e.min : null;
    const hi = typeof e?.max === 'number' ? e.max : null;
    if (lo == null && hi == null) return null;
    return Math.round(((lo ?? hi)! + (hi ?? lo)!) / 2);
  } catch { return null; }
}

export interface RankOpts {
  jobs: ScanJob[];
  itemVecs: ArrayLike<number>[];
  queryVec: ArrayLike<number> | null;
  weights: RankWeights;
  workModes?: string[];
  keyword?: string;
  payMin?: number;
  location?: { lat: number; lng: number } | null;
  radiusMi?: number;
  sort?: 'fit' | 'pay' | 'date' | 'distance';
  limit?: number;
}

/**
 * Pure ranking core (PLAN.md §6.4) — filters + scores a candidate set. No db/
 * electron imports, so it runs identically in a worker thread or in-process and
 * is unit-testable. The worker shrinks `jobs` via SQL first; this re-applies all
 * filters defensively (pay/geo can't be done in SQL).
 */
export function rankCandidates(o: RankOpts): { results: any[] } {
  const payMin = Number(o.payMin) || 0;
  const radiusMi = Number(o.radiusMi) || 0;
  const loc = o.location ?? null;
  const corpus = o.itemVecs;
  const scored: any[] = [];

  for (const j of o.jobs) {
    if (!matchesWorkModes(j.work_mode, o.workModes ?? [])) continue;
    if (!matchesKeyword(j, o.keyword ?? '')) continue;
    const pay = parsePay(j.salary_listed) ?? estimatedPay(j.salary_estimate);  // listed, else LLM estimate
    if (payMin > 0 && pay != null && pay < payMin) continue;   // unknown pay kept (soft)

    let distance: number | null = null;
    if (loc && radiusMi > 0) {
      if (j.work_mode === 'remote') distance = null;
      else if (j.geo_lat != null && j.geo_lng != null) {
        distance = haversineMiles(loc.lat, loc.lng, j.geo_lat, j.geo_lng);
        if (distance > radiusMi) continue;
      }
    } else if (loc && j.geo_lat != null && j.geo_lng != null) {
      distance = haversineMiles(loc.lat, loc.lng, j.geo_lat, j.geo_lng);
    }

    let sim = 0;
    if (j.vec) sim = o.queryVec ? cosine(j.vec, o.queryVec) : (corpus.length ? topKMeanSim(j.vec, corpus) : 0);

    const { vec, ...rest } = j;
    scored.push({ ...rest, sim, fit_grade: simToGrade(sim), pay, distance, score: combineScore(sim, { pay, workMode: j.work_mode }, o.weights) });
  }

  const sort = o.sort ?? 'fit';
  scored.sort((a, b) =>
    sort === 'pay' ? (b.pay ?? -1) - (a.pay ?? -1)
    : sort === 'date' ? b.first_seen - a.first_seen
    : sort === 'distance' ? (a.distance ?? Infinity) - (b.distance ?? Infinity)
    : b.score - a.score);

  return { results: scored.slice(0, o.limit ?? 100) };
}
