import { ipcMain } from 'electron';
import { runEmbeddings, search, discover, gradeJob, type SearchParams } from '../discovery/service';

let embedding = false;

export function registerDiscoveryHandlers() {
  ipcMain.handle('discovery:embed', async (_e, force?: boolean) => {
    if (embedding) return { error: 'Embedding already in progress.' };
    embedding = true;
    try { return await runEmbeddings(!!force); }
    catch (e: any) { return { error: e?.message ?? String(e) }; }
    finally { embedding = false; }
  });

  ipcMain.handle('discovery:search', async (_e, params: SearchParams) => {
    try { return await search(params ?? {}); }
    catch (e: any) { return { error: e?.message ?? String(e) }; }
  });

  ipcMain.handle('discovery:discover', async (_e, limit?: number) => {
    try { return await discover(limit ?? 30); }
    catch (e: any) { return { error: e?.message ?? String(e) }; }
  });

  ipcMain.handle('discovery:grade', async (_e, jobId: number) => gradeJob(jobId));
}
