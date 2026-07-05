/**
 * Pure request router for the hub's local HTTP ingress (PLAN.md §5.1 transport).
 * Kept side-effect-free (deps injected) so it's unit-testable without a socket.
 * The extension talks to this over http://127.0.0.1:<port> with an X-JF-Token.
 */

export interface HubDeps {
  token: string;
  ingestJobs: (jobs: any[]) => { added: number; duplicates: number; skipped: number; updated?: number };
  ingestFields: (fields: any[]) => { saved: number };
  status: () => any;
  appVersion: string;
  oauthCallback?: (code: string) => Promise<string>;
  /** Extension found 0 job cards on a results page — selectors likely stale. */
  scraperStale?: (site: string, url: string) => void;
}

export interface RouteResult { status: number; body: any | null; }

export function handleRequest(
  method: string,
  path: string,
  headers: Record<string, string | string[] | undefined>,
  body: any,
  deps: HubDeps
): RouteResult {
  if (method === 'OPTIONS') return { status: 204, body: null };

  // /ping is unauthenticated so the extension can detect the hub before pairing.
  if (method === 'GET' && path === '/ping') {
    return { status: 200, body: { ok: true, app: 'job-finder-v2', version: deps.appVersion } };
  }

  const token = headers['x-jf-token'];
  const provided = Array.isArray(token) ? token[0] : token;
  if (!deps.token || provided !== deps.token) {
    return { status: 401, body: { error: 'Invalid or missing X-JF-Token. Pair the extension in Settings.' } };
  }

  if (method === 'POST' && path === '/ingest/jobs') {
    const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
    return { status: 200, body: deps.ingestJobs(jobs) };
  }
  if (method === 'POST' && path === '/ingest/fields') {
    const fields = Array.isArray(body?.fields) ? body.fields : [];
    return { status: 200, body: deps.ingestFields(fields) };
  }
  if (method === 'POST' && path === '/ingest/stale') {
    deps.scraperStale?.(String(body?.site ?? 'unknown'), String(body?.url ?? ''));
    return { status: 200, body: { ok: true } };
  }
  if (method === 'GET' && path === '/status') {
    return { status: 200, body: deps.status() };
  }

  return { status: 404, body: { error: `No route for ${method} ${path}` } };
}
