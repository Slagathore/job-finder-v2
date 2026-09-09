/**
 * When a scan may skip a repo (pure — no db or electron imports, so vitest can
 * load it).
 *
 * A run over three dozen repos will be interrupted. Resuming has to be able to
 * tell "already read this" from "never got to it", and a deep dive has to be
 * able to redo a repo that only ever got the shallow pass.
 */

export type ProjectDepth = 'medium' | 'deep';

/** Depth ordering. A deeper pass covers everything a shallower one did. */
const RANK: Record<string, number> = { medium: 1, deep: 2 };

export interface DigestedRow {
  state: string;
  depth: string | null;
}

/** Has this repo already been digested at least this deep? */
export function alreadyDigested(row: DigestedRow | null | undefined, depth: ProjectDepth): boolean {
  if (!row || row.state !== 'done' || !row.depth) return false;
  return (RANK[row.depth] ?? 0) >= (RANK[depth] ?? 0);
}
