import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { applyPatchSet, type PatchSet } from './patcher';
import { getProposal, setStatus } from './store';
import { appendAudit } from '../agent/audit';

interface BackupEntry { path: string; action: 'restore' | 'delete'; }

function backupDir(id: number): string {
  return path.join(app.getPath('userData'), 'selfext-backups', String(id));
}

/**
 * Apply an approved proposal to the LIVE tree (PLAN.md §6.15). Backs up every
 * touched file first so it can be rolled back. Requires the proposal to exist;
 * approval/gating is enforced by the IPC layer (mandatory user click).
 */
export async function applyProposal(id: number): Promise<{ ok: boolean; changed?: string[]; error?: string }> {
  const p = getProposal(id);
  if (!p?.patch) return { ok: false, error: 'Proposal not found / unparseable.' };
  const set: PatchSet = p.patch;
  const root = app.getAppPath();
  const bdir = backupDir(id);
  const manifest: BackupEntry[] = [];

  try {
    await fsp.mkdir(bdir, { recursive: true });
    for (const f of set.files) {
      const rel = f.path.replace(/\\/g, '/');
      const abs = path.resolve(root, rel);
      if (fs.existsSync(abs)) {
        const dest = path.join(bdir, 'files', rel);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.copyFile(abs, dest);
        manifest.push({ path: rel, action: 'restore' });
      } else {
        manifest.push({ path: rel, action: 'delete' });
      }
    }
    await fsp.writeFile(path.join(bdir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    const { changed } = await applyPatchSet(set, root);
    setStatus(id, 'applied');
    appendAudit('user', 'selfext:apply', { id, changed });
    return { ok: true, changed };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/** Restore the pre-patch state of an applied proposal. */
export async function rollbackProposal(id: number): Promise<{ ok: boolean; error?: string }> {
  const root = app.getAppPath();
  const bdir = backupDir(id);
  try {
    const manifest: BackupEntry[] = JSON.parse(await fsp.readFile(path.join(bdir, 'manifest.json'), 'utf8'));
    for (const m of manifest) {
      const abs = path.resolve(root, m.path);
      if (m.action === 'restore') {
        const src = path.join(bdir, 'files', m.path);
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.copyFile(src, abs);
      } else {
        await fsp.rm(abs, { force: true });
      }
    }
    setStatus(id, 'rolled_back');
    appendAudit('user', 'selfext:rollback', { id });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
