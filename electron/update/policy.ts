/** Pure decision logic for update notifications — kept import-free so tests
 *  can exercise it without the electron/DB module chain. */

export interface UpdateStatus {
  available: boolean;        // newer commit exists on main than this build
  latestSha: string;
  summary: string;           // latest commit subject line
  emergency: boolean;        // UPDATE.json beacon flag
  emergencyMessage: string;
}

/**
 * silence: '' (notify normally) | 'until:<sha>' | 'forever'.
 * An emergency beacon supersedes every silence choice — that is its job.
 * 'until:<sha>' silences only the update the user saw; a newer push
 * (different head sha) notifies again.
 */
export function shouldNotify(status: UpdateStatus, silence: string): boolean {
  if (!status.available) return false;
  if (status.emergency) return true;
  if (silence === 'forever') return false;
  if (silence.startsWith('until:')) return silence.slice('until:'.length) !== status.latestSha;
  return true;
}
