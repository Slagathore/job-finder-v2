/**
 * GitHub CLI bridge.
 *
 * Cole should not have to register a GitHub OAuth App just to let his own job
 * app read his own repos, so the primary connection path borrows the token from
 * an already-authenticated `gh`. Child processes go through selfext/exec's
 * `run`, which tracks them so a hard shutdown does not orphan anything.
 *
 * The token this returns is a live credential: it is passed straight to the
 * REST client and never logged, stored in the DB, or put in a prompt.
 */

import { run } from '../selfext/exec';
import { parseGhAuthStatus, type GhAuthInfo } from './gh-parse';

/** gh is fast at these; a hung keyring prompt should not wedge the app. */
const GH_TIMEOUT_MS = 20_000;
/** winget downloads an installer, so it gets a much longer leash. */
const WINGET_TIMEOUT_MS = 8 * 60_000;

export interface GhState extends GhAuthInfo {
  installed: boolean;
  version: string;
  detail: string;
}

export async function ghVersion(): Promise<string | null> {
  const r = await run('gh', ['--version'], { timeoutMs: GH_TIMEOUT_MS });
  if (!r.ok) return null;
  return (/gh version ([^\s]+)/i.exec(r.stdout)?.[1] ?? r.stdout.split('\n')[0] ?? '').trim() || null;
}

/** Is gh installed, and is it logged in? Never throws. */
export async function ghState(): Promise<GhState> {
  const version = await ghVersion();
  if (!version) {
    return {
      installed: false, version: '', authenticated: false, login: '', scopes: [], host: '',
      detail: 'The GitHub CLI is not on your PATH.',
    };
  }
  const r = await run('gh', ['auth', 'status'], { timeoutMs: GH_TIMEOUT_MS });
  // gh has moved this report between stdout and stderr across versions, so read both.
  const info = parseGhAuthStatus(`${r.stdout}\n${r.stderr}`);
  return {
    installed: true,
    version,
    ...info,
    detail: info.authenticated
      ? `Signed in as ${info.login}.`
      : 'The GitHub CLI is installed but not signed in. Run gh auth login in a terminal.',
  };
}

/**
 * Borrow the CLI's token. Returns null when gh is missing or logged out.
 * The value is a secret: do not log it or fold it into an error message.
 */
export async function ghToken(): Promise<string | null> {
  const r = await run('gh', ['auth', 'token'], { timeoutMs: GH_TIMEOUT_MS });
  if (!r.ok) return null;
  const token = r.stdout.trim();
  return token || null;
}

export interface InstallResult { ok: boolean; message: string }

/**
 * Install the GitHub CLI with winget. The caller must have confirmed with the
 * user first: this downloads and runs an installer.
 */
export async function installGhCli(): Promise<InstallResult> {
  if (process.platform !== 'win32') {
    return { ok: false, message: 'Automatic install is Windows only. Install the GitHub CLI from cli.github.com, then hit Retry.' };
  }
  const probe = await run('winget', ['--version'], { timeoutMs: 30_000 });
  if (!probe.ok) {
    return { ok: false, message: 'winget is not available on this machine. Install the GitHub CLI from cli.github.com, then hit Retry.' };
  }
  const r = await run('winget', [
    'install', '--id', 'GitHub.cli',
    '--accept-source-agreements', '--accept-package-agreements',
  ], { timeoutMs: WINGET_TIMEOUT_MS });

  if (!r.ok) {
    const tail = `${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-4).join(' ').slice(0, 300);
    return { ok: false, message: `winget could not install the GitHub CLI. ${tail}` };
  }
  // A fresh install lands outside this process's inherited PATH, so gh usually
  // is not callable until the app restarts. Say that instead of looking broken.
  const version = await ghVersion();
  return version
    ? { ok: true, message: `GitHub CLI ${version} installed. Now run gh auth login in a terminal, then hit Retry.` }
    : { ok: true, message: 'GitHub CLI installed. Restart Job Finder, run gh auth login in a terminal, then hit Retry.' };
}
