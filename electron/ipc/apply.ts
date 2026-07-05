import { ipcMain } from 'electron';
import { runTailor } from '../apply/run';
import { getApplication } from '../apply/store';
import { prepareBatch, submitApplication, gateApplication, markApplied } from '../apply/batch';
import { prepForJob } from '../apply/prep';
import { applyInWindow } from '../apply/autofill';

export function registerApplyHandlers() {
  ipcMain.handle('apply:tailor', (_e, jobId: number) => runTailor(jobId));
  ipcMain.handle('apply:get', (_e, jobId: number) => getApplication(jobId));
  ipcMain.handle('apply:prepareBatch', (_e, jobIds: number[]) => prepareBatch(jobIds ?? []));
  ipcMain.handle('apply:submit', (_e, jobId: number) => submitApplication(jobId));
  ipcMain.handle('apply:prep', (_e, jobId: number) => prepForJob(jobId));

  // Real apply: gate (blocklist + liveness) → open a session window, auto-fill
  // the form + upload the résumé → only mark applied once the window actually
  // opened and processed. A dead page / load failure never records "applied".
  ipcMain.handle('apply:apply', async (_e, jobId: number) => {
    const gate = await gateApplication(jobId);
    if (!gate.ok) return gate;
    const fill = await applyInWindow(jobId);
    if (fill.ok) markApplied(jobId);
    return { ...gate, ...fill };
  });

  // Bulk apply: gate each, open all that pass in separate windows at once,
  // and mark applied only the ones whose window actually processed.
  ipcMain.handle('apply:applyBatch', async (_e, jobIds: number[]) => {
    const ids = jobIds ?? [];
    const results: any[] = [];
    const toFill: number[] = [];
    for (const id of ids) {
      const gate = await gateApplication(id);
      if (gate.ok) toFill.push(id);
      else results.push({ jobId: id, ok: false, reason: gate.reason });
    }
    const fills = await Promise.all(toFill.map(id => applyInWindow(id).then(r => {
      if (r.ok) markApplied(id);
      return { jobId: id, ...r };
    })));
    return { results: [...results, ...fills] };
  });
}
