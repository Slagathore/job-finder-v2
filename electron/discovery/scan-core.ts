import { cosine, topKMeanSim } from './vector';
import {
  boostFactor, fusedScore, bm25Rank, rrfFuse, isGrade,
  matchesWorkModes, matchesKeyword, matchesExcludeKeyword, parsePay,
  type RankWeights, type Grade,
} from './rank';
import { haversineMiles } from '../geo/distance';

export interface ScanJob {
  id: number; company: string; title: string; url: string; description?: string | null;
  work_mode: string | null; salary_listed: string | null; salary_estimate?: string | null;
  geo_lat: number | null; geo_lng: number | null; fit_score: string | null;
  fit_rationale?: string | null;
  starred: number; surfaced: number; first_seen: number; status: string;
  posted_at?: number | null; expires_at?: number | null; also_seen?: string | null;
  liveness_status?: string | null; liveness_checked_at?: number | null;
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
  /** Semantic query text; also feeds the lexical (BM25) half of the hybrid. */
  tags?: string;
  roleFamily?: string;
  keyword?: string;
  excludeKeyword?: string;
  payMin?: number;
  location?: { lat: number; lng: number } | null;
  radiusMi?: number;
  sort?: 'fit' | 'pay' | 'date' | 'distance';
  limit?: number;
}

/** The text the lexical half of the hybrid searches for. */
export function lexicalQuery(o: Pick<RankOpts, 'tags' | 'roleFamily' | 'keyword'>): string {
  return [o.tags, o.roleFamily, o.keyword].map(x => (x ?? '').trim()).filter(Boolean).join(' ');
}

/**
 * Pure ranking core (PLAN.md §6.4) - filters, then orders a candidate set with
 * hybrid retrieval: dense embedding similarity and BM25 lexical relevance, fused
 * by Reciprocal Rank Fusion, with pay/WFH as a soft tiebreaker. No db/electron
 * imports, so it runs identically in a worker thread or in-process and is
 * unit-testable. The worker shrinks `jobs` via SQL first; this re-applies all
 * filters defensively (pay/geo can't be done in SQL).
 *
 * `fit_grade` is the CACHED LLM rubric grade or null. Similarity never becomes a
 * grade: cosine between two pieces of related professional text sits in a narrow
 * high band, so it graded nearly everything A.
 */
export function rankCandidates(o: RankOpts): { results: any[]; total: number } {
  const payMin = Number(o.payMin) || 0;
  const radiusMi = Number(o.radiusMi) || 0;
  const loc = o.location ?? null;
  const corpus = o.itemVecs;
  const scored: any[] = [];

  for (const j of o.jobs) {
    if (!matchesWorkModes(j.work_mode, o.workModes ?? [])) continue;
    if (!matchesKeyword(j, o.keyword ?? '')) continue;
    if (!matchesExcludeKeyword(j, o.excludeKeyword ?? '')) continue;
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
    scored.push({
      ...rest,
      sim,
      // Cached LLM rubric grade, or null for "not graded yet". Never fabricated.
      fit_grade: isGrade(j.fit_score) ? (j.fit_score!.toUpperCase().trim() as Grade) : null,
      pay, distance,
      boost: boostFactor({ pay, workMode: j.work_mode }, o.weights),
    });
  }

  // Dense ranking: only jobs that actually produced a similarity take part, so a
  // corpus with no embeddings contributes an empty list instead of a flat tie.
  const denseIds = scored.filter(x => x.sim > 0).sort((a, b) => b.sim - a.sim).map(x => x.id);

  // Lexical ranking: BM25 over title + company + description against the query.
  const lex = bm25Rank(
    scored.map(x => ({ id: x.id, text: `${x.title ?? ''} ${x.company ?? ''} ${x.description ?? ''}` })),
    lexicalQuery(o)
  );
  const lexScore = new Map(lex.map(h => [h.id, h.score]));

  const rrf = rrfFuse([denseIds, lex.map(h => h.id)]);
  for (const x of scored) {
    x.rrf = rrf.get(x.id) ?? 0;
    x.lex = lexScore.get(x.id) ?? 0;
    x.score = fusedScore(x.rrf, x.boost);
  }

  const sort = o.sort ?? 'fit';
  scored.sort((a, b) =>
    sort === 'pay' ? (b.pay ?? -1) - (a.pay ?? -1)
    : sort === 'date' ? b.first_seen - a.first_seen
    : sort === 'distance' ? (a.distance ?? Infinity) - (b.distance ?? Infinity)
    : b.score - a.score || b.sim - a.sim);

  // `total` = everything that passed the filters, so the UI can say "showing N of TOTAL".
  return { results: scored.slice(0, o.limit ?? 100), total: scored.length };
}
