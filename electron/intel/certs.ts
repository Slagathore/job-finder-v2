import { generate, type ChatMessage } from '../llm/provider';
import { getDb } from '../ipc/db';
import { readSettings } from '../ipc/settings';
import { getProfile } from '../experience/store';
import { parseCerts, type Cert } from './parse';

export type { Cert };

const CACHE_MS = 30 * 24 * 60 * 60 * 1000;

const SYSTEM = `Advise which certificates/credentials would most boost a candidate's viability (and pay) in a
target field, given their background. Rank by impact-per-effort. Be honest — some fields value certs little.
Respond with ONLY a JSON array:
[ { "certificate": "...", "lift": "low|medium|high", "effort": "low|medium|high",
    "rationale": "<1 sentence on the viability boost>", "confidence": "low|medium|high" } ]`;

export function buildCertsPrompt(field: string, profile: any): ChatMessage[] {
  return [{ role: 'system', content: SYSTEM },
    { role: 'user', content: `Target field/role: ${field}\nCandidate background: ${profile?.narrative ?? 'n/a'}; skills: ${(profile?.skills ?? []).slice(0, 20).join(', ')}.\n\nList up to 8 certs ranked by impact-per-effort.` }];
}

export async function certAdvice(field: string, force = false): Promise<{ certs: Cert[] } | { error: string }> {
  if (!field.trim()) return { error: 'Enter a target field/role.' };
  const db = getDb();
  const cached = db.prepare('SELECT certificate, lift_estimate, rationale, cached_at FROM cert_advice WHERE field_role = ? ORDER BY cached_at DESC').all(field) as any[];
  if (!force && cached.length && Date.now() - cached[0].cached_at < CACHE_MS) {
    return { certs: cached.map(c => { try { return JSON.parse(c.rationale); } catch { return { certificate: c.certificate, lift: c.lift_estimate, effort: 'medium', rationale: '', confidence: 'low' }; } }) };
  }
  try {
    const r = await generate(readSettings(), buildCertsPrompt(field, getProfile()), { temperature: 0.3, maxTokens: 3000 });
    const certs = parseCerts(r.text);
    const now = Date.now();
    db.prepare('DELETE FROM cert_advice WHERE field_role = ?').run(field);
    const ins = db.prepare('INSERT INTO cert_advice (field_role, certificate, lift_estimate, rationale, cached_at) VALUES (?,?,?,?,?)');
    const tx = db.transaction(() => { for (const c of certs) ins.run(field, c.certificate, c.lift, JSON.stringify(c), now); });
    tx();
    return { certs };
  } catch (e: any) { return { error: e?.message ?? String(e) }; }
}
