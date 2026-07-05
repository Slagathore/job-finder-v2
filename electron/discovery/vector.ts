/**
 * Vector math for semantic discovery (PLAN.md §6.18). Embeddings are stored as
 * Float32 BLOBs in SQLite; cosine similarity drives job↔experience matching.
 */

export function toBlob(vec: number[] | Float32Array): Buffer {
  const f = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

export function fromBlob(buf: Buffer): Float32Array {
  // Copy into an aligned buffer (better-sqlite3 blobs may be unaligned).
  const copy = Buffer.from(buf);
  return new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.length / 4));
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Score a job vector against the candidate's experience corpus: mean of the
 * top-k most-similar line items. Top-k (not max) avoids a single generic skill
 * dominating, while still rewarding strong specific overlaps.
 */
export function topKMeanSim(jobVec: ArrayLike<number>, itemVecs: ArrayLike<number>[], k = 3): number {
  if (!itemVecs.length) return 0;
  const sims = itemVecs.map(v => cosine(jobVec, v)).sort((a, b) => b - a);
  const take = sims.slice(0, Math.min(k, sims.length));
  return take.reduce((s, x) => s + x, 0) / take.length;
}
