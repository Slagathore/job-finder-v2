import { ipcMain } from 'electron';
import { readSettings, writeSetting as saveSetting } from './settings';
import { buildAuthUrl, exchangeCode } from '../gmail/auth';
import { getProfileEmail } from '../gmail/client';
import { ingestInbox } from '../gmail/ingest';

function redirectUri(): string {
  return `http://127.0.0.1:${readSettings().hubPort}/oauth/callback`;
}

/** Hub OAuth callback handler: exchange the code, store refresh token + email. */
export async function handleOAuthCode(code: string): Promise<string> {
  const s = readSettings();
  if (!s.gmailClientId || !s.gmailClientSecret) return 'Missing client ID/secret in Settings.';
  try {
    const tok = await exchangeCode(s.gmailClientId, s.gmailClientSecret, code, redirectUri());
    if (!tok.refresh_token) return 'No refresh token returned (revoke prior grant + retry with prompt=consent).';
    saveSetting('gmailRefreshToken', tok.refresh_token);
    let email = '';
    try { email = await getProfileEmail(tok.access_token); } catch { /* */ }
    saveSetting('gmailEmail', email);
    return `Connected${email ? ` as ${email}` : ''}. You can close this tab.`;
  } catch (e: any) {
    return `OAuth failed: ${e?.message ?? e}`;
  }
}

export function registerGmailHandlers() {
  ipcMain.handle('gmail:authUrl', () => {
    const s = readSettings();
    if (!s.gmailClientId) return { error: 'Set the Gmail client ID in Settings first.' };
    return { url: buildAuthUrl(s.gmailClientId, redirectUri()) };
  });
  ipcMain.handle('gmail:status', () => {
    const s = readSettings();
    return { connected: !!s.gmailRefreshToken, email: s.gmailEmail || '' };
  });
  ipcMain.handle('gmail:ingest', () => ingestInbox());
  ipcMain.handle('gmail:disconnect', () => { saveSetting('gmailRefreshToken', ''); saveSetting('gmailEmail', ''); return { ok: true }; });
}
