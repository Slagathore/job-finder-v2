import { BrowserWindow } from 'electron';
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
 * Discovery caveat, inherited from career-ops: Google may serve a CAPTCHA —
 * we detect it and tell the user instead of hammering. Two queries per run,
 * human-ish delays, five results max, exactly like the original.
 */

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

export async function discoverContacts(company: string, role?: string):
  Promise<{ added: Contact[]; found: number; captcha?: boolean } | { error: string }> {
  if (!company.trim()) return { error: 'Enter a company name.' };

  const queries = [
    `site:linkedin.com/in "${company.trim()}" recruiter "talent acquisition"`,
    ...(role?.trim() ? [`site:linkedin.com/in "${company.trim()}" "${role.trim()}" hiring manager`] : []),
  ];

  const win = new BrowserWindow({
    show: false, width: 1100, height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const results: { linkedin_url: string; raw_name: string; titleHint: string }[] = [];
  let captcha = false;

  try {
    for (const query of queries) {
      if (results.length >= MAX_CONTACTS) break;
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=5`;
      try {
        await win.loadURL(url);
        await sleep(GOOGLE_DELAY_MS);
        if (win.webContents.getURL().includes('/sorry/')) { captcha = true; break; }
        const batch = await win.webContents.executeJavaScript(COLLECT_JS) as { linkedin_url: string; raw_name: string }[];
        const titleHint = query.includes('recruiter') ? 'Technical Recruiter' : 'Hiring Manager';
        for (const r of batch ?? []) {
          if (!results.some(x => x.linkedin_url === r.linkedin_url)) results.push({ ...r, titleHint });
          if (results.length >= MAX_CONTACTS) break;
        }
      } catch (e: any) {
        console.error('[contacts] query failed:', e?.message ?? e);
      }
      await sleep(GOOGLE_DELAY_MS);
    }
  } finally {
    win.destroy();
  }

  // Persist, deduping against contacts we already know.
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
  if (captcha && !results.length) {
    return { error: 'Google served a CAPTCHA — try again later (or add the contact manually from a normal browser search).' };
  }
  return { added, found: results.length, captcha };
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
    if (!out.message) return { error: 'The model returned no usable message — try again.' };
    touchContact(contactId);
    return out;
  } catch (e: any) { return { error: e?.message ?? String(e) }; }
}
