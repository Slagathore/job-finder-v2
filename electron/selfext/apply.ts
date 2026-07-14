import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { applyPatchSet, type PatchSet } from './patcher';
import { getProposal, setStatus } from './store';
import { appendAudit } from '../agent/audit';
import { MANIFEST_VERSION, hashFile, verifyRollback, type BackupEntry, type BackupManifest } from './backup';

function backupDir(id: number): string {
  return path.join(app.getPath('userData'), 'selfext-backups', String(id));
}

/**
 * Apply an approved proposal to the LIVE tree (PLAN.md §6.15). Backs up every
 * touched file first so it can be rolled back. Requires the proposal to exist;
 * approval/gating is enforced by the IPC layer (mandatory user click).
 *
 * The manifest is written AFTER the patch lands, because it stamps the identity
 * the rollback is allowed to restore against: the app version, plus the hash of
 * each file as the patch left it. See backup.ts for why that matters.
 */
export async function applyProposal(id: number): Promise<{ ok: boolean; changed?: string[]; error?: string }> {
  const p = getProposal(id);
  if (!p?.patch) return { ok: false, error: 'Proposal not found / unparseable.' };
  const set: PatchSet = p.patch;
  const root = app.getAppPath();
  const bdir = backupDir(id);
  const pre: { path: string; action: 'restore' | 'delete' }[] = [];

  try {
    await fsp.mkdir(bdir, { recursive: true });
    for (const f of set.files) {
      const rel = f.path.replace(/\\/g, '/');
      const abs = path.resolve(root, rel);
      if (fs.existsSync(abs)) {
        const dest = path.join(bdir, 'files', rel);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.copyFile(abs, dest);
        pre.push({ path: rel, action: 'restore' });
      } else {
        pre.push({ path: rel, action: 'delete' });
      }
    }

    const { changed } = await applyPatchSet(set, root);

    const entries: BackupEntry[] = [];
    for (const e of pre) entries.push({ ...e, postHash: await hashFile(path.resolve(root, e.path)) });
    const manifest: BackupManifest = {
      manifestVersion: MANIFEST_VERSION,
      appVersion: app.getVersion(),
      createdAt: Date.now(),
      entries,
    };
    await fsp.writeFile(path.join(bdir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    setStatus(id, 'applied');
    appendAudit('user', 'selfext:apply', { id, changed });
    return { ok: true, changed };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/**
 * Restore the pre-patch state of an applied proposal — but only when the tree
 * still matches what the patch left behind. A backup that no longer describes
 * the current code is refused with the reason, not force-applied.
 */
export async function rollbackProposal(id: number): Promise<{ ok: boolean; error?: string }> {
  const root = app.getAppPath();
  const bdir = backupDir(id);
  const filesDir = path.join(bdir, 'files');
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(bdir, 'manifest.json'), 'utf8'));
    const check = await verifyRollback(raw, root, filesDir, app.getVersion());
    if (!check.ok) {
      appendAudit('user', 'selfext:rollback-refused', { id, reason: check.reason });
      return { ok: false, error: check.reason };
    }

    for (const m of check.manifest.entries) {
      const abs = path.resolve(root, m.path);
      if (m.action === 'restore') {
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.copyFile(path.join(filesDir, m.path), abs);
      } else {
        // The patch created this file and verifyRollback confirmed it is still
        // byte-for-byte the file the patch wrote — so removing it removes only
        // what the patch added.
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
