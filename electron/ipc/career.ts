import { ipcMain } from 'electron';
import { getDb } from './db';
import { computeInsights, type OutcomeRow } from '../career/analytics';
import { listStories, addStory, deleteStory } from '../career/stories';
import { runDoctor } from '../career/doctor';
import { evalProject, evalTraining, buildDeepResearchPrompt } from '../career/modes';
import { listContacts, addContact, deleteContact, discoverContacts, draftOutreach } from '../career/contacts';
import { getProfile } from '../experience/store';
import {
  applyDirectionFits, applyDirectionSearches, getDirection, getIntake,
  previewDirectionFits, previewDirectionSearches, runDirection, saveIntake, undoDirectionWrite,
} from '../career/direction';

/** Career features ported from career-ops: analytics, story bank, doctor,
 *  prompt modes, and the contacts/outreach pipeline. */
export function registerCareerHandlers() {
  // Career direction deep dive. Every write is previewed before it happens and
  // reversible after it, so nothing changes behind the user's back.
  ipcMain.handle('career:intakeGet', () => getIntake());
  ipcMain.handle('career:intakeSave', (_e, answers: any) => saveIntake(answers));
  ipcMain.handle('career:directionGet', () => getDirection());
  ipcMain.handle('career:direction', (_e, force?: boolean) => runDirection(!!force));
  ipcMain.handle('career:directionPlan', (_e, p: { index: number; kind: 'searches' | 'fits' }) =>
    (p?.kind === 'fits' ? previewDirectionFits(Number(p?.index) || 0) : previewDirectionSearches(Number(p?.index) || 0)));
  ipcMain.handle('career:directionApply', (_e, p: { index: number; kind: 'searches' | 'fits' }) =>
    (p?.kind === 'fits' ? applyDirectionFits(Number(p?.index) || 0) : applyDirectionSearches(Number(p?.index) || 0)));
  ipcMain.handle('career:directionUndo', (_e, p: { searchIds?: number[]; fitIds?: number[] }) =>
    undoDirectionWrite({ searchIds: p?.searchIds ?? [], fitIds: p?.fitIds ?? [] }));

  ipcMain.handle('career:insights', () => {
    const rows = getDb().prepare(`
      SELECT status, fit_score, work_mode, source, first_seen FROM jobs
      WHERE status IN ('applied', 'responded', 'interview', 'offer', 'rejected')
    `).all() as OutcomeRow[];
    return computeInsights(rows);
  });

  ipcMain.handle('stories:list', () => listStories());
  ipcMain.handle('stories:add', (_e, p: { prompt: string; story: string; tags?: string }) => {
    if (!p?.prompt?.trim() || !p?.story?.trim()) return { error: 'Prompt and story are both required.' };
    return addStory(p.prompt, p.story, p.tags);
  });
  ipcMain.handle('stories:delete', (_e, id: number) => { deleteStory(id); return true; });

  ipcMain.handle('career:doctor', () => runDoctor());

  ipcMain.handle('career:project', (_e, idea: string) => evalProject(String(idea ?? '')));
  ipcMain.handle('career:training', (_e, course: string) => evalTraining(String(course ?? '')));
  ipcMain.handle('career:deep', (_e, p: { company: string; role: string }) => {
    if (!p?.company?.trim() || !p?.role?.trim()) return { error: 'Company and role are both required.' };
    return { prompt: buildDeepResearchPrompt(p.company.trim(), p.role.trim(), getProfile()) };
  });

  ipcMain.handle('contacts:list', (_e, company?: string) => listContacts(company));
  ipcMain.handle('contacts:add', (_e, c: any) => {
    if (!c?.company?.trim()) return { error: 'Company is required.' };
    return addContact(c);
  });
  ipcMain.handle('contacts:delete', (_e, id: number) => { deleteContact(id); return true; });
  ipcMain.handle('contacts:discover', (_e, p: { company: string; role?: string }) =>
    discoverContacts(String(p?.company ?? ''), p?.role));
  ipcMain.handle('contacts:outreach', (_e, p: { contactId: number; jobId?: number }) =>
    draftOutreach(Number(p?.contactId), p?.jobId));
}
