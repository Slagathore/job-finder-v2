import { getDb } from '../ipc/db';
import type { LineItem } from './digest';
import type { DerivedProfile, RoleFit } from './profile';

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

export function getRoleFits(): any[] {
  return getDb().prepare('SELECT * FROM role_fits ORDER BY confidence DESC').all();
}

function safeArr(s: any): string[] { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } }
