/** Canonical pipeline lifecycle columns (PLAN.md §6.9). Pure — testable. */
export const PIPELINE_COLUMNS = ['discovered', 'tailored', 'applied', 'responded', 'interview', 'offer', 'rejected'] as const;
export type Column = typeof PIPELINE_COLUMNS[number];

const ALIASES: Record<string, Column> = {
  evaluated: 'discovered',
  discarded: 'rejected',
  declined: 'rejected',
  skip: 'rejected',
};

export function columnForState(state?: string | null): Column {
  const s = (state || 'discovered').toLowerCase();
  if ((PIPELINE_COLUMNS as readonly string[]).includes(s)) return s as Column;
  return ALIASES[s] ?? 'discovered';
}

export function groupIntoColumns<T extends { state?: string | null }>(rows: T[]): Record<Column, T[]> {
  const out = Object.fromEntries(PIPELINE_COLUMNS.map(c => [c, [] as T[]])) as Record<Column, T[]>;
  for (const r of rows) out[columnForState(r.state)].push(r);
  return out;
}
