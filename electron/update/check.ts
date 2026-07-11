import * as fs from 'fs';
import * as path from 'path';
import { readSettings, writeSetting } from '../ipc/settings';
import { shouldNotify, UpdateStatus } from './policy';

const REPO = 'Slagathore/job-finder-v2';
export const REPO_URL = `https://github.com/${REPO}`;
const API_LATEST = `https://api.github.com/repos/${REPO}/commits/main`;
const RAW_BEACON = `https://raw.githubusercontent.com/${REPO}/main/UPDATE.json`;

/** Written by scripts/write-buildinfo.mjs at the end of `npm run build`. */
function readBuildSha(): string {
  try {
    const p = path.join(__dirname, '..', 'buildinfo.json');
    return String(JSON.parse(fs.readFileSync(p, 'utf8')).sha ?? '');
  } catch { return ''; }
}

let lastStatus: UpdateStatus | null = null;

/** Compare this build's commit to origin/main + read the emergency beacon.
 *  Returns null when unknowable (dev build, offline, API down) — never throws. */
export async function fetchUpdateStatus(): Promise<UpdateStatus | null> {
  const buildSha = readBuildSha();
  if (!buildSha) return null;
  try {
    const headers = { 'User-Agent': 'job-finder-update-check', Accept: 'application/vnd.github+json' };
    const [commitRes, beaconRes] = await Promise.all([
      fetch(API_LATEST, { headers, signal: AbortSignal.timeout(6000) }),
      fetch(RAW_BEACON, { signal: AbortSignal.timeout(6000) }).catch(() => null),
    ]);
    if (!commitRes.ok) return null;
    const c: any = await commitRes.json();
    const latestSha = String(c.sha ?? '');
    if (!latestSha) return null;

    let emergency = false, emergencyMessage = '';
    if (beaconRes?.ok) {
      const b: any = await beaconRes.json().catch(() => null);
      if (b?.emergency === true) {
        emergency = true;
        emergencyMessage = String(b.message || 'A critical update is available. Please update as soon as possible.');
      }
    }
    return {
      available: latestSha !== buildSha,
      latestSha,
      summary: String(c.commit?.message ?? '').split('\n')[0],
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
  return { ...status, repoUrl: REPO_URL };
}

export function silenceUpdates(mode: 'until-next' | 'forever' | 'clear'): boolean {
  if (mode === 'forever') writeSetting('updateSilence', 'forever');
  else if (mode === 'until-next') writeSetting('updateSilence', lastStatus?.latestSha ? `until:${lastStatus.latestSha}` : '');
  else writeSetting('updateSilence', '');
  return true;
}
