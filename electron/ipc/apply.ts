import { ipcMain } from 'electron';
import { runTailor } from '../apply/run';
import { getApplication } from '../apply/store';
import { prepareBatch, submitApplication } from '../apply/batch';
import { prepForJob } from '../apply/prep';
import { applyInWindow } from '../apply/autofill';

export function registerApplyHandlers() {
  ipcMain.handle('apply:tailor', (_e, jobId: number) => runTailor(jobId));
  ipcMain.handle('apply:get', (_e, jobId: number) => getApplication(jobId));
  ipcMain.handle('apply:prepareBatch', (_e, jobIds: number[]) => prepareBatch(jobIds ?? []));
  ipcMain.handle('apply:submit', (_e, jobId: number) => submitApplication(jobId));
  ipcMain.handle('apply:prep', (_e, jobId: number) => prepForJob(jobId));

  // Real apply: gate (blocklist + liveness) → mark applied → open a session
  // window, auto-fill the form + upload the résumé; user reviews + submits.
  ipcMain.handle('apply:apply', async (_e, jobId: number) => {
    const sub = await submitApplication(jobId);
    if (!sub.ok) return sub;
    const fill = await applyInWindow(jobId);
    return { ...sub, ...fill };
  });

  // Bulk apply: gate each, then open all that pass in separate windows at once.
  ipcMain.handle('apply:applyBatch', async (_e, jobIds: number[]) => {
    const ids = jobIds ?? [];
    const results: any[] = [];
    const toFill: number[] = [];
    for (const id of ids) {
      const sub = await submitApplication(id);
      if (sub.ok) toFill.push(id);
      else results.push({ jobId: id, ok: false, reason: sub.reason });
    }
    const fills = await Promise.all(toFill.map(id => applyInWindow(id).then(r => ({ jobId: id, ...r }))));
    return { results: [...results, ...fills] };
  });
}
