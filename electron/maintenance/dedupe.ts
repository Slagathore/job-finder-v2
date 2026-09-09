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
    SELECT id, source, url, company, title, description, salary_listed, starred, status, also_seen,
           (SELECT COUNT(*) FROM applications a WHERE a.job_id = jobs.id) AS apps
    FROM jobs WHERE company != '' AND title != ''
  `).all() as any[];

  const key = (r: any) => `${normalizeCompany(r.company)}::${(r.title || '').toLowerCase().trim()}`;
  const atsByKey = new Map<string, any>();
  for (const r of rows) if (isAts(r.source)) atsByKey.set(key(r), r);

  // Aggregator-vs-aggregator: the same role harvested from Indeed AND LinkedIn
  // has no ATS row to collapse into, so elect one survivor per key (richest
  // description wins) and fold the rest into it. Without this, cross-posted
  // roles show up once per board in every search.
  const extWinnerByKey = new Map<string, any>();
  for (const r of rows) {
    if (!isExt(r.source) || atsByKey.has(key(r))) continue;
    const k = key(r);
    const cur = extWinnerByKey.get(k);
    const rich = (x: any) => (x.description || '').length + (x.salary_listed ? 1000 : 0);
    // A row the user has touched always survives, whatever its description length.
    const touched = (x: any) => (x.starred || x.apps > 0 || (x.status && x.status !== 'discovered')) ? 1 : 0;
    if (!cur || touched(r) > touched(cur) || (touched(r) === touched(cur) && rich(r) > rich(cur))) {
      extWinnerByKey.set(k, r);
    }
  }

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
  const noteAlsoSeen = db.prepare('UPDATE jobs SET also_seen = @also WHERE id = @id');

  /** Record on the survivor that this role was also listed elsewhere, so the UI
   *  can show every place it was found instead of silently dropping the dupe. */
  const alsoSeen = new Map<number, { source: string; url: string }[]>();
  const addAlsoSeen = (survivorId: number, dupe: any, existingJson: string | null) => {
    if (!alsoSeen.has(survivorId)) {
      let prior: { source: string; url: string }[] = [];
      try { const p = JSON.parse(existingJson || '[]'); if (Array.isArray(p)) prior = p; } catch { /* ignore */ }
      alsoSeen.set(survivorId, prior);
    }
    const list = alsoSeen.get(survivorId)!;
    if (dupe.url && !list.some(x => x.url === dupe.url)) list.push({ source: dupe.source || 'unknown', url: dupe.url });
  };

  let merged = 0, kept = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (!isExt(r.source)) continue;
      const k = key(r);
      const ats = atsByKey.get(k);
      const extWinner = extWinnerByKey.get(k);
      // Prefer collapsing into the company's own ATS row; else into the elected
      // aggregator survivor (skipping the survivor itself).
      const survivor = ats ?? (extWinner && extWinner.id !== r.id ? extWinner : null);
      if (!survivor) continue;
      if (r.starred || r.apps > 0 || (r.status && r.status !== 'discovered')) { kept++; continue; }
      enrich.run({
        id: survivor.id,
        description: (r.description || '').trim() || null,
        salary: (r.salary_listed || '').trim() || null,
        grp: k.slice(0, 120),
      });
      addAlsoSeen(survivor.id, r, survivor.also_seen);
      del.run(r.id);
      merged++;
    }
    for (const [id, list] of alsoSeen) noteAlsoSeen.run({ id, also: JSON.stringify(list) });
  });
  tx();

  if (merged > 0) console.log(`[dedupe] collapsed ${merged} duplicate listings (${kept} kept: user-touched)`);
  return { merged, kept };
}
