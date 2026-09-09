/**
 * Line-item duplicate rules (pure — no db/electron imports, so it stays testable).
 *
 * Uploading a second resume re-states most of the same history in slightly
 * different words. Inserting those as fresh rows inflates the corpus with
 * near-identical bullets, which then crowd out genuinely distinct experience
 * when the tailoring step picks its top-N items. So near-duplicates merge into
 * the existing row instead, keeping whichever wording carries more detail.
 */

/** Words too common to say anything about whether two bullets are the same. */
const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'at', 'from',
  'as', 'is', 'was', 'were', 'be', 'been', 'that', 'this', 'it', 'its', 'my', 'our', 'i',
]);

export function tokenize(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9%$.\s-]/g, ' ')
    .split(/\s+/)
    .map(t => t.replace(/^[-.]+|[-.]+$/g, ''))
    .filter(t => t.length > 1 && !STOP.has(t));
}

/** Jaccard overlap of significant tokens, 0..1. */
export function textSimilarity(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / (A.size + B.size - shared);
}

export interface DupeCandidate {
  id?: number;
  kind: string;
  text: string;
  employer?: string | null;
  role?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  metrics?: string | null;
}

/** Above this Jaccard overlap, two same-kind items are treated as the same fact. */
export const DUPE_THRESHOLD = 0.62;

/**
 * Find the existing item a new one duplicates, or null. Only same-kind items
 * can match, and items pinned to different employers never match — two similar
 * bullets at two different jobs are two real accomplishments.
 */
export function findDuplicate<T extends DupeCandidate>(candidate: DupeCandidate, existing: T[]): T | null {
  let best: T | null = null;
  let bestScore = DUPE_THRESHOLD;
  for (const e of existing) {
    if (e.kind !== candidate.kind) continue;
    const ce = (candidate.employer ?? '').trim().toLowerCase();
    const ee = (e.employer ?? '').trim().toLowerCase();
    if (ce && ee && ce !== ee) continue;
    const score = textSimilarity(candidate.text, e.text);
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return best;
}

/**
 * Merge a duplicate into the row that already exists. The longer text usually
 * carries more specifics, and any field the old row left blank is filled from
 * the new one, so two partial resumes add up to one richer entry.
 */
export function mergeItems<T extends DupeCandidate>(existing: T, incoming: DupeCandidate): T {
  const pickText = (incoming.text ?? '').length > (existing.text ?? '').length ? incoming.text : existing.text;
  const fill = (a: any, b: any) => (a != null && String(a).trim() !== '' ? a : b ?? null);
  return {
    ...existing,
    text: pickText,
    employer: fill(existing.employer, incoming.employer),
    role: fill(existing.role, incoming.role),
    start_date: fill(existing.start_date, incoming.start_date),
    end_date: fill(existing.end_date, incoming.end_date),
    metrics: fill(existing.metrics, incoming.metrics),
  };
}
