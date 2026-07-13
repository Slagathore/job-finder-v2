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
  // That makes it the one route a normal webpage's own JS could poll from an
  // ordinary browser tab to fingerprint "is Job Finder running" (no CORS
  // headers are sent back, so the page can't read the body, but a fetch() that
  // resolves vs. rejects already leaks that much). The extension's requests
  // come from its service worker (no Origin header, or a chrome-extension://
  // one) and same-machine callers (curl, the app's own doctor check) never set
  // an Origin at all — so reject only when an http(s) PAGE origin is present.
  if (method === 'GET' && path === '/ping') {
    const origin = headers['origin'];
    const originVal = Array.isArray(origin) ? origin[0] : origin;
    if (originVal && /^https?:\/\//i.test(originVal)) {
      return { status: 403, body: { error: 'Forbidden origin.' } };
    }
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
