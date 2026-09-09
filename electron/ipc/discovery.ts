import { ipcMain } from 'electron';
import {
  runEmbeddings, search, discover, gradeJob, autoGradeJobs,
  type SearchParams, type GradeProgress,
} from '../discovery/service';
import { readSettings } from './settings';

let embedding = false;

/** Bumped by every search, so an older grading pass knows it was superseded. */
let gradeGeneration = 0;

export interface DiscoveryDeps {
  onGradeProgress: (p: GradeProgress) => void;
}

export function registerDiscoveryHandlers(deps: DiscoveryDeps = { onGradeProgress: () => {} }) {
  ipcMain.handle('discovery:embed', async (_e, force?: boolean) => {
    if (embedding) return { error: 'Embedding already in progress.' };
    embedding = true;
    try { return await runEmbeddings(!!force); }
    catch (e: any) { return { error: e?.message ?? String(e) }; }
    finally { embedding = false; }
  });

  ipcMain.handle('discovery:search', async (_e, params: SearchParams) => {
    try {
      const out = await search(params ?? {});
      // Grade the top hits in the background. Deliberately NOT awaited: the
      // results go back to the renderer now, grades arrive over the progress
      // channel as each one lands.
      const n = Number(readSettings().autoGradeTopN) || 0;
      if (n > 0 && out.results.length) {
        const mine = ++gradeGeneration;
        const ids = out.results.slice(0, n).map((r: any) => r.id);
        void autoGradeJobs(ids, {
          onProgress: p => { if (mine === gradeGeneration) deps.onGradeProgress(p); },
          shouldStop: () => mine !== gradeGeneration,
        }).catch(e => deps.onGradeProgress({
          running: false, done: 0, total: 0, note: `Fit grading failed: ${e?.message ?? String(e)}`,
        }));
      }
      return out;
    }
    catch (e: any) { return { error: e?.message ?? String(e) }; }
  });

  ipcMain.handle('discovery:discover', async (_e, limit?: number) => {
    try { return await discover(limit ?? 30); }
    catch (e: any) { return { error: e?.message ?? String(e) }; }
  });

  ipcMain.handle('discovery:grade', async (_e, jobId: number) => gradeJob(jobId));

  // Manual re-run of the automatic pass, e.g. "grade the rest of these".
  ipcMain.handle('discovery:gradeTop', async (_e, a: { jobIds: number[]; force?: boolean }) => {
    const mine = ++gradeGeneration;
    try {
      return await autoGradeJobs(a?.jobIds ?? [], {
        force: !!a?.force,
        onProgress: p => { if (mine === gradeGeneration) deps.onGradeProgress(p); },
        shouldStop: () => mine !== gradeGeneration,
      });
    } catch (e: any) { return { error: e?.message ?? String(e) }; }
  });
}
