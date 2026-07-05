import { ipcMain } from 'electron';
import { readSettings } from './settings';
import { generate, health, embed, type ChatMessage, type GenerateOpts } from '../llm/provider';

export function registerLlmHandlers() {
  ipcMain.handle('llm:health', async () => health(readSettings()));

  ipcMain.handle('llm:generate', async (_e, payload: { messages: ChatMessage[]; opts?: GenerateOpts }) => {
    try {
      return await generate(readSettings(), payload.messages, payload.opts ?? {});
    } catch (e: any) {
      return { error: e?.message ?? String(e) };
    }
  });

  ipcMain.handle('llm:embed', async (_e, texts: string[]) => {
    try {
      return { vectors: await embed(readSettings(), texts) };
    } catch (e: any) {
      return { error: e?.message ?? String(e) };
    }
  });
}
