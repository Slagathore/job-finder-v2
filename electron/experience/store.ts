import { getDb } from '../ipc/db';
import type { LineItem } from './digest';
import type { DerivedProfile, RoleFit } from './profile';
import { findDuplicate, mergeItems } from './dupe-rule';

export function insertItems(items: LineItem[]): number {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO experience_items
      (kind, text, source_ref, role, employer, start_date, end_date, metrics, seniority_signal, created_at)
    VALUES (@kind, @text, @source_ref, @role, @employer, @start_date, @end_date, @metrics, @seniority_signal, @created_at)
  `);
  let n = 0;
  const tx = db.transaction((rows: LineItem[]) => {
    for (const i of rows) {
      stmt.run({
        kind: i.kind, text: i.text, source_ref: (i as any).source_ref ?? null,
        role: i.role ?? null, employer: i.employer ?? null,
        start_date: i.start_date ?? null, end_date: i.end_date ?? null,
        metrics: i.metrics ?? null, seniority_signal: i.seniority_signal ?? null,
        created_at: now,
      });
      n++;
    }
  });
  tx(items);
  return n;
}

/**
 * Insert line items, merging any that duplicate what is already stored.
 * Returns both counts so the UI can say "12 added, 9 merged" after a second
 * resume upload instead of silently doubling the corpus.
 *
 * `supersedeSourceRef`, when given, deletes every existing item whose
 * source_ref is EXACTLY that ref before inserting, so re-digesting the same
 * project (a repeat GitHub scan, folder digest, or URL digest) replaces its
 * previous pass instead of piling a second, near-duplicate description on
 * top. The match is exact, not a substring/LIKE match, so an item whose
 * source_ref was unioned with a pipe because it merged with, say, a resume
 * item (e.g. "resume:pasted|github:owner/repo") is left alone: it carries
 * other provenance too and is not this project's alone to delete. The delete
 * and the insert/merge pass run inside the same transaction, so a failure
 * partway through cannot leave the user with the old pass gone and the new
 * one missing.
 */
export function insertItemsDeduped(
  items: LineItem[], opts?: { supersedeSourceRef?: string }
): { added: number; merged: number } {
  const db = getDb();
  const now = Date.now();

  const deleteSuperseded = db.prepare('DELETE FROM experience_items WHERE source_ref = ?');
  const selectExisting = db.prepare(
    'SELECT id, kind, text, employer, role, start_date, end_date, metrics, source_ref FROM experience_items'
  );
  const insert = db.prepare(`
    INSERT INTO experience_items
      (kind, text, source_ref, role, employer, start_date, end_date, metrics, seniority_signal, created_at)
    VALUES (@kind, @text, @source_ref, @role, @employer, @start_date, @end_date, @metrics, @seniority_signal, @created_at)
  `);
  // A merged row's text may have changed, so its embedding must be recomputed.
  const update = db.prepare(`
    UPDATE experience_items
       SET text = @text, employer = @employer, role = @role, start_date = @start_date,
           end_date = @end_date, metrics = @metrics, source_ref = @source_ref, embedding = NULL
     WHERE id = @id
  `);

  let added = 0, merged = 0;
  const tx = db.transaction((rows: LineItem[]) => {
    if (opts?.supersedeSourceRef) deleteSuperseded.run(opts.supersedeSourceRef);
    const existing = selectExisting.all() as any[];
    for (const i of rows) {
      const candidate = {
        kind: i.kind, text: i.text, employer: i.employer ?? null, role: i.role ?? null,
        start_date: i.start_date ?? null, end_date: i.end_date ?? null, metrics: i.metrics ?? null,
      };
      const dupe = findDuplicate(candidate, existing);
      if (dupe) {
        const m = mergeItems(dupe, candidate);
        // Keep provenance for both sources, so a line item still says where it came from.
        const refs = new Set(String(dupe.source_ref ?? '').split('|').filter(Boolean));
        const incomingRef = (i as any).source_ref;
        if (incomingRef) refs.add(incomingRef);
        update.run({
          id: dupe.id, text: m.text, employer: m.employer, role: m.role,
          start_date: m.start_date, end_date: m.end_date, metrics: m.metrics,
          source_ref: Array.from(refs).join('|') || null,
        });
        Object.assign(dupe, m);   // later items in this batch dedupe against the merged text
        merged++;
        continue;
      }
      const info = insert.run({
        kind: i.kind, text: i.text, source_ref: (i as any).source_ref ?? null,
        role: i.role ?? null, employer: i.employer ?? null,
        start_date: i.start_date ?? null, end_date: i.end_date ?? null,
        metrics: i.metrics ?? null, seniority_signal: i.seniority_signal ?? null,
        created_at: now,
      });
      existing.push({ ...candidate, id: Number(info.lastInsertRowid), source_ref: (i as any).source_ref ?? null });
      added++;
    }
  });
  tx(items);
  return { added, merged };
}

export function listItems(): any[] {
  return getDb().prepare('SELECT * FROM experience_items ORDER BY id DESC').all();
}
export function listItemsForInference(): LineItem[] {
  return getDb().prepare('SELECT kind, text, role, employer, start_date, end_date, metrics, seniority_signal FROM experience_items').all() as LineItem[];
}
export function deleteItem(id: number) { getDb().prepare('DELETE FROM experience_items WHERE id = ?').run(id); }
export function clearItems() { getDb().prepare('DELETE FROM experience_items').run(); }

export function saveProfile(p: DerivedProfile) {
  const db = getDb();
  const now = Date.now();
  // Single canonical profile row (id reused).
  db.prepare('DELETE FROM profiles').run();
  db.prepare(`
    INSERT INTO profiles (id, skills, domains, seniority, total_yoe, narrative, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
  `).run(JSON.stringify(p.skills), JSON.stringify(p.domains), p.seniority, p.total_yoe, p.narrative, now);
}

export function getProfile(): DerivedProfile | null {
  const row = getDb().prepare('SELECT * FROM profiles WHERE id = 1').get() as any;
  if (!row) return null;
  return {
    skills: safeArr(row.skills), domains: safeArr(row.domains),
    seniority: row.seniority, total_yoe: row.total_yoe, narrative: row.narrative,
  };
}

export function replaceRoleFits(fits: RoleFit[]) {
  const db = getDb();
  const now = Date.now();
  db.prepare('DELETE FROM role_fits').run();
  const stmt = db.prepare(`
    INSERT INTO role_fits (role_family, industry, taxonomy_code, confidence, rationale, refreshed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((rows: RoleFit[]) => {
    for (const f of rows) stmt.run(f.role_family, f.industry, f.taxonomy_code, f.confidence, f.rationale, now);
  });
  tx(fits);
}

/**
 * Append role fits without touching the ones already there.
 *
 * replaceRoleFits wipes the table, which is right after a fresh inference and
 * wrong for anything that adds a single conclusion. Returns the new row ids so
 * the caller can undo exactly what it added.
 */
export function addRoleFits(fits: RoleFit[]): { id: number; role_family: string }[] {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO role_fits (role_family, industry, taxonomy_code, confidence, rationale, refreshed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const added: { id: number; role_family: string }[] = [];
  const tx = db.transaction((rows: RoleFit[]) => {
    for (const f of rows) {
      const info = stmt.run(f.role_family, f.industry, f.taxonomy_code ?? null, f.confidence, f.rationale, now);
      added.push({ id: Number(info.lastInsertRowid), role_family: f.role_family });
    }
  });
  tx(fits);
  return added;
}

export function getRoleFits(): any[] {
  return getDb().prepare('SELECT * FROM role_fits ORDER BY confidence DESC').all();
}

function safeArr(s: any): string[] { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } }
