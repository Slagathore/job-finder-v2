import * as fs from 'fs';
import * as path from 'path';
import { getDb, getDbPath } from '../ipc/db';
import { readSettings } from '../ipc/settings';
import { health } from '../llm/provider';

/**
 * Setup doctor — one-click "is everything wired correctly" diagnostics
 * (career-ops doctor.mjs / verify-pipeline.mjs, folded into the app).
 * Every check is fast and failure-tolerant; a broken check reports itself
 * broken rather than throwing.
 */

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runDoctor(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const s = readSettings();

  // 1. Database writable
  try {
    const db = getDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('doctor_probe', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
    db.prepare("DELETE FROM settings WHERE key = 'doctor_probe'").run();
    const jobs = (db.prepare('SELECT COUNT(*) n FROM jobs').get() as { n: number }).n;
    checks.push({ name: 'Database', ok: true, detail: `writable · ${jobs} jobs` });
  } catch (e: any) {
    checks.push({ name: 'Database', ok: false, detail: e?.message ?? String(e) });
  }

  // 2. LLM backend
  try {
    const h = await health(s);
    const ok = h.ollamaUp || h.anthropicConfigured;
    checks.push({
      name: 'AI backend', ok,
      detail: h.ollamaUp ? `Ollama up · ${s.primaryModel}` : h.anthropicConfigured ? 'Ollama down — Anthropic fallback available' : 'no Ollama, no Anthropic key — AI features disabled',
    });
  } catch (e: any) {
    checks.push({ name: 'AI backend', ok: false, detail: e?.message ?? String(e) });
  }

  // 3. Extension hub listening
  try {
    const port = Number(s.hubPort) || 17893;
    const res = await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout(3000) });
    checks.push({ name: 'Extension hub', ok: res.ok, detail: res.ok ? `listening on ${port}` : `ping returned HTTP ${res.status}` });
  } catch {
    checks.push({ name: 'Extension hub', ok: false, detail: `nothing answering on port ${Number(s.hubPort) || 17893} — is another app holding it?` });
  }

  // 4. Extension actually paired (has it ever delivered?)
  try {
    const n = (getDb().prepare("SELECT COUNT(*) n FROM jobs WHERE source IN ('extension','indeed','linkedin','careerbuilder','glassdoor','ziprecruiter')").get() as { n: number }).n;
    checks.push({ name: 'Extension pairing', ok: n > 0 || !!s.hubToken, detail: n > 0 ? `${n} jobs harvested via extension` : 'token ready — no harvests received yet (load the extension and click Harvest)' });
  } catch (e: any) {
    checks.push({ name: 'Extension pairing', ok: false, detail: e?.message ?? String(e) });
  }

  // 5. Boards
  try {
    const n = (getDb().prepare('SELECT COUNT(*) n FROM boards WHERE enabled = 1').get() as { n: number }).n;
    checks.push({ name: 'Scan boards', ok: n > 0, detail: n > 0 ? `${n} boards enabled` : 'no boards enabled — Boards tab' });
  } catch (e: any) {
    checks.push({ name: 'Scan boards', ok: false, detail: e?.message ?? String(e) });
  }

  // 6. Candidate profile (used on tailored resumes)
  const contactOk = !!(s.candidateName && s.candidateEmail);
  checks.push({ name: 'Contact details', ok: contactOk, detail: contactOk ? `${s.candidateName} <${s.candidateEmail}>` : 'name/email missing — Settings (used on generated resumes)' });

  // 7. Experience engine
  try {
    const n = (getDb().prepare('SELECT COUNT(*) n FROM experience_items').get() as { n: number }).n;
    checks.push({ name: 'Experience engine', ok: n > 0, detail: n > 0 ? `${n} line items` : 'no line items — import a résumé in the Experience tab' });
  } catch (e: any) {
    checks.push({ name: 'Experience engine', ok: false, detail: e?.message ?? String(e) });
  }

  // 8. Gmail (optional — only flagged if configured but broken-looking)
  checks.push({
    name: 'Gmail ingest', ok: true,
    detail: s.gmailRefreshToken ? `connected as ${s.gmailEmail || 'unknown'}` : 'not connected (optional)',
  });

  // 9. Backups
  try {
    const dir = path.join(path.dirname(getDbPath()), 'backups');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^jobfinder-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort() : [];
    const latest = files[files.length - 1];
    const ageDays = latest ? Math.floor((Date.now() - new Date(latest.slice(10, 20)).getTime()) / 86_400_000) : Infinity;
    checks.push({ name: 'DB backups', ok: ageDays <= 2, detail: latest ? `${files.length} kept · newest ${latest.slice(10, 20)}` : 'no backups yet (created daily on boot / 6h timer)' });
  } catch (e: any) {
    checks.push({ name: 'DB backups', ok: false, detail: e?.message ?? String(e) });
  }

  return checks;
}
