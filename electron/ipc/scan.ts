import { ipcMain } from 'electron';
import { runScan, scanBusy } from '../scan/runner';

export function registerScanHandlers() {
  // The reentrancy lock lives inside runScan (shared with scheduler/tray/agent).
  ipcMain.handle('scan:run', async (_e, trigger: 'manual' | 'scheduled' | 'agent' = 'manual') => {
    try {
      return await runScan(trigger);
    } catch (e: any) {
      return { error: e?.message ?? String(e) };
    }
  });

  ipcMain.handle('scan:busy', () => ({ scanning: scanBusy() }));
}
