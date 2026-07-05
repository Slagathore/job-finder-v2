import { ipcMain } from 'electron';
import { runPrune, dbStats } from '../maintenance/prune';

export function registerMaintenanceHandlers() {
  ipcMain.handle('maintenance:stats', () => dbStats());
  ipcMain.handle('maintenance:prune', () => runPrune());   // manual trigger
}
