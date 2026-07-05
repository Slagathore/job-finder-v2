import { getDb } from '../ipc/db';

export interface SavedDocs {
  cvHtml: string; cvPdf?: string | null;
  coverHtml: string; coverPdf?: string | null;
  tailored: any;
}

/** Upsert the application row for a job, appending a doc version + marking tailored. */
export function saveApplicationDocs(jobId: number, d: SavedDocs): void {
  const db = getDb();
  const now = Date.now();
  const existing = db.prepare('SELECT id, doc_versions FROM applications WHERE job_id = ?').get(jobId) as any;
  const version = { ts: now, cvHtml: d.cvHtml, cvPdf: d.cvPdf ?? null, coverHtml: d.coverHtml, coverPdf: d.coverPdf ?? null };
  const cvPath = d.cvPdf || d.cvHtml;
  const coverPath = d.coverPdf || d.coverHtml;

  if (existing) {
    let versions: any[] = [];
    try { versions = JSON.parse(existing.doc_versions || '[]'); } catch { /* reset */ }
    versions.push(version);
    db.prepare(`UPDATE applications SET tailored_cv_path = ?, cover_letter_path = ?, doc_versions = ?,
                state = CASE WHEN state IN ('applied','responded','interview','offer') THEN state ELSE 'tailored' END
                WHERE id = ?`)
      .run(cvPath, coverPath, JSON.stringify(versions), existing.id);
  } else {
    db.prepare(`INSERT INTO applications (job_id, state, tailored_cv_path, cover_letter_path, doc_versions, created_at)
                VALUES (?, 'tailored', ?, ?, ?, ?)`)
      .run(jobId, cvPath, coverPath, JSON.stringify([version]), now);
  }
}

export function getApplication(jobId: number): any | null {
  const row = getDb().prepare('SELECT * FROM applications WHERE job_id = ?').get(jobId) as any;
  if (!row) return null;
  try { row.doc_versions = JSON.parse(row.doc_versions || '[]'); } catch { row.doc_versions = []; }
  return row;
}
