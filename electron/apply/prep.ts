import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { generate } from '../llm/provider';
import { getDb } from '../ipc/db';
import { readSettings } from '../ipc/settings';
import { buildPrepPrompt, parsePrep, type PrepDoc } from './prep-parse';
import { listStories, saveGeneratedStories, touchStories } from '../career/stories';

const slug = (s: string) => (s || 'job').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function renderPrepHtml(job: any, prep: PrepDoc): string {
  const esc = (s: string) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  const li = (xs: string[]) => xs.map(x => `<li>${esc(x)}</li>`).join('');
  const stories = prep.stories.map(s => `<li><b>${esc(s.q)}</b><br>${esc(s.a)}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:14px/1.6 -apple-system,Segoe UI,sans-serif;max-width:760px;margin:32px auto;padding:0 24px;color:#1a1a1a}
    h1{font-size:22px} h2{font-size:16px;border-bottom:1px solid #ccc;padding-bottom:4px;margin-top:24px} li{margin:6px 0}
  </style></head><body>
    <h1>Interview prep — ${esc(job.title)} @ ${esc(job.company)}</h1>
    <h2>Likely questions</h2><ul>${li(prep.questions)}</ul>
    <h2>Your stories (STAR)</h2><ul>${stories}</ul>
    <h2>Questions to ask them</h2><ul>${li(prep.askThem)}</ul>
  </body></html>`;
}

export async function prepForJob(jobId: number): Promise<{ prep: PrepDoc; path: string } | { error: string }> {
  const db = getDb();
  const job = db.prepare('SELECT id, title, company, description FROM jobs WHERE id = ?').get(jobId) as any;
  if (!job) return { error: 'Job not found.' };
  const items = db.prepare('SELECT kind, text FROM experience_items LIMIT 40').all() as any[];
  // Story bank: feed saved stories in for reuse, persist new ones after.
  const bank = listStories().slice(0, 12);
  try {
    const r = await generate(readSettings(), buildPrepPrompt(job, items, bank), { temperature: 0.3, maxTokens: 1800 });
    const prep = parsePrep(r.text);
    try { touchStories(bank.map(s => s.id)); saveGeneratedStories(jobId, prep.stories); } catch { /* bank is best-effort */ }
    const dir = path.join(app.getPath('userData'), 'output', `${jobId}-${slug(job.company)}-prep`);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'interview-prep.html');
    fs.writeFileSync(file, renderPrepHtml(job, prep), 'utf-8');
    return { prep, path: file };
  } catch (e: any) { return { error: e?.message ?? String(e) }; }
}
