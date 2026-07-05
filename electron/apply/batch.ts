import { getDb } from '../ipc/db';
import { isBlocked } from '../ipc/blocklist';
import { runTailor } from './run';
import { checkLiveness } from './liveness';
import { detectRoute } from './route';

export interface PreparedItem {
  jobId: number; company: string; title: string; url: string;
  blocked?: boolean; route?: string; live?: boolean; liveReason?: string;
  cv?: string; cover?: string; error?: string;
}

/** Prepare a batch for review: gate on blocklist, tailor docs, check liveness,
 *  detect route. Nothing is submitted here (PLAN.md §6.1 review queue). */
export async function prepareBatch(jobIds: number[]): Promise<{ items: PreparedItem[] }> {
  const db = getDb();
  const items: PreparedItem[] = [];
  for (const id of jobIds) {
    const job = db.prepare('SELECT id, company, title, url FROM jobs WHERE id = ?').get(id) as any;
    if (!job) { items.push({ jobId: id, company: '', title: '', url: '', error: 'job not found' }); continue; }
    const base: PreparedItem = { jobId: id, company: job.company, title: job.title, url: job.url };

    if (isBlocked(job.company)) { items.push({ ...base, blocked: true }); continue; }

    const tail = await runTailor(id);
    if ('error' in tail) { items.push({ ...base, error: tail.error }); continue; }

    const live = await checkLiveness(job.url);
    items.push({ ...base, route: detectRoute(job.url), live: live.live, liveReason: live.reason, cv: tail.cv, cover: tail.cover });
  }
  return { items };
}

/**
 * Mark a job applied (assisted hand-off): re-check blocklist + liveness, set the
 * application state, and return the URL for the renderer to open so Cole submits
 * with the tailored docs ready. (Automated form submission via the Playwright
 * apply-engine is the remaining piece — see PLAN §6.1.)
 */
export async function submitApplication(jobId: number): Promise<{ ok: boolean; url?: string; reason?: string }> {
  const db = getDb();
  const job = db.prepare('SELECT id, company, url FROM jobs WHERE id = ?').get(jobId) as any;
  if (!job) return { ok: false, reason: 'job not found' };
  if (isBlocked(job.company)) return { ok: false, reason: 'company is blocklisted' };

  const live = await checkLiveness(job.url);
  if (!live.live) return { ok: false, reason: `posting ${live.reason}` };

  const now = Date.now();
  const existing = db.prepare('SELECT id FROM applications WHERE job_id = ?').get(jobId) as any;
  if (existing) db.prepare("UPDATE applications SET state = 'applied', submitted_at = ?, trigger = 'manual' WHERE job_id = ?").run(now, jobId);
  else db.prepare("INSERT INTO applications (job_id, state, submitted_at, trigger, created_at) VALUES (?, 'applied', ?, 'manual', ?)").run(jobId, now, now);
  db.prepare("UPDATE jobs SET status = 'applied' WHERE id = ?").run(jobId);

  return { ok: true, url: job.url };
}
