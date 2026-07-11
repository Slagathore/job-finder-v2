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
