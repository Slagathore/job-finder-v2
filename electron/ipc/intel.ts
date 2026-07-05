import { ipcMain } from 'electron';
import { estimateSalary } from '../intel/salary';
import { getCompanyIntel } from '../intel/company';
import { suggestMoves } from '../intel/moves';
import { certAdvice } from '../intel/certs';

export function registerIntelHandlers() {
  ipcMain.handle('intel:salary', (_e, jobId: number) => estimateSalary(jobId));
  ipcMain.handle('intel:company', (_e, p: { company: string; force?: boolean }) => getCompanyIntel(p.company, p.force));
  ipcMain.handle('intel:moves', () => suggestMoves());
  ipcMain.handle('intel:certs', (_e, p: { field: string; force?: boolean }) => certAdvice(p.field, p.force));
}
