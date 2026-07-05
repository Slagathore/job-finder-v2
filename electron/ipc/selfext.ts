import { ipcMain, app } from 'electron';
import { readSettings } from './settings';
import { generateProposal } from '../selfext/reflector';
import { scanPatch } from '../selfext/scanner';
import { runInSandbox } from '../selfext/sandbox';
import { saveProposal, listProposals, getProposal, setSandboxResult, setStatus } from '../selfext/store';
import { applyProposal, rollbackProposal } from '../selfext/apply';

let busy = false;

export function registerSelfExtHandlers() {
  ipcMain.handle('selfext:propose', async (_e, instruction: string) => {
    if (busy) return { error: 'Another self-extension task is running.' };
    busy = true;
    try {
      const set = await generateProposal(readSettings(), app.getAppPath(), instruction);
      if (!set) return { error: 'Model did not return a usable patch set.' };
      const scan = scanPatch(set);
      const id = saveProposal(set, scan);
      return { id, patch: set, scan };
    } catch (e: any) { return { error: e?.message ?? String(e) }; }
    finally { busy = false; }
  });

  ipcMain.handle('selfext:sandbox', async (_e, id: number) => {
    if (busy) return { error: 'Another self-extension task is running.' };
    busy = true;
    try {
      const p = getProposal(id);
      if (!p?.patch) return { error: 'Proposal not found.' };
      const result = await runInSandbox(app.getAppPath(), p.patch);
      setSandboxResult(id, result);
      return result;
    } catch (e: any) { return { error: e?.message ?? String(e) }; }
    finally { busy = false; }
  });

  ipcMain.handle('selfext:list', () => listProposals());
  ipcMain.handle('selfext:get', (_e, id: number) => getProposal(id));
  // Mandatory user action — and the sandbox must have PASSED (lint + tests in a
  // temp clone). Enforced here, not just in the UI: a patch that can rewrite
  // main.ts must never apply unverified (AUDIT §self-ext gate).
  ipcMain.handle('selfext:approve', (_e, id: number) => {
    const p = getProposal(id);
    if (!p) return { error: 'Proposal not found.' };
    if (!p.sandbox?.ok) return { error: 'Sandbox checks have not passed for this proposal — run “Sandbox” (lint + tests) first.' };
    return applyProposal(id);
  });
  ipcMain.handle('selfext:reject', (_e, id: number) => { setStatus(id, 'rejected'); return { ok: true }; });
  ipcMain.handle('selfext:rollback', (_e, id: number) => rollbackProposal(id));
}
