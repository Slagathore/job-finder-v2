/**
 * GitHub REST client, plain fetch with a bearer token. No SDK dependency: the
 * handful of endpoints this needs are not worth another package in the tree.
 *
 * The token is a live credential. It only ever appears in an Authorization
 * header, never in a thrown message, a log line or an LLM prompt.
 */

import {
  DEEP_MAX_FILE_BYTES, MANIFEST_NAMES, isManifest,
  looksBinaryContent, pickSourceFiles, shouldSkipPath,
  type SourceFile, type WalkFile,
} from './filter';

const API = 'https://api.github.com';
const UA = 'job-finder-v2';
const TIMEOUT_MS = 20_000;

export interface GhRepo {
  full_name: string;
  name: string;
  owner: string;
  private: boolean;
  description: string | null;
  language: string | null;
  pushed_at: string | null;
  html_url: string;
  default_branch: string;
  fork: boolean;
  archived: boolean;
  size: number;
}

function headers(token: string, accept = 'application/vnd.github+json'): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': UA,
  };
}

/** GET a JSON endpoint. Throws with the status but never with the token. */
async function apiJson<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: headers(token),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new Error('GitHub rejected the credentials. Reconnect or paste a fresh token.');
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    throw new Error('GitHub rate limit reached. Wait for it to reset and try again.');
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${path}`);
  return await res.json() as T;
}

/** GET raw file text, or null when the path is absent. */
async function apiRaw(token: string, path: string): Promise<string | null> {
  const res = await fetch(`${API}${path}`, {
    headers: headers(token, 'application/vnd.github.raw'),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return await res.text();
}

/** Who the token belongs to. Doubles as a cheap credential check. */
export async function whoAmI(token: string): Promise<{ login: string }> {
  const u = await apiJson<{ login: string }>(token, '/user');
  return { login: u.login };
}

function normalizeRepo(r: any): GhRepo {
  return {
    full_name: String(r.full_name ?? ''),
    name: String(r.name ?? ''),
    owner: String(r.owner?.login ?? r.full_name?.split('/')[0] ?? ''),
    private: !!r.private,
    description: r.description ?? null,
    language: r.language ?? null,
    pushed_at: r.pushed_at ?? null,
    html_url: String(r.html_url ?? ''),
    default_branch: String(r.default_branch ?? 'main'),
    fork: !!r.fork,
    archived: !!r.archived,
    size: Number(r.size ?? 0),
  };
}

/**
 * Every repo the token can see, private ones included, paginated to the end.
 * /user/repos with the default affiliation covers owned, collaborator and org
 * member repos, which is the whole point of asking for the repo scope.
 */
export async function listAllRepos(token: string, maxPages = 20): Promise<GhRepo[]> {
  const out: GhRepo[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await apiJson<any[]>(
      token,
      `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const r of batch) if (r?.full_name) out.push(normalizeRepo(r));
    if (batch.length < 100) break;
  }
  return out;
}

export async function getRepo(token: string, fullName: string): Promise<GhRepo> {
  return normalizeRepo(await apiJson<any>(token, `/repos/${fullName}`));
}

export async function getReadme(token: string, fullName: string): Promise<string | null> {
  const text = await apiRaw(token, `/repos/${fullName}/readme`);
  return text && text.trim() ? text : null;
}

export async function getLanguages(token: string, fullName: string): Promise<Record<string, number>> {
  try { return await apiJson<Record<string, number>>(token, `/repos/${fullName}/languages`); }
  catch { return {}; }
}

/** Top level file names, so the model can see the shape of the repo. */
export async function getTopLevelTree(token: string, fullName: string): Promise<string[]> {
  try {
    const entries = await apiJson<any[]>(token, `/repos/${fullName}/contents/`);
    if (!Array.isArray(entries)) return [];
    return entries.map(e => (e.type === 'dir' ? `${e.name}/` : String(e.name))).sort();
  } catch { return []; }
}

/** The first package manifest the repo actually has, if any. */
export async function getManifest(
  token: string, fullName: string, topLevel: string[]
): Promise<{ name: string; content: string } | null> {
  const present = topLevel.filter(n => !n.endsWith('/') && isManifest(n));
  const ordered = [
    ...MANIFEST_NAMES.filter(n => present.includes(n)),
    ...present.filter(n => !MANIFEST_NAMES.includes(n)),
  ];
  for (const name of ordered.slice(0, 3)) {
    const content = await apiRaw(token, `/repos/${fullName}/contents/${encodeURI(name)}`);
    if (content && content.trim()) return { name, content };
  }
  return null;
}

/** Everything a medium dive reads. */
export async function fetchMediumFacts(token: string, repo: GhRepo) {
  const [readme, languages, tree] = await Promise.all([
    getReadme(token, repo.full_name).catch(() => null),
    getLanguages(token, repo.full_name),
    getTopLevelTree(token, repo.full_name),
  ]);
  const manifest = await getManifest(token, repo.full_name, tree).catch(() => null);
  return { readme, languages, tree, manifest };
}

/** The whole tree as {path,size}, filtered by the walk rules. */
export async function getSourceTree(token: string, fullName: string, branch: string): Promise<WalkFile[]> {
  const t = await apiJson<{ tree?: any[]; truncated?: boolean }>(
    token, `/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  );
  const entries = Array.isArray(t.tree) ? t.tree : [];
  return entries
    .filter(e => e?.type === 'blob' && typeof e.path === 'string')
    .filter(e => !shouldSkipPath(e.path))
    .map(e => ({ path: String(e.path), size: Number(e.size ?? 0) }));
}

/**
 * Read the ranked pick of source files, head-clipped, skipping anything that
 * turns out to be binary once it is in hand.
 */
export async function readSourceFiles(
  token: string, fullName: string, branch: string, files: WalkFile[]
): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  for (const f of files) {
    const text = await apiRaw(token, `/repos/${fullName}/contents/${f.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`)
      .catch(() => null);
    if (!text || looksBinaryContent(text)) continue;
    out.push({ path: f.path, text: text.slice(0, DEEP_MAX_FILE_BYTES) });
  }
  return out;
}

/** Ranked, budgeted source read for one repo. */
export async function fetchDeepSource(token: string, repo: GhRepo): Promise<SourceFile[]> {
  const tree = await getSourceTree(token, repo.full_name, repo.default_branch);
  return readSourceFiles(token, repo.full_name, repo.default_branch, pickSourceFiles(tree));
}
