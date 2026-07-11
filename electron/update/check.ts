import { app } from 'electron';
import { readSettings, writeSetting } from '../ipc/settings';
import { shouldNotify, isNewer, UpdateStatus } from './policy';

const REPO = 'Slagathore/job-finder-v2';
export const REPO_URL = `https://github.com/${REPO}`;
const API_LATEST_RELEASE = `https://api.github.com/repos/${REPO}/releases/latest`;
const RAW_BEACON = `https://raw.githubusercontent.com/${REPO}/main/UPDATE.json`;

let lastStatus: UpdateStatus | null = null;

/**
 * Compare the running app version against the latest published RELEASE, and
 * read the emergency beacon. Releases — not `main` — are the reference point:
 * main is always ahead of the last release, so comparing against it would show
 * a permanent "update available" nag for unreleased commits.
 * Returns null when unknowable (offline, API down, no releases) — never throws.
 */
export async function fetchUpdateStatus(): Promise<UpdateStatus | null> {
  const current = app.getVersion();
  try {
    const headers = { 'User-Agent': 'job-finder-update-check', Accept: 'application/vnd.github+json' };
    const [relRes, beaconRes] = await Promise.all([
      fetch(API_LATEST_RELEASE, { headers, signal: AbortSignal.timeout(6000) }),
      fetch(RAW_BEACON, { signal: AbortSignal.timeout(6000) }).catch(() => null),
    ]);
    if (!relRes.ok) return null;                       // 404 = no releases yet
    const r: any = await relRes.json();
    if (r?.draft || r?.prerelease) return null;
    const latestVersion = String(r.tag_name ?? '').replace(/^v/i, '');
    if (!latestVersion) return null;

    let emergency = false, emergencyMessage = '';
    if (beaconRes?.ok) {
      const b: any = await beaconRes.json().catch(() => null);
      if (b?.emergency === true) {
        emergency = true;
        emergencyMessage = String(b.message || 'A critical update is available. Please update as soon as possible.');
      }
    }
    return {
      available: isNewer(latestVersion, current),
      latestVersion,
      summary: String(r.name || `Version ${latestVersion}`),
      emergency,
      emergencyMessage,
    };
  } catch { return null; }
}

/** The renderer's on-load check: status if the user should see a banner, else null. */
export async function checkForUpdates(): Promise<(UpdateStatus & { repoUrl: string }) | null> {
  const status = await fetchUpdateStatus();
  lastStatus = status;
  if (!status) return null;
  const silence = String(readSettings().updateSilence ?? '');
  if (!shouldNotify(status, silence)) return null;
  return { ...status, repoUrl: `${REPO_URL}/releases/latest` };
}

export function silenceUpdates(mode: 'until-next' | 'forever' | 'clear'): boolean {
  if (mode === 'forever') writeSetting('updateSilence', 'forever');
  else if (mode === 'until-next') writeSetting('updateSilence', lastStatus?.latestVersion ? `until:${lastStatus.latestVersion}` : '');
  else writeSetting('updateSilence', '');
  return true;
}
