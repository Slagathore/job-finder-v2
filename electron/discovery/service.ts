import { Worker } from 'worker_threads';
import * as path from 'path';
import { getDb, getDbPath } from '../ipc/db';
import { readSettings } from '../ipc/settings';
import { embed } from '../llm/provider';
import { toBlob, fromBlob, cosine, topKMeanSim } from './vector';
import { simToGrade, parsePay, type RankWeights } from './rank';
import { rankCandidates, type ScanJob } from './scan-core';
import { gradeJobLlm, type GradeItem } from './grade';

const BATCH = 32;

function jobEmbedText(j: any): string {
  return [j.title, j.company, j.location_raw, (j.description ?? '').slice(0, 4000)]
    .filter(Boolean).join('\n');
}

/** Embed all jobs + line items that don't yet have a vector. Idempotent. */
export async function runEmbeddings(force = false): Promise<{ jobsEmbedded: number; itemsEmbedded: number }> {
  const db = getDb();
  const s = readSettings();
  let jobsEmbedded = 0, itemsEmbedded = 0;

  const items = db.prepare(
    `SELECT id, text FROM experience_items ${force ? '' : 'WHERE embedding IS NULL'}`
  ).all() as { id: number; text: string }[];
  const updItem = db.prepare('UPDATE experience_items SET embedding = ? WHERE id = ?');
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const vecs = await embed(s, batch.map(b => b.text));
    const tx = db.transaction(() => {
      batch.forEach((b, k) => { if (vecs[k]) { updItem.run(toBlob(vecs[k]), b.id); itemsEmbedded++; } });
    });
    tx();
  }

  const jobs = db.prepare(
    `SELECT id, title, company, location_raw, description FROM jobs ${force ? '' : 'WHERE embedding IS NULL'}`
  ).all() as any[];
  const updJob = db.prepare('UPDATE jobs SET embedding = ? WHERE id = ?');
  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    const vecs = await embed(s, batch.map(jobEmbedText));
    const tx = db.transaction(() => {
      batch.forEach((j, k) => { if (vecs[k]) { updJob.run(toBlob(vecs[k]), j.id); jobsEmbedded++; } });
    });
    tx();
  }

  return { jobsEmbedded, itemsEmbedded };
}

function loadItemVectors(): { id: number; vec: Float32Array }[] {
  const rows = getDb().prepare('SELECT id, embedding FROM experience_items WHERE embedding IS NOT NULL').all() as any[];
  return rows.map(r => ({ id: r.id, vec: fromBlob(r.embedding) }));
}

export interface SearchParams {
  tags?: string;
  roleFamily?: string;
  workModes?: string[];
  payMin?: number;
  keyword?: string;
  sort?: 'fit' | 'pay' | 'date' | 'distance';
  limit?: number;
  location?: { lat: number; lng: number } | null;
  radiusMi?: number;
}

export interface SearchResult {
  results: any[];
  embeddedCoverage: { jobs: number; jobsTotal: number; items: number };
  usedQueryVector: boolean;
}

const SCAN_COLUMNS =
  'id,company,title,url,description,work_mode,salary_listed,salary_estimate,geo_lat,geo_lng,fit_score,starred,surfaced,first_seen,status,embedding';

function loadScanJobs(): { jobs: ScanJob[]; embeddedJobs: number } {
  const rows = getDb().prepare(`SELECT ${SCAN_COLUMNS} FROM jobs`).all() as any[];
  let embeddedJobs = 0;
  const jobs = rows.map(r => {
    const { embedding, ...meta } = r;
    if (embedding) embeddedJobs++;
    return { ...meta, vec: embedding ? fromBlob(embedding) : null } as ScanJob;
  });
  return { jobs, embeddedJobs };
}

/** Run the ranking in a worker thread (own readonly DB connection) so a large
 *  corpus never blocks the UI. Rejects → caller falls back in-process. */
function runSearchWorker(payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(path.join(__dirname, 'worker.js')); }
    catch (e) { reject(e); return; }
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('search worker timeout')); }, 30_000);
    worker.once('message', (m: any) => { clearTimeout(timer); worker.terminate(); m?.ok ? resolve(m) : reject(new Error(m?.error || 'worker failed')); });
    worker.once('error', (e) => { clearTimeout(timer); worker.terminate(); reject(e); });
    worker.postMessage(payload);
  });
}

export async function search(params: SearchParams): Promise<SearchResult> {
  const s = readSettings();
  const weights: RankWeights = { payWeight: s.payWeight ?? 1, wfhWeight: s.wfhWeight ?? 1 };

  const queryText = [params.tags, params.roleFamily].map(x => (x ?? '').trim()).filter(Boolean).join(', ');
  let queryVec: number[] | null = null;
  if (queryText) { try { queryVec = (await embed(s, [queryText]))[0] ?? null; } catch { queryVec = null; } }

  try {
    const m = await runSearchWorker({ dbPath: getDbPath(), params, queryVec, weights });
    return { results: m.results, embeddedCoverage: m.embeddedCoverage, usedQueryVector: !!queryVec };
  } catch {
    // In-process fallback (e.g. worker unavailable in a packaged build).
    const { jobs, embeddedJobs } = loadScanJobs();
    const itemVecs = loadItemVectors().map(i => i.vec);
    const out = rankCandidates({ jobs, itemVecs, queryVec, weights, ...params });
    return { results: out.results, embeddedCoverage: { jobs: embeddedJobs, jobsTotal: jobs.length, items: itemVecs.length }, usedQueryVector: !!queryVec };
  }
}

/** Rank ALL jobs by fit to the experience corpus; mark + return the top picks
 *  (PLAN.md §6.18 surface mode). Requires job + item embeddings. */
export async function discover(limit = 30): Promise<{ results: any[]; note?: string }> {
  const db = getDb();
  const itemVecs = loadItemVectors().map(i => i.vec);
  if (!itemVecs.length) return { results: [], note: 'No experience embeddings yet — import experience and run embeddings.' };

  const jobs = (db.prepare('SELECT * FROM jobs WHERE embedding IS NOT NULL').all() as any[]);
  if (!jobs.length) return { results: [], note: 'No job embeddings yet — run embeddings first.' };

  const scored = jobs.map(j => {
    const sim = topKMeanSim(fromBlob(j.embedding), itemVecs);
    return { ...j, embedding: undefined, sim, fit_grade: simToGrade(sim), pay: parsePay(j.salary_listed) };
  }).sort((a, b) => b.sim - a.sim).slice(0, limit);

  const mark = db.prepare('UPDATE jobs SET surfaced = 1 WHERE id = ?');
  const tx = db.transaction(() => { for (const j of scored) mark.run(j.id); });
  tx();

  return { results: scored };
}

/** LLM fit-grade one job, storing grade + rationale + supporting item ids. */
export async function gradeJob(jobId: number): Promise<{ grade: string; rationale: string } | { error: string }> {
  const db = getDb();
  const s = readSettings();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
  if (!job) return { error: 'Job not found.' };

  // Pick the most relevant line items (by vector if available, else first 25).
  let items: GradeItem[];
  const allItems = db.prepare('SELECT id, kind, text, embedding FROM experience_items').all() as any[];
  if (job.embedding && allItems.some(i => i.embedding)) {
    const jv = fromBlob(job.embedding);
    items = allItems
      .filter(i => i.embedding)
      .map(i => ({ i, sim: cosine(jv, fromBlob(i.embedding)) }))
      .sort((a, b) => b.sim - a.sim).slice(0, 20)
      .map(({ i }) => ({ id: i.id, kind: i.kind, text: i.text }));
  } else {
    items = allItems.slice(0, 25).map(i => ({ id: i.id, kind: i.kind, text: i.text }));
  }

  try {
    const r = await gradeJobLlm(s, job, items);
    db.prepare('UPDATE jobs SET fit_score = ?, fit_rationale = ?, supporting_item_ids = ? WHERE id = ?')
      .run(r.grade, r.rationale, JSON.stringify(r.supporting_item_ids), jobId);
    return { grade: r.grade, rationale: r.rationale };
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}
