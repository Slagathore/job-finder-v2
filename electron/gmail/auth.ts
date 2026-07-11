/** Minimal Google OAuth (installed-app, loopback redirect) via fetch — no SDK. */

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';

export function buildAuthUrl(clientId: string, redirectUri: string): string {
  const p = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: SCOPE, access_type: 'offline', prompt: 'consent',
  });
  return `${AUTH}?${p.toString()}`;
}

async function tokenRequest(params: Record<string, string>): Promise<any> {
  const res = await fetch(TOKEN, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error_description || j.error || `token HTTP ${res.status}`);
  return j;
}

export function exchangeCode(clientId: string, clientSecret: string, code: string, redirectUri: string) {
  return tokenRequest({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
}

export async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const j = await tokenRequest({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' });
  return j.access_token;
}
