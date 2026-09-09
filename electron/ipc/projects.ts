/**
 * IPC for project ingestion.
 *
 * Credential ladder, in order, so nobody has to register a GitHub OAuth App:
 *   1. the GitHub CLI's own token (gh auth token)
 *   2. offer to install the CLI with winget, after the user confirms
 *   3. a personal access token pasted into the app, stored encrypted
 *
 * The token never leaves this process except as an Authorization header.
 */

import { ipcMain } from 'electron';
import * as path from 'path';
import { readSettings, writeSetting } from './settings';
import { ghState, ghToken, installGhCli } from '../projects/gh-cli';
import { looksLikeToken, missingScopes } from '../projects/gh-parse';
import { listAllRepos, whoAmI } from '../projects/github';
import {
  clearStaleRunning, listRepos, repoCounts, upsertRepos,
} from '../projects/store';
import {
  acquire, deepDiveRepo, digestFolder, digestWebApp, isRunning, release, scanRepos,
  type ProjectProgress,
} from '../projects/run';

export interface ProjectHandlerDeps {
  onProgress: (p: ProjectProgress) => void;
}

/** Where the credential in play came from, for the UI to explain itself. */
export type TokenSource = 'gh' | 'token' | 'none';

async function resolveToken(): Promise<{ token: string | null; source: TokenSource }> {
  const cli = await ghToken().catch(() => null);
  if (cli) return { token: cli, source: 'gh' };
  const saved = String((readSettings() as any).githubToken ?? '').trim();
  if (saved) return { token: saved, source: 'token' };
  return { token: null, source: 'none' };
}

const NOT_CONNECTED =
  'Not connected to GitHub yet. Use the GitHub CLI, or paste a personal access token below.';

export function registerProjectHandlers(deps: ProjectHandlerDeps) {
  // A run that was in flight when the app closed left rows marked running.
  clearStaleRunning();

  ipcMain.handle('projects:status', async () => {
    const gh = await ghState().catch(() => null);
    const savedToken = String((readSettings() as any).githubToken ?? '').trim();
    const { source } = await resolveToken();
    return {
      ghInstalled: !!gh?.installed,
      ghVersion: gh?.version ?? '',
      ghAuthenticated: !!gh?.authenticated,
      login: gh?.login ?? '',
      scopes: gh?.scopes ?? [],
      missingScopes: missingScopes(gh?.scopes ?? []),
      ghDetail: gh?.detail ?? 'Could not run the GitHub CLI.',
      tokenSaved: !!savedToken,
      source,
      connected: source !== 'none',
      running: isRunning(),
      counts: repoCounts(),
    };
  });

  ipcMain.handle('projects:list', () => listRepos());

  /** Installs the GitHub CLI. The renderer confirms with the user first. */
  ipcMain.handle('projects:installGh', async () => {
    try { return await installGhCli(); }
    catch (e: any) { return { ok: false, message: e?.message ?? String(e) }; }
  });

  ipcMain.handle('projects:saveToken', async (_e, token: string) => {
    const value = String(token ?? '').trim();
    if (!value) return { error: 'Paste a token first.' };
    if (!looksLikeToken(value)) {
      return { error: 'That does not look like a GitHub token. Copy the whole thing, it starts with ghp_ or github_pat_.' };
    }
    try {
      const me = await whoAmI(value);
      writeSetting('githubToken', value);
      return { ok: true, login: me.login };
    } catch (e: any) {
      return { error: e?.message ?? String(e) };
    }
  });

  ipcMain.handle('projects:clearToken', () => { writeSetting('githubToken', ''); return { ok: true }; });

  /** Pull the repo list and store it. Private repos included. */
  ipcMain.handle('projects:refresh', async () => {
    const { token, source } = await resolveToken();
    if (!token) return { error: NOT_CONNECTED };
    try {
      const repos = await listAllRepos(token);
      const { added, updated } = upsertRepos(repos);
      return {
        total: repos.length,
        privateCount: repos.filter(r => r.private).length,
        added, updated, source,
      };
    } catch (e: any) { return { error: e?.message ?? String(e) }; }
  });

  /**
   * Scan every repo not already digested at this depth. Runs off the IPC
   * response: the handler returns as soon as the work is queued, and progress
   * arrives on projects:progress, so the UI never blocks on 36 repos.
   */
  ipcMain.handle('projects:scan', async (_e, p: { depth?: 'medium' | 'deep' } = {}) => {
    if (!acquire()) return { error: 'A project scan is already running.' };
    const { token } = await resolveToken();
    if (!token) { release(); return { error: NOT_CONNECTED }; }
    const depth = p?.depth === 'deep' ? 'deep' : 'medium';
    scanRepos(readSettings(), token, depth, deps.onProgress)
      .then(r => deps.onProgress({
        running: false, phase: `Scan finished: ${r.scanned} digested, ${r.failed} failed`,
        current: '', done: r.scanned + r.failed, total: r.scanned + r.failed, percent: 100,
      }))
      .catch(e => deps.onProgress({
        running: false, phase: `Scan stopped: ${e?.message ?? e}`, current: '', done: 0, total: 0, percent: 0,
      }))
      .finally(() => release());
    return { started: true, depth };
  });

  ipcMain.handle('projects:deepDive', async (_e, fullName: string) => {
    if (!fullName) return { error: 'Pick a repo first.' };
    if (!acquire()) return { error: 'A project scan is already running.' };
    const { token } = await resolveToken();
    if (!token) { release(); return { error: NOT_CONNECTED }; }
    try {
      return await deepDiveRepo(readSettings(), token, fullName, deps.onProgress);
    } catch (e: any) {
      return { error: e?.message ?? String(e) };
    } finally { release(); }
  });

  ipcMain.handle('projects:digestFolder', async (_e, folder: string) => {
    if (!folder) return { error: 'Pick a folder first.' };
    if (!acquire()) return { error: 'A project scan is already running.' };
    try {
      const out = await digestFolder(readSettings(), folder, deps.onProgress);
      return { ...out, source: `folder:${path.basename(folder)}` };
    } catch (e: any) {
      return { error: e?.message ?? String(e) };
    } finally { release(); }
  });

  ipcMain.handle('projects:digestUrl', async (_e, url: string) => {
    if (!/^https?:\/\//i.test(String(url ?? ''))) return { error: 'Include the https:// part of the URL.' };
    if (!acquire()) return { error: 'A project scan is already running.' };
    try {
      return await digestWebApp(readSettings(), url, deps.onProgress);
    } catch (e: any) {
      return { error: e?.message ?? String(e) };
    } finally { release(); }
  });
}
