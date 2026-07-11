export interface Email { id: string; from: string; subject: string; date: string; snippet: string; body: string; }

/** Decode Gmail's base64url payloads. Pure. */
export function decodeB64Url(data: string): string {
  if (!data) return '';
  try { return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
  catch { return ''; }
}

function header(headers: any[], name: string): string {
  return (headers || []).find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function extractBody(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeB64Url(payload.body.data);
  if (Array.isArray(payload.parts)) {
    for (const p of payload.parts) { const t = extractBody(p); if (t) return t; }
  }
  if (payload.body?.data) {                         // html or unknown — strip tags
    const d = decodeB64Url(payload.body.data);
    return payload.mimeType === 'text/html' ? stripHtml(d) : d;
  }
  return '';
}

/** Parse a Gmail users.messages.get (format=full) response into a flat Email. Pure. */
export function parseMessage(msg: any): Email {
  const headers = msg?.payload?.headers ?? [];
  return {
    id: msg?.id ?? '',
    from: header(headers, 'From'),
    subject: header(headers, 'Subject'),
    date: header(headers, 'Date'),
    snippet: msg?.snippet ?? '',
    body: extractBody(msg?.payload).slice(0, 8000),
  };
}

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export async function listMessages(token: string, q: string, max = 30): Promise<{ id: string }[]> {
  const url = `${API}/messages?q=${encodeURIComponent(q)}&maxResults=${max}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`gmail list HTTP ${res.status}`);
  const j = await res.json();
  return j.messages ?? [];
}

export async function getMessage(token: string, id: string): Promise<Email> {
  const res = await fetch(`${API}/messages/${id}?format=full`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`gmail get HTTP ${res.status}`);
  return parseMessage(await res.json());
}

export async function getProfileEmail(token: string): Promise<string> {
  const res = await fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return '';
  return (await res.json()).emailAddress ?? '';
}
