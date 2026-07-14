/** Pure decision logic for update notifications — kept import-free so tests
 *  can exercise it without the electron/DB module chain. */

export interface UpdateStatus {
  available: boolean;        // a newer RELEASE exists than the running version
  latestVersion: string;     // e.g. "1.1.0"
  summary: string;           // release name / headline
  emergency: boolean;        // UPDATE.json beacon flag
  emergencyMessage: string;
}

/** "v1.2.3" / "1.2.3" → [1,2,3]. Non-numeric junk sorts as 0. */
function parseVersion(v: string): number[] {
  return String(v).replace(/^v/i, '').split(/[.\-+]/).slice(0, 3).map(p => Number(p) || 0);
}

/** true when `a` is strictly newer than `b`. */
export function isNewer(a: string, b: string): boolean {
  const pa = parseVersion(a), pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * silence: '' (notify normally) | 'until:<version>' | 'forever'.
 * An emergency beacon supersedes every silence choice — that is its job.
 * 'until:<version>' silences only the release the user already dismissed; a
 * newer release notifies again.
 */
export function shouldNotify(status: UpdateStatus, silence: string): boolean {
  if (!status.available) return false;
  if (status.emergency) return true;
  if (silence === 'forever') return false;
  if (silence.startsWith('until:')) {
    const dismissed = silence.slice('until:'.length);
    return isNewer(status.latestVersion, dismissed);
  }
  return true;
}

// ── Installing the update (not just noticing it) ────────────────────────────

export interface InstallEnv {
  packaged: boolean;   // app.isPackaged
  portable: boolean;   // running the portable exe (electron-builder sets PORTABLE_EXECUTABLE_FILE)
  platform: string;    // process.platform
}

export type InstallSupport = { ok: true } | { ok: false; reason: string };

/**
 * Can this running copy replace itself? Only an installed (NSIS) Windows build
 * can: that is the only shape with an installer to hand off to. Everything else
 * gets told the truth instead of a button that pretends.
 */
export function updateInstallSupport(env: InstallEnv): InstallSupport {
  if (!env.packaged) {
    return { ok: false, reason: 'This copy runs from a source checkout, so there is no installer to replace. Update it with git pull and npm run build.' };
  }
  if (env.portable) {
    return { ok: false, reason: 'The portable build cannot replace itself while it is running. Download the new portable exe from the releases page.' };
  }
  if (env.platform !== 'win32') {
    return { ok: false, reason: 'In-app install is wired for the Windows installer only. Download the new build from the releases page.' };
  }
  return { ok: true };
}

/**
 * Turn an updater failure into something a user can act on — and never into
 * something that reads like success. A rejected download (bad checksum, wrong
 * publisher) means nothing was installed, and the message has to say so.
 */
export function describeUpdateError(message: string): string {
  const m = String(message ?? '');
  if (/ERR_UPDATER_INVALID_SIGNATURE|is not signed by/i.test(m)) {
    return 'The downloaded installer is not signed by the app publisher, so it was rejected. Nothing was installed.';
  }
  if (/sha512|checksum|integrity/i.test(m)) {
    return 'The downloaded installer failed its checksum check, so it was rejected. Nothing was installed.';
  }
  if (/latest\.yml|ERR_UPDATER_LATEST_VERSION_NOT_FOUND|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|Cannot find channel/i.test(m)) {
    return 'This release does not publish the update metadata the app needs (latest.yml). Download the installer from the releases page instead.';
  }
  if (/ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|ECONNREFUSED|net::|socket hang up/i.test(m)) {
    return 'Could not reach GitHub to download the update. Check your connection and try again.';
  }
  if (/EPERM|EACCES|EBUSY/i.test(m)) {
    return 'The update could not be written to disk (permission denied or a file is in use). Nothing was installed.';
  }
  return `Update failed, nothing was installed: ${m || 'unknown error'}`;
}
