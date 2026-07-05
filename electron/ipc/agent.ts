import { ipcMain } from 'electron';
import { planMessage, runPlan, runStep, getPermissions, setPermission, listMemory } from '../agent/run';
import type { ChatMessage } from '../llm/provider';
import type { PlanStep } from '../agent/planner';

export function registerAgentHandlers() {
  ipcMain.handle('agent:plan', (_e, p: { message: string; history?: ChatMessage[] }) =>
    planMessage(p.message, p.history ?? []));
  ipcMain.handle('agent:run', (_e, steps: PlanStep[]) => runPlan(steps ?? []));
  ipcMain.handle('agent:runStep', (_e, step: PlanStep) => runStep(step));
  ipcMain.handle('agent:permissions', () => getPermissions());
  ipcMain.handle('agent:setPermission', (_e, p: { capability: string; mode: string }) => {
    setPermission(p.capability, p.mode);
    return getPermissions();
  });
  ipcMain.handle('agent:memory', () => listMemory());
}
