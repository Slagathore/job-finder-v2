import * as http from 'http';
import { handleRequest, type HubDeps } from './router';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-JF-Token',
};

const MAX_BODY = 8 * 1024 * 1024; // 8 MB cap

/**
 * Start the hub's localhost HTTP ingress. Binds to 127.0.0.1 only. `getDeps` is
 * called per request so the token/handlers always reflect current settings.
 */
export function startHubServer(getDeps: () => HubDeps, port: number): http.Server {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;

    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { aborted = true; res.writeHead(413, CORS); res.end(); req.destroy(); return; }
      chunks.push(c);
    });

    req.on('end', async () => {
      if (aborted) return;
      const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = parsed.pathname;

      // OAuth loopback callback (browser redirect, not the extension) — HTML response.
      if (req.method === 'GET' && pathname === '/oauth/callback') {
        const code = parsed.searchParams.get('code') ?? '';
        let msg = 'Missing authorization code.';
        try { if (code && getDeps().oauthCallback) msg = await getDeps().oauthCallback!(code); }
        catch (e: any) { msg = `Error: ${e?.message ?? e}`; }
        res.writeHead(200, { ...CORS, 'Content-Type': 'text/html' });
        res.end(`<!doctype html><body style="font:16px sans-serif;padding:40px"><h2>Job Finder</h2><p>${msg}</p></body>`);
        return;
      }

      let body: any = null;
      if (chunks.length) {
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf-8')); }
        catch { res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON body' })); return; }
      }
      let out;
      try {
        out = handleRequest(req.method ?? 'GET', pathname, req.headers as any, body, getDeps());
      } catch (e: any) {
        out = { status: 500, body: { error: e?.message ?? String(e) } };
      }
      const headers: Record<string, string> = { ...CORS };
      if (out.body !== null) headers['Content-Type'] = 'application/json';
      res.writeHead(out.status, headers);
      res.end(out.body === null ? undefined : JSON.stringify(out.body));
    });
  });

  server.on('error', (err) => console.error('[hub-server] error:', err.message));
  server.listen(port, '127.0.0.1', () => console.log(`[hub-server] listening on http://127.0.0.1:${port}`));
  return server;
}
