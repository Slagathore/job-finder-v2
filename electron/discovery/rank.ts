/**
 * Pure ranking helpers (PLAN.md §6.4).
 *
 * Retrieval is hybrid: a dense embedding ranking and a lexical BM25 ranking are
 * fused with Reciprocal Rank Fusion. Fusion decides candidate ORDER only. Raw
 * cosine similarity is a retrieval signal, not a calibrated match score, so it
 * is never turned into a grade or shown as a percentage. Pay and WFH stay SOFT
 * boosters (never hide; never dominate). The displayed A-F grade comes from the
 * LLM rubric in grade.ts and is cached in jobs.fit_score.
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
 * The soft pay/WFH booster on its own, 0..0.3 at weight 1. Split out so both the
 * legacy similarity score and the fused hybrid score apply the identical bonus.
 */
export function boostFactor(
  opts: { pay: number | null; workMode: string | null | undefined },
  w: RankWeights
): number {
  return 0.15 * w.wfhWeight * wfhScore(opts.workMode)
       + 0.15 * w.payWeight * payNorm(opts.pay);
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
  return sim + boostFactor(opts, w);
}

export const GRADES: Grade[] = ['A', 'B', 'C', 'D', 'F'];

/** Is a stored fit_score a usable cached grade? Anything else reads as ungraded. */
export function isGrade(v: unknown): v is Grade {
  return typeof v === 'string' && (GRADES as string[]).includes(v.toUpperCase().trim());
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

/** Excludes a job if ANY of the (comma-separated) negative terms appear in title/company/description. */
export function matchesExcludeKeyword(job: { title?: string | null; company?: string | null; description?: string | null }, kw: string): boolean {
  if (!kw || !kw.trim()) return true;
  const hay = `${job.title ?? ''} ${job.company ?? ''} ${job.description ?? ''}`.toLowerCase();
  const terms = kw.toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
  return !terms.some(t => hay.includes(t));
}


// ─────────────────────────────────────────────────────────────────────────────
// Hybrid retrieval: BM25 lexical scoring + Reciprocal Rank Fusion.
// ─────────────────────────────────────────────────────────────────────────────

/** Words that carry no signal in a job posting, so they only add noise to BM25. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'you', 'our', 'are', 'will', 'this', 'that', 'from',
  'have', 'has', 'was', 'were', 'been', 'their', 'they', 'them', 'your', 'its',
  'not', 'but', 'all', 'any', 'can', 'may', 'who', 'what', 'when', 'where', 'how',
  'work', 'role', 'job', 'team', 'company', 'position', 'per', 'via', 'into', 'out',
  'about', 'more', 'than', 'also', 'other', 'such', 'each', 'both', 'over', 'under',
]);

/**
 * Split text into scoring terms. Keeps `c++`, `.net`, `node.js` style tokens
 * intact, lowercases, drops one-character tokens and stopwords.
 */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  const raw = text.toLowerCase().match(/[a-z0-9][a-z0-9+#._-]*/g) ?? [];
  const out: string[] = [];
  for (const t0 of raw) {
    const t = t0.replace(/[._-]+$/, '');
    if (t.length < 2) continue;
    if (STOPWORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

export interface LexicalDoc { id: number; text: string }
export interface LexicalHit { id: number; score: number }

/**
 * Okapi BM25 over a small in-memory corpus. Implemented here rather than pulled
 * in as a dependency: it is a dozen lines and staying pure keeps it unit-testable
 * alongside the rest of the ranking core.
 *
 * idf uses the standard non-negative form, so a term present in every document
 * contributes ~0 instead of a negative score that would penalise a match.
 * Returns only documents that matched at least one query term, best first.
 */
export function bm25Rank(
  docs: LexicalDoc[],
  query: string,
  opts: { k1?: number; b?: number } = {}
): LexicalHit[] {
  const k1 = opts.k1 ?? 1.5;
  const b = opts.b ?? 0.75;
  const qTerms = Array.from(new Set(tokenize(query)));
  if (!qTerms.length || !docs.length) return [];

  const tfs: Map<string, number>[] = [];
  const lengths: number[] = [];
  const df = new Map<string, number>();
  for (const d of docs) {
    const terms = tokenize(d.text);
    lengths.push(terms.length);
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    tfs.push(tf);
    for (const t of tf.keys()) if (qTerms.includes(t)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = docs.length;
  const avgdl = lengths.reduce((s, x) => s + x, 0) / N || 1;

  const hits: LexicalHit[] = [];
  for (let i = 0; i < docs.length; i++) {
    let score = 0;
    for (const t of qTerms) {
      const f = tfs[i].get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (lengths[i] / avgdl))));
    }
    if (score > 0) hits.push({ id: docs[i].id, score });
  }
  hits.sort((x, y) => y.score - x.score || x.id - y.id);
  return hits;
}

/** Standard RRF constant. 60 is the value from the original Cormack paper. */
export const RRF_K = 60;

/**
 * Reciprocal Rank Fusion over any number of ranked id lists (each best-first).
 * Rank-based, so the two systems need no score normalisation between them.
 * An empty list contributes nothing, so one dead system degrades to the other.
 */
export function rrfFuse(rankings: number[][], k = RRF_K): Map<number, number> {
  const out = new Map<number, number>();
  for (const list of rankings) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      out.set(id, (out.get(id) ?? 0) + 1 / (k + i + 1));
    }
  }
  return out;
}

/**
 * How much of an RRF score one full soft booster is worth. A top-of-list rank
 * step costs about 0.0005, so a maxed booster (0.3) moves a job roughly five
 * places near the top: enough to matter, never enough to bury relevance. When
 * nothing was retrieved at all (rrf 0 everywhere) this leaves the boosters as
 * the only ordering signal, which is the old behaviour.
 */
export const RRF_BOOST_SCALE = 0.008;

export function fusedScore(rrf: number, boost: number): number {
  return rrf + boost * RRF_BOOST_SCALE;
}
