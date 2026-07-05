import { getDb } from '../ipc/db';
import { inferWorkMode } from '../scan/ats';
import { normalizeJobUrl } from './url';

export { normalizeJobUrl };

export interface RawJob {
  title: string;
  url: string;
  company?: string;
  location?: string;
  source?: string;
  description?: string;
  salary?: string;
}

/**
 * Ingest harvested jobs from any source (extension, scan, etc.). Dedups against
 * existing jobs + scan_history (and within the batch), inserts new rows, and
 * records scan_history. A duplicate that carries a description (e.g. the
 * extension re-harvesting a job from its detail page) enriches the existing row
 * and clears its embedding so the next embed run uses the richer text.
 * Shared by the HTTP ingress and usable elsewhere.
 */
export function ingestJobs(raw: RawJob[]): { added: number; duplicates: number; skipped: number; updated: number } {
  const db = getDb();
  const now = Date.now();

  const seen = new Set<string>();
  for (const r of db.prepare('SELECT url FROM jobs').all() as { url: string }[]) if (r.url) seen.add(r.url);
  for (const r of db.prepare('SELECT url FROM scan_history').all() as { url: string }[]) if (r.url) seen.add(r.url);

  const insertJob = db.prepare(`
    INSERT INTO jobs (source, url, company, title, description, location_raw, work_mode, salary_listed, first_seen, status)
    VALUES (@source, @url, @company, @title, @description, @location_raw, @work_mode, @salary_listed, @first_seen, 'discovered')
    ON CONFLICT(url) DO NOTHING
  `);
  const insertHist = db.prepare(
    `INSERT INTO scan_history (url, first_seen, portal, title, company, status) VALUES (?, ?, ?, ?, ?, 'added')`
  );
  const selByUrl = db.prepare('SELECT id, description FROM jobs WHERE url = ?');
  const enrich = db.prepare(`
    UPDATE jobs SET description = @description,
                    salary_listed = COALESCE(NULLIF(salary_listed, ''), @salary_listed),
                    embedding = NULL
    WHERE id = @id
  `);

  let added = 0, duplicates = 0, skipped = 0, updated = 0;
  const tx = db.transaction((rows: RawJob[]) => {
    for (const j of rows) {
      const url = normalizeJobUrl(j.url);
      if (!url || !j.title?.trim()) { skipped++; continue; }
      if (seen.has(url)) {
        const desc = (j.description ?? '').trim();
        if (desc) {
          const existing = selByUrl.get(url) as { id: number; description: string | null } | undefined;
          if (existing && !(existing.description ?? '').trim()) {
            enrich.run({ id: existing.id, description: desc, salary_listed: j.salary?.trim() || null });
            updated++;
            continue;
          }
        }
        duplicates++;
        continue;
      }
      seen.add(url);
      const source = j.source || 'extension';
      const res = insertJob.run({
        source, url, company: j.company ?? '', title: j.title.trim(),
        description: j.description ?? null, location_raw: j.location ?? '',
        work_mode: inferWorkMode(j.location ?? ''), salary_listed: j.salary?.trim() || null,
        first_seen: now,
      });
      if (res.changes > 0) { added++; insertHist.run(url, now, source, j.title.trim(), j.company ?? ''); }
      else duplicates++;
    }
  });
  tx(raw);
  return { added, duplicates, skipped, updated };
}

export interface RawField { label: string; value: string; }

/** Upsert manually-entered apply-form fields into field_memory (§6.7). */
export function ingestFields(fields: RawField[]): { saved: number } {
  const db = getDb();
  const now = Date.now();
  const sel = db.prepare('SELECT id FROM field_memory WHERE normalized_label = ?');
  const upd = db.prepare('UPDATE field_memory SET value = ?, last_used = ? WHERE id = ?');
  const ins = db.prepare('INSERT INTO field_memory (normalized_label, value, last_used, source) VALUES (?, ?, ?, ?)');
  let saved = 0;
  const tx = db.transaction((rows: RawField[]) => {
    for (const f of rows) {
      const label = (f.label ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
      const value = (f.value ?? '').trim();
      if (!label || !value) continue;
      const existing = sel.get(label) as { id: number } | undefined;
      if (existing) upd.run(value, now, existing.id);
      else ins.run(label, value, now, 'extension');
      saved++;
    }
  });
  tx(fields);
  return { saved };
}
