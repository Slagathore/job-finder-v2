import { ipcMain } from 'electron';
import { runTailor } from '../apply/run';
import { getApplication } from '../apply/store';
import { prepareBatch, submitApplication, gateApplication, markApplied } from '../apply/batch';
import { prepForJob } from '../apply/prep';
import { applyInWindow } from '../apply/autofill';
import { pool } from '../scan/ats';

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

  // Bulk apply: gate each, then fill through a bounded pool (a few windows
  // in flight at a time, not one per job at once), and mark applied only
  // the ones whose window actually processed.
  ipcMain.handle('apply:applyBatch', async (_e, jobIds: number[]) => {
    const ids = jobIds ?? [];
    const results: any[] = [];
    const toFill: number[] = [];
    for (const id of ids) {
      const gate = await gateApplication(id);
      if (gate.ok) toFill.push(id);
      else results.push({ jobId: id, ok: false, reason: gate.reason });
    }
    const fills: any[] = new Array(toFill.length);
    await pool(toFill.map((id, i) => ({ id, i })), 3, async ({ id, i }) => {
      try {
        const r = await applyInWindow(id);
        if (r.ok) markApplied(id);
        fills[i] = { jobId: id, ...r };
      } catch (e: any) {
        // One job's throw must not sink the rest of the batch — pool() has no
        // per-item isolation of its own, so every index gets written here too.
        fills[i] = { jobId: id, ok: false, filled: 0, skipped: 0, fileUploaded: false, error: e?.message ?? String(e) };
      }
    });
    return { results: [...results, ...fills] };
  });
}
