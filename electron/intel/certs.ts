import { generate, type ChatMessage } from '../llm/provider';
import { getDb } from '../ipc/db';
import { readSettings } from '../ipc/settings';
import { getProfile } from '../experience/store';
import { parseCerts, ensurePromotionTrack, normalizeCert, type Cert } from './parse';

export type { Cert };

const CACHE_MS = 30 * 24 * 60 * 60 * 1000;

const SYSTEM = `Advise which certificates/credentials would most boost a candidate's viability (and pay) in a
target field, given their background. Rank by impact-per-effort. Be honest, some fields value certs little.

For every suggestion you MUST also say what it makes the candidate a candidate FOR:
"industries" is the list of industries that credential opens up or strengthens, and "titles" is the list
of actual job titles they could apply to with it (real posting titles, not vague families).

Exactly one suggestion must have "track": "promotion". That one is the promotion track option: a step up
in seniority or scope (lead, senior, manager, principal, or a materially bigger remit), not a sideways
move. Every other suggestion uses "track": "lateral".

Respond with ONLY a JSON array:
[ { "certificate": "...", "lift": "low|medium|high", "effort": "low|medium|high",
    "rationale": "<1 sentence on the viability boost>", "confidence": "low|medium|high",
    "industries": ["..."], "titles": ["..."], "track": "promotion|lateral" } ]`;

export function buildCertsPrompt(field: string, profile: any): ChatMessage[] {
  return [{ role: 'system', content: SYSTEM },
    { role: 'user', content: `Target field/role: ${field}\nCandidate background: ${profile?.narrative ?? 'n/a'}; skills: ${(profile?.skills ?? []).slice(0, 20).join(', ')}.\nCurrent seniority: ${profile?.seniority ?? 'unknown'}.\n\nList up to 8 certs ranked by impact-per-effort, with industries and job titles on each, and exactly one marked as the promotion track.` }];
}

export async function certAdvice(field: string, force = false): Promise<{ certs: Cert[] } | { error: string }> {
  if (!field.trim()) return { error: 'Enter a target field/role.' };
  const db = getDb();
  const cached = db.prepare('SELECT certificate, lift_estimate, rationale, cached_at FROM cert_advice WHERE field_role = ? ORDER BY cached_at DESC').all(field) as any[];
  if (!force && cached.length && Date.now() - cached[0].cached_at < CACHE_MS) {
    // The rationale column holds the whole suggestion as JSON, so rows cached
    // before industries/titles/track existed still load: normalizeCert fills
    // the new fields in rather than leaving undefined holes in the table.
    const rows = cached.map(c => {
      try { return normalizeCert(JSON.parse(c.rationale)); }
      catch { return normalizeCert({ certificate: c.certificate, lift: c.lift_estimate }); }
    });
    return { certs: ensurePromotionTrack(rows) };
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
