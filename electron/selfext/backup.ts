import * as crypto from 'crypto';
import * as fsp from 'fs/promises';
import * as path from 'path';

/**
 * Rollback identity for a self-extension patch.
 *
 * The backups live in userData and the `patch_proposals` rows live in the DB, so
 * BOTH outlive the code they were taken against: an app update, a git pull, or a
 * later patch can move the tree on while the "Roll back" button keeps offering to
 * restore a snapshot from an older world. Restoring blindly would copy stale
 * files over newer ones, or delete a file a later version legitimately created.
 *
 * So a backup records what it was taken AGAINST: the app version, and a content
 * hash of every touched file as the patch left it (`postHash`). A rollback is a
 * no-op unless the tree still looks exactly like that.
 */
export const MANIFEST_VERSION = 2;

export interface BackupEntry {
  /** posix, relative to the app root */
  path: string;
  /** restore = the file existed before the patch; delete = the patch created it */
  action: 'restore' | 'delete';
  /** sha256 of the file as the patch LEFT it. null = the patch deleted the file. */
  postHash: string | null;
}

export interface BackupManifest {
  manifestVersion: number;
  appVersion: string;
  createdAt: number;
  entries: BackupEntry[];
}

export type VerifyResult =
  | { ok: true; manifest: BackupManifest }
  | { ok: false; reason: string };

/** sha256 of a file, or null when it does not exist. */
export async function hashFile(abs: string): Promise<string | null> {
  try {
    const buf = await fsp.readFile(abs);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch (e: any) {
    if (e?.code === 'ENOENT' || e?.code === 'EISDIR') return null;
    throw e;
  }
}

async function exists(abs: string): Promise<boolean> {
  try { await fsp.access(abs); return true; } catch { return false; }
}

/**
 * Decide whether an applied patch can still be rolled back safely.
 *
 * Refuses (never throws, never touches disk) when:
 *  - the manifest predates the integrity stamps (v1: a bare array, no hashes)
 *  - the app version moved since the backup was taken
 *  - any touched file no longer matches the content the patch left there
 *  - a file the backup must restore is missing from the backup directory
 *
 * All-or-nothing: every entry is checked before a single byte is written back.
 */
export async function verifyRollback(
  raw: unknown,
  root: string,
  backupFilesDir: string,
  appVersion: string,
): Promise<VerifyResult> {
  if (Array.isArray(raw) || !raw || typeof raw !== 'object' || (raw as any).manifestVersion !== MANIFEST_VERSION) {
    return {
      ok: false,
      reason: 'This backup was recorded before rollback safety checks existed, so it carries no app version and no content hashes. ' +
        'Restoring it could overwrite newer files, so the rollback is refused. Revert by hand (or with git) instead.',
    };
  }
  const manifest = raw as BackupManifest;
  if (!Array.isArray(manifest.entries)) return { ok: false, reason: 'Backup manifest is unreadable (no entries).' };
  if (manifest.appVersion !== appVersion) {
    return {
      ok: false,
      reason: `This patch was applied against app version ${manifest.appVersion}, and this app is version ${appVersion}. ` +
        'The code has moved on since the backup was taken, so rolling it back could overwrite newer files. Rollback refused.',
    };
  }

  for (const e of manifest.entries) {
    const abs = path.resolve(root, e.path);
    const current = await hashFile(abs);

    if (e.postHash === null) {
      // The patch deleted this file. It must still be gone.
      if (current !== null) {
        return { ok: false, reason: `${e.path} exists again since the patch deleted it. Something recreated it, so rollback is refused (it would delete that file).` };
      }
    } else if (current === null) {
      return { ok: false, reason: `${e.path} no longer exists. The tree changed after the patch was applied, so rollback is refused.` };
    } else if (current !== e.postHash) {
      return { ok: false, reason: `${e.path} has changed since the patch was applied. Rolling back would overwrite that newer content, so it is refused.` };
    }

    if (e.action === 'restore' && !(await exists(path.join(backupFilesDir, e.path)))) {
      return { ok: false, reason: `The backup copy of ${e.path} is missing from the backup directory, so it cannot be restored. Rollback refused.` };
    }
  }
  return { ok: true, manifest };
}
