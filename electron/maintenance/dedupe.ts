import type BetterSqlite3 from 'better-sqlite3';
import { getDb } from '../ipc/db';
import { normalizeCompany } from '../lib/company';

/**
 * Cross-source dedup (§6.20 dupe_group, finally wired): the same role often
 * exists both as an aggregator row (Indeed/LinkedIn/… extension harvest) and
 * as a direct ATS row (Greenhouse/Lever/Ashby scan). Applying via the company
 * ATS beats applying through an aggregator, so the ATS row wins: it inherits
 * any richer description/salary the aggregator row carried, and the aggregator
 * row is deleted — unless the user has touched it (starred / has an
 * application / status moved beyond 'discovered').
 */

export interface DedupeResult { merged: number; kept: number; }

const isAts = (source: string | null) => /-api$/.test(source ?? '');
const isExt = (source: string | null) => /-ext$/.test(source ?? '');

export function collapseAggregatorDupes(dbArg?: BetterSqlite3.Database): DedupeResult {
  const db = dbArg ?? getDb();
  const rows = db.prepare(`
    SELECT id, source, company, title, description, salary_listed, starred, status,
           (SELECT COUNT(*) FROM applications a WHERE a.job_id = jobs.id) AS apps
    FROM jobs WHERE company != '' AND title != ''
  `).all() as any[];

  const key = (r: any) => `${normalizeCompany(r.company)}::${(r.title || '').toLowerCase().trim()}`;
  const atsByKey = new Map<string, any>();
  for (const r of rows) if (isAts(r.source)) atsByKey.set(key(r), r);

  // SQLite evaluates SET expressions against the pre-update row, so the
  // embedding is cleared exactly when the ATS row gains a description.
  const enrich = db.prepare(`
    UPDATE jobs SET description = COALESCE(NULLIF(description, ''), @description),
                    salary_listed = COALESCE(NULLIF(salary_listed, ''), @salary),
                    embedding = CASE WHEN NULLIF(description, '') IS NULL AND @description IS NOT NULL
                                     THEN NULL ELSE embedding END,
                    dupe_group = @grp
    WHERE id = @id
  `);
  const del = db.prepare('DELETE FROM jobs WHERE id = ?');

  let merged = 0, kept = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (!isExt(r.source)) continue;
      const ats = atsByKey.get(key(r));
      if (!ats) continue;
      if (r.starred || r.apps > 0 || (r.status && r.status !== 'discovered')) { kept++; continue; }
      enrich.run({
        id: ats.id,
        description: (r.description || '').trim() || null,
        salary: (r.salary_listed || '').trim() || null,
        grp: key(r).slice(0, 120),
      });
      del.run(r.id);
      merged++;
    }
  });
  tx();

  if (merged > 0) console.log(`[dedupe] collapsed ${merged} aggregator dupes into ATS rows (${kept} kept: user-touched)`);
  return { merged, kept };
}
