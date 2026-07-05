import { ipcMain } from 'electron';
import { runScan } from '../scan/runner';

let scanning = false;

export function registerScanHandlers() {
  ipcMain.handle('scan:run', async (_e, trigger: 'manual' | 'scheduled' | 'agent' = 'manual') => {
    if (scanning) return { error: 'A scan is already running.' };
    scanning = true;
    try {
      return await runScan(trigger);
    } catch (e: any) {
      return { error: e?.message ?? String(e) };
    } finally {
      scanning = false;
    }
  });

  ipcMain.handle('scan:busy', () => ({ scanning }));
}
