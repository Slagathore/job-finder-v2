import { generate, type ChatMessage } from '../llm/provider';
import { getDb } from '../ipc/db';
import { readSettings } from '../ipc/settings';
import { parseCompanyIntel, type CompanyIntel } from './parse';

export type { CompanyIntel };

const CACHE_MS = 30 * 24 * 60 * 60 * 1000;

const SYSTEM = `Give a candidate a quick read on a company as an employer.
Respond with ONLY: { "rating": <0-5 number|null>, "pros": ["..."], "cons": ["..."], "summary": "<1-2 sentences>", "confidence": "low|medium|high" }
The rating is your best ESTIMATE of an overall employee-satisfaction score (Glassdoor-style), not a fetched figure.`;

export function buildCompanyPrompt(company: string): ChatMessage[] {
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Company: ${company}` }];
}

export async function getCompanyIntel(company: string, force = false): Promise<CompanyIntel | { error: string }> {
  const db = getDb();
  const cached = db.prepare('SELECT * FROM company_intel WHERE company = ? ORDER BY cached_at DESC LIMIT 1').get(company) as any;
  if (!force && cached && Date.now() - cached.cached_at < CACHE_MS) {
    try { const d = JSON.parse(cached.salary_data); return { ...d, company, rating: cached.glassdoor_score, source: 'cache' }; } catch { /* refetch */ }
  }
  try {
    const r = await generate(readSettings(), buildCompanyPrompt(company), { temperature: 0.3, maxTokens: 400 });
    const intel = parseCompanyIntel(r.text, company);
    db.prepare('INSERT INTO company_intel (company, glassdoor_score, salary_data, cached_at) VALUES (?, ?, ?, ?)')
      .run(company, intel.rating, JSON.stringify({ pros: intel.pros, cons: intel.cons, summary: intel.summary, confidence: intel.confidence }), Date.now());
    return intel;
  } catch (e: any) { return { error: e?.message ?? String(e) }; }
}
