/**
 * Discovery worker (PLAN.md §4 scale fix). Runs the vector ranking off the main
 * thread with its own READONLY SQLite connection — so a large corpus never
 * blocks the UI. Pre-filters by work_mode in SQL to shrink the candidate set;
 * the pure `rankCandidates` does the rest. Compiled to dist-electron/discovery/.
 */
import { parentPort } from 'worker_threads';
import Database from 'better-sqlite3';
import { fromBlob } from './vector';
import { rankCandidates, type ScanJob } from './scan-core';

interface Msg { dbPath: string; params: any; queryVec: number[] | null; weights: any; }

const COLUMNS =
  'id,company,title,url,description,work_mode,salary_listed,salary_estimate,geo_lat,geo_lng,fit_score,starred,surfaced,first_seen,status,embedding';

parentPort?.on('message', (msg: Msg) => {
  try {
    const db = new Database(msg.dbPath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = true');

    const where: string[] = [];
    const args: any[] = [];
    const wm = msg.params?.workModes as string[] | undefined;
    if (wm && wm.length) { where.push(`work_mode IN (${wm.map(() => '?').join(',')})`); args.push(...wm); }

    const rows = db.prepare(
      `SELECT ${COLUMNS} FROM jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`
    ).all(...args) as any[];

    let embeddedJobs = 0;
    const jobs: ScanJob[] = rows.map(r => {
      const { embedding, ...meta } = r;
      if (embedding) embeddedJobs++;
      return { ...meta, vec: embedding ? fromBlob(embedding) : null } as ScanJob;
    });
    const itemVecs = (db.prepare('SELECT embedding FROM experience_items WHERE embedding IS NOT NULL').all() as any[])
      .map(r => fromBlob(r.embedding));
    db.close();

    const out = rankCandidates({ jobs, itemVecs, queryVec: msg.queryVec, weights: msg.weights, ...msg.params });
    parentPort!.postMessage({ ok: true, results: out.results, embeddedCoverage: { jobs: embeddedJobs, jobsTotal: jobs.length, items: itemVecs.length } });
  } catch (e: any) {
    parentPort!.postMessage({ ok: false, error: e?.message ?? String(e) });
  }
});
