/**
 * Parsers for GitHub CLI output (pure — no child_process, fs or electron, so
 * vitest can load it).
 *
 * `gh auth status` is a human-readable report, not a JSON API, and it has moved
 * between stdout and stderr across versions. The runner hands us both streams
 * joined together and this decides what they mean.
 */

export interface GhAuthInfo {
  authenticated: boolean;
  login: string;
  scopes: string[];
  host: string;
}

/** Strip ANSI colour codes so a coloured terminal report still parses. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '');
}

export function parseGhAuthStatus(raw: string): GhAuthInfo {
  const text = stripAnsi(raw);
  const info: GhAuthInfo = { authenticated: false, login: '', scopes: [], host: '' };
  if (!text.trim()) return info;

  const host = /^\s*([a-z0-9.-]+\.[a-z]{2,})\s*$/im.exec(text);
  if (host) info.host = host[1];

  const login = /Logged in to ([a-z0-9.-]+) (?:account|as) ([A-Za-z0-9-]+)/i.exec(text);
  if (login) {
    info.authenticated = true;
    info.host = info.host || login[1];
    info.login = login[2];
  }
  if (/not logged in|You are not logged into any GitHub hosts/i.test(text)) info.authenticated = false;

  const scopes = /Token scopes:\s*(.+)/i.exec(text);
  if (scopes) {
    info.scopes = scopes[1]
      .split(',')
      .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  return info;
}

/** The scopes a repo scan needs. Missing ones mean private repos stay hidden. */
export const REQUIRED_SCOPES = ['repo'];

export function missingScopes(scopes: string[]): string[] {
  const have = new Set(scopes.map(s => s.toLowerCase()));
  return REQUIRED_SCOPES.filter(s => !have.has(s));
}

/** A token looks plausible before we spend a round trip on it. */
export function looksLikeToken(value: string): boolean {
  const v = String(value ?? '').trim();
  if (v.length < 20 || /\s/.test(v)) return false;
  return /^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|[0-9a-f]{40})$/.test(v);
}
