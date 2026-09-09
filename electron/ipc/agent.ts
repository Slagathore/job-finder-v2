import { ipcMain } from 'electron';
import { planMessage, runPlan, runStep, getPermissions, setPermission, listMemory, type PlanRequest } from '../agent/run';
import { listConversations, getConversation, deleteConversation } from '../agent/conversations';
import type { PlanStep } from '../agent/planner';

export function registerAgentHandlers() {
  ipcMain.handle('agent:plan', (_e, p: PlanRequest) => planMessage(p ?? { message: '' }));
  ipcMain.handle('agent:run', (_e, p: { steps: PlanStep[]; messageId?: number | null }) =>
    runPlan(p?.steps ?? [], p?.messageId ?? null));
  ipcMain.handle('agent:runStep', (_e, p: { step: PlanStep; messageId?: number | null; index?: number }) =>
    runStep(p.step, p?.messageId ?? null, p?.index));
  ipcMain.handle('agent:permissions', () => getPermissions());
  ipcMain.handle('agent:setPermission', (_e, p: { capability: string; mode: string }) => {
    setPermission(p.capability, p.mode);
    return getPermissions();
  });
  ipcMain.handle('agent:memory', () => listMemory());

  // Conversation history
  ipcMain.handle('agent:conversations', () => listConversations());
  ipcMain.handle('agent:conversation', (_e, id: number) => getConversation(Number(id)));
  ipcMain.handle('agent:deleteConversation', (_e, id: number) => {
    deleteConversation(Number(id));
    return listConversations();
  });
}
