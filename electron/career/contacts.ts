import { BrowserWindow, session } from 'electron';
import { getDb } from '../ipc/db';
import { readSettings } from '../ipc/settings';
import { generate } from '../llm/provider';
import { getProfile } from '../experience/store';
import { buildOutreachPrompt, parseOutreach, nameFromSlugOrText } from './outreach-prompt';

/**
 * Contacts: manual CRUD + recruiter/hiring-manager discovery via Google
 * site-search (ported from career-ops enrich.mjs searchLinkedInContacts) +
 * outreach message generation (modes/contacto.md).
 *
 * Discovery caveat, inherited from career-ops: Google serves a CAPTCHA, a cookie
 * consent page, or an interstitial to a fresh cookie-less automated context far more
 * often than it does to a normal browser. Two fixes for that:
 *  - the window runs in a NAMED, PERSISTED session (persist:career-contacts), so once
 *    Cole clicks through a prompt once, the cookies stick and later runs skip it;
 *  - when a run hits a block (or comes back with nothing), the window is SHOWN instead
 *    of silently failing, so he can see what Google is asking for and click through it.
 * Two queries per run (strict, then a broader fallback), human-ish delays, five results
 * max, close to the career-ops original.
 */

const SESSION_PARTITION = 'persist:career-contacts';

/** Best-effort detection of Google's cookie/consent interstitial. Covers both the
 *  standalone consent.google.com redirect and the in-page banner Google sometimes
 *  renders directly on the results page for a fresh session. */
function looksLikeConsentUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'consent.google.com' || u.pathname.startsWith('/consent');
  } catch { return false; }
}

const CONSENT_PROMPT_JS = `(() => {
  const sel = ['#L2AGLb', 'button[aria-label="Accept all"]', 'button[aria-label="I agree"]', 'form[action*="consent"] button'];
  return sel.some(s => document.querySelector(s));
})()`;

export interface Contact {
  id: number;
  company: string;
  name: string | null;
  title: string | null;
  kind: string;
  linkedin_url: string | null;
  notes: string | null;
  source: string;
  created_at: number;
  last_contacted: number | null;
}

const MAX_CONTACTS = 5;
const GOOGLE_DELAY_MS = 2000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function listContacts(company?: string): Contact[] {
  const db = getDb();
  return (company?.trim()
    ? db.prepare('SELECT * FROM contacts WHERE company LIKE ? ORDER BY created_at DESC').all(`%${company.trim()}%`)
    : db.prepare('SELECT * FROM contacts ORDER BY created_at DESC').all()) as Contact[];
}

export function addContact(c: { company: string; name?: string; title?: string; kind?: string; linkedin_url?: string; notes?: string; source?: string }): Contact {
  const db = getDb();
  const r = db.prepare(`INSERT INTO contacts (company, name, title, kind, linkedin_url, notes, source, created_at)
    VALUES (@company, @name, @title, @kind, @linkedin_url, @notes, @source, @created_at)`).run({
    company: c.company.trim(), name: c.name?.trim() || null, title: c.title?.trim() || null,
    kind: c.kind || 'recruiter', linkedin_url: c.linkedin_url?.trim() || null,
    notes: c.notes?.trim() || null, source: c.source || 'manual', created_at: Date.now(),
  });
  return db.prepare('SELECT * FROM contacts WHERE id = ?').get(r.lastInsertRowid) as Contact;
}

export function deleteContact(id: number): void {
  getDb().prepare('DELETE FROM contacts WHERE id = ?').run(id);
}

export function touchContact(id: number): void {
  getDb().prepare('UPDATE contacts SET last_contacted = ? WHERE id = ?').run(Date.now(), id);
}

/** Collect linkedin.com/in anchors from a rendered Google results page. */
const COLLECT_JS = `(() => {
  const found = [];
  document.querySelectorAll('a[href*="linkedin.com/in"]').forEach((link) => {
    const href = link.href.split('?')[0];
    if (!href.includes('linkedin.com/in/')) return;
    if (found.some((f) => f.linkedin_url === href)) return;
    const container = link.closest('div[class]') ?? link.parentElement;
    const headingEl = (container && container.querySelector('h3')) ?? link;
    const rawName = (headingEl.textContent || '').trim();
    const m = href.match(/\\/in\\/([^/]+)/);
    found.push({ linkedin_url: href, raw_name: rawName || (m ? m[1] : '') });
  });
  return found.slice(0, 5);
})()`;

export type ContactsDiagnosis = 'ok' | 'consent' | 'captcha' | 'no-results' | 'network-error';

export interface DiscoverContactsResult {
  added: Contact[];
  found: number;
  diagnosis: ContactsDiagnosis;
  usedQuery: 'strict' | 'broad' | null;
  message: string;
}

export async function discoverContacts(company: string, role?: string):
  Promise<DiscoverContactsResult | { error: string }> {
  if (!company.trim()) return { error: 'Enter a company name.' };

  const attempts: { label: 'strict' | 'broad'; query: string }[] = [
    { label: 'strict', query: `site:linkedin.com/in "${company.trim()}" recruiter "talent acquisition"` },
    // Falls back to a broader query (no title requirement) when the strict one comes up
    // empty, a small company may not have anyone whose title says "talent acquisition".
    { label: 'broad', query: `site:linkedin.com/in "${company.trim()}"${role?.trim() ? ` "${role.trim()}"` : ''}` },
  ];

  // A named, persisted session: cookies and any consent Cole clicks through survive
  // between runs, so a block hit once should not recur on the next Discover contacts.
  const sess = session.fromPartition(SESSION_PARTITION);
  const win = new BrowserWindow({
    show: false, width: 1100, height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, session: sess },
  });

  const results: { linkedin_url: string; raw_name: string; titleHint: string }[] = [];
  let usedQuery: 'strict' | 'broad' | null = null;
  let blockedReason: 'captcha' | 'consent' | null = null;
  let networkError = false;

  for (const attempt of attempts) {
    if (results.length >= MAX_CONTACTS) break;
    const url = `https://www.google.com/search?q=${encodeURIComponent(attempt.query)}&num=5`;
    try {
      await win.loadURL(url);
    } catch (e: any) {
      console.error('[contacts] load failed:', e?.message ?? e);
      networkError = true;
      continue;
    }
    await sleep(GOOGLE_DELAY_MS);

    const currentUrl = win.webContents.getURL();
    if (currentUrl.includes('/sorry/')) { blockedReason = 'captcha'; break; }
    if (looksLikeConsentUrl(currentUrl)) { blockedReason = 'consent'; break; }
    const hasConsentPrompt = await win.webContents.executeJavaScript(CONSENT_PROMPT_JS).catch(() => false);
    if (hasConsentPrompt) { blockedReason = 'consent'; break; }

    const batch = await win.webContents.executeJavaScript(COLLECT_JS).catch(() => []) as { linkedin_url: string; raw_name: string }[];
    const titleHint = attempt.label === 'strict' ? 'Technical Recruiter' : 'Hiring Manager';
    let addedThisAttempt = 0;
    for (const r of batch ?? []) {
      if (!results.some(x => x.linkedin_url === r.linkedin_url)) { results.push({ ...r, titleHint }); addedThisAttempt++; }
      if (results.length >= MAX_CONTACTS) break;
    }
    if (addedThisAttempt > 0 && usedQuery == null) usedQuery = attempt.label;
    await sleep(GOOGLE_DELAY_MS);
  }

  // Persist whatever was found, even if a later attempt then hit a block, deduping
  // against contacts we already know.
  const db = getDb();
  const known = new Set((db.prepare('SELECT linkedin_url FROM contacts WHERE linkedin_url IS NOT NULL').all() as { linkedin_url: string }[]).map(r => r.linkedin_url));
  const added: Contact[] = [];
  for (const r of results) {
    if (known.has(r.linkedin_url)) continue;
    added.push(addContact({
      company: company.trim(),
      name: nameFromSlugOrText(r.raw_name),
      title: r.titleHint,
      kind: r.titleHint === 'Technical Recruiter' ? 'recruiter' : 'hiring-manager',
      linkedin_url: r.linkedin_url,
      source: 'discovered',
    }));
  }

  let diagnosis: ContactsDiagnosis;
  let message: string;
  if (results.length > 0) {
    diagnosis = 'ok';
    message = `Found ${results.length} profile${results.length === 1 ? '' : 's'} from the ${usedQuery} search.`;
  } else if (blockedReason === 'captcha') {
    diagnosis = 'captcha';
    message = 'Google served a CAPTCHA. A browser window is now open, solve it there, then click Discover contacts again. The session is remembered, so future runs should not hit it again.';
  } else if (blockedReason === 'consent') {
    diagnosis = 'consent';
    message = 'Google is showing a cookie/consent prompt. A browser window is now open, click through it, then click Discover contacts again. The session is remembered, so future runs should not hit it again.';
  } else if (networkError) {
    diagnosis = 'network-error';
    message = 'Could not reach Google. Check your connection and try again.';
  } else {
    diagnosis = 'no-results';
    message = `Both searches loaded but found no LinkedIn profiles for ${company.trim()}. A browser window is now open so you can see what Google actually returned.`;
  }

  // Show the window rather than failing invisibly whenever there is nothing to show
  // for the run and something for Cole to look at or click through. A pure network
  // error gets no window: there is nothing loaded worth looking at.
  if (results.length === 0 && diagnosis !== 'network-error') {
    try { win.show(); } catch { /* */ }
  } else {
    win.destroy();
  }

  return { added, found: results.length, diagnosis, usedQuery, message };
}

export async function draftOutreach(contactId: number, jobId?: number):
  Promise<{ message: string; alternate: string } | { error: string }> {
  const db = getDb();
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId) as Contact | undefined;
  if (!contact) return { error: 'Contact not found.' };
  const job = jobId ? db.prepare('SELECT title, description FROM jobs WHERE id = ?').get(jobId) as any : null;
  const profile = getProfile() as any;
  const accomplishments = (db.prepare("SELECT text FROM experience_items WHERE kind = 'accomplishment' LIMIT 6").all() as { text: string }[]).map(r => r.text);
  try {
    const r = await generate(readSettings(), buildOutreachPrompt(
      { name: contact.name, title: contact.title, kind: contact.kind, company: contact.company },
      { narrative: profile?.narrative, skills: profile?.skills, topAccomplishments: accomplishments },
      job,
    ), { temperature: 0.5, maxTokens: 800 });
    const out = parseOutreach(r.text);
    if (!out.message) return { error: 'The model returned no usable message, try again.' };
    touchContact(contactId);
    return out;
  } catch (e: any) { return { error: e?.message ?? String(e) }; }
}
