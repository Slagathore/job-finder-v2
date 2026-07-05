import { ipcMain } from 'electron';
import { readSettings } from './settings';
import { generate } from '../llm/provider';
import { extractText } from '../experience/ingest';
import { digestSource } from '../experience/digest';
import { inferProfileAndRoles, suggestQuestions } from '../experience/profile';
import {
  insertItems, listItems, listItemsForInference, deleteItem, clearItems,
  saveProfile, getProfile, replaceRoleFits, getRoleFits,
} from '../experience/store';
import * as path from 'path';

function withSource(items: any[], sourceRef: string) {
  return items.map(i => ({ ...i, source_ref: sourceRef }));
}

export function registerExperienceHandlers() {
  ipcMain.handle('experience:importText', async (_e, p: { text: string; sourceRef?: string }) => {
    try {
      if (!p.text?.trim()) return { error: 'No text provided.' };
      const ref = p.sourceRef || 'pasted';
      const items = await digestSource(readSettings(), p.text, ref);
      const added = insertItems(withSource(items, ref));
      return { added, items: items.length };
    } catch (e: any) { return { error: e?.message ?? String(e) }; }
  });

  ipcMain.handle('experience:importFile', async (_e, filePath: string) => {
    try {
      const text = await extractText(filePath);
      if (!text.trim()) return { error: 'No text could be extracted from that file.' };
      const ref = `file:${path.basename(filePath)}`;
      const items = await digestSource(readSettings(), text, ref);
      const added = insertItems(withSource(items, ref));
      return { added, items: items.length, source: ref };
    } catch (e: any) { return { error: e?.message ?? String(e) }; }
  });

  ipcMain.handle('experience:list', () => listItems());
  ipcMain.handle('experience:delete', (_e, id: number) => { deleteItem(id); return { ok: true }; });
  ipcMain.handle('experience:clear', () => { clearItems(); return { ok: true }; });

  ipcMain.handle('experience:infer', async () => {
    try {
      const items = listItemsForInference();
      if (items.length === 0) return { error: 'No experience captured yet — import a resume first.' };
      const { profile, roleFits } = await inferProfileAndRoles(readSettings(), items);
      saveProfile(profile);
      replaceRoleFits(roleFits);
      return { profile, roleFits };
    } catch (e: any) { return { error: e?.message ?? String(e) }; }
  });

  ipcMain.handle('experience:getProfile', () => ({ profile: getProfile(), roleFits: getRoleFits() }));

  ipcMain.handle('experience:roast', async () => {
    const items = listItemsForInference();
    if (items.length === 0) return { error: 'No experience to roast — import a résumé first.' };
    const corpus = items.slice(0, 120).map((i: any) => `- [${i.kind}] ${i.text}`).join('\n');
    try {
      const r = await generate(readSettings(), [
        { role: 'system', content: 'You are a brutally honest but constructive senior recruiter. Roast this candidate\'s résumé line items: call out vague/weak/cliché bullets, missing metrics, and red flags — then give punchy, specific fixes. Keep it sharp and skimmable (markdown).' },
        { role: 'user', content: corpus },
      ], { temperature: 0.7, maxTokens: 1200 });
      return { text: r.text };
    } catch (e: any) { return { error: e?.message ?? String(e) }; }
  });

  ipcMain.handle('experience:suggestQuestions', async () => {
    try {
      return { questions: await suggestQuestions(readSettings(), listItemsForInference()) };
    } catch (e: any) { return { error: e?.message ?? String(e) }; }
  });
}
