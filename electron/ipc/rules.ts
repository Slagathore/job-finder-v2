import { ipcMain } from 'electron';
import { getDb } from './db';

/** User rules that govern tailoring / search / scoring (PLAN.md §6.11). */
export function registerRuleHandlers() {
  ipcMain.handle('rules:list', () =>
    getDb().prepare('SELECT * FROM user_rules ORDER BY id DESC').all());

  ipcMain.handle('rules:add', (_e, r: { scope: string; text: string }) => {
    if (!r.text?.trim()) return { error: 'Empty rule.' };
    getDb().prepare('INSERT INTO user_rules (scope, text, source, created_at) VALUES (?, ?, ?, ?)')
      .run(r.scope || 'resume', r.text.trim(), 'user', Date.now());
    return { ok: true };
  });

  ipcMain.handle('rules:delete', (_e, id: number) => {
    getDb().prepare('DELETE FROM user_rules WHERE id = ?').run(id);
    return { ok: true };
  });
}

/** Helper for other modules: the rule texts relevant to a scope. */
export function rulesForScopes(scopes: string[]): string[] {
  const placeholders = scopes.map(() => '?').join(',');
  return (getDb().prepare(`SELECT text FROM user_rules WHERE scope IN (${placeholders})`).all(...scopes) as { text: string }[])
    .map(r => r.text);
}
